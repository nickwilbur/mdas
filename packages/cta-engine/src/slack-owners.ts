/**
 * Correct SFDC Assigned_CSE__c identities to operational Slack mentions.
 *
 * SFDC occasionally points at the wrong user record (same display-name
 * collision). Keys are SFDC user ids; name fallbacks support JSONL CTAs
 * that only carry the stale display name.
 */

export interface SlackOwnerCorrection {
  name: string;
  slack_handle: string;
}

/** SFDC user id → operational CSE Slack identity */
const SFDC_CSE_CORRECTIONS: Record<string, SlackOwnerCorrection> = {
  // Mahalakshmi Krishnan (Finance BSA) is wrongly assigned in SFDC;
  // operational CSE is Mahalakshmi S (@Maha).
  '005Po000008o45VIAQ': { name: 'Mahalakshmi S', slack_handle: 'Maha' },
};

/** Display-name fallback when only the SFDC name is available. */
const CSE_NAME_CORRECTIONS: Record<string, SlackOwnerCorrection> = {
  'Mahalakshmi Krishnan': { name: 'Mahalakshmi S', slack_handle: 'Maha' },
};

export function resolveCseSlackOwner(
  sfdcUserId: string | null | undefined,
  sfdcName: string | null | undefined,
): { name: string; slack_handle?: string; role: 'CSE' } | null {
  if (!sfdcName?.trim()) return null;

  if (sfdcUserId && SFDC_CSE_CORRECTIONS[sfdcUserId]) {
    const c = SFDC_CSE_CORRECTIONS[sfdcUserId];
    return { name: c.name, slack_handle: c.slack_handle, role: 'CSE' };
  }

  const byName = CSE_NAME_CORRECTIONS[sfdcName.trim()];
  if (byName) {
    return { name: byName.name, slack_handle: byName.slack_handle, role: 'CSE' };
  }

  return { name: sfdcName.trim(), role: 'CSE' };
}
