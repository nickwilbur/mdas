# Expand 3 CTA Scan — 2026-05-11 (Dry Run)

**Mode:** `scan` | **Status:** `dry-run` (auto_post: false)
**Accounts scanned:** 224 | **Portfolio ARR:** $48,057,373
**CTAs generated:** 12 | **Confirmed churn retros:** 1
**Run timestamp:** 2026-05-11T19:48:00Z

---

## CTA Batch — Sorted: Red first, then ARR desc, then renewal proximity

---

### CTA-1 | The Dun & Bradstreet Corporation | surprise_churn_watch + pricing_risk

```json
{
  "cta_id": "0017000000Udec8AAB-20260511-surprise_churn_watch",
  "account_name": "The Dun & Bradstreet Corporation",
  "salesforce_account_id": "0017000000Udec8AAB",
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000GPeYvIAL/view",
  "play_type": "surprise_churn_watch",
  "risk_color": "🔴",
  "cerebro_risk_category": "High",
  "primary_owner": {
    "name": "Jeanie Isenhour",
    "slack_handle": "@jeanie.isenhour",
    "role": "AE"
  },
  "cc_owners": [
    { "name": "Kyle Larkin", "slack_handle": "@kyle.larkin", "role": "CSE" },
    { "name": "Nick Wilbur", "slack_handle": "@nick.wilbur", "role": "Manager" }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/CB775FV7V",
  "drivers": [
    "$850K downsell risk — ACV Delta -$850,000 on $1.12M ATR",
    "Customer threatening full platform exit within 12 months",
    "Pricing pushback — 'price has already doubled and makes it unaffordable'",
    "Contact transition — Pat Ryan handing off to Dave Matthews mid-renewal",
    "Cerebro Suite Risk = true",
    "Renewal due 5/28/2026 — 17 days"
  ],
  "requested_action": "Align on pricing floor with finance, prepare save play, loop Nick in before Thursday forecast call",
  "deadline": "2026-05-16",
  "follow_through": {
    "expected_artifact": "Updated SFDC Opportunity Next Steps with save play status | Pricing floor documented | Nick briefed",
    "check_back_date": "2026-05-20",
    "auto_check_query": "Glean Search: 'Dun Bradstreet renewal pricing' across salescloud, slack #gs-dun-bradstreet, gainsight since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No pricing alignment or save play by check_back_date"
  },
  "data_gaps": ["Slack handles need verification against Slack directory"]
}
```

🔴 @jeanie.isenhour @kyle.larkin — D&B renewal is due 5/28 and we're looking at an $850K downsell on $1.12M ATR. Pat Ryan is saying the price has doubled and it's unaffordable — he'll move off the platform in 12 months if we can't get creative. he's also transitioning to Dave Matthews mid-deal. we need to get aligned on pricing floor with finance and have a save play ready before thursday's forecast call. @nick.wilbur fyi — i need to be looped in on this one. by EOW. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000GPeYvIAL/view

---

### CTA-2 | True North Loyalty | managed_wind_down (reclassified from utilization_risk)

```json
{
  "cta_id": "0017000001QzjnGAAR-20260511-utilization_risk",
  "account_name": "True North Loyalty, LLC",
  "salesforce_account_id": "0017000001QzjnGAAR",
  "renewal_opportunity_url": null,
  "play_type": "managed_wind_down",
  "risk_color": "🔴",
  "cerebro_risk_category": "High",
  "primary_owner": {
    "name": "Ethan Wookey",
    "slack_handle": "@ethan.wookey",
    "role": "AE"
  },
  "cc_owners": [
    { "name": "Mahalakshmi Krishnan", "slack_handle": "@mahalakshmi.krishnan", "role": "CSE" }
  ],
  "destination_slack_channel": null,
  "cse_sentiment_commentary": "State & Renewal Risk: The customer is winding down their business but is open to a short-term contract extension. Their renewal is in June 2026, and they're willing to extend for approximately three months beyond their end-of-life timeline. If an extension isn't feasible, they plan to disconnect in June. Action Plan: The Account Executive is currently working on the renewal.",
  "commentary_last_updated": "2026-04-27T16:19:00.000+0000",
  "team_aware": true,
  "drivers": [
    "CSE Sentiment Commentary (4/27): Customer is winding down business, open to 3-month extension past June EOL",
    "AE is already working the renewal per CSE commentary",
    "Utilization at 19% vs 65% threshold — explained by wind-down",
    "Billing Product Share at 39% — explained by wind-down",
    "Expertise Risk — no TAM/ESA/PES/MS attached",
    "Cerebro Suite Risk = false, so OTC process coverage is adequate",
    "Renewal 6/14/2026 — 34 days"
  ],
  "requested_action": "Confirm whether 3-month extension is being papered. If yes, ensure SFDC opp reflects extension terms. If no extension, prepare for clean disconnect in June.",
  "deadline": "2026-05-23",
  "follow_through": {
    "expected_artifact": "Updated SFDC Opportunity with extension terms or disconnect plan | Renewal opp stage progression",
    "check_back_date": "2026-05-27",
    "auto_check_query": "Glean Search: 'True North Loyalty renewal extension' across salescloud, gainsight since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No opp update or extension decision by check_back_date"
  },
  "data_gaps": ["No Slack channel in SFDC report", "No renewal opportunity URL found"]
}
```

🔴 @ethan.wookey — True North Loyalty renews 6/14, $20K. CSE commentary from 4/27 says they're winding down operations but open to a 3-month extension past their EOL. you're already working the renewal — can you confirm whether we're papering the extension? if yes, update the opp with extension terms. if they're disconnecting in June, let's make sure we have a clean off-ramp. cc @mahalakshmi.krishnan. by 5/23.

---

### CTA-3 | Simpleview (DTN) | dark_renewal

```json
{
  "cta_id": "simpleview-20260511-dark_renewal",
  "account_name": "Simpleview Inc (DTN BU uses Zuora)",
  "salesforce_account_id": null,
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/0064u00001FGkUbAAL/view",
  "play_type": "dark_renewal",
  "risk_color": "🔴",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Ethan Wookey",
    "slack_handle": "@ethan.wookey",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": null,
  "drivers": [
    "Dark 265+ days — last SFDC activity 8/20/2025",
    "Renewal 5/30/2026 — 19 days",
    "Stage 2.0 Discover — no progression"
  ],
  "requested_action": "Reach out to customer, get a read, update SFDC",
  "deadline": "2026-05-16",
  "follow_through": {
    "expected_artifact": "Logged activity in SFDC | Updated opportunity stage or next steps",
    "check_back_date": "2026-05-20",
    "auto_check_query": "Glean Search: 'Simpleview DTN renewal' across salescloud since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No SFDC activity logged by check_back_date"
  },
  "data_gaps": ["SFDC Account ID not resolved from report", "No Slack channel", "Cerebro signals not pulled"]
}
```

🔴 @ethan.wookey — Simpleview (DTN) renewal is 5/30 and we've been dark for 265+ days. last activity was August 2025. opp is still at stage 2 Discover with 19 days to go. need a touch this week and an SFDC update so we know where we stand. by EOW. https://zuora.lightning.force.com/lightning/r/Opportunity/0064u00001FGkUbAAL/view

---

### CTA-4 | The Wrap News | dark_renewal

```json
{
  "cta_id": "wrap-news-20260511-dark_renewal",
  "account_name": "The Wrap News Inc.",
  "salesforce_account_id": null,
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po000004hfvGIAQ/view",
  "play_type": "dark_renewal",
  "risk_color": "🔴",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Cameron Challoner",
    "slack_handle": "@cameron.challoner",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": null,
  "drivers": [
    "Dark 13+ months — last SFDC activity 4/2/2025",
    "Zephr renewal 5/30/2026 — 19 days",
    "Stage 3.0 Define — stalled"
  ],
  "requested_action": "Reach out, get a read on Zephr renewal intent, update SFDC",
  "deadline": "2026-05-16",
  "follow_through": {
    "expected_artifact": "Logged activity in SFDC | Updated next steps",
    "check_back_date": "2026-05-20",
    "auto_check_query": "Glean Search: 'Wrap News Zephr renewal' across salescloud since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No SFDC activity logged by check_back_date"
  },
  "data_gaps": ["SFDC Account ID not resolved", "No Slack channel", "Cerebro signals not pulled"]
}
```

🔴 @cameron.challoner — The Wrap News Zephr renewal is 5/30, dark 13+ months (last activity April 2025). 19 days to close and we have no read on renewal intent. need a reach-out and SFDC update by EOW. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po000004hfvGIAQ/view

---

### CTA-5 | Dor Technologies | dark_renewal

```json
{
  "cta_id": "dor-tech-20260511-dark_renewal",
  "account_name": "Dor Technologies",
  "salesforce_account_id": null,
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000hSjawIAC/view",
  "play_type": "dark_renewal",
  "risk_color": "🔴",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Cameron Challoner",
    "slack_handle": "@cameron.challoner",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": null,
  "drivers": [
    "No logged SFDC activity",
    "Renewal 5/30/2026 — 19 days",
    "Stage 2.0 Discover — no progression"
  ],
  "requested_action": "Reach out, get a read, update SFDC",
  "deadline": "2026-05-16",
  "follow_through": {
    "expected_artifact": "Logged activity in SFDC | Updated next steps",
    "check_back_date": "2026-05-20",
    "auto_check_query": "Glean Search: 'Dor Technologies renewal' across salescloud since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No SFDC activity logged by check_back_date"
  },
  "data_gaps": ["SFDC Account ID not resolved", "No Slack channel", "Cerebro signals not pulled"]
}
```

🔴 @cameron.challoner — Dor Technologies renewal is 5/30 with no logged activity and still at stage 2 Discover. 19 days. need a touch and SFDC update by EOW. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000hSjawIAC/view

---

### CTA-6 | Finale Inventory | dark_renewal

```json
{
  "cta_id": "finale-inv-20260511-dark_renewal",
  "account_name": "Finale Inventory",
  "salesforce_account_id": null,
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000HVCeVIAX/view",
  "play_type": "dark_renewal",
  "risk_color": "🟡",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Dominic Varner",
    "slack_handle": "@dominic.varner",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": null,
  "drivers": [
    "Dark 90+ days",
    "Renewal 6/13/2026 — 33 days",
    "Stage 4.0 Validate"
  ],
  "requested_action": "Reach out, confirm renewal path, update SFDC",
  "deadline": "2026-05-23",
  "follow_through": {
    "expected_artifact": "Logged activity in SFDC | Updated next steps",
    "check_back_date": "2026-05-27",
    "auto_check_query": "Glean Search: 'Finale Inventory renewal' across salescloud since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No SFDC activity logged by check_back_date"
  },
  "data_gaps": ["SFDC Account ID not resolved", "No Slack channel", "Cerebro signals not pulled"]
}
```

🟡 @dominic.varner — Finale Inventory renews 6/13, dark 90+ days. opp is at stage 4 Validate but no recent activity. can you re-engage and confirm the renewal path? SFDC update by 5/23. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000HVCeVIAX/view

---

### CTA-7 | UpKeep Technologies | dark_renewal

```json
{
  "cta_id": "upkeep-20260511-dark_renewal",
  "account_name": "UPKEEP TECHNOLOGIES, INC",
  "salesforce_account_id": null,
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000jV1NjIAK/view",
  "play_type": "dark_renewal",
  "risk_color": "🟡",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Cameron Challoner",
    "slack_handle": "@cameron.challoner",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": null,
  "drivers": [
    "Dark 90+ days",
    "Renewal 6/14/2026 — 34 days",
    "Stage 2.0 Discover — no progression"
  ],
  "requested_action": "Reach out, update SFDC",
  "deadline": "2026-05-23",
  "follow_through": {
    "expected_artifact": "Logged activity in SFDC | Updated next steps",
    "check_back_date": "2026-05-27",
    "auto_check_query": "Glean Search: 'UpKeep Technologies renewal' across salescloud since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No SFDC activity logged by check_back_date"
  },
  "data_gaps": ["SFDC Account ID not resolved", "No Slack channel", "Cerebro signals not pulled"]
}
```

🟡 @cameron.challoner — UpKeep renewal is 6/14, dark 90+ days, still at stage 2. need a touch and SFDC update by 5/23. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000jV1NjIAK/view

---

### CTA-8 | Yesware | dark_renewal

```json
{
  "cta_id": "yesware-20260511-dark_renewal",
  "account_name": "Yesware, Inc.",
  "salesforce_account_id": null,
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000jzkaIIAQ/view",
  "play_type": "dark_renewal",
  "risk_color": "🟡",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Brandon LaTourelle",
    "slack_handle": "@brandon.latourelle",
    "role": "AE"
  },
  "cc_owners": [
    { "name": "Kiran Rajan", "slack_handle": "@kiran.rajan", "role": "CSE" }
  ],
  "destination_slack_channel": null,
  "drivers": [
    "Dark 90+ days",
    "Renewal 6/26/2026 — 46 days",
    "Stage 3.0 Define"
  ],
  "requested_action": "Reach out, update SFDC, loop in Kiran",
  "deadline": "2026-05-30",
  "follow_through": {
    "expected_artifact": "Logged activity in SFDC | Updated next steps",
    "check_back_date": "2026-06-03",
    "auto_check_query": "Glean Search: 'Yesware renewal' across salescloud since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No SFDC activity logged by check_back_date"
  },
  "data_gaps": ["SFDC Account ID not resolved", "No Slack channel", "Cerebro signals not pulled"]
}
```

🟡 @brandon.latourelle @kiran.rajan — Yesware renews 6/26, dark 90+ days. can you get a touch in and update SFDC? by 5/30. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000jzkaIIAQ/view

---

### CTA-9 | Deloitte LLP | dark_renewal

```json
{
  "cta_id": "deloitte-20260511-dark_renewal",
  "account_name": "Deloitte LLP",
  "salesforce_account_id": null,
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000jNV4PIAW/view",
  "play_type": "dark_renewal",
  "risk_color": "🟡",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Cameron Challoner",
    "slack_handle": "@cameron.challoner",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": null,
  "drivers": [
    "Dark 90+ days",
    "Renewal 6/28/2026 — 48 days",
    "Stage 2.0 Discover"
  ],
  "requested_action": "Reach out, update SFDC",
  "deadline": "2026-05-30",
  "follow_through": {
    "expected_artifact": "Logged activity in SFDC | Updated next steps",
    "check_back_date": "2026-06-03",
    "auto_check_query": "Glean Search: 'Deloitte renewal' across salescloud since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No SFDC activity logged by check_back_date"
  },
  "data_gaps": ["SFDC Account ID not resolved", "No Slack channel", "Cerebro signals not pulled"]
}
```

🟡 @cameron.challoner — Deloitte renewal is 6/28, dark 90+ days, stage 2 Discover. need a reach-out and SFDC update by 5/30. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000jNV4PIAW/view

---

### CTA-10 | RSA Conference | scale_engagement + utilization_risk

```json
{
  "cta_id": "0010g00001iSDmFAAW-20260511-utilization_risk",
  "account_name": "RSA Conference LLC",
  "salesforce_account_id": "0010g00001iSDmFAAW",
  "renewal_opportunity_url": null,
  "play_type": "utilization_risk",
  "risk_color": "🔴",
  "cerebro_risk_category": "High",
  "primary_owner": {
    "name": "Ethan Wookey",
    "slack_handle": "@ethan.wookey",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C08GTP9K6MR",
  "drivers": [
    "Utilization at 0% — platform appears unused",
    "0 VP+ meetings in last 90 days",
    "Suite Risk = true, Expertise Risk = true — no TAM/ESA",
    "CSE Sentiment = Red",
    "Renewal 10/31/2026 — ~6 months"
  ],
  "requested_action": "Determine if customer is actually using the platform, update SFDC sentiment with real commentary",
  "deadline": "2026-05-30",
  "follow_through": {
    "expected_artifact": "Updated SFDC CSE Sentiment commentary | Logged activity",
    "check_back_date": "2026-06-03",
    "auto_check_query": "Glean Search: 'RSA Conference' across salescloud, slack C08GTP9K6MR since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No sentiment update by check_back_date"
  },
  "data_gaps": ["No CSE assigned — AE acting as primary", "Cerebro risk_category inferred from 4/7 signals true"]
}
```

🔴 @ethan.wookey — RSA Conference is $24K, renews 10/31, red sentiment. Cerebro shows utilization at literally 0% and zero exec meetings in 90 days. suite and expertise risk both flagged, no TAM or ESA. need to figure out if they're actually using the platform or if this is a quiet churn in progress. get a touch in and update SFDC sentiment by 5/30. https://zuora.enterprise.slack.com/archives/C08GTP9K6MR

---

### CTA-11 | Sync.com | scale_engagement

```json
{
  "cta_id": "001700000192ydCAAQ-20260511-scale_engagement",
  "account_name": "Sync.com",
  "salesforce_account_id": "001700000192ydCAAQ",
  "renewal_opportunity_url": null,
  "play_type": "scale_engagement",
  "risk_color": "🔴",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Dominic Varner",
    "slack_handle": "@dominic.varner",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C093XPSB2BY",
  "drivers": [
    "CSE Sentiment = Red",
    "Renewal 10/31/2026 — ~6 months",
    "ARR $22K — scale account, no CSE assigned"
  ],
  "requested_action": "Get a touch in, update SFDC sentiment with real commentary",
  "deadline": "2026-05-30",
  "follow_through": {
    "expected_artifact": "Updated SFDC CSE Sentiment commentary | Logged activity",
    "check_back_date": "2026-06-03",
    "auto_check_query": "Glean Search: 'Sync.com' across salescloud, slack C093XPSB2BY since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No sentiment update by check_back_date"
  },
  "data_gaps": ["Cerebro signals not pulled for this account", "No CSE assigned"]
}
```

🔴 @dominic.varner — Sync.com is $22K, renews 10/31, red sentiment, no CSE coverage. need a touch and SFDC sentiment update so we have a real read. by 5/30. https://zuora.enterprise.slack.com/archives/C093XPSB2BY

---

### CTA-12 | Ekata | expertise_risk + engagement_risk

```json
{
  "cta_id": "0010g00001lEwSYAA0-20260511-expertise_risk",
  "account_name": "Ekata, Inc.",
  "salesforce_account_id": "0010g00001lEwSYAA0",
  "renewal_opportunity_url": null,
  "play_type": "expertise_risk",
  "risk_color": "🔴",
  "cerebro_risk_category": "High",
  "primary_owner": {
    "name": "Vinay Swamynathan",
    "slack_handle": "@vinay.swamynathan",
    "role": "CSE"
  },
  "cc_owners": [
    { "name": "Jeanie Isenhour", "slack_handle": "@jeanie.isenhour", "role": "AE" }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C091UP5EL93",
  "drivers": [
    "0 VP+ meetings in last 90 days",
    "Legacy Tech Risk = true",
    "Suite Risk = true — limited OTC process coverage",
    "Expertise Risk = true — no TAM/ESA/PES/MS",
    "CSE Sentiment = Red"
  ],
  "requested_action": "Schedule touch, understand why sentiment is red, assess CS investment need",
  "deadline": "2026-06-13",
  "follow_through": {
    "expected_artifact": "Updated SFDC CSE Sentiment commentary | CS investment request if warranted",
    "check_back_date": "2026-06-17",
    "auto_check_query": "Glean Search: 'Ekata' across salescloud, slack C091UP5EL93, gainsight since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No sentiment update by check_back_date"
  },
  "data_gaps": ["Cerebro risk_category inferred from 4/7 signals true", "Renewal far out (1/31/2031) — CTA driven by sentiment + risk signals not proximity"]
}
```

🔴 @vinay.swamynathan — Ekata is $25K, red sentiment, and Cerebro is showing zero exec meetings, legacy tech risk, suite risk, and no TAM/ESA. renewal is far out (2031) but with this many flags we need to understand why sentiment is red and whether a CS investment ask is warranted. get a touch in and update SFDC sentiment. cc @jeanie.isenhour. by 6/13. https://zuora.enterprise.slack.com/archives/C091UP5EL93

---

## Confirmed Churn Retro (no re-engagement CTA per §7)

### RETRO | Bird.com (MessageBird) | confirmed_churn

```json
{
  "cta_id": "0017000000jKKmrAAG-20260511-confirmed_churn_retro",
  "account_name": "Bird.com Inc. (fka MessageBird USA Inc.)",
  "salesforce_account_id": "0017000000jKKmrAAG",
  "renewal_opportunity_url": "https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000f2X57IAE/view",
  "play_type": "confirmed_churn_retro",
  "risk_color": "🔴",
  "cerebro_risk_category": null,
  "primary_owner": {
    "name": "Brandon LaTourelle",
    "slack_handle": "@brandon.latourelle",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": null,
  "drivers": [
    "Confirmed Full Churn — $308K ARR lost",
    "Churn reason: Zuora powering too small portion of their business",
    "Customer moved to internal billing system",
    "Cerebro: Engagement 0, Share 17%, Legacy Tech (Orders API 0%)"
  ],
  "requested_action": "Confirm churn reason and post quick post-mortem note in #expand-3-pod-fy27",
  "deadline": "2026-05-23",
  "follow_through": {
    "expected_artifact": "Post-mortem note in #expand-3-pod-fy27 | Churn reason documented in SFDC",
    "check_back_date": "2026-05-27",
    "auto_check_query": "Glean Search: 'Bird.com churn post-mortem' across slack #expand-3-pod-fy27 since 2026-05-11",
    "escalation_owner": "Nick Wilbur",
    "escalation_trigger": "No post-mortem by check_back_date"
  },
  "data_gaps": []
}
```

🔴 @brandon.latourelle — Bird.com is confirmed full churn, $308K. they moved to an internal billing system. Cerebro had them at engagement zero, share 17%, legacy tech. can you drop a quick post-mortem in #expand-3-pod-fy27 confirming the churn reason and any lessons? by 5/23. https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000f2X57IAE/view

---

## Accounts Evaluated — No CTA Generated

| Account | ARR | Renewal | Sentiment | Reason |
|---|---|---|---|---|
| TeamSnap | $112,587 | 5/14/2026 | Green | Actively in Stage 6.0 Agree, renewal being closed by Brandon/Sneha |
| Canon U.S.A. | $40,858 | 5/10/2026 | Green | 05-26 TAM already Closed/Won. Next renewal (05-27) in Stage 1.0 |
| Commerce.com | $1,434,195 | 12/31/2026 | Green | Healthy — no triggers fired |
| Paycor | $1,408,457 | 1/30/2029 | Green | Healthy — no triggers fired |
| Delta Defense | $1,072,649 | 10/28/2028 | Green | Healthy — no triggers fired |
| Xactware Solutions | $1,071,278 | 4/29/2028 | Green | Healthy — no triggers fired |
| Avetta | $995,238 | 10/24/2028 | Green | Healthy — no triggers fired |

---

## Owner Load Summary

| Owner | Role | CTAs This Run | Accounts |
|---|---|---|---|
| Cameron Challoner | AE | 4 | Wrap News, Dor Tech, UpKeep, Deloitte |
| Ethan Wookey | AE | 3 | True North (cc), Simpleview, RSA Conference |
| Jeanie Isenhour | AE | 2 | D&B (primary), Ekata (cc) |
| Dominic Varner | AE | 2 | Finale Inventory, Sync.com |
| Brandon LaTourelle | AE | 2 | Yesware, Bird.com retro |
| Mahalakshmi Krishnan | CSE | 1 | True North Loyalty |
| Kyle Larkin | CSE | 1 | D&B (cc) |
| Vinay Swamynathan | CSE | 1 | Ekata |
| Kiran Rajan | CSE | 1 | Yesware (cc) |

---

## Global Data Gaps

1. **Slack handles** — All @handles are inferred from `firstname.lastname` convention. Need verification against Zuora Slack workspace directory before enabling auto_post.
2. **Cerebro risk_category / risk_analysis narrative** — Not exposed as structured fields in Glean's Cerebro datasource. Risk category inferred using count-of-true-booleans heuristic (4+ = High, 2-3 = Moderate, 0-1 = Low).
3. **SFDC Account IDs for dark renewal accounts** — Several accounts from the Dark Renewals spreadsheet were not cross-referenced against the full SFDC report. Needs enrichment pass.
4. **CSE Sentiment last_updated dates** — Not retrieved for sentiment_stale rule evaluation. Need SFDC field-level query.
5. **Gainsight CTAs / Staircase sentiment** — Not pulled in this scan. Need Glean enrichment pass to check for duplicate CTA risk.
6. **Full 224-account sweep** — This scan focused on the highest-priority accounts (Red sentiment, near-term renewals, dark renewals). A complete sweep of all 224 accounts requires per-account Cerebro lookups not feasible in a single run.

---

*Generated by Expand 3 CTA Agent | dry-run | 2026-05-11T19:48:00Z*
