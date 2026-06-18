# Expand 3 CTA Scan — 2026-06-16

**Generated:** 2026-06-16T19:58:53.586Z
**Total CTAs:** 28
**Renewal scope:** FY27 + FY28 open renewals
**CTA gate:** dark, identified risk, or unhealthy only
**Script:** `scripts/generate-ctas.ts` (v3 — @mdas/cta-engine)

---
## CTA 1 — Riverbed Technology

```json
{
  "cta_id": "expand3-2026-06-16-riverbed-technology-dark_account",
  "account_name": "Riverbed Technology",
  "salesforce_account_id": "0017000000PnYcNAAV",
  "play_type": "dark_account",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Manoj Raja Krishnan",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Brandon LaTourelle",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B31K0QPPG",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000FavRvIAJ/view",
  "drivers": [
    "Renewal date: 2026-06-29",
    "ARR: $279,910",
    "ATR at risk: $279,910",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 6 min (30d) — below threshold",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-06-23",
  "check_back_date": "2026-06-16",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-06-16",
    "auto_check_query": "Riverbed Technology Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-06-23",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p>STATE &amp; RENEWAL RISK:  Full churn risk as the. Utilization of Zuora revenue has stopped since the end of February, when we try to connect with the customer, they keep delaying it, mentioning the month close. </p>",
  "commentary_last_updated": "2026-06-12T12:21:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Brandon LaTourelle",
    "role": "AE"
  },
  "cse": {
    "name": "Manoj Raja Krishnan",
    "role": "CSE"
  },
  "priority_score": 98,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 6 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0017000000PnYcNAAV:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 279910.2,
  "renewal_opportunity_name": "Riverbed Technology RevPro Renewal June 2026"
}
```

---

## CTA 2 — Antylia Scientific

```json
{
  "cta_id": "expand3-2026-06-16-antylia-scientific-dark_account",
  "account_name": "Antylia Scientific",
  "salesforce_account_id": "0017000001IFGK1AAP",
  "play_type": "dark_account",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B35PDQGUC",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000l1gIHIAY/view",
  "drivers": [
    "Renewal date: 2026-07-05",
    "ARR: $94,164",
    "ATR at risk: $47,082",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 1 min (30d) — below threshold",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-06-28",
  "check_back_date": "2026-06-21",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-06-21",
    "auto_check_query": "Antylia Scientific Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-06-28",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State and Renewal:<br style=\"\">Although current usage remains ok, Year-over-Year (YoY) results are weak. The customer seems less engaged, having declined recent Table Talk invitations, mentioning no interest for now.There is renewal risk</p><p color=\"\" style=\"\">Account Plan:</p><p color=\"\" style=\"\">we’ve reached out to Ashish Patel, Director of Software Engineering, to set up an account review. no response.Follow ups are done</p>",
  "commentary_last_updated": "2026-05-22T02:35:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 98,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 1 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0017000001IFGK1AAP:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 47082,
  "renewal_opportunity_name": "Antylia Scientific Billing 07-26"
}
```

---

## CTA 3 — Traxxall

```json
{
  "cta_id": "expand3-2026-06-16-traxxall-dark_account",
  "account_name": "Traxxall",
  "salesforce_account_id": "0010g00001aLjB5AAK",
  "play_type": "dark_account",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B32DM1LLW",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po000012adUJIAY/view",
  "drivers": [
    "Renewal date: 2026-12-22",
    "ARR: $39,000",
    "ATR at risk: $19,500",
    "CSE sentiment commentary last updated 141d ago",
    "No dedicated CSE (digital coverage)",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 1 min (30d) — below threshold"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Traxxall Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [
    "No CSE assigned (digital coverage)"
  ],
  "cse_sentiment_commentary": "<p>Confirmed churn. Zuora will no longer be the system of record for the Customer as of the renewal or the Customer has already migrated off of Zuora ahead of their renewal date (could include a “read-only” tenant)</p>",
  "commentary_last_updated": "2026-01-26T07:58:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cse": null,
  "priority_score": 92,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "CSE sentiment commentary last updated 141d ago",
      "observedAt": "2026-01-26T07:58:00.000+0000"
    },
    {
      "source": "salesforce",
      "signal": "No dedicated CSE (digital coverage)"
    },
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 1 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0010g00001aLjB5AAK:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 19500,
  "renewal_opportunity_name": "Traxxall Billing 12-26"
}
```

---

## CTA 4 — Luminary Media

```json
{
  "cta_id": "expand3-2026-06-16-luminary-media-dark_account",
  "account_name": "Luminary Media",
  "salesforce_account_id": "0010g00001cVNjCAAW",
  "play_type": "dark_account",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B2P5VCJ2K",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000wCPpFIAW/view",
  "drivers": [
    "Renewal date: 2026-10-17",
    "ARR: $86,400",
    "ATR at risk: $43,200",
    "CSE sentiment commentary last updated 133d ago",
    "No dedicated CSE (digital coverage)",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 1 min (30d) — below threshold"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Luminary Media Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [
    "No CSE assigned (digital coverage)"
  ],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State and renewal :</p><p color=\"\" style=\"\">Customer renewed for next one year.Since the last renewal was not smooth,upcomimg renewal is in risk.</p><p color=\"\" style=\"\">Account Plan:</p><p color=\"\" style=\"\">Need to engage with the customer to address the challenges.</p>",
  "commentary_last_updated": "2026-02-03T07:15:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cse": null,
  "priority_score": 92,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "CSE sentiment commentary last updated 133d ago",
      "observedAt": "2026-02-03T07:15:00.000+0000"
    },
    {
      "source": "salesforce",
      "signal": "No dedicated CSE (digital coverage)"
    },
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 1 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0010g00001cVNjCAAW:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 43200,
  "renewal_opportunity_name": "Luminary Media Billing 10-26"
}
```

---

## CTA 5 — Underline Technologies, LLC

```json
{
  "cta_id": "expand3-2026-06-16-underline-technologies--llc-dark_account",
  "account_name": "Underline Technologies, LLC",
  "salesforce_account_id": "001Po00000CIlpZIAT",
  "play_type": "dark_account",
  "risk_color": "Green",
  "primary_owner": {
    "name": "Dominic Varner",
    "role": "AE"
  },
  "cc_owners": [],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C091Q3P9MV4",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000HVCeUIAX/view",
  "drivers": [
    "Renewal date: 2027-06-28",
    "ARR: $152,000",
    "ATR at risk: $76,000",
    "CSE sentiment commentary last updated 158d ago",
    "No dedicated CSE (digital coverage)",
    "No workshop logged in the last 365 days"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Underline Technologies, LLC Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [
    "No CSE assigned (digital coverage)"
  ],
  "cse_sentiment_commentary": "<ul color=\"\" style=\"\"><li style=\"\">STATE AND RENEWAL RISK: KR : Recent go live on Nov-2024. Another Estuate implementation ans working with them to get additonal details and product setup.<p color=\"\" style=\"\"><br style=\"\"></p><p color=\"\" style=\"\">No risk and keeping the account in green.</p></li></ul><ul color=\"\" style=\"\"><li style=\"\">Next steps : No response from the customer on NetSuite connector. Follow up and keep them engaged.</li></ul>",
  "commentary_last_updated": "2026-01-09T18:49:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Dominic Varner",
    "role": "AE"
  },
  "cse": null,
  "priority_score": 77,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "CSE sentiment commentary last updated 158d ago",
      "observedAt": "2026-01-09T18:49:00.000+0000"
    },
    {
      "source": "salesforce",
      "signal": "No dedicated CSE (digital coverage)"
    },
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    }
  ],
  "dedup_key": "001Po00000CIlpZIAT:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 76000,
  "renewal_opportunity_name": "Underline Technologies, LLC Zuora  Renewal June 2027"
}
```

---

## CTA 6 — Imagine Communications, Inc.

```json
{
  "cta_id": "expand3-2026-06-16-imagine-communications--inc--managed_wind_down",
  "account_name": "Imagine Communications, Inc.",
  "salesforce_account_id": "0017000000uJ9tYAAS",
  "play_type": "managed_wind_down",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Kiran Rajan",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Dominic Varner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C07RME7MJ9E",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po000012Vmq3IAC/view",
  "drivers": [
    "Renewal date: 2026-12-31",
    "ARR: $131,058",
    "ATR at risk: $131,058",
    "Commentary documents customer wind-down or exit",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Manage wind-down timeline and ensure clean exit.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Imagine Communications, Inc. Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p class=\"p8i6j01 paragraph\" color=\"\" style=\"\">STATE AND RENEWAL RISK: Considered Confirmed Churn</p><p class=\"p8i6j01 paragraph\" color=\"\" style=\"\">The account is actively evaluating transition off Zuora Revenue to Oracle, with continued asks for data access via Snowflake Secure Share and read-only access. They signed a 1 year renewal with downsell will be actively moving off the system this year.</p><div color=\"\" style=\"\"><p style=\"\"><br style=\"\"></p><div class=\"_1ibi0s314 _1ibi0s3cl tk0j8o2 tk0j8o0\" style=\"\"><a class=\"wdbi343 wdbi341 wdbi340 _1ibi0s36s\" id=\"base-ui-:ri9g:\" href=\"https://zuora.gainsightcloud.com/v1/ui/timeline#/activities/1I004SG7RDV06L1HFJ16IW8RI5IRQHOH91SL\" rel=\"noreferrer\" target=\"_blank\" color=\"\" style=\"\"></a><a class=\"wdbi343 wdbi341 wdbi340 _1ibi0s36s\" id=\"base-ui-:ri9k:\" href=\"https://zuora.gainsightcloud.com/v1/ui/timeline#/activities/1I004SG7RDV06L1HFJDWU3464ONOCQFV2C3I\" rel=\"noreferrer\" target=\"_blank\" color=\"\" style=\"\"></a></div><p class=\"p8i6j01 paragraph\" style=\"\">ACTION PLAN: Align with AE (Dominic Varner) &amp;</p><div class=\"_1ibi0s314 _1ibi0s3cl tk0j8o2 tk0j8o0\" style=\"\"><a class=\"wdbi343 wdbi341 wdbi340 _1ibi0s36s\" id=\"base-ui-:ri9o:\" href=\"https://zuora.gainsightcloud.com/v1/ui/timeline#/activities/1I004SG7RDV06L1HFJ8RPF2AOV1FU2OADY49\" rel=\"noreferrer\" target=\"_blank\" color=\"\" style=\"\"></a><a class=\"wdbi343 wdbi341 wdbi340 _1ibi0s36s\" id=\"base-ui-:ri9s:\" href=\"https://zuora.gainsightcloud.com/v1/ui/timeline#/activities/1I004SG7RDV06L1HFJ16IW8RI5IRQHOH91SL\" rel=\"noreferrer\" target=\"_blank\" color=\"\" style=\"\"></a></div>Engage key stakeholders at Imagine (Chirag Bhagat, Darlene Harrell) to validate data scope and timelines, and keep Monthly cadence to maintain executive visibility on risks tied to the Oracle transition</div>",
  "commentary_last_updated": "2026-05-22T14:39:00.000+0000",
  "team_aware": true,
  "ae": {
    "name": "Dominic Varner",
    "role": "AE"
  },
  "cse": {
    "name": "Kiran Rajan",
    "role": "CSE"
  },
  "priority_score": 74,
  "confidence": "high",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Wind-down documented in commentary"
    }
  ],
  "dedup_key": "0017000000uJ9tYAAS:managed_wind_down",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 131058.22,
  "renewal_opportunity_name": "Imagine Communications, Inc. Revenue 12-26"
}
```

---

## CTA 7 — Inmar, Inc.

```json
{
  "cta_id": "expand3-2026-06-16-inmar--inc--dark_account",
  "account_name": "Inmar, Inc.",
  "salesforce_account_id": "0017000000rFyeMAAS",
  "play_type": "dark_account",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Brandon LaTourelle",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C07NEU5NY6B",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000tPfedIAC/view",
  "drivers": [
    "Renewal date: 2026-09-30",
    "ARR: $157,500",
    "ATR at risk: $157,500",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 8 min (30d) — below threshold",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Inmar, Inc. Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p style=\"\" color=\"\"><span style=\"\">State and Renewal:</span><br style=\"\">The customer has stopped responding, is not attending cadence calls, and declined the workshop, which puts the upcoming renewal at risk.</p><p style=\"\" color=\"\"><span style=\"\">Account Plan:</span><br style=\"\">We have reached out to the customer to address their technical issues with PM support and are currently awaiting their response.</p>",
  "commentary_last_updated": "2026-05-22T02:11:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Brandon LaTourelle",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 74,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 8 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0017000000rFyeMAAS:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 157500,
  "renewal_opportunity_name": "Inmar, Inc. Revenue 09-26"
}
```

---

## CTA 8 — Alchemy Systems

```json
{
  "cta_id": "expand3-2026-06-16-alchemy-systems-dark_account",
  "account_name": "Alchemy Systems",
  "salesforce_account_id": "0017000000pm9KJAAY",
  "play_type": "dark_account",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C08SE81CCV7",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000GczvhIAB/view",
  "drivers": [
    "Renewal date: 2027-07-31",
    "ARR: $146,454",
    "ATR at risk: $73,227",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 9 min (30d) — below threshold",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Alchemy Systems Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State and renewal :</p><p color=\"\" style=\"\">Renewal is in risk.The client is planning to **migrate to Shopify for e-commerce and transactional processing in 2026** as part of a broader technology consolidation and cost reduction initiative.</p><p color=\"\" style=\"\"><br style=\"\"></p><p color=\"\" style=\"\">Account Plan :</p><p color=\"\" style=\"\">Both parties agreed to maintain communication, with Zuora planning to check in monthly via email to ensure support needs are met.</p>",
  "commentary_last_updated": "2026-06-01T18:29:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 74,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 9 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0017000000pm9KJAAY:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 73227,
  "renewal_opportunity_name": "Alchemy Systems Zuora Renewal July 2027"
}
```

---

## CTA 9 — inContact

```json
{
  "cta_id": "expand3-2026-06-16-incontact-dark_account",
  "account_name": "inContact",
  "salesforce_account_id": "0010g00001aLDKsAAO",
  "play_type": "dark_account",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Ethan Wookey",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C08DMLZ65PZ",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00001GaOWjIAN/view",
  "drivers": [
    "Renewal date: 2027-04-29",
    "ARR: $260,425",
    "ATR at risk: $130,213",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 0 min (30d) — below threshold",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "inContact Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p style=\"\" color=\"\">State and Renewal</p><p style=\"\" color=\"\">No renewal risk.Customer signed for next 1 year.YOY metrics are declining.</p><p style=\"\" color=\"\">Account Plan:</p><p style=\"\" color=\"\">Folow up with the customer to set cadence call and continue the engagement.</p>",
  "commentary_last_updated": "2026-05-22T02:37:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 74,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 0 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0010g00001aLDKsAAO:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 130212.6,
  "renewal_opportunity_name": "inContact Billing 04-27"
}
```

---

## CTA 10 — NorthStar Travel Media, LLC

```json
{
  "cta_id": "expand3-2026-06-16-northstar-travel-media--llc-dark_account",
  "account_name": "NorthStar Travel Media, LLC",
  "salesforce_account_id": "0017000000dJGzAAAW",
  "play_type": "dark_account",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B2LPJC1PZ",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000tUTrKIAW/view",
  "drivers": [
    "Renewal date: 2026-09-30",
    "ARR: $96,419",
    "ATR at risk: $48,210",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 1 min (30d) — below threshold",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "NorthStar Travel Media, LLC Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State &amp; Renewal Update:</p><p color=\"\" style=\"\"><br style=\"\">No immediate risk.Had a meeting with the Northstar team to discuss the NetSuite connector again.YOY metrics are not great</p><p color=\"\" style=\"\">Account Plan:</p><p color=\"\" style=\"\">Following with customer to have Monthly cadence.</p>",
  "commentary_last_updated": "2026-05-22T02:28:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 74,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 1 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0017000000dJGzAAAW:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 48209.7,
  "renewal_opportunity_name": "NorthStar Travel Media, LLC Billing 09-26"
}
```

---

## CTA 11 — Data Processing Design Inc

```json
{
  "cta_id": "expand3-2026-06-16-data-processing-design-inc-dark_account",
  "account_name": "Data Processing Design Inc",
  "salesforce_account_id": "0014u00001twlSRAAY",
  "play_type": "dark_account",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Ethan Wookey",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://app.slack.com/client/E03RP62KP5H/C0B315C8AER",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000CqfC5IAJ/view",
  "drivers": [
    "Renewal date: 2027-05-09",
    "ARR: $125,861",
    "ATR at risk: $62,930",
    "No workshop logged in the last 365 days",
    "Cerebro engagement risk flagged",
    "Engagio engagement 1 min (30d) — below threshold",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Data Processing Design Inc Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State and Renewal :</p><p color=\"\" style=\"\">No immediate renewal risk. There are no current issues reported. Utilisation and YOY metrics are <a href=\"http://good.no/\" target=\"_blank\" color=\"\" style=\"\">good</a>. No cadence or regular touch with <a href=\"http://customer.so/\" target=\"_blank\" color=\"\" style=\"\">customer.So</a> marked it in amber.</p><p color=\"\" style=\"\">Account Plan :</p><p color=\"\" style=\"\">Follw ups are done to be in touch with the cutsomer</p>",
  "commentary_last_updated": "2026-05-22T02:18:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 74,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 1 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0014u00001twlSRAAY:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 62930.41,
  "renewal_opportunity_name": "Data Processing Design Inc Zuora Renewal May 2027"
}
```

---

## CTA 12 — Science News

```json
{
  "cta_id": "expand3-2026-06-16-science-news-dark_account",
  "account_name": "Science News",
  "salesforce_account_id": "0010g00001iSEpPAAW",
  "play_type": "dark_account",
  "risk_color": "Green",
  "primary_owner": {
    "name": "Christopher Franklin-Hollier",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0AE2FELL2G",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000SqOSjIAN/view",
  "drivers": [
    "Renewal date: 2027-12-14",
    "ARR: $154,224",
    "ATR at risk: $77,112",
    "CSE sentiment commentary last updated 221d ago",
    "No workshop logged in the last 365 days",
    "Engagio engagement 1 min (30d) — below threshold"
  ],
  "requested_action": "Investigate account status and re-engage.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Science News Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p>The customer had a few issues that were solved. <br><br>- B2B account login was failing due to a misconfiguration.<br>- Login/Email form validation is now working and they will apply it in Production. </p>",
  "commentary_last_updated": "2025-11-07T14:54:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Christopher Franklin-Hollier",
    "role": "CSE"
  },
  "priority_score": 74,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "CSE sentiment commentary last updated 221d ago",
      "observedAt": "2025-11-07T14:54:00.000+0000"
    },
    {
      "source": "salesforce",
      "signal": "No workshop logged in the last 365 days"
    },
    {
      "source": "salesforce",
      "signal": "Engagio engagement 1 min (30d) — below threshold"
    }
  ],
  "dedup_key": "0010g00001iSEpPAAW:dark_account",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 77112,
  "renewal_opportunity_name": "Science News Zephr 12/2027"
}
```

---

## CTA 13 — Perch Energy, LLC

```json
{
  "cta_id": "expand3-2026-06-16-perch-energy--llc-managed_wind_down",
  "account_name": "Perch Energy, LLC",
  "salesforce_account_id": "0010g00001ewAnzAAE",
  "play_type": "managed_wind_down",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Nick Wilbur",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Tyler Villaroman",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C074AQ52NHG",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000x1CrZIAU/view",
  "drivers": [
    "Renewal date: 2026-10-30",
    "ARR: $418,280",
    "ATR at risk: $209,140",
    "Commentary documents customer wind-down or exit",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Manage wind-down timeline and ensure clean exit.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Perch Energy, LLC Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p class=\"p8i6j01 paragraph\"><b>STATE AND RENEWAL RISK:</b> Perch Energy is a confirmed Red/downsell account with a -$100,000 ACV delta on the October 2026 renewal, driven by chronic low utilization (tracking at &lt;40–52% of committed volume insururmountable product gaps around stripe connect payment splits andd a long-term m&amp;a plan to consolidate parent company arcadia energy&#39;s homegrown billing system. &lt; p&gt;</p><div class=\"tk0j8o1 _1ibi0s31a _1ibi0s3do\"></div>The agreed hybrid scope—Zuora for invoicing and financial reporting only, with Stripe payment orchestration managed externally—has not been formalized with value-based KPIs or a renewal proposal, and there has been no recorded customer engagement since the October 2025 renewal closed, representing a critical 6-month engagement gap. <div class=\"tk0j8o1 _1ibi0s31a _1ibi0s3do\"><a class=\"wdbi343 wdbi341 _1ibi0s3dd _1ibi0s376\" id=\"base-ui-:r2e3:\" rel=\"noreferrer\" target=\"_blank\" href=\"https://zuora.gainsightcloud.com/v1/ui/customersuccess360?cid=1P02CGFSM2TC4IAYDXXUNW2P5NH0UR0R3MRW\"></a><a class=\"wdbi343 wdbi341 _1ibi0s3dd _1ibi0s376\" id=\"base-ui-:r2e6:\" rel=\"noreferrer\" target=\"_blank\" href=\"https://zuora.gainsightcloud.com/v1/ui/customersuccess360?cid=1P02CGFSM2TC4IAYDXXUNW2P5NH0UR0R3MRW#/3995290f-cd22-43c7-8db5-80795551b746\"></a></div>What is working: active platform users (Peter Yao, Trevor Lennox) continue to log in regularly, the PCI extraction agreement with GS/Estuate was executed, and Jeff Battles (SVP Technology) has expressed appreciation for Zuora&#39;s invoicing and reporting capabilities within the hybrid model. <div class=\"tk0j8o1 _1ibi0s31a _1ibi0s3do\"></div><p class=\"p8i6j01 paragraph\"><b>ACTION PLAN:</b> The immediate priority is to re-establish engagement with Jeff Battles and Peter Yao by early May 2026 to confirm the hybrid architecture plan, assess the impact of the PureSky volume migration on committed billing volume, and validate the status of the PCI extraction project with GS/Estuate. </p><div class=\"tk0j8o1 _1ibi0s31a _1ibi0s3do\"><a class=\"wdbi343 wdbi341 _1ibi0s3dd _1ibi0s376\" id=\"base-ui-:r2ec:\" rel=\"noreferrer\" target=\"_blank\" href=\"https://zuora.gainsightcloud.com/v1/ui/customersuccess360?cid=1P02CGFSM2TC4IAYDXXUNW2P5NH0UR0R3MRW#/9acbe000-cbf2-4a2e-abe7-75d7bb8bd380\"></a><a class=\"wdbi343 wdbi341 _1ibi0s3dd _1ibi0s376\" id=\"base-ui-:r2ef:\" rel=\"noreferrer\" target=\"_blank\" href=\"https://docs.google.com/document/d/1_sBxYR_pWnenLBGFIYNFB31Dej9MMsU7DjoCCyWIj4g\"></a></div><br>",
  "commentary_last_updated": "2026-04-21T16:38:00.000+0000",
  "team_aware": true,
  "ae": {
    "name": "Tyler Villaroman",
    "role": "AE"
  },
  "cse": {
    "name": "Nick Wilbur",
    "role": "CSE"
  },
  "priority_score": 73,
  "confidence": "high",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Wind-down documented in commentary"
    }
  ],
  "dedup_key": "0010g00001ewAnzAAE:managed_wind_down",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 209140,
  "renewal_opportunity_name": "Perch Energy, LLC Billing 10-26"
}
```

---

## CTA 14 — Elm Street Technology, LLC

```json
{
  "cta_id": "expand3-2026-06-16-elm-street-technology--llc-managed_wind_down",
  "account_name": "Elm Street Technology, LLC",
  "salesforce_account_id": "0014u00001pxMOjAAM",
  "play_type": "managed_wind_down",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Kyle Larkin",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Tyler Villaroman",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C086JUNBAJC",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00001FsRlFIAV/view",
  "drivers": [
    "Renewal date: 2027-04-23",
    "ARR: $994,431",
    "ATR at risk: $497,215",
    "Commentary documents customer wind-down or exit",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Manage wind-down timeline and ensure clean exit.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Elm Street Technology, LLC Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p> <b>STATE AND RENEWAL RISK:</b> The FY28 renewal (close date April 23, 2027) remains modeled as a full churn/downsell at -$497K ACV driven by overcommitted contract volume and persistent platform underutilization. However, the engagement has materially improved since the last sentiment update: accounting periods have been closed through December 2025 with the Mass Updater template ready to redistribute revenue into historical 2025 periods, <span style=\"font-family: Roboto, -apple-system, BlinkMacSystemFont,;\" color=\"\">and new CFO Eric Amblard — introduced on May 27 — has acknowledged that the implementation failures stem from prior SIs rather than Zuora&#39;s product and is constructively engaged, though he has set hard deadlines of June 30 (new product launch) and July 9 (board meeting) as proof points.</span></p><div class=\"tk0j8o1 _1ibi0s31a _1ibi0s3en\"><a class=\"wdbi343 wdbi341 _1ibi0s3ec _1ibi0s376\" id=\"base-ui-:rcmv:\" href=\"https://zuora.enterprise.slack.com/archives/C086JUNBAJC/p1779905295832549?thread_ts=1779905295.832549&amp;cid=C086JUNBAJC\" rel=\"noreferrer\" target=\"_blank\"></a></div>What is working: the core platform is operationally stable (StaircaseAI Health Score 90), the TAM cadence with Siddhant Verma and Hans Saunders remains active, monthly value reports are being delivered, and the June 9 Tampa onsite workshop — attended by Eric Amblard, Tammy Grant, Hans Saunders, and Bishop Lafer — is the highest-stakes engagement milestone to date with a well-structured agenda covering RevRec remediation, July product launch readiness, Sage Intacct JE automation, and Canadian BU onboarding scoping<p><br></p><p><b>ACTION PLAN:</b> The immediate priority is executing the June 9 Tampa onsite workshop (Kyle Larkin, Nick Wilbur, Amy Costandi leading sessions; Michael Katzman and Tyler Villaroman attending) and delivering a post-workshop recommendation deck by approximately June 13, covering a concrete RevRec roadmap and the July new product launch E2E setup in Zuora — both of which must be demonstrably in motion before Eric Amblard&#39;s July 9 board meeting. </p><div class=\"tk0j8o1 _1ibi0s31a _1ibi0s3en\"><a class=\"wdbi343 wdbi341 _1ibi0s3ec _1ibi0s376\" id=\"base-ui-:rcnb:\" href=\"https://docs.google.com/presentation/d/1rGKGDuAR1dGBz6jaxX1B6vOmc2uJDPQogwGmJmOGjOo\" rel=\"noreferrer\" target=\"_blank\"></a><a class=\"wdbi343 wdbi341 _1ibi0s3ec _1ibi0s376\" id=\"base-ui-:rcne:\" href=\"https://zuora.gainsightcloud.com/v1/ui/timeline#/activities/1I004SG7RDV06L1HFJ7J08YHC7RTQHERB724\" rel=\"noreferrer\" target=\"_blank\"></a></div><p>In parallel, Michael Katzman will stand up bi-weekly executive syncs with Eric, Hans, and Tammy, while Tyler Villaroman, Nick Wilbur, and Ronak Majmudar begin defining the 3-year commercial structure (right-sized volume + RevRec bundle) with the goal of converting the FY28 renewal to a multi-year commitment before the customer&#39;s exit window closes.</p>",
  "commentary_last_updated": "2026-06-06T16:35:00.000+0000",
  "team_aware": true,
  "ae": {
    "name": "Tyler Villaroman",
    "role": "AE"
  },
  "cse": {
    "name": "Kyle Larkin",
    "role": "CSE"
  },
  "priority_score": 72,
  "confidence": "high",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Wind-down documented in commentary"
    }
  ],
  "dedup_key": "0014u00001pxMOjAAM:managed_wind_down",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 497215.4,
  "renewal_opportunity_name": "Elm Street Technology, LLC Billing 04-27"
}
```

---

## CTA 15 — Control Play Inc (formerly 787Networks)

```json
{
  "cta_id": "expand3-2026-06-16-control-play-inc--formerly-787networks--dark_renewal",
  "account_name": "Control Play Inc (formerly 787Networks)",
  "salesforce_account_id": "0017000001UuShxAAF",
  "play_type": "dark_renewal",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B342FD1PT",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000kbTgUIAU/view",
  "drivers": [
    "Renewal date: 2026-06-29",
    "ARR: $119,095",
    "ATR at risk: $59,547",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-06-23",
  "check_back_date": "2026-06-16",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-06-16",
    "auto_check_query": "Control Play Inc (formerly 787Networks) Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-06-23",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">1. State and Renewal:</p><p color=\"\" style=\"\">Utilization and Year-over-Year (YoY) metrics looks good, Utilisation is good.Renewal risk is there.they expressed concerns regarding the overall value received relative to the current pricing model.</p><p color=\"\" style=\"\">2. Account Plan:<br style=\"\">We’ve followed up to schedule an account review,dates will be finalised</p>",
  "commentary_last_updated": "2026-05-22T02:41:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 69,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 2.0 Discover"
    }
  ],
  "dedup_key": "0017000001UuShxAAF:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 59547.25,
  "renewal_opportunity_name": "Control Play Inc (formerly 787Networks) Billing 06-26"
}
```

---

## CTA 16 — Leafly, LLC

```json
{
  "cta_id": "expand3-2026-06-16-leafly--llc-dark_renewal",
  "account_name": "Leafly, LLC",
  "salesforce_account_id": "0017000000xKYBZAA4",
  "play_type": "dark_renewal",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C03ULQFE6V6",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000nHbLXIA0/view",
  "drivers": [
    "Renewal date: 2026-07-29",
    "ARR: $577,046",
    "ATR at risk: $288,523",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-07",
  "check_back_date": "2026-06-30",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-06-30",
    "auto_check_query": "Leafly, LLC Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-07",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State and renewa risk:</p><p color=\"\" style=\"\">Renewal risk is moderate and tied to cost sensitivity—ROI and automation value must be clearly demonstrated.</p><p color=\"\" style=\"\">Customer is frustrated with manual reconciliation and fragmented reporting, exploring Zuora Revenue but still early in evaluation.</p><p color=\"\" style=\"\">Account Plan</p><p color=\"\" style=\"\">Position Zuora Revenue as the automation and consolidation solution to eliminate manual JEs and improve forecasting visibility.</p>",
  "commentary_last_updated": "2026-06-01T18:24:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 69,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 3.0 Define"
    }
  ],
  "dedup_key": "0017000000xKYBZAA4:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 288523.2,
  "renewal_opportunity_name": "Leafly, LLC Billing 07-26"
}
```

---

## CTA 17 — Devex

```json
{
  "cta_id": "expand3-2026-06-16-devex-dark_renewal",
  "account_name": "Devex",
  "salesforce_account_id": "0017000000mNirEAAS",
  "play_type": "dark_renewal",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C091FRKT95M",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000mT1rUIAS/view",
  "drivers": [
    "Renewal date: 2026-07-21",
    "ARR: $138,000",
    "ATR at risk: $69,000",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-07",
  "check_back_date": "2026-06-30",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-06-30",
    "auto_check_query": "Devex Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-07",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">1. State and Renewal:<br style=\"\">account is marked Red and may be at risk of churn this year. They’re unhappy with Zuora Analytics and Dashboards since their needs can’t be met with the current features (as confirmed by the product team). We’ve shared alternative options for them to review, though they’re also evaluating other platforms, including Stripe.</p><p color=\"\" style=\"\">2. Account Plan:<br style=\"\">A regular check-in cadence has been set to maintain engagement and address ongoing concerns.</p>",
  "commentary_last_updated": "2026-05-22T02:12:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 69,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 3.0 Define"
    }
  ],
  "dedup_key": "0017000000mNirEAAS:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 69000,
  "renewal_opportunity_name": "Devex Billing 07-26"
}
```

---

## CTA 18 — Zello

```json
{
  "cta_id": "expand3-2026-06-16-zello-dark_renewal",
  "account_name": "Zello",
  "salesforce_account_id": "0017000000n679XAAQ",
  "play_type": "dark_renewal",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Kiran Rajan",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Dominic Varner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C08JY9UQDFE",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000mo8y1IAA/view",
  "drivers": [
    "Renewal date: 2026-07-26",
    "ARR: $329,414",
    "ATR at risk: $164,707",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-07",
  "check_back_date": "2026-06-30",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-06-30",
    "auto_check_query": "Zello Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-07",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p style=\"\" color=\"\">Risk:<br style=\"\">Account is engaged and using Payment Links, but renewal is at risk with a ~$50K downsell due to Stripe competition and cost/product-fit concerns.</p><p style=\"\" color=\"\">Plan:<br style=\"\">Stabilize by proving ROI (Payment Links), fixing email reliability, and delivering a scalable reseller billing solution. Align on product roadmap (H1’26) and had an in-person session in Austin (late April) to address gaps and commercial options.<br style=\"\">Owners: AE (Dominic), TAM (Samatha), CSE (Kiran), with Product support.</p>",
  "commentary_last_updated": "2026-05-22T14:43:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Dominic Varner",
    "role": "AE"
  },
  "cse": {
    "name": "Kiran Rajan",
    "role": "CSE"
  },
  "priority_score": 68,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 2.0 Discover"
    }
  ],
  "dedup_key": "0017000000n679XAAQ:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 164707.01,
  "renewal_opportunity_name": "Zello Billing 07-26"
}
```

---

## CTA 19 — Readdle

```json
{
  "cta_id": "expand3-2026-06-16-readdle-surprise_churn_watch",
  "account_name": "Readdle",
  "salesforce_account_id": "00170000014fI1lAAE",
  "play_type": "surprise_churn_watch",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B3287NP42",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000zgflCIAQ/view",
  "drivers": [
    "CSE Sentiment: Yellow",
    "ARR: $127,427",
    "ATR at risk: $63,714",
    "Renewal in 165d"
  ],
  "requested_action": "Monitor closely — Yellow sentiment with approaching renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Readdle Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p class=\"\" color=\"\" style=\"\">State and Renewal<br style=\"\">No engagement with customer, leads to renewal risk.YOY metrics are not great.Utilisation is OK.</p><p class=\"\" color=\"\" style=\"\">Account Plan</p><p class=\"\" color=\"\" style=\"\">Customer refused to have the account review.Trying to set cadence call</p>",
  "commentary_last_updated": "2026-05-22T02:39:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 54,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Yellow sentiment + renewal proximity"
    }
  ],
  "dedup_key": "00170000014fI1lAAE:surprise_churn_watch",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 63713.51,
  "renewal_opportunity_name": "Readdle Billing 11-26"
}
```

---

## CTA 20 — Omni Technology Solutions Inc

```json
{
  "cta_id": "expand3-2026-06-16-omni-technology-solutions-inc-dark_renewal",
  "account_name": "Omni Technology Solutions Inc",
  "salesforce_account_id": "0017000000j2pYoAAI",
  "play_type": "dark_renewal",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B35RPBCJY",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000zo7nxIAA/view",
  "drivers": [
    "Renewal date: 2026-11-29",
    "ARR: $176,208",
    "ATR at risk: $88,104",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Omni Technology Solutions Inc Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><div class=\"gs-section-title\" color=\"\" style=\"\"><h6 class=\"ant-typography ant-typography-title-section\" style=\"\">Note</h6></div><div class=\"content-section\" color=\"\" style=\"\"><div class=\"content-holder\" style=\"\"><div class=\"content\" style=\"\"><p style=\"\"></p><p color=\"\" style=\"\">RENEWAL STATE (AMBER): 1-year renewal secured; however, declining utilization signals potential business slowdown and risk of future volume restructuring. </p><p color=\"\" style=\"\">ACCOUNT PLAN: Conduct executive alignment/reset to reconfirm strategic goals and roadmap, closely monitor utilization trends, and proactively scenario-plan for volume adjustments to protect renewal stability and long-term growth.</p></div></div></div>",
  "commentary_last_updated": "2026-06-01T18:23:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 53,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 1.0 Qualify"
    }
  ],
  "dedup_key": "0017000000j2pYoAAI:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 88103.8,
  "renewal_opportunity_name": "Omni Technology Solutions Inc Billing 11-26"
}
```

---

## CTA 21 — Gfi USA LLC

```json
{
  "cta_id": "expand3-2026-06-16-gfi-usa-llc-surprise_churn_watch",
  "account_name": "Gfi USA LLC",
  "salesforce_account_id": "0017000000qgI72AAE",
  "play_type": "surprise_churn_watch",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Kiran Rajan",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Dominic Varner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C09MZHL2F0W",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000x1gUfIAI/view",
  "drivers": [
    "CSE Sentiment: Yellow",
    "ARR: $576,804",
    "ATR at risk: $288,402",
    "Renewal in 135d"
  ],
  "requested_action": "Monitor closely — Yellow sentiment with approaching renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Gfi USA LLC Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p color=\"\" style=\"\">State:<br style=\"\">Stable but low engagement with resistance to modernization. Renewal faces pricing pressure, possible volume downsell, and medium-term churn risk (NetSuite/in-house evaluation).</p><p color=\"\" style=\"\">Plan:<br style=\"\">Pursue a right-sized 12-month renewal (with optional 24-month path). Re-establish cadence with stakeholders and address pricing with AE Dominic.</p>",
  "commentary_last_updated": "2026-05-22T14:51:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Dominic Varner",
    "role": "AE"
  },
  "cse": {
    "name": "Kiran Rajan",
    "role": "CSE"
  },
  "priority_score": 53,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Yellow sentiment + renewal proximity"
    }
  ],
  "dedup_key": "0017000000qgI72AAE:surprise_churn_watch",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 288402,
  "renewal_opportunity_name": "Gfi USA LLC Billing 10-26"
}
```

---

## CTA 22 — Venn Inc (fka OS33)

```json
{
  "cta_id": "expand3-2026-06-16-venn-inc--fka-os33--dark_renewal",
  "account_name": "Venn Inc (fka OS33)",
  "salesforce_account_id": "0017000000koD1zAAE",
  "play_type": "dark_renewal",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C09BT0Q7FL3",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00001GsWlxIAF/view",
  "drivers": [
    "Renewal date: 2027-04-13",
    "ARR: $110,000",
    "ATR at risk: $55,000",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Venn Inc (fka OS33) Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State &amp; Renewal Update:</p><p color=\"\" style=\"\">Customer is going to renew for 1 year and mentioned looking at a couple other solutions to see if they can handle our use cases better.</p><p color=\"\" style=\"\">AE plans to recommend TAM after renewal.</p><p color=\"\" style=\"\">Account Plan:</p><p color=\"\" style=\"\">Monthly cadence has been set,Continuous engagement with customer to support all the queries.</p>",
  "commentary_last_updated": "2026-04-28T10:37:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 52,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 1.0 Qualify"
    }
  ],
  "dedup_key": "0017000000koD1zAAE:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 55000,
  "renewal_opportunity_name": "Venn Inc (fka OS33) Billing 04-27"
}
```

---

## CTA 23 — Elevat Inc.

```json
{
  "cta_id": "expand3-2026-06-16-elevat-inc--dark_renewal",
  "account_name": "Elevat Inc.",
  "salesforce_account_id": "0017000001UwQFMAA3",
  "play_type": "dark_renewal",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B2LNNGY5V",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po000018p8JOIAY/view",
  "drivers": [
    "Renewal date: 2027-02-13",
    "ARR: $66,625",
    "ATR at risk: $33,313",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Elevat Inc. Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p class=\"\" color=\"\" style=\"\">State and Renewal<br style=\"\">Renewal done for next 1 year with 1m in Q1(Auto renewed)</p><p class=\"\" color=\"\" style=\"\">No major concerns.</p><p class=\"\" color=\"\" style=\"\">2. Account Plan<br style=\"\">Account review done and following with the customer to have monthly cadence.Customer asked for the recent contract to be reviewed.</p>",
  "commentary_last_updated": "2026-05-22T02:40:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 51,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 1.0 Qualify"
    }
  ],
  "dedup_key": "0017000001UwQFMAA3:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 33312.52,
  "renewal_opportunity_name": "Elevat Inc. Billing 02-27"
}
```

---

## CTA 24 — RPost, Inc.

```json
{
  "cta_id": "expand3-2026-06-16-rpost--inc--dark_renewal",
  "account_name": "RPost, Inc.",
  "salesforce_account_id": "0017000000kmr2xAAA",
  "play_type": "dark_renewal",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Ethan Wookey",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B3WB4PMCY",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000EIQOzIAP/view",
  "drivers": [
    "Renewal date: 2027-05-31",
    "ARR: $168,561",
    "ATR at risk: $84,281",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "RPost, Inc. Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p class=\"\" color=\"\" style=\"\">State and Renewal<br style=\"\">Year-over-year performance and utilization metrics are good,But no regular cadence or engagement with customer.Due to lack of engagement the account is in amber.</p><p class=\"\" color=\"\" style=\"\">Account Plan</p><p class=\"\" color=\"\" style=\"\">Customer engagement is on and off for usecsaes.Trying to establish account review.Dec Follow up sent</p>",
  "commentary_last_updated": "2026-05-22T02:44:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 51,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 0.0 Engage"
    }
  ],
  "dedup_key": "0017000000kmr2xAAA:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 84280.72,
  "renewal_opportunity_name": "RPost, Inc. Zuora Renewal May 2027"
}
```

---

## CTA 25 — Enverus Inc. (fka Cortex Business Solutions)

```json
{
  "cta_id": "expand3-2026-06-16-enverus-inc---fka-cortex-business-solutions--dark_renewal",
  "account_name": "Enverus Inc. (fka Cortex Business Solutions)",
  "salesforce_account_id": "0017000000klypeAAA",
  "play_type": "dark_renewal",
  "risk_color": "Yellow",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B304Y6S6A",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00001879RGIAY/view",
  "drivers": [
    "Renewal date: 2027-02-13",
    "ARR: $138,280",
    "ATR at risk: $69,140",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Yellow"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Enverus Inc. (fka Cortex Business Solutions) Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State and Renewal:<br style=\"\">Renewal done for next 1 year with 3M in Q1</p><p color=\"\" style=\"\">Account Plan:</p><p color=\"\" style=\"\">Following with customer to have cadence call.But currently customer declined and they dont have major concerns</p>",
  "commentary_last_updated": "2026-05-22T02:43:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 51,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 1.0 Qualify"
    }
  ],
  "dedup_key": "0017000000klypeAAA:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 69140.08,
  "renewal_opportunity_name": "Enverus Inc. (fka Cortex Business Solutions) Billing 02-27"
}
```

---

## CTA 26 — Rimini Street, Inc.

```json
{
  "cta_id": "expand3-2026-06-16-rimini-street--inc--dark_renewal",
  "account_name": "Rimini Street, Inc.",
  "salesforce_account_id": "0017000000nsQV2AAM",
  "play_type": "dark_renewal",
  "risk_color": "Green",
  "primary_owner": {
    "name": "Sriganth Balusamy",
    "role": "CSE"
  },
  "cc_owners": [
    {
      "name": "Brandon LaTourelle",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C08G3JUJ9QA",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000Wo7S7IAJ/view",
  "drivers": [
    "Renewal date: 2027-01-31",
    "ARR: $290,624",
    "ATR at risk: $290,624",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Green"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Rimini Street, Inc. Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p>Green. Expected to renew. AI demo planned for this week. Will reestablish connection with them. Will try to get some insights in to the ERP implementation as well</p>",
  "commentary_last_updated": "2026-05-25T14:39:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Brandon LaTourelle",
    "role": "AE"
  },
  "cse": {
    "name": "Sriganth Balusamy",
    "role": "CSE"
  },
  "priority_score": 51,
  "confidence": "medium",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 2.0 Discover"
    }
  ],
  "dedup_key": "0017000000nsQV2AAM:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 290624,
  "renewal_opportunity_name": "Rimini Street, Inc. RevPro 1/2027"
}
```

---

## CTA 27 — InfluxData Inc.

```json
{
  "cta_id": "expand3-2026-06-16-influxdata-inc--dark_renewal",
  "account_name": "InfluxData Inc.",
  "salesforce_account_id": "0017000001TLW8SAAX",
  "play_type": "dark_renewal",
  "risk_color": "Green",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Ethan Wookey",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C08GG9EN4Q4",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00001GzSP3IAN/view",
  "drivers": [
    "Renewal date: 2027-04-29",
    "ARR: $152,443",
    "ATR at risk: $76,222",
    "Renewal opp lacks recent next steps",
    "CSE Sentiment: Green"
  ],
  "requested_action": "Re-engage ahead of upcoming renewal.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "InfluxData Inc. Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p style=\"\">State and renewal.</p><p>No renewal risk.signed Influxdata 2 renewal(coming from a 1 year) at a 5% price increase; goals for the near future:</p><p>Account Plan</p><ul style=\"margin: 4px 0px 4px 24px; padding: 0px;\"><li style=\"margin: 2px 0px; padding: 0px; color: rgb(29, 28, 29);\">Get their utilization moving in the right direction</li><li style=\"margin: 2px 0px; padding: 0px; color: rgb(29, 28, 29);\">Show our Netsuite Connector</li><li style=\"margin: 2px 0px; padding: 0px; color: rgb(29, 28, 29);\">Get them using Zuora AI</li></ul>",
  "commentary_last_updated": "2026-05-06T07:17:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Ethan Wookey",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 51,
  "confidence": "low",
  "source_signals": [
    {
      "source": "salesforce",
      "signal": "Renewal opp stage: 1.0 Qualify"
    }
  ],
  "dedup_key": "0017000001TLW8SAAX:dark_renewal",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 76221.62,
  "renewal_opportunity_name": "InfluxData Inc. Billing 04-27"
}
```

---

## CTA 28 — Editshare, LLC

```json
{
  "cta_id": "expand3-2026-06-16-editshare--llc-engagement_risk",
  "account_name": "Editshare, LLC",
  "salesforce_account_id": "0017000000kkYUeAAM",
  "play_type": "engagement_risk",
  "risk_color": "Red",
  "primary_owner": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "cc_owners": [
    {
      "name": "Cameron Challoner",
      "role": "AE"
    }
  ],
  "destination_slack_channel": "https://zuora.enterprise.slack.com/archives/C0B304Q2TC6",
  "renewal_opportunity_url": "https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000rCWf8IAG/view",
  "drivers": [
    "Renewal date: 2027-09-29",
    "ARR: $208,000",
    "ATR at risk: $104,000",
    "Cerebro engagement risk flagged",
    "CSE Sentiment: Red"
  ],
  "requested_action": "Reconnect on engagement — validate champion and exec touchpoints.",
  "deadline": "2026-07-16",
  "check_back_date": "2026-07-09",
  "expected_artifact": "SFDC update + Slack thread",
  "follow_through": {
    "expected_artifact": "SFDC update + Slack thread",
    "check_back_date": "2026-07-09",
    "auto_check_query": "Editshare, LLC Slack OR meeting OR email last 7 days",
    "if_no_response_by": "2026-07-16",
    "then": "Escalate to CSE manager"
  },
  "data_gaps": [],
  "cse_sentiment_commentary": "<p></p><p color=\"\" style=\"\">State and Renewal :</p><p color=\"\" style=\"\"><br style=\"\"></p><p color=\"\" style=\"\">Renewal is at risk.Last year Renewal – Downsell with Churn Risk = “At Risk”, even though it closed On Time (Closed/Won) and extends the contract to 30 Sep 2027.</p><p color=\"\" style=\"\">YOY Metrics are not good.Utilisation is good.</p><p color=\"\" style=\"\"><br style=\"\"></p><p color=\"\" style=\"\">Account Plan:</p><div class=\"tk0j8o1 _1ibi0s31a _1ibi0s3dn\" color=\"\" style=\"\"><a class=\"wdbi343 wdbi341 _1ibi0s3dc _1ibi0s376\" id=\"base-ui-:r31a:\" href=\"https://zuora.lightning.force.com/lightning/r/Account/0017000000kkYUeAAM/view\" rel=\"noreferrer\" target=\"_blank\" color=\"\" style=\"\"></a></div><p color=\"\" style=\"\">the customer wants time until Q2 next year to decide how they go forward, so we should treat longer‑term renewal as at risk and keep close engagement.</p>",
  "commentary_last_updated": "2026-06-01T18:16:00.000+0000",
  "team_aware": false,
  "ae": {
    "name": "Cameron Challoner",
    "role": "AE"
  },
  "cse": {
    "name": "Mahalakshmi S",
    "role": "CSE",
    "slack_handle": "Maha"
  },
  "priority_score": 48,
  "confidence": "high",
  "source_signals": [
    {
      "source": "cerebro",
      "signal": "Cerebro engagement risk flagged"
    }
  ],
  "dedup_key": "0017000000kkYUeAAM:engagement_risk",
  "stale_after": "2026-07-31",
  "atr_at_risk_usd": 104000,
  "renewal_opportunity_name": "Editshare, LLC Billing 09-27"
}
```
---

## Accounts evaluated — no CTA

- **Digital Air Strike**: Commentary documents active plan — team aware
- **Fender Musical Instruments Corporation**: Commentary documents active plan — team aware
- **Arista Networks, Inc.**: Commentary documents active plan — team aware
- **Service Noodle**: Commentary documents active plan — team aware
- **Broadly**: Commentary documents active plan — team aware
- **Customer Focus Software**: Commentary documents active plan — team aware
- **Teads Holding Co.**: Commentary documents active plan — team aware
- **Zetta, Inc**: Commentary documents active plan — team aware
- **BI Incorporated**: Customer mid-migration/RFP — paused vendor activity per commentary
- **Engageware**: Commentary documents active plan — team aware
- **AIB, Inc.**: Commentary documents active plan — team aware
- **International Risk Management Institute, Inc.**: Commentary documents active plan — team aware
- **Wowza Media Systems**: Customer mid-migration/RFP — paused vendor activity per commentary
- **Dealers United LLC**: Commentary documents active plan — team aware
- **Quotit Corporation**: Commentary documents active plan — team aware
- **Bamboo Rose**: Commentary documents active plan — team aware
- **iRobot Corporation**: Commentary documents active plan — team aware
- **Omnitracs, LLC**: Commentary documents active plan — team aware
- **FuneralOne**: Commentary documents active plan — team aware
- **Sync.com**: Commentary documents active plan — team aware
- **Talkdesk**: Commentary documents active plan — team aware
- **Data Doctors Quality Care, LLC**: Commentary documents active plan — team aware
- **Worksuite, LLC**: Commentary documents active plan — team aware
- **Donnelley Financial LLC**: Commentary documents active plan — team aware
- **Akerna Corp (fka MJ Freeway)**: Open Gainsight CTA covers this play: "Akerna Corp (fka MJ Freeway) Low Utilization"
- **OfferUp**: Commentary documents active plan — team aware
- **Celartem, Inc.**: Commentary documents active plan — team aware
- **RealNetworks LLC**: Commentary documents active plan — team aware
- **Valant Medical Solutions Inc.**: Commentary documents active plan — team aware
- **UPKEEP TECHNOLOGIES, INC**: Commentary documents active plan — team aware
- **Swing Education, Inc.**: Customer mid-migration/RFP — paused vendor activity per commentary
- **Prezi**: Commentary documents active plan — team aware
- **Brightedge Technologies, Inc.**: Commentary documents active plan — team aware
- **Aabaco Small Business, LLC**: Commentary documents active plan — team aware
- **Guru**: Commentary documents active plan — team aware
- **Dynata, LLC. (fka MarketSight)**: Commentary documents active plan — team aware
- **Brunswick News, a division of Postmedia Network Inc.**: Commentary documents active plan — team aware
- **Appointment Plus**: Commentary documents active plan — team aware
- **ReviewTrackers**: Commentary documents active plan — team aware
- **Mobials Inc**: Customer mid-migration/RFP — paused vendor activity per commentary
- **Dor Technologies**: Commentary documents active plan — team aware
- **Yesware, Inc.**: Commentary documents active plan — team aware
- **Rubicon Global**: Open Gainsight CTA covers this play: "Activity Timeline - Amber - Renewal  — Rubicon Global"
- **International Air Transportation Association (IATA)**: Commentary documents active plan — team aware
- **SiteCompli, LLC**: Commentary documents active plan — team aware
- **Adweek, LLC**: Commentary documents active plan — team aware
- **Placester, Inc.**: Commentary documents active plan — team aware
- **Washington Newspaper Publishing Co, LLC**: Customer mid-migration/RFP — paused vendor activity per commentary
- **American Residential Warranty**: Commentary documents active plan — team aware
- **Secureframe**: Commentary documents active plan — team aware
- **The Columbian Publishing Company**: Commentary documents active plan — team aware
- **GoCanvas**: Commentary documents active plan — team aware
- **DaySmart Software**: Commentary documents active plan — team aware
- **Bitly, Inc.**: Customer mid-migration/RFP — paused vendor activity per commentary
- **Zengine Ltd fka IntelliCentrics Inc.**: Commentary documents active plan — team aware
- **Malwarebytes, Inc. (restart)**: Commentary documents active plan — team aware
- **RTO Insider LLC**: Commentary documents active plan — team aware
- **Maxwell Health**: Commentary documents active plan — team aware
- **Braze Inc. (Restart)**: No rules matched
- **View The Space, Inc.**: Commentary documents active plan — team aware
- **RSA Conference LLC**: Commentary documents active plan — team aware
- **Finale, Inc.**: Open Gainsight CTA covers this play: "Activity Timeline - Zuora Renewal Catchup — Finale Inventory"
- **Turf Tank**: Commentary documents active plan — team aware
- **Kandji**: Commentary documents active plan — team aware
- **The San Francisco Standard**: Commentary documents active plan — team aware
- **Commerce.com US, Inc**: Commentary documents active plan — team aware
- **A10 Networks, Inc.**: Commentary documents active plan — team aware
- **Telestream**: Commentary documents active plan — team aware
- **Medrio**: No rules matched
- **Relativity ODA LLC**: Commentary documents active plan — team aware
- **Convoso**: Commentary documents active plan — team aware
- **Kustomer, LLC.**: Commentary documents active plan — team aware
- **Deloitte LLP**: Commentary documents active plan — team aware
- **Voya Services Company (fka Benefitfocus.com, Inc)**: Commentary documents active plan — team aware
- **Demandforce, Inc.**: No rules matched
- **Tobii Dynavox**: Commentary documents active plan — team aware
- **PhotoShelter, Inc.**: Commentary documents active plan — team aware
- **WorthPoint Corporation**: Commentary documents active plan — team aware
- **Sporting Media USA Inc.**: Commentary documents active plan — team aware
- **Teledyne FLIR, LLC**: Commentary documents active plan — team aware
- **Aviat U.S., Inc.**: No rules matched
- **OpenSpace**: Open Gainsight CTA covers this play: "Engagement: No Meeting for OpenSpace"
- **Simpleview Inc (DTN BU uses Zuora)**: Open Gainsight CTA covers this play: "Activity Timeline - DTN(Simpleview) <> Zuora Renewal Sync — Simpleview Inc (DTN BU uses Zuora)"
- **Pipedrive, Inc.**: Customer mid-migration/RFP — paused vendor activity per commentary
- **Crunchbase, Inc.**: Commentary documents active plan — team aware
- **66degrees**: Commentary documents active plan — team aware
- **WABTEC: WESTINGHOUSE AIR BRAKE TECHNOLOGIES CORPORATION**: No rules matched
- **MarginEdge**: No rules matched
- **Alchemer LLC (fka SurveyGizmo)**: Commentary documents active plan — team aware
- **Association of Certified Fraud Examiners**: Commentary documents active plan — team aware
- **Canon Inc**: Commentary documents active plan — team aware
- **Petvisor Holdings, LLC**: No rules matched
- **Atmosera (EasyStreet)**: Commentary documents active plan — team aware
- **Act! (fka Swiftpage)**: No rules matched
- **UL Verification Services Inc**: Commentary documents active plan — team aware
- **Canon U.S.A., Inc.**: Commentary documents active plan — team aware
- **GoAnimate, Inc. (Vyond)**: Commentary documents active plan — team aware
- **SumUp, Inc.**: Commentary documents active plan — team aware
- **YMCA of Central Florida Metro**: No rules matched
- **SAMBA Holdings, Inc.**: Commentary documents active plan — team aware
