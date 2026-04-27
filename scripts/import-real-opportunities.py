#!/usr/bin/env python3
"""
Import REAL Salesforce opportunity data (from Glean read_document batches) into snapshot_opportunity.

Reads all *.json files in a directory (each is a Glean read_document response with multiple opps).
Each document contains either:
  - richDocumentData.content (full JSON dict of fields), or
  - snippets[0] = full JSON dict, or
  - snippets[0] = unstructured value list and snippets[1] = matchingFilters JSON

Filters opps to:
  - currentfyfranchise/prefranchise == "Expand 3"
  - customerid present in our snapshot_account latest run
  - Close Date in [-15 months, +36 months] from today

Creates a new refresh_run (status='success') with all 236 accounts (copied from latest run)
plus the parsed opportunities.
"""
import glob
import json
import os
import subprocess
import sys
from datetime import date, datetime

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opp_data"


def psql(sql: str, *, capture: bool = False):
    cmd = [
        "docker", "exec", "-i", "mdas-db-1", "psql", "-U", "mdas", "-d", "mdas",
        "-v", "ON_ERROR_STOP=1", "-t", "-A", "-q",
    ]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        print("psql error:", r.stderr, file=sys.stderr)
        sys.exit(r.returncode)
    return r.stdout.strip()


# Source refresh: latest one with 200+ accounts
src_refresh = psql(
    "SELECT refresh_id::text FROM snapshot_account GROUP BY refresh_id "
    "HAVING COUNT(*) >= 200 ORDER BY MAX(captured_at) DESC LIMIT 1;",
    capture=True,
)
print(f"Source refresh: {src_refresh}")

our_accounts = set(
    a for a in psql(
        f"SELECT account_id FROM snapshot_account WHERE refresh_id='{src_refresh}';",
        capture=True,
    ).splitlines() if a
)
print(f"Our accounts: {len(our_accounts)}")


def add_months(d: date, m: int) -> date:
    y = d.year + (d.month - 1 + m) // 12
    mo = (d.month - 1 + m) % 12 + 1
    day = min(d.day, 28)
    return date(y, mo, day)


today = date.today()
min_date = add_months(today, -15)
max_date = add_months(today, 36)
print(f"Date window: {min_date} -> {max_date}")


def parse_close_date(s):
    if not s:
        return None
    s = s.split("T")[0]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def load_record(doc):
    """Return a dict of opp fields by trying richDocumentData.content first,
    then snippets[0] if it's a JSON dict, else None."""
    rd = doc.get("richDocumentData")
    if rd and isinstance(rd, dict):
        content = rd.get("content")
        if isinstance(content, str):
            try:
                obj = json.loads(content)
                if isinstance(obj, dict):
                    return obj
            except Exception:
                pass
    # Try snippets in order
    for snip in (doc.get("snippets") or []):
        if not snip or not snip.lstrip().startswith("{"):
            continue
        try:
            obj, _ = json.JSONDecoder().raw_decode(snip.lstrip())
            if isinstance(obj, dict) and ("Close Date" in obj or "Close Datetime" in obj):
                return obj
        except Exception:
            continue
    return None


def load_filters(doc):
    """Return matchingFilters dict from second snippet (if present), else None."""
    sn = doc.get("snippets") or []
    if len(sn) >= 2:
        try:
            obj = json.loads(sn[1])
            if isinstance(obj, dict):
                return obj
        except Exception:
            return None
    return None


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except Exception:
        return None


def stage_num_from_stage(stage_str):
    if not stage_str:
        return None
    try:
        return int(float(stage_str.split(".")[0].split("-")[0].strip()))
    except Exception:
        return None


# Collect all documents
all_docs = []
for path in sorted(glob.glob(os.path.join(DATA_DIR, "*.json"))):
    with open(path) as f:
        try:
            data = json.load(f)
        except Exception as e:
            print(f"Skip {path}: {e}")
            continue
    docs = data.get("documents") or []
    print(f"{os.path.basename(path)}: {len(docs)} docs")
    all_docs.extend(docs)
print(f"Total docs: {len(all_docs)}")

# Parse each
extracted = []
seen_ids = set()
skipped_no_data = 0
skipped_filters = 0
skipped_account = 0
skipped_date = 0
for doc in all_docs:
    rec = load_record(doc)
    mf = load_filters(doc)
    if not rec and not mf:
        skipped_no_data += 1
        continue

    # Extract account ID and franchise
    cust_id = None
    franchise = None
    if rec:
        franchise = rec.get("Pre Franchise") or rec.get("Current FY Franchise") or rec.get("Opportunity Current FY Franchise")
    if mf and not cust_id:
        cust_id = (mf.get("customerid", [None]) + [None])[0]
    if mf and not franchise:
        franchise = (mf.get("prefranchise", []) + mf.get("currentfyfranchise", []) + mf.get("opportunitycurrentfyfranchise", []))
        franchise = franchise[0] if franchise else None

    if franchise != "Expand 3":
        skipped_filters += 1
        continue

    # Try to get cust_id from rec if missing
    if not cust_id:
        # rec may not have customerid, fall back
        skipped_account += 1
        continue

    if cust_id not in our_accounts:
        skipped_account += 1
        continue

    # Close date
    close_str = None
    if rec:
        close_str = rec.get("Close Date") or rec.get("Close Datetime")
    if not close_str and mf:
        close_str = mf.get("closedate") if isinstance(mf.get("closedate"), str) else None
        if not close_str:
            cd_list = mf.get("closedate")
            if isinstance(cd_list, list) and cd_list:
                close_str = cd_list[0]
    close_dt = parse_close_date(close_str) if close_str else None
    if not close_dt:
        skipped_date += 1
        continue
    if close_dt < min_date or close_dt > max_date:
        skipped_date += 1
        continue

    # Opp ID
    opp_id = None
    if rec:
        opp_id = rec.get("18-Digit ID") or rec.get("Opportunity ID")
    if not opp_id and mf:
        ids = mf.get("18digitid") or mf.get("x18_digit_id")
        if isinstance(ids, list):
            opp_id = ids[0] if ids else None
        elif isinstance(ids, str):
            opp_id = ids
    if not opp_id or opp_id in seen_ids:
        continue
    seen_ids.add(opp_id)

    # Build payload
    def get(rec_key, mf_key=None):
        if rec and rec.get(rec_key) is not None:
            return rec.get(rec_key)
        if mf and mf_key:
            v = mf.get(mf_key)
            if isinstance(v, list) and v:
                return v[0]
            if isinstance(v, str):
                return v
        return None

    name = get("Name") or doc.get("title", "")
    stage_name = get("Stage", "stagename") or get("Current Stage", "currentstage") or ""
    stage_num = stage_num_from_stage(stage_name)
    close_qtr = get("Close Quarter", "closequarter") or f"Q{((close_dt.month - 1) // 3) + 1}"
    if isinstance(close_qtr, list):
        close_qtr = close_qtr[0]

    fp = get("Close Date Fiscal Period", "closedatefiscalperiod") or ""
    if isinstance(fp, list):
        fp = fp[0] if fp else ""
    fy = close_dt.year
    if isinstance(fp, str) and fp.startswith("FY"):
        try:
            fy = int(fp[2:6])
        except Exception:
            pass

    acv = num(get("ACV"))
    atr = num(get("Available to Renew (USD)") or get("Available to Renew"))
    fml = num(get("Forecast Most Likely (USD)"))
    fml_override = num(get("Forecast Most Likely Override (USD)"))
    confidence = get("Most Likely Confidence") or "Medium"
    if isinstance(confidence, list):
        confidence = confidence[0] if confidence else "Medium"
    if confidence not in ("Low", "Medium", "High", "Confirmed", "Closed"):
        confidence = "Medium"
    hedge = num(get("Forecast Hedge")) or 0
    acv_delta = num(get("ACV Delta (USD)")) or 0
    cd_corp = num(get("Churn Delta (Corp)"))
    known_churn = abs(cd_corp) if (cd_corp is not None and cd_corp < 0) else 0

    product_line = get("Product Line", "productline") or "Zuora"
    if isinstance(product_line, list):
        product_line = product_line[0] if product_line else "Zuora"

    flm_notes = get("FLM  Notes") or get("FLM Notes") or ""
    next_steps = get("Next Steps") or ""
    full_churn_notif = get("Last Day to Notify Customer") or ""
    if isinstance(full_churn_notif, str) and "T" in full_churn_notif:
        full_churn_notif = full_churn_notif.split("T")[0]
    elif not full_churn_notif:
        full_churn_notif = None

    churn_reason = get("Churn Reason", "churnreason")
    if isinstance(churn_reason, list):
        churn_reason = churn_reason[0] if churn_reason else None

    opp_type = get("Opportunity Type", "opportunitytype") or "Renewal"
    if isinstance(opp_type, list):
        opp_type = opp_type[0] if opp_type else "Renewal"

    sf_url = f"https://zuora.lightning.force.com/lightning/r/Opportunity/{opp_id}/view"

    payload = {
        "opportunityId": opp_id,
        "opportunityName": name,
        "accountId": cust_id,
        "type": opp_type,
        "stageName": stage_name if isinstance(stage_name, str) else (stage_name[0] if stage_name else ""),
        "stageNum": stage_num,
        "closeDate": close_dt.isoformat(),
        "closeQuarter": close_qtr,
        "fiscalYear": fy,
        "acv": acv,
        "availableToRenewUSD": atr,
        "forecastMostLikely": fml,
        "forecastMostLikelyOverride": fml_override,
        "mostLikelyConfidence": confidence,
        "forecastHedgeUSD": hedge,
        "acvDelta": acv_delta,
        "knownChurnUSD": known_churn,
        "productLine": product_line,
        "flmNotes": flm_notes if isinstance(flm_notes, str) else "",
        "slmNotes": None,
        "scNextSteps": next_steps if isinstance(next_steps, str) else "",
        "salesEngineer": None,
        "fullChurnNotificationToOwnerDate": full_churn_notif,
        "fullChurnFinalEmailSentDate": None,
        "churnDownsellReason": churn_reason if isinstance(churn_reason, str) else None,
        "sourceLinks": [
            {"source": "salesforce", "label": "SFDC Opportunity", "url": sf_url}
        ],
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
    }
    extracted.append((opp_id, cust_id, payload))

print(f"Extracted: {len(extracted)}")
print(f"Skipped — no data: {skipped_no_data}, not-Expand-3: {skipped_filters}, "
      f"not-our-account: {skipped_account}, date-out-of-range: {skipped_date}")

if not extracted:
    sys.exit(0)

# Create new refresh
new_refresh = psql(
    "INSERT INTO refresh_runs (scoring_version, sources_attempted, sources_succeeded, started_at, completed_at, status, row_counts) "
    "VALUES ('v0.1.0', '[\"salesforce\"]'::jsonb, '[\"salesforce\"]'::jsonb, NOW(), NOW(), 'success', '{}'::jsonb) RETURNING id::text;",
    capture=True,
).splitlines()[-1].strip()
print(f"New refresh: {new_refresh}")

psql(
    f"INSERT INTO snapshot_account (refresh_id, account_id, payload, captured_at) "
    f"SELECT '{new_refresh}'::uuid, account_id, payload, NOW() FROM snapshot_account WHERE refresh_id='{src_refresh}';"
)
psql(
    f"INSERT INTO account_view (refresh_id, account_id, view_payload) "
    f"SELECT '{new_refresh}'::uuid, account_id, view_payload FROM account_view WHERE refresh_id='{src_refresh}';"
)


def esc(s):
    if s is None:
        return None
    return s.replace("'", "''")


inserts = []
for opp_id, cust_id, payload in extracted:
    p_json = json.dumps(payload)
    inserts.append(
        f"('{new_refresh}'::uuid, '{esc(opp_id)}', '{esc(cust_id)}', '{esc(p_json)}'::jsonb, NOW())"
    )

BATCH = 100
for i in range(0, len(inserts), BATCH):
    batch = inserts[i: i + BATCH]
    sql = (
        "INSERT INTO snapshot_opportunity (refresh_id, opportunity_id, account_id, payload, captured_at) VALUES "
        + ",".join(batch)
        + ";"
    )
    psql(sql)
    print(f"Inserted batch {i // BATCH + 1}: {len(batch)} rows")

psql(
    f"UPDATE refresh_runs SET row_counts = jsonb_build_object('accounts', "
    f"(SELECT COUNT(*) FROM snapshot_account WHERE refresh_id='{new_refresh}'), "
    f"'opportunities', (SELECT COUNT(*) FROM snapshot_opportunity WHERE refresh_id='{new_refresh}')) "
    f"WHERE id='{new_refresh}';"
)
print(f"Done. New refresh_id={new_refresh}, opportunities={len(inserts)}")
