/**
 * Native landscape-letter PDF generator for the Expand 3 CSE executive brief.
 *
 * Renders real vector text + tables via jsPDF + autotable (no html2canvas
 * rasterization). Content flows continuously: a slim running header repeats on
 * every page, section headings never orphan at a page bottom, and long tables
 * paginate cleanly instead of clipping or letterboxing.
 */
import type { LeadershipReportData, ParsedTable } from './parse-report';
import { normalizeStatus } from './parse-report';

// Landscape US Letter, points.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BAND_H = 40;
const CONTENT_TOP = BAND_H + 14;
const BOTTOM = PAGE_H - 26;

const COLORS = {
  ink: [17, 24, 39] as [number, number, number],
  sub: [100, 116, 139] as [number, number, number],
  band: [15, 23, 42] as [number, number, number],
  headRow: [30, 41, 59] as [number, number, number],
  line: [226, 232, 240] as [number, number, number],
  zebra: [248, 250, 252] as [number, number, number],
  green: [220, 252, 231] as [number, number, number],
  greenInk: [22, 101, 52] as [number, number, number],
  yellow: [254, 243, 199] as [number, number, number],
  yellowInk: [120, 53, 15] as [number, number, number],
  red: [254, 226, 226] as [number, number, number],
  redInk: [153, 27, 27] as [number, number, number],
  neutral: [241, 245, 249] as [number, number, number],
  neutralInk: [51, 65, 85] as [number, number, number],
};

type RGB = [number, number, number];
type AutoTableOptions = Parameters<typeof import('jspdf-autotable').default>[1];

interface Ctx {
  doc: import('jspdf').jsPDF;
  autoTable: (doc: import('jspdf').jsPDF, options: AutoTableOptions) => void;
  y: number;
  title: string;
  period: string;
}

// jsPDF's built-in Helvetica is WinAnsi-only; map common non-WinAnsi glyphs
// from the markdown source to safe equivalents so text measures + renders right.
const GLYPH_MAP: Array<[RegExp, string]> = [
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/≠/g, '!='],
  [/×/g, 'x'],
  [/[≈∼]/g, '~'],
  [/→/g, '->'],
  [/←/g, '<-'],
  [/[•·]/g, '-'],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
  [/[\u2010\u2011\u2012\u2015]/g, '-'],
];

export function sanitizeText(s: string | undefined | null): string {
  if (!s) return '';
  let out = s.replace(/\*\*/g, '').replace(/`/g, '');
  for (const [re, rep] of GLYPH_MAP) out = out.replace(re, rep);
  return out.replace(/\s+/g, ' ').trim();
}

const strip = sanitizeText;

function statusFill(status: string): { fill: RGB; text: RGB } {
  switch (normalizeStatus(status)) {
    case 'green':
      return { fill: COLORS.green, text: COLORS.greenInk };
    case 'yellow':
      return { fill: COLORS.yellow, text: COLORS.yellowInk };
    case 'red':
      return { fill: COLORS.red, text: COLORS.redInk };
    default:
      return { fill: COLORS.neutral, text: COLORS.neutralInk };
  }
}

function drawBand(ctx: Ctx): void {
  const { doc } = ctx;
  doc.setFillColor(...COLORS.band);
  doc.rect(0, 0, PAGE_W, BAND_H, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(ctx.title, MARGIN, 25);
  if (ctx.period) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(203, 213, 225);
    doc.text(ctx.period, PAGE_W - MARGIN, 24, { align: 'right' });
  }
}

function tableEndY(ctx: Ctx): number {
  const last = (ctx.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last ? last.finalY : ctx.y;
}

/** Start a new page (preserving the running header) when `needed` pts won't fit. */
function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y + needed > BOTTOM) {
    ctx.doc.addPage('letter', 'landscape');
    drawBand(ctx);
    ctx.y = CONTENT_TOP;
  }
}

function heading(ctx: Ctx, label: string): void {
  ensure(ctx, 48);
  const { doc } = ctx;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.ink);
  doc.text(label.toUpperCase(), MARGIN, ctx.y);
  doc.setDrawColor(...COLORS.line);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, ctx.y + 3, MARGIN + CONTENT_W, ctx.y + 3);
  ctx.y += 13;
}

function paragraph(ctx: Ctx, text: string, opts?: { bold?: boolean; size?: number; color?: RGB }): void {
  const { doc } = ctx;
  const size = opts?.size ?? 7.5;
  const lineH = size * 1.25;
  doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...(opts?.color ?? COLORS.ink));
  const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
  for (const line of lines) {
    ensure(ctx, lineH + 1);
    doc.text(line, MARGIN, ctx.y);
    ctx.y += lineH;
  }
}

const BASE_TABLE_STYLES = {
  font: 'helvetica' as const,
  fontSize: 7,
  cellPadding: 3,
  overflow: 'linebreak' as const,
  lineColor: COLORS.line,
  lineWidth: 0.5,
  textColor: COLORS.ink,
  valign: 'top' as const,
};

const HEAD_STYLES = {
  fillColor: COLORS.headRow,
  textColor: [255, 255, 255] as RGB,
  fontStyle: 'bold' as const,
  fontSize: 7,
  cellPadding: 3,
};

/** Run an autotable in flow: it paginates within the body area and repaints the band. */
function flow(ctx: Ctx, options: Partial<AutoTableOptions>): void {
  ctx.autoTable(ctx.doc, {
    startY: ctx.y,
    margin: { top: CONTENT_TOP, bottom: 26, left: MARGIN, right: MARGIN },
    tableWidth: CONTENT_W,
    styles: BASE_TABLE_STYLES,
    headStyles: HEAD_STYLES,
    alternateRowStyles: { fillColor: COLORS.zebra },
    rowPageBreak: 'avoid',
    didDrawPage: () => drawBand(ctx),
    ...options,
  } as AutoTableOptions);
  ctx.y = tableEndY(ctx) + 14;
}

function kpiStrip(ctx: Ctx, data: LeadershipReportData): void {
  const sp = data.strategicPosture;
  const cells = [
    { label: 'Overall status', value: strip(sp.overallStatus) || '—', status: sp.overallStatus },
    { label: 'Confidence', value: strip(sp.confidence) || '—' },
    { label: 'Strategic posture', value: strip(sp.strategicPosture) || '—' },
    { label: 'Primary attention', value: strip(sp.primaryAttention) || '—' },
  ];
  ensure(ctx, 60);
  const colW = CONTENT_W / 4;
  flow(ctx, {
    styles: { ...BASE_TABLE_STYLES, cellPadding: 6, minCellHeight: 50 },
    columnStyles: { 0: { cellWidth: colW }, 1: { cellWidth: colW }, 2: { cellWidth: colW }, 3: { cellWidth: colW } },
    body: [cells.map(() => ({ content: '' }))],
    didParseCell: (hook) => {
      hook.cell.styles.fillColor = COLORS.zebra;
    },
    didDrawCell: (hook) => {
      const c = cells[hook.column.index];
      if (!c || hook.section !== 'body') return;
      const { doc } = ctx;
      const x = hook.cell.x + 7;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      doc.setTextColor(...COLORS.sub);
      doc.text(c.label.toUpperCase(), x, hook.cell.y + 12);
      if (c.status) {
        const sc = statusFill(c.status);
        const badgeW = Math.min(doc.getTextWidth(c.value) + 12, hook.cell.width - 14);
        doc.setFillColor(...sc.fill);
        doc.roundedRect(x, hook.cell.y + 18, badgeW, 14, 2, 2, 'F');
        doc.setTextColor(...sc.text);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(c.value, x + 6, hook.cell.y + 28);
      } else {
        doc.setTextColor(...COLORS.ink);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(c.value, hook.cell.width - 14) as string[];
        doc.text(lines.slice(0, 3), x, hook.cell.y + 24, { lineHeightFactor: 1.2 });
      }
    },
  });
}

function healthTable(ctx: Ctx, data: LeadershipReportData): void {
  if (data.healthAreas.length === 0) return;
  heading(ctx, 'Portfolio health signals');
  flow(ctx, {
    head: [['Area', 'Status', 'Signal', 'Leadership interpretation']],
    body: data.healthAreas.map((r) => [strip(r.area), strip(r.status), strip(r.signal), strip(r.interpretation)]),
    columnStyles: {
      0: { cellWidth: 116, fontStyle: 'bold' },
      1: { cellWidth: 50, halign: 'center' },
      2: { cellWidth: 250 },
      3: { cellWidth: CONTENT_W - 116 - 50 - 250 },
    },
    didParseCell: (hook) => {
      if (hook.section === 'body' && hook.column.index === 1) {
        const sc = statusFill(hook.cell.raw as string);
        hook.cell.styles.fillColor = sc.fill;
        hook.cell.styles.textColor = sc.text;
        hook.cell.styles.fontStyle = 'bold';
        hook.cell.styles.halign = 'center';
      }
    },
  });
}

function execSummary(ctx: Ctx, data: LeadershipReportData): void {
  if (data.executiveSummary.length === 0) return;
  heading(ctx, 'Executive summary');
  flow(ctx, {
    body: data.executiveSummary.map((b) => [strip(b.label), strip(b.body)]),
    columnStyles: {
      0: { cellWidth: 150, fontStyle: 'bold', textColor: COLORS.band },
      1: { cellWidth: CONTENT_W - 150 },
    },
  });
}

function attentionTable(ctx: Ctx, data: LeadershipReportData): void {
  if (data.leadershipAttention.length === 0) return;
  heading(ctx, 'Leadership attention needed');
  flow(ctx, {
    head: [['Item', 'Why it matters', 'Ask / decision', 'Owner', 'By']],
    body: data.leadershipAttention.map((r) => [
      strip(r.item),
      strip(r.why),
      strip(r.ask),
      strip(r.owner),
      strip(r.neededBy),
    ]),
    columnStyles: {
      0: { cellWidth: 116, fontStyle: 'bold' },
      1: { cellWidth: 170 },
      2: { cellWidth: CONTENT_W - 116 - 170 - 110 - 54 },
      3: { cellWidth: 110 },
      4: { cellWidth: 54 },
    },
  });
}

function genericTable(
  ctx: Ctx,
  title: string,
  table: ParsedTable,
  opts?: { boldFirstCol?: boolean },
): void {
  if (table.rows.length === 0) return;
  heading(ctx, title);
  flow(ctx, {
    head: [table.headers.map((h) => strip(h))],
    body: table.rows.map((r) => r.cells.map((c) => strip(c))),
    columnStyles: opts?.boldFirstCol ? { 0: { fontStyle: 'bold', textColor: COLORS.band } } : {},
  });
}

function keyValueGrid(ctx: Ctx, title: string, table: ParsedTable): void {
  if (table.rows.length === 0) return;
  heading(ctx, title);
  flow(ctx, {
    body: table.rows.map((r) => [strip(r.cells[0]), strip(r.cells[1] ?? '')]),
    columnStyles: {
      0: { cellWidth: 190, fontStyle: 'bold', textColor: COLORS.band },
      1: { cellWidth: CONTENT_W - 190 },
    },
  });
}

function aiAndClosing(ctx: Ctx, data: LeadershipReportData): void {
  const ai = data.aiAdoption;
  if (ai.useCase || ai.why) {
    heading(ctx, 'AI adoption opportunity');
    if (ai.useCase) paragraph(ctx, strip(ai.useCase), { bold: true });
    const parts = [ai.why, ai.pilot && `Pilot: ${ai.pilot}`, ai.successSignal && `Success signal: ${ai.successSignal}`]
      .filter(Boolean)
      .map((p) => strip(p as string));
    for (const p of parts) paragraph(ctx, p, { color: COLORS.sub });
    ctx.y += 6;
  }

  if (data.closingAssessment.length > 0) {
    heading(ctx, 'Closing leadership assessment');
    data.closingAssessment.forEach((c, i) => {
      paragraph(ctx, `${i + 1}.  ${strip(c)}`);
      ctx.y += 2;
    });
  }
}

function stampPageNumbers(ctx: Ctx, footnote?: string): void {
  const { doc } = ctx;
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.sub);
    doc.text(`Page ${i} of ${total}`, PAGE_W - MARGIN, PAGE_H - 14, { align: 'right' });
    if (i === total && footnote) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6);
      const lines = doc.splitTextToSize(strip(footnote), CONTENT_W - 120) as string[];
      doc.text(lines.slice(0, 2), MARGIN, PAGE_H - 14);
    }
  }
}

export async function buildLeadershipBriefDoc(
  data: LeadershipReportData,
): Promise<import('jspdf').jsPDF> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // Importing jspdf-autotable also registers a `.autoTable()` instance method;
  // resolve the functional export when present, else use the instance method.
  const fn = typeof autoTableMod.default === 'function' ? autoTableMod.default : null;
  const autoTable: Ctx['autoTable'] = (d, options) => {
    if (fn) fn(d, options);
    else (d as unknown as { autoTable: (o: AutoTableOptions) => void }).autoTable(options);
  };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const ctx: Ctx = {
    doc,
    autoTable,
    y: CONTENT_TOP,
    title: strip(data.meta.title) || 'Expand 3 CSE Executive Brief',
    period: data.meta.reportingPeriod ? `Reporting period: ${strip(data.meta.reportingPeriod)}` : '',
  };

  drawBand(ctx);

  kpiStrip(ctx, data);
  healthTable(ctx, data);
  attentionTable(ctx, data);
  execSummary(ctx, data);
  genericTable(ctx, 'Strategic alignment to CSE goals', data.strategicAlignment, { boldFirstCol: true });
  genericTable(ctx, 'Outcomes delivered this week', data.outcomesDelivered, { boldFirstCol: true });
  genericTable(ctx, 'Key work in progress', data.workInProgress, { boldFirstCol: true });
  keyValueGrid(ctx, 'Portfolio data confidence', data.engineeringHealth);
  keyValueGrid(ctx, 'Evidence summary', data.evidenceSummary);
  genericTable(ctx, 'Recommended focus areas', data.focusAreas, { boldFirstCol: true });
  genericTable(ctx, 'CSE management recommendations', data.staffRecommendations, { boldFirstCol: true });
  genericTable(ctx, 'Risks to watch', data.risks, { boldFirstCol: true });
  aiAndClosing(ctx, data);

  stampPageNumbers(ctx, data.footnote);

  return doc;
}

export async function exportLeadershipBriefPdf(
  data: LeadershipReportData,
  filename: string,
): Promise<void> {
  const doc = await buildLeadershipBriefDoc(data);
  doc.save(filename);
}
