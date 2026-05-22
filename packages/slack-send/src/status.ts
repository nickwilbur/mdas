// Pure mapping-status computation. No I/O.
//
// Resolution order (highest priority wins):
//   1. Manual override (admin-maintained)
//   2. Salesforce Internal_Customer_Slack_Channel__c
//   3. Sheet import (operational tracker CSV, admin-imported)
//   4. Cache (carry-forward from previous refresh)
//   5. Heuristic (computed cust-{slug} candidate — NAME ONLY, not sendable)
//   6. Unresolved
//
// Status meanings:
//   mapped                       — URL parsed cleanly, channel id extracted
//   missing_salesforce_channel   — no override, SFDC field empty, no cache
//   invalid_slack_url            — a URL is present but doesn't parse to a
//                                  valid Slack channel id
//   inaccessible_channel         — set only by an out-of-band validation
//                                  pass (Slack API conversations.info
//                                  returned not_in_channel / channel_not_found).
//                                  Refresh never sets this on its own.
//   unresolved                   — catch-all for "no URL from any source"
//   manually_overridden          — an override URL was used AND parsed; the
//                                  mapping is usable but the source is
//                                  override, not Salesforce.

import { parseSlackUrl } from './parse.js';

export type MappingStatus =
  | 'mapped'
  | 'missing_salesforce_channel'
  | 'invalid_slack_url'
  | 'inaccessible_channel'
  | 'unresolved'
  | 'manually_overridden'
  | 'heuristic_candidate';

export type MappingSource = 'salesforce' | 'override' | 'sheet' | 'heuristic' | 'cache';

export interface MappingStatusInput {
  /** Internal_Customer_Slack_Channel__c on the SFDC Account, or null. */
  salesforceUrl: string | null;
  /** Manual override URL, or null. */
  overrideUrl: string | null;
  /** Admin-imported sheet URL, or null. */
  sheetUrl?: string | null;
  /** Previously-cached URL from the durable mapping table, or null. */
  cachedUrl: string | null;
  /**
   * Heuristic-derived channel name (e.g. "cust-stenograph"). This is a
   * NAME, not a URL — there is no way to manufacture a Slack channel
   * id from a name without calling the Slack API. Heuristic-only rows
   * resolve to status='heuristic_candidate' and are NOT sendable.
   */
  heuristicCandidateName?: string | null;
  /**
   * Pre-existing `inaccessible_channel` flag from a prior validation pass.
   * If true AND we'd otherwise return `mapped`/`manually_overridden`, we
   * preserve `inaccessible_channel` so a known-bad channel can't silently
   * flip back to mapped without a successful re-validation.
   */
  knownInaccessible?: boolean;
}

export interface MappingStatusResult {
  status: MappingStatus;
  statusReason: string;
  source: MappingSource;
  slackUrl: string | null;
  slackChannelId: string | null;
  /** For heuristic source: the derived channel name (e.g. "cust-acme"). */
  derivedChannelName?: string | null;
}

export function computeMappingStatus(input: MappingStatusInput): MappingStatusResult {
  // 1. Override path.
  if (input.overrideUrl) {
    const parsed = parseSlackUrl(input.overrideUrl);
    if (!parsed) {
      return {
        status: 'invalid_slack_url',
        statusReason: 'Manual override URL did not parse as a Slack channel URL.',
        source: 'override',
        slackUrl: input.overrideUrl,
        slackChannelId: null,
      };
    }
    if (input.knownInaccessible) {
      return {
        status: 'inaccessible_channel',
        statusReason: 'Override URL parsed, but a prior validation marked the channel inaccessible.',
        source: 'override',
        slackUrl: input.overrideUrl,
        slackChannelId: parsed.channelId,
      };
    }
    return {
      status: 'manually_overridden',
      statusReason: 'Manual override in effect.',
      source: 'override',
      slackUrl: input.overrideUrl,
      slackChannelId: parsed.channelId,
    };
  }

  // 2. Salesforce path.
  if (input.salesforceUrl) {
    const parsed = parseSlackUrl(input.salesforceUrl);
    if (!parsed) {
      return {
        status: 'invalid_slack_url',
        statusReason:
          'Salesforce Internal Customer Slack Channel field is populated but does not parse as a Slack channel URL.',
        source: 'salesforce',
        slackUrl: input.salesforceUrl,
        slackChannelId: null,
      };
    }
    if (input.knownInaccessible) {
      return {
        status: 'inaccessible_channel',
        statusReason: 'Salesforce URL parsed, but a prior validation marked the channel inaccessible.',
        source: 'salesforce',
        slackUrl: input.salesforceUrl,
        slackChannelId: parsed.channelId,
      };
    }
    return {
      status: 'mapped',
      statusReason: 'Resolved from Salesforce Internal Customer Slack Channel field.',
      source: 'salesforce',
      slackUrl: input.salesforceUrl,
      slackChannelId: parsed.channelId,
    };
  }

  // 3. Sheet path — admin-imported from the operational tracker CSV.
  //    Treated like a real URL source (parsed, status='mapped'); the
  //    `source` field tells the UI it came from the sheet, not SFDC.
  if (input.sheetUrl) {
    const parsed = parseSlackUrl(input.sheetUrl);
    if (!parsed) {
      return {
        status: 'invalid_slack_url',
        statusReason: 'Sheet-imported URL does not parse as a Slack channel URL.',
        source: 'sheet',
        slackUrl: input.sheetUrl,
        slackChannelId: null,
      };
    }
    if (input.knownInaccessible) {
      return {
        status: 'inaccessible_channel',
        statusReason: 'Sheet URL parsed, but a prior validation marked the channel inaccessible.',
        source: 'sheet',
        slackUrl: input.sheetUrl,
        slackChannelId: parsed.channelId,
      };
    }
    return {
      status: 'mapped',
      statusReason:
        'No Salesforce value; resolved from admin-imported operational tracker sheet.',
      source: 'sheet',
      slackUrl: input.sheetUrl,
      slackChannelId: parsed.channelId,
    };
  }

  // 4. Cache path — last good URL from a prior refresh, when SFDC went empty.
  if (input.cachedUrl) {
    const parsed = parseSlackUrl(input.cachedUrl);
    if (!parsed) {
      return {
        status: 'invalid_slack_url',
        statusReason: 'Cached URL no longer parses; Salesforce field is empty.',
        source: 'cache',
        slackUrl: input.cachedUrl,
        slackChannelId: null,
      };
    }
    return {
      status: 'mapped',
      statusReason:
        'Salesforce field is empty; falling back to previously-cached URL. Update Salesforce to clear this fallback.',
      source: 'cache',
      slackUrl: input.cachedUrl,
      slackChannelId: parsed.channelId,
    };
  }

  // 5. Heuristic path — last resort. We have a derived channel-NAME
  //    (cust-{slug}) but no channel-ID. Surface it so the user can
  //    verify in Slack and promote to override, but DO NOT mark the row
  //    sendable — there is no channel id and the send gate requires one.
  if (input.heuristicCandidateName) {
    return {
      status: 'heuristic_candidate',
      statusReason:
        `No Salesforce, sheet, override, or cached URL. Derived candidate name "${input.heuristicCandidateName}" from the cust-{slug} convention — verify in Slack and add an override to use.`,
      source: 'heuristic',
      slackUrl: null,
      slackChannelId: null,
      derivedChannelName: input.heuristicCandidateName,
    };
  }

  // 6. Nothing.
  return {
    status: 'missing_salesforce_channel',
    statusReason:
      'No Salesforce value, no manual override, no sheet import, no cached URL, no derivable candidate.',
    source: 'salesforce',
    slackUrl: null,
    slackChannelId: null,
  };
}
