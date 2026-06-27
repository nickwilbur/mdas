export interface LeadershipReportPage {
  num: number;
  title: string;
  label: string;
  markdown: string;
}

export interface LeadershipReportMeta {
  title: string;
  reportingPeriod?: string;
  preparedFor?: string;
  preparedBy?: string;
}

export interface HealthAreaRow {
  area: string;
  status: string;
  signal: string;
  interpretation: string;
}

export interface AttentionRow {
  item: string;
  why: string;
  ask: string;
  owner: string;
  neededBy: string;
}

export interface LabeledBullet {
  label: string;
  body: string;
}

export interface StrategicPosture {
  strategicPosture?: string;
  overallStatus?: string;
  confidence?: string;
  primaryAttention?: string;
  staffAssessment?: string;
}

export interface TableRow {
  cells: string[];
}

export interface ParsedTable {
  headers: string[];
  rows: TableRow[];
}

export interface AiAdoptionBlock {
  useCase?: string;
  why?: string;
  pilot?: string;
  successSignal?: string;
}

export interface LeadershipReportData {
  meta: LeadershipReportMeta;
  pages: LeadershipReportPage[];
  executiveSummary: LabeledBullet[];
  healthAreas: HealthAreaRow[];
  leadershipAttention: AttentionRow[];
  strategicPosture: StrategicPosture;
  strategicAlignment: ParsedTable;
  outcomesDelivered: ParsedTable;
  workInProgress: ParsedTable;
  engineeringHealth: ParsedTable;
  evidenceSummary: ParsedTable;
  focusAreas: ParsedTable;
  staffRecommendations: ParsedTable;
  risks: ParsedTable;
  aiAdoption: AiAdoptionBlock;
  closingAssessment: string[];
  footnote?: string;
}

const PAGE_HEADER_RE = /^# Page (\d+) — (.+)$/;

export function splitLeadershipReportPages(markdown: string): LeadershipReportPage[] {
  const lines = markdown.split('\n');
  const headers: { num: number; title: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(PAGE_HEADER_RE);
    if (m) headers.push({ num: Number(m[1]), title: m[2]!.trim(), line: i });
  }

  if (headers.length === 0) {
    return [{ num: 1, title: 'Report', label: 'Report', markdown: stripPageBreaks(markdown) }];
  }

  const intro = lines.slice(0, headers[0]!.line).join('\n').trim();

  return headers.map((header, idx) => {
    const end = headers[idx + 1]?.line ?? lines.length;
    let body = stripPageBreaks(lines.slice(header.line, end).join('\n'));
    if (idx === 0 && intro) body = `${intro}\n\n${body}`;
    return {
      num: header.num,
      title: header.title,
      label: `Page ${header.num}: ${header.title}`,
      markdown: body.trim(),
    };
  });
}

function stripPageBreaks(md: string): string {
  return md.replace(/<div style="page-break-after: always;"><\/div>/gi, '').trim();
}

export function stripInlineMd(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function parseMarkdownTable(section: string): ParsedTable | null {
  const lines = section.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return null;

  const parseRow = (line: string) =>
    line
      .split('|')
      .map((c) => stripInlineMd(c.trim()))
      .filter((c) => c.length > 0);

  const headers = parseRow(lines[0]!);
  const bodyStart = lines.length > 1 && /^\|[\s\-:|]+\|$/.test(lines[1]!.trim()) ? 2 : 1;
  const rows = lines
    .slice(bodyStart)
    .map(parseRow)
    .filter((r) => r.length > 0)
    .map((cells) => ({ cells }));

  if (headers.length === 0 || rows.length === 0) return null;
  return { headers, rows };
}

function extractSection(markdown: string, heading: string): string {
  const re = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, 'm');
  const match = re.exec(markdown);
  if (!match) return '';

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseLabeledBullets(section: string): LabeledBullet[] {
  const bullets: LabeledBullet[] = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^- \*\*([^*]+):\*\*\s*(.+)$/);
    if (m) bullets.push({ label: m[1]!.trim(), body: stripInlineMd(m[2]!) });
  }
  return bullets;
}

export function parseSimpleBullets(section: string): string[] {
  return section
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => stripInlineMd(l.slice(2)));
}

function parseKeyValueTable(section: string): Record<string, string> {
  const table = parseMarkdownTable(section);
  const out: Record<string, string> = {};
  if (!table) return out;
  for (const row of table.rows) {
    const key = row.cells[0];
    const val = row.cells[1];
    if (key && val) out[stripInlineMd(key)] = stripInlineMd(val);
  }
  return out;
}

function parseHealthAreas(section: string): HealthAreaRow[] {
  const table = parseMarkdownTable(section);
  if (!table) return [];
  return table.rows.map((r) => ({
    area: r.cells[0] ?? '',
    status: r.cells[1] ?? '',
    signal: r.cells[2] ?? '',
    interpretation: r.cells[3] ?? '',
  }));
}

function parseAttention(section: string): AttentionRow[] {
  const table = parseMarkdownTable(section);
  if (!table) return [];
  return table.rows.map((r) => ({
    item: r.cells[0] ?? '',
    why: r.cells[1] ?? '',
    ask: r.cells[2] ?? '',
    owner: r.cells[3] ?? '',
    neededBy: r.cells[4] ?? '',
  }));
}

function parseAiAdoption(section: string): AiAdoptionBlock {
  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
  const block: AiAdoptionBlock = {};
  let mode: keyof AiAdoptionBlock | null = null;

  for (const line of lines) {
    if (line.startsWith('**Recommended AI enablement use case:**')) {
      mode = 'useCase';
      const inline = line.replace(/\*\*Recommended AI enablement use case:\*\*\s*/, '').trim();
      if (inline) block.useCase = stripInlineMd(inline);
      continue;
    }
    if (line.startsWith('**Why it matters:**')) {
      mode = 'why';
      const inline = line.replace(/\*\*Why it matters:\*\*\s*/, '').trim();
      if (inline) block.why = stripInlineMd(inline);
      continue;
    }
    if (line.startsWith('**How to pilot next week:**')) {
      mode = 'pilot';
      const inline = line.replace(/\*\*How to pilot next week:\*\*\s*/, '').trim();
      if (inline) block.pilot = stripInlineMd(inline);
      continue;
    }
    if (line.startsWith('**Success signal:**')) {
      mode = 'successSignal';
      const inline = line.replace(/\*\*Success signal:\*\*\s*/, '').trim();
      if (inline) block.successSignal = stripInlineMd(inline);
      continue;
    }
    if (mode && !line.startsWith('**')) {
      const prev = block[mode] ?? '';
      block[mode] = prev ? `${prev} ${stripInlineMd(line)}` : stripInlineMd(line);
    }
  }
  return block;
}

/** Full structured parse for visual dashboard rendering. */
export function parseLeadershipReport(markdown: string): LeadershipReportData {
  const pages = splitLeadershipReportPages(markdown);
  const page1 = pages.find((p) => p.num === 1)?.markdown ?? pages[0]?.markdown ?? markdown;
  const page2 = pages.find((p) => p.num === 2)?.markdown ?? '';
  const page3 = pages.find((p) => p.num === 3)?.markdown ?? '';

  const title =
    markdown.match(/^# (.+)$/m)?.[1]?.trim() ?? 'MDAS Weekly Leadership Report';
  const reportingPeriod = markdown.match(/\*\*Reporting period:\*\*\s*(.+)/)?.[1]?.trim();
  const preparedFor = markdown.match(/\*\*Prepared for:\*\*\s*(.+)/)?.[1]?.trim();
  const preparedBy = markdown.match(/\*\*Prepared by:\*\*\s*(.+)/)?.[1]?.trim();

  const postureKv = parseKeyValueTable(extractSection(page1, 'Strategic Posture'));

  const footnoteMatch = markdown.match(/\n---\n\n(\*Evidence base:.+\*)\s*$/s);

  return {
    meta: { title, reportingPeriod, preparedFor, preparedBy },
    pages,
    executiveSummary: parseLabeledBullets(extractSection(page1, 'Executive Summary')),
    healthAreas: parseHealthAreas(
      extractSection(page1, 'Portfolio Health Dashboard') ||
        extractSection(page1, 'Overall Health Dashboard'),
    ),
    leadershipAttention: parseAttention(extractSection(page1, 'Leadership Attention Needed')),
    strategicPosture: {
      strategicPosture: postureKv['Strategic posture'],
      overallStatus: postureKv['Overall status'],
      confidence: postureKv['Confidence'],
      primaryAttention: postureKv['Primary leadership attention needed'],
      staffAssessment:
        postureKv['CSE leadership read'] ?? postureKv['Staff Engineer assessment'],
    },
    strategicAlignment:
      parseMarkdownTable(extractSection(page2, 'Strategic Alignment to CSE Goals')) ?? {
        headers: [],
        rows: [],
      },
    outcomesDelivered:
      parseMarkdownTable(extractSection(page2, 'Outcomes Delivered This Week')) ?? {
        headers: [],
        rows: [],
      },
    workInProgress:
      parseMarkdownTable(extractSection(page2, 'Key Work in Progress')) ?? {
        headers: [],
        rows: [],
      },
    engineeringHealth:
      parseMarkdownTable(
        extractSection(page2, 'Portfolio Data Confidence') ||
          extractSection(page2, 'Engineering and Operational Health Details'),
      ) ?? { headers: [], rows: [] },
    evidenceSummary:
      parseMarkdownTable(extractSection(page2, 'Evidence Summary')) ?? { headers: [], rows: [] },
    focusAreas:
      parseMarkdownTable(extractSection(page3, 'Recommended Focus Areas for Next Week')) ?? {
        headers: [],
        rows: [],
      },
    staffRecommendations:
      parseMarkdownTable(
        extractSection(page3, 'CSE Management Recommendations') ||
          extractSection(page3, 'Staff Engineer Recommendations'),
      ) ?? { headers: [], rows: [] },
    risks: parseMarkdownTable(extractSection(page3, 'Risks to Watch')) ?? { headers: [], rows: [] },
    aiAdoption: parseAiAdoption(extractSection(page3, 'AI Adoption Opportunity')),
    closingAssessment: parseSimpleBullets(
      extractSection(page3, 'Closing CSE Leadership Assessment') ||
        extractSection(page3, 'Closing Staff Engineer Assessment'),
    ),
    footnote: footnoteMatch?.[1] ? stripInlineMd(footnoteMatch[1]) : undefined,
  };
}

export function extractLeadershipPosture(markdown: string): {
  overallStatus?: string;
  strategicPosture?: string;
  confidence?: string;
  reportingPeriod?: string;
} {
  const data = parseLeadershipReport(markdown);
  return {
    reportingPeriod: data.meta.reportingPeriod,
    strategicPosture: data.strategicPosture.strategicPosture,
    overallStatus: data.strategicPosture.overallStatus,
    confidence: data.strategicPosture.confidence,
  };
}

export function latestWeeklyReportSlug(reports: { slug: string }[]): string | null {
  const weekly = reports
    .filter((r) => r.slug.startsWith('weekly-report-'))
    .sort((a, b) => b.slug.localeCompare(a.slug));
  return weekly[0]?.slug ?? null;
}

export function normalizeStatus(status: string): 'green' | 'yellow' | 'red' | 'neutral' {
  const s = status.toLowerCase();
  if (s.includes('green')) return 'green';
  if (s.includes('yellow')) return 'yellow';
  if (s.includes('red')) return 'red';
  return 'neutral';
}

export function normalizeProgress(value: string): 'progress' | 'partial' | 'limited' | 'neutral' {
  const s = value.toLowerCase();
  if (s.includes('progress')) return 'progress';
  if (s.includes('partial')) return 'partial';
  if (s.includes('limited')) return 'limited';
  return 'neutral';
}
