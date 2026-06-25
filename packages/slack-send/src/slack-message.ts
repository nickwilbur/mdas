// Shared heuristics for classifying Slack messages indexed via Glean.

const AUTOMATED_SLACK_BODY =
  /\b(has joined|was added|added to|added by|joined #|joined the channel|left #|removed from|archived the channel|set the channel|changed the channel topic|pinned a message|invited @|channel created|app (was )?added|integration (has been )?added|is now a member|uploaded a file|shared an invitation|removed an integration)\b/i;

const AUTOMATED_SLACK_TITLE =
  /^(Slackbot|Google Calendar|Zoom|Gainsight|Jira|Salesforce|HubSpot|Asana|PagerDuty|Datadog|GitHub|Workflow Builder|Account Pulse)/i;

const AUTOMATED_SLACK_APP_POST =
  /\b(here(?:'s| is) what(?:'s| is) happening on the account|account pulse)\b/i;

/** True when a Slack title/snippet looks like a system or bot post, not a human. */
export function isAutomatedSlackMessage(title: string, summary: string | null): boolean {
  const blob = `${title} ${summary ?? ''}`;
  if (AUTOMATED_SLACK_BODY.test(blob)) return true;
  if (AUTOMATED_SLACK_TITLE.test(title.trim())) return true;
  if (AUTOMATED_SLACK_APP_POST.test(blob)) return true;
  return false;
}
