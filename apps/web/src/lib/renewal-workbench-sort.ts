import type { SortDirection } from '@/components/TableHeader';

export const RENEWAL_WORKBENCH_SORT_KEY = 'mdas:renewal-workbench-sort:v1';

export type RenewalWorkbenchSortField =
  | 'account'
  | 'opportunity'
  | 'cse'
  | 'renewalDate'
  | 'stage'
  | 'atr'
  | 'renewed'
  | 'churned'
  | 'downsell'
  | 'outcome'
  | 'health'
  | 'overallAssessment'
  | 'slackUpdate'
  | 'customerEngagement';

export interface RenewalWorkbenchSort {
  field: RenewalWorkbenchSortField;
  direction: SortDirection;
}

export const DEFAULT_RENEWAL_WORKBENCH_SORT: RenewalWorkbenchSort = {
  field: 'atr',
  direction: 'desc',
};

const VALID_FIELDS = new Set<RenewalWorkbenchSortField>([
  'account',
  'opportunity',
  'cse',
  'renewalDate',
  'stage',
  'atr',
  'renewed',
  'churned',
  'downsell',
  'outcome',
  'health',
  'overallAssessment',
  'slackUpdate',
  'customerEngagement',
]);

export function normalizeRenewalWorkbenchSort(raw: unknown): RenewalWorkbenchSort {
  if (!raw || typeof raw !== 'object') return DEFAULT_RENEWAL_WORKBENCH_SORT;
  const r = raw as Partial<RenewalWorkbenchSort>;
  const field = VALID_FIELDS.has(r.field as RenewalWorkbenchSortField)
    ? (r.field as RenewalWorkbenchSortField)
    : DEFAULT_RENEWAL_WORKBENCH_SORT.field;
  const direction = r.direction === 'asc' || r.direction === 'desc' ? r.direction : 'desc';
  return { field, direction };
}

export const renewalWorkbenchSortSerializer = {
  serialize: (v: RenewalWorkbenchSort): string => JSON.stringify(v),
  deserialize: (s: string): RenewalWorkbenchSort =>
    normalizeRenewalWorkbenchSort(JSON.parse(s)),
};
