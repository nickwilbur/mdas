/**
 * Parse and select values from a Clari *manager forecast export* CSV
 * (Role / Timeframe / Field / Week / Data Type / Data Value, …).
 *
 * Headline churn/downsell numbers must come from the latest populated
 * "Forecast Value" row — never from summing weeks, never from
 * "Forecast Updated", and never by coercing Yes/No into dollars.
 */

export const CLARI_FORECAST_SOURCE_LABEL = 'Clari manager forecast export';

export interface ClariManagerForecastRow {
  user: string;
  email: string;
  crmUserId: string;
  role: string;
  parentRole: string;
  timeframe: string;
  field: string;
  week: number | null;
  startDay: string;
  endDay: string;
  dataType: string;
  dataValueRaw: string;
}

export interface ClariForecastSelection {
  clariForecastValue: number;
  clariForecastWeek: number | null;
  clariForecastStartDay: string;
  clariForecastEndDay: string;
  forecastSource: typeof CLARI_FORECAST_SOURCE_LABEL;
}

/** Parse "Data Value" cells into a finite number, or null if blank / non-numeric / boolean text. */
export function parseClariNumericDataValue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (t === '') return null;
  if (/^(yes|no|n\/a)$/i.test(t)) return null;
  const normalized = t.replace(/[$,]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clari exports alternate spellings for the same forecast field — e.g.
 * `Churn & Downsell Flash` in manager exports vs `Churn/Downsell Flash`
 * in older fixtures. Normalize before matching.
 */
export function normalizeClariFieldName(field: string): string {
  return field.trim().replace(/\s*&\s*/g, '/');
}

function normalizeHeaderCell(s: string): string {
  return s.trim().toLowerCase();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseWeekCell(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a Clari manager forecast export pasted as CSV text.
 * Header row is required; column names are matched case-insensitively.
 */
export function parseClariManagerForecastExportCsv(csv: string): ClariManagerForecastRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const headerCells = parseCsvLine(lines[0]!).map(normalizeHeaderCell);
  const idx = (name: string): number => {
    const i = headerCells.indexOf(name);
    return i;
  };

  // Accept common Clari export header spellings
  const col = {
    user: idx('user'),
    email: idx('email'),
    crmUserId: idx('crm user id'),
    role: idx('role'),
    parentRole: idx('parent role'),
    timeframe: idx('timeframe'),
    field: idx('field'),
    week: idx('week'),
    startDay: idx('start day'),
    endDay: idx('end day'),
    dataType: idx('data type'),
    dataValue: idx('data value'),
  };
  if (col.role < 0 || col.timeframe < 0 || col.field < 0 || col.dataType < 0 || col.dataValue < 0) {
    return [];
  }

  const out: ClariManagerForecastRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]!);
    const get = (i: number) => (i >= 0 && i < cells.length ? cells[i]! : '').trim();
    out.push({
      user: get(col.user),
      email: get(col.email),
      crmUserId: get(col.crmUserId),
      role: get(col.role),
      parentRole: get(col.parentRole),
      timeframe: get(col.timeframe),
      field: get(col.field),
      week: col.week >= 0 ? parseWeekCell(get(col.week)) : null,
      startDay: get(col.startDay),
      endDay: get(col.endDay),
      dataType: get(col.dataType),
      dataValueRaw: get(col.dataValue),
    });
  }
  return out;
}

export function parseFiscalQuarterKey(key: string): { fy: number; q: number } | null {
  const m = key.match(/^(\d+)-Q([1-4])$/);
  if (!m) return null;
  return { fy: parseInt(m[1]!, 10), q: parseInt(m[2]!, 10) };
}

/**
 * True when a Clari `Timeframe` cell corresponds to the MDAS fiscal
 * quarter key (e.g. "2027-Q2" ↔ "FY27 Q2", "Q2", "2027-Q2").
 */
export function timeframeMatchesFiscalQuarter(
  timeframe: string,
  fiscalQuarterKey: string,
): boolean {
  const tf = timeframe.trim();
  const fq = parseFiscalQuarterKey(fiscalQuarterKey);
  if (!fq) return false;

  if (tf === fiscalQuarterKey) return true;

  const fyShort = String(fq.fy).slice(-2);
  const reLabeled = new RegExp(`^FY\\s*${fyShort}\\s*Q${fq.q}$`, 'i');
  if (reLabeled.test(tf.replace(/\s+/g, ' '))) return true;

  const mFull = tf.match(/FY\s*(\d{2,4})\s*Q([1-4])/i);
  if (mFull) {
    let fy = parseInt(mFull[1]!, 10);
    if (fy < 100) fy += 2000;
    const q = parseInt(mFull[2]!, 10);
    return fy === fq.fy && q === fq.q;
  }

  const mIso = tf.match(/^(\d{4})-Q([1-4])$/i);
  if (mIso) {
    return parseInt(mIso[1]!, 10) === fq.fy && parseInt(mIso[2]!, 10) === fq.q;
  }

  const mBare = tf.match(/^Q([1-4])$/i);
  if (mBare) return parseInt(mBare[1]!, 10) === fq.q;

  return false;
}

export interface SelectClariForecastValueOpts {
  role: string;
  /** e.g. (tf) => timeframeMatchesFiscalQuarter(tf, "2027-Q2") */
  timeframeMatches: (timeframe: string) => boolean;
  field: string;
  dataType: string;
}

/**
 * Filter → sort by week (asc) then Start Day (asc) → take the **last**
 * row with a populated numeric Data Value (latest populated week).
 */
export function selectLatestClariForecastValue(
  rows: ClariManagerForecastRow[],
  opts: SelectClariForecastValueOpts,
): ClariForecastSelection | null {
  const roleWant = opts.role.trim();
  const fieldWant = normalizeClariFieldName(opts.field);
  const dataTypeWant = opts.dataType.trim();

  const candidates = rows.filter(
    (r) =>
      r.role.trim() === roleWant &&
      opts.timeframeMatches(r.timeframe.trim()) &&
      normalizeClariFieldName(r.field) === fieldWant &&
      r.dataType.trim() === dataTypeWant,
  );

  const populated = candidates.filter((r) => parseClariNumericDataValue(r.dataValueRaw) != null);
  if (populated.length === 0) return null;

  populated.sort((a, b) => {
    const wa = a.week ?? -1;
    const wb = b.week ?? -1;
    if (wa !== wb) return wa - wb;
    return a.startDay.localeCompare(b.startDay);
  });

  const last = populated[populated.length - 1]!;
  const value = parseClariNumericDataValue(last.dataValueRaw);
  if (value == null) return null;

  return {
    clariForecastValue: value,
    clariForecastWeek: last.week,
    clariForecastStartDay: last.startDay,
    clariForecastEndDay: last.endDay,
    forecastSource: CLARI_FORECAST_SOURCE_LABEL,
  };
}
