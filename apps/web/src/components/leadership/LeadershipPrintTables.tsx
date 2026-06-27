import clsx from 'clsx';
import { normalizeStatus } from '@/lib/leadership/parse-report';
import type { AttentionRow, HealthAreaRow, LeadershipReportData } from '@/lib/leadership/parse-report';

const PRINT_TABLE =
  'brief-pdf-table w-full border-collapse text-left text-[8px] leading-tight print:text-[8px]';
const PRINT_TH = 'border border-gray-300 bg-slate-800 px-1.5 py-1 font-semibold text-white';
const PRINT_TD = 'border border-gray-200 px-1.5 py-1 align-top text-gray-800';

function stripMd(s: string): string {
  return s.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function PrintStatus({ status }: { status: string }) {
  const tone = normalizeStatus(status);
  const colors = {
    green: 'bg-emerald-100 text-emerald-900',
    yellow: 'bg-amber-100 text-amber-950',
    red: 'bg-red-100 text-red-900',
    neutral: 'bg-gray-100 text-gray-700',
  } as const;
  return (
    <span className={clsx('inline-block rounded px-1 py-0.5 font-semibold', colors[tone])}>
      {stripMd(status)}
    </span>
  );
}

export function HealthAreasPrintTable({ areas }: { areas: HealthAreaRow[] }) {
  if (areas.length === 0) return null;
  return (
    <table className={PRINT_TABLE}>
      <thead>
        <tr>
          <th className={clsx(PRINT_TH, 'w-[22%]')}>Area</th>
          <th className={clsx(PRINT_TH, 'w-[8%]')}>Status</th>
          <th className={clsx(PRINT_TH, 'w-[32%]')}>Signal</th>
          <th className={clsx(PRINT_TH, 'w-[38%]')}>Interpretation</th>
        </tr>
      </thead>
      <tbody>
        {areas.map((row) => (
          <tr key={row.area} className="even:bg-gray-50/80">
            <td className={clsx(PRINT_TD, 'font-medium')}>{row.area}</td>
            <td className={PRINT_TD}>
              <PrintStatus status={row.status} />
            </td>
            <td className={PRINT_TD}>{stripMd(row.signal)}</td>
            <td className={PRINT_TD}>{stripMd(row.interpretation)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LeadershipAttentionPrintTable({ rows }: { rows: AttentionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <table className={PRINT_TABLE}>
      <thead>
        <tr>
          <th className={clsx(PRINT_TH, 'w-[18%]')}>Item</th>
          <th className={clsx(PRINT_TH, 'w-[22%]')}>Why</th>
          <th className={clsx(PRINT_TH, 'w-[36%]')}>Ask</th>
          <th className={clsx(PRINT_TH, 'w-[14%]')}>Owner</th>
          <th className={clsx(PRINT_TH, 'w-[10%]')}>By</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.item}>
            <td className={clsx(PRINT_TD, 'font-medium')}>{row.item}</td>
            <td className={PRINT_TD}>{row.why}</td>
            <td className={PRINT_TD}>{stripMd(row.ask)}</td>
            <td className={PRINT_TD}>{row.owner}</td>
            <td className={PRINT_TD}>{row.neededBy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ExecutiveSummaryPrintGrid({
  items,
}: {
  items: { label: string; body: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {items.map((b) => (
        <div key={b.label} className="text-[8px] leading-snug text-gray-800">
          <span className="font-semibold text-slate-700">{b.label}: </span>
          {stripMd(b.body)}
        </div>
      ))}
    </div>
  );
}

export function FocusAreasPrintTable({ data }: { data: LeadershipReportData }) {
  const { focusAreas } = data;
  if (focusAreas.rows.length === 0) return null;
  return (
    <table className={PRINT_TABLE}>
      <thead>
        <tr>
          {focusAreas.headers.map((h) => (
            <th key={h} className={PRINT_TH}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {focusAreas.rows.map((row, i) => (
          <tr key={i} className="even:bg-gray-50/80">
            {row.cells.map((cell, ci) => (
              <td key={ci} className={clsx(PRINT_TD, ci === 0 && 'font-medium')}>
                {stripMd(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
