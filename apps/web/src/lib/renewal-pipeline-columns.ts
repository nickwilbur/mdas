/** Column layout for the renewal workbench pipeline table. */

export type PipelineColumnId =
  | 'account'
  | 'opportunity'
  | 'cse'
  | 'closeDate'
  | 'stage'
  | 'status'
  | 'cta'
  | 'atr'
  | 'forecast'
  | 'downsell'
  | 'nextStep'
  | 'overallAssessment'
  | 'slackUpdate'
  | 'customerEngagement';

export const PIPELINE_COLUMNS_STORAGE_KEY = 'mdas:renewal-workbench-pipeline-columns:v1';

export const DEFAULT_PIPELINE_COLUMN_ORDER: PipelineColumnId[] = [
  'account',
  'opportunity',
  'cse',
  'closeDate',
  'stage',
  'status',
  'cta',
  'atr',
  'forecast',
  'downsell',
  'nextStep',
  'overallAssessment',
  'slackUpdate',
  'customerEngagement',
];

export const DEFAULT_PIPELINE_COLUMN_WIDTHS: Record<PipelineColumnId, number> = {
  account: 160,
  opportunity: 200,
  cse: 120,
  closeDate: 108,
  stage: 120,
  status: 140,
  cta: 120,
  atr: 96,
  forecast: 96,
  downsell: 96,
  nextStep: 160,
  overallAssessment: 140,
  slackUpdate: 88,
  customerEngagement: 108,
};

export const PIPELINE_COLUMN_MIN_WIDTH = 72;

export interface PipelineColumnLayout {
  order: PipelineColumnId[];
  widths: Partial<Record<PipelineColumnId, number>>;
}

export function normalizePipelineColumnLayout(raw: PipelineColumnLayout | null): PipelineColumnLayout {
  const known = new Set<PipelineColumnId>(DEFAULT_PIPELINE_COLUMN_ORDER);
  const order: PipelineColumnId[] = [];
  for (const id of raw?.order ?? DEFAULT_PIPELINE_COLUMN_ORDER) {
    if (known.has(id) && !order.includes(id)) order.push(id);
  }
  for (const id of DEFAULT_PIPELINE_COLUMN_ORDER) {
    if (!order.includes(id)) order.push(id);
  }
  const widths: Partial<Record<PipelineColumnId, number>> = {
    ...DEFAULT_PIPELINE_COLUMN_WIDTHS,
    ...(raw?.widths ?? {}),
  };
  for (const id of DEFAULT_PIPELINE_COLUMN_ORDER) {
    const w = widths[id];
    if (w == null || w < PIPELINE_COLUMN_MIN_WIDTH) {
      widths[id] = DEFAULT_PIPELINE_COLUMN_WIDTHS[id];
    }
  }
  return { order, widths };
}

export const pipelineColumnLayoutSerializer = {
  serialize: (v: PipelineColumnLayout): string => JSON.stringify(v),
  deserialize: (s: string): PipelineColumnLayout =>
    normalizePipelineColumnLayout(JSON.parse(s) as PipelineColumnLayout),
};
