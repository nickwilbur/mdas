---
description: Generate Expand 3 churn-risk Slack CTAs from Cerebro, SFDC, and Glean signals
---

# Expand 3 CTA Generator Workflow

## Run Modes

- `/expand3-cta-generator scan` — Full sweep of all Expand 3 accounts
- `/expand3-cta-generator account <name>` — Single account deep dive
- `/expand3-cta-generator followup` — Check open CTAs in expand3_cta_log.jsonl
- `/expand3-cta-generator weekly_clari` — Format for Clari churn forecast update

## Scan Mode Steps

1. **Fetch account universe** — Pull the SFDC "Expand 3 Accounts with Slack Channels" report via `mcp2_read_document` using URL `https://zuora.lightning.force.com/lightning/r/Report/00OPo00000ktI8HMAU/view`. Parse the factMap rows to extract: account name, SFDC account ID, AE, CSE, franchise, Slack channel URL, ARR, renewal date, CSE sentiment, customer status.

2. **Pull CSE Sentiment Commentary + SFDC account details** — For each account with Red/Yellow sentiment OR renewal within 4 quarters, search `mcp2_search` with `app: salescloud` and the account name. Extract from the SFDC Account snippets:
   - **CSE Sentiment Commentary** (State & Renewal Risk + Action Plan narrative)
   - **CSE Sentiment Last Updated** timestamp
   - **Account Engagement Status** (e.g. "7. Customer - No Open Opp")
   - **Churn Predictor** status
   - **Last Task Completed** (most recent SFDC activity)
   - **Next Task Planned**
   
   ⚠️ **This is the most critical data source for CTA quality.** The sentiment commentary often contains context that changes the CTA play type entirely (e.g. a utilization_risk becomes a managed_wind_down if the CSE already documented the customer is shutting down).

3. **Pull Cerebro health signals** — For each account in scope, search `mcp2_search` with `app: cerebro` and the account name. Extract the 7 health signal flags and their quantitative values from matchingFilters.

4. **Pull renewal opportunities** — For accounts with renewals in the next 4 quarters from run date, search `mcp2_search` with `app: salescloud` for `<account_name> renewal opportunity`. Extract: opp name, URL, stage, ACV, ACV delta, forecast most likely, last activity date, churn risk, churn reason.

5. **Pull recent Glean activity** — For high-risk accounts, use `mcp2_search` to find recent Slack messages, meeting notes, emails, and Gainsight CTAs from the last 90 days. Include email threads (`type: email`) for accounts where sentiment commentary is stale or missing.

6. **Apply trigger rules with context** — Evaluate each account against the trigger rules, BUT factor in CSE Sentiment Commentary and recent activity before finalizing the play type:
   - If commentary already documents a known issue + active plan → downgrade from action CTA to **awareness/tracking** CTA
   - If commentary shows wind-down / EOL → reclassify as `managed_wind_down` instead of utilization_risk/engagement_risk
   - If commentary is recent (< 30 days) and AE/CSE are actively working → flag as `team_aware` and adjust requested action accordingly
   - Standard trigger rules: dark_renewal, engagement_risk, no_strategic_engagement, scale_engagement, utilization_risk, suite_risk, share_risk, legacy_tech_risk, pricing_risk, expertise_risk, sentiment_stale, surprise_churn_watch, managed_wind_down

7. **Consolidate CTAs** — One CTA per account per run. If multiple rules fire, combine drivers. Include CSE Sentiment Commentary excerpt in drivers when available. Sort: Red first, then ARR descending, then renewal proximity.

8. **Generate output** — For each CTA, emit the §5 JSON schema + rendered Slack message in Nick's voice (direct, lowercase-casual, lead with ask, name the signal not the dashboard, end with deadline). Include `cse_sentiment_commentary` and `commentary_last_updated` fields in the JSON schema.

9. **Write tracking log** — Append each CTA to `expand3_cta_log.jsonl` with status: "open".

10. **Output scan document** — Write prioritized batch to `expand3_cta_scan_<date>.md`.

## Time Horizon

- **4 quarters from run date** — e.g. if run on 2026-05-11, cover renewals through 2027-05-11
- Prioritize by proximity: renewals in current quarter get tighter deadlines
- All Expand 3 accounts in scope regardless of renewal date if Red sentiment or critical Cerebro signals

## Follow-up Mode Steps

1. Read `expand3_cta_log.jsonl` and find all entries with `status: "open"` and `check_back_date <= today`.
2. For each, run the `auto_check_query` via `mcp2_search`.
3. Classify: closed_done, closed_acknowledged, or stalled.
4. For stalled CTAs, draft escalation message.
5. Update the log entry.
6. Output follow-through roll-up table.

## Guardrails

- Stay in Expand 3 only
- Never fabricate Cerebro signals — use data_gaps field
- Don't duplicate CTAs within 14 days for same account + play_type
- Confirmed Churn = retro only, not re-engagement CTA
- One Slack post per account per run
- Dry-run mode default (auto_post: false)

## Key Data Sources

- **SFDC Report**: `00OPo00000ktI8HMAU` (Expand 3 Accounts with Slack Channels)
- **Cerebro**: `mcp2_search` with `app: cerebro`, filter by account name
- **SFDC Opps**: `mcp2_search` with `app: salescloud`, filter by account + renewal
- **Glean Activity**: `mcp2_search` across slack, gainsight, staircase
- **Dark Renewals Reference**: Google Sheet "Expand 3 Dark Renewals with CTAs and Slack"
