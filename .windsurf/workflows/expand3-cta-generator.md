---
description: Generate Expand 3 churn-risk Slack CTAs from Cerebro, SFDC, and Glean signals
---

# Expand 3 CTA Generator Workflow (v2 — Reasoning-First)

## Run Modes

- `/expand3-cta-generator scan` — Full sweep of all Expand 3 accounts
- `/expand3-cta-generator account <name>` — Single account deep dive
- `/expand3-cta-generator followup` — Check open CTAs in expand3_cta_log.jsonl
- `/expand3-cta-generator weekly_clari` — Format for Clari churn forecast update

## CTA Reasoning & Voice (v2)

A good CTA is not a data dump with a deadline appended. It's a peer-to-peer ask that proves Nick read the account, has a point of view, and respects the AE/CSE's time.

Every CTA goes through three layers. Layers 1-2 are private reasoning (stored in `situation_read` and `point_of_view` JSON fields for audit, never posted to Slack). Layer 3 is the only thing posted.

### Layer 1 — Situation Read (private → `situation_read` field)
Write a 2-4 sentence internal narrative: "What is actually happening with this account, in plain English?" Anchor in concrete observations from Cerebro + Glean + SFDC. Synthesize across sources — interpret signals, don't list them.

Good reads:
- "Renewal is 8/14/26 and we haven't had a real exec conversation since the 11/4/25 QBR. Utilization is fine but they just hired a new VP Finance who has a known preference for Stripe Billing. Risk isn't the product, it's that we're not in the room."
- "Critical risk by the Cerebro book — utilization 38%, share 22%, no VP+ engagement. But the Slack thread from 4/22/26 shows their team is mid-replatform and pausing all vendor reviews until Q3. The right play is a holding pattern, not a CTA."

If the read leads to "no CTA needed," stop. Emit `cta_suppressed: true` with reason.

### Layer 2 — Point of View (private → `point_of_view` field)
One sentence: "If I were Nick, what is the smallest meaningful thing I'd ask the owner to do this week, and why?"

The "smallest meaningful" constraint matters:
- ✅ "Get a 30-min discovery with the new VP Finance before she finishes vendor evals — by 5/22/26."
- ✅ "Confirm with the champion whether the replatform is real or rumor, then update SFDC sentiment by EOW."
- ❌ "Re-engage the account holistically" — vague, the AE will ignore it.

### Layer 3 — The Ask (posted to Slack)
Translate the POV into a 2-4 sentence Slack message in Nick's voice:
- One ask, one owner tagged with `@firstname` (lowercase)
- Two facts max — pick evidence that justifies the ask, skip everything else
- Dates as m/d/yy always. Deadline concrete: "by EOW" or "by Friday 5/15/26"
- Link the renewal opp when one exists (Slack mrkdwn: `<url|Renewal opp>`)
- No emojis except risk dot at start (🔴 🟡 🟢). No bullets, headers, bold
- Cc someone only if they must act too — integrate into ask ("can you and @thais")
- Data gaps go in JSON `data_gaps` field, NOT in the Slack message

### Self-Check (run silently before emitting each CTA)
1. Could a real human have written this in 90 seconds?
2. Is the ask specific enough that I'd know if the owner did it?
3. Did I cut every fact that doesn't change the ask?
4. Does it sound like Nick from the Dark Renewals sheet, or like a dashboard?

If any answer is "no," rewrite Layer 3.

### Anti-Signals (reasons NOT to post, even if a rule would fire)
- Customer is mid-migration/RFP and explicitly paused vendor activity
- Owner posted in channel within last 7 days about an active workstream
- A Gainsight CTA covering the same play is open and not yet past due
- Account is being handed off / re-pod'd this quarter
- Same play_type posted for this account in last 14 days without material risk change

### Calibration Examples

**Example A — engagement gap with org change:**
- Situation read: "D&B renewal is 5/28/26, $1.1M. Cerebro flags critical: zero VP+ meetings in 90 days and share at 31%. They hired a new CFO on 3/15/26 and we haven't introduced ourselves."
- POV: "Dominic and Thais need to get a CFO intro on calendar this week or we're going to forecast blind."
- Slack: `🔴 @dominic — D&B renews 5/28/26 and we've had zero exec engagement in 90 days. Their new CFO started 3/15/26 and we haven't met her. Can you and @thais get an intro on calendar by Friday 5/15/26 so we have a real read before the 5/14/26 forecast call? <url|Renewal opp>`

**Example B — utilization risk, real story is a stalled ask:**
- Situation read: "Acme is 9 months out, $340k. Utilization at 41% looks bad but the deeper issue is they asked for a Q2 utilization review on 3/12/26 and we never scheduled it."
- POV: "Brandon needs to schedule the review they already asked for."
- Slack: `🟡 @brandon — Acme asked us for a Q2 utilization review on 3/12/26 and we never got it on the calendar. Their champion has gone quiet and we're at 41% utilization with renewal 2/8/27. Can you get the review scheduled by EOW? <url|Renewal opp>`

**Example C — critical risk, right move is no CTA:**
- Situation read: "Alchemy is critical — utilization 22%, share 18%. Customer told us 4/22/26 they're consolidating to Shopify in 2027. Paused vendor evaluations until Q3."
- POV: "Nothing the AE can do this week that isn't noise. Hold and revisit July."
- Output: `cta_suppressed: true`, reason: "Customer paused vendor activity until Q3. Revisit July."

**Anti-example D (what NOT to do — mechanical v1 output):**
`🔴 @dominic — Account: D&B Inc | ARR: $1.1M | Renewal Date: 2026-05-28 | Risk Category: Critical | Utilization Risk: True | Share Risk: True | Suggested Action: Schedule customer touchpoint at your earliest convenience.`

## Scan Mode Steps

⚠️ **CRITICAL: A scan MUST evaluate ALL 224 accounts — not just Red/Yellow sentiment. The rolling 4-quarter renewal window and dark account detection require a full sweep. Never short-circuit to a subset.**

1. **Fetch account universe** — Pull the SFDC "Expand 3 Accounts with Slack Channels" report via `mcp2_read_document` using URL `https://zuora.lightning.force.com/lightning/r/Report/00OPo00000ktI8HMAU/view`. Parse the factMap rows to extract: account name, SFDC account ID, AE, CSE, franchise, Slack channel URL, ARR, renewal date, CSE sentiment, customer status.

2. **Identify evaluation scope** — From the account universe, flag accounts for evaluation in **three tiers** (accounts can appear in multiple tiers):
   - **Tier 1 — Risk signals**: Red or Yellow CSE sentiment, OR confirmed churn indicators
   - **Tier 2 — Renewal window**: Any account with a renewal date within the next 4 rolling quarters from run date (e.g. run 2026-05-11 → renewals through 2027-05-11)
   - **Tier 3 — Dark account candidates**: Accounts that match ANY of the dark account criteria below
   
   All three tiers are evaluated. Expect 50–100+ accounts in scope on a typical scan.

3. **Pull CSE Sentiment Commentary + SFDC account details** — For every account in scope (all three tiers), search `mcp2_search` with `app: salescloud` and the account name. Extract from the SFDC Account snippets:
   - **CSE Sentiment Commentary** (State & Renewal Risk + Action Plan narrative)
   - **CSE Sentiment Last Updated** timestamp
   - **Account Engagement Status** (e.g. "7. Customer - No Open Opp")
   - **Churn Predictor** status
   - **Last Task Completed** (most recent SFDC activity)
   - **Next Task Planned**
   
   ⚠️ **This is the most critical data source for CTA quality.** The sentiment commentary often contains context that changes the CTA play type entirely (e.g. a utilization_risk becomes a managed_wind_down if the CSE already documented the customer is shutting down).

4. **Pull Cerebro health signals** — For each account in scope, search `mcp2_search` with `app: cerebro` and the account name. Extract the 7 health signal flags and their quantitative values from matchingFilters.

5. **Pull renewal opportunities** — For accounts with renewals in the next 4 quarters from run date, search `mcp2_search` with `app: salescloud` for `<account_name> renewal opportunity`. Extract: opp name, URL, stage, ACV, ACV delta, forecast most likely, last activity date, churn risk, churn reason. **IMPORTANT: Include the `renewal_opportunity_url` field in the JSON schema for each CTA.**

6. **Pull recent Glean activity** — For high-risk accounts and dark account candidates, use `mcp2_search` to find recent Slack messages, meeting notes, emails, and Gainsight CTAs from the last 90 days. Include email threads (`type: email`) for accounts where sentiment commentary is stale or missing.

7. **Three-layer reasoning (v2 §2)** — For each account in scope, run the three-layer reasoning from the "CTA Reasoning & Voice" section above:
   - **Layer 1**: Write a `situation_read` (2-4 sentences, private). Use the Signal Lens below as evidence to weigh, not triggers to fire on.
   - **Layer 2**: Write a `point_of_view` (1 sentence, private). Smallest meaningful ask.
   - **Layer 3**: Write the Slack message (2-4 sentences, posted). Run the self-check.
   - **Suppression**: If the situation read + anti-signals lead to "no CTA needed," emit `cta_suppressed: true` with reason. Expect a meaningful share of accounts to produce no CTA — that’s correct behavior, not a bug.
   - Factor in CSE Sentiment Commentary before finalizing: if commentary documents known issue + active plan → `team_aware`; if commentary shows wind-down/EOL → `managed_wind_down`

8. **Consolidate** — One CTA per account per run. Sort: Red first, then ARR descending, then renewal proximity.

9. **Generate output** — For each CTA, emit JSON envelope with `situation_read`, `point_of_view`, `cse_sentiment_commentary`, `commentary_last_updated`, `renewal_opportunity_url` fields + the Layer 3 Slack message. Use m/d/yy dates everywhere.

10. **Write tracking log** — Append each CTA to `expand3_cta_log.jsonl` with status: "open".

11. **Output scan document** — Write prioritized batch to `expand3_cta_scan_<date>.md`. Include a section listing all accounts evaluated with no CTA generated and a one-line reason (e.g. "Green sentiment, no Cerebro flags, renewal 9 months out").

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

## Signal Lens (use as evidence for Layer 1, not as automated triggers)

### Dark Account Detection

A "dark" account is one where we have insufficient visibility to assess risk. An account is dark if it matches **any** of these criteria:

- **dark_renewal**: Renewal within 4 quarters AND (no SFDC opportunity activity in last 60 days OR opportunity stage is stale/early)
- **dark_account**: Account matches 2+ of the following, regardless of renewal date:
  - No CSE Sentiment Commentary, OR commentary older than 90 days
  - No CSE assigned (csCoverage = null or Digital-only)
  - SFDC Last Task Completed > 90 days ago OR null
  - No Slack channel in SFDC report
  - Cerebro Engagement Score < 20 OR null
  - No Glean activity (Slack/email/meetings) in last 90 days
  - Account Engagement Status contains "No Open Opp" or is null

Dark accounts are **high priority** even with Green sentiment — Green may just mean no one has looked.

### Other Signals

- **surprise_churn_watch**: Red sentiment + large ACV delta or confirmed churn signals, NOT already documented in commentary
- **managed_wind_down**: Commentary documents customer is exiting/winding down/consolidating away from Zuora
- **utilization_risk**: Cerebro Utilization < 65% threshold AND customer is NOT in documented wind-down
- **engagement_risk**: Cerebro Engagement Risk = true OR engagement score < 20
- **no_strategic_engagement**: No VP+ meetings in 90 days AND renewal within 2 quarters
- **scale_engagement**: Low engagement but no risk signals — needs proactive touch
- **suite_risk**: Cerebro Suite Risk = true (customer using narrow slice of platform)
- **share_risk**: Cerebro Share Risk = true (Billing Product Share < 50%)
- **legacy_tech_risk**: Cerebro Legacy Tech Risk = true
- **pricing_risk**: Commentary or signals indicate pricing pushback
- **expertise_risk**: No TAM/ESA/PES/MS attached AND Cerebro Expertise Risk = true
- **sentiment_stale**: CSE Sentiment Commentary > 90 days old AND renewal within 2 quarters
- **confirmed_churn_retro**: Confirmed full churn — retro only, not a re-engagement CTA

## Key Data Sources

- **SFDC Report**: `00OPo00000ktI8HMAU` (Expand 3 Accounts with Slack Channels)
- **Cerebro**: `mcp2_search` with `app: cerebro`, filter by account name
- **SFDC Opps**: `mcp2_search` with `app: salescloud`, filter by account + renewal
- **Glean Activity**: `mcp2_search` across slack, gainsight, staircase
- **Dark Renewals Reference**: Google Sheet "Expand 3 Dark Renewals with CTAs and Slack"
