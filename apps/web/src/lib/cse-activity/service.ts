import 'server-only';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestSuccessfulRun } from '@mdas/db';
import {
  assessGleanMcpFreshness,
  compareSnapshots,
  dedupeTeamMembers,
  generateAllTeamReports,
  generateManagerDashboard,
  generateWeeklySnapshotPackage,
  gleanMcpNeedsRefreshWarning,
  inferTeamMembersFromViews,
  listSnapshotDates,
  readSnapshot,
  readTextArtifact,
  slugifyName,
  writeSnapshotFiles,
  type GleanMcpFreshnessSummary,
  type TeamMemberConfig,
  type WeeklySnapshot,
} from '@mdas/cse-activity';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';
import { loadCTAData } from '@/lib/cta-data';
import { loadCseActivityConfig } from './config';
import { mdasProjectRoot } from './project-root';
import type { CseSnapshotJobProgress } from './snapshot-jobs';

function ctaUpdatesInWindow() {
  const { logEntries } = loadCTAData();
  return logEntries.map((e) => ({
    cta_id: e.cta_id,
    account_name: e.account_name,
    salesforce_account_id: e.salesforce_account_id,
    play_type: e.play_type,
    status: e.status,
    updated_at: e.updated_at,
    owner:
      typeof e.assigned_owner === 'string'
        ? e.assigned_owner
        : e.assigned_owner?.name ?? (typeof e.primary_owner === 'string' ? e.primary_owner : e.primary_owner?.name),
    atr_at_risk_usd: e.atr_at_risk_usd,
  }));
}

export async function getInferredTeamFromViews(): Promise<TeamMemberConfig[]> {
  const { views } = await getDashboardData(7);
  return inferTeamMembersFromViews(views);
}

export async function getGleanMcpFreshnessSummary(): Promise<GleanMcpFreshnessSummary> {
  const [run, { views }] = await Promise.all([latestSuccessfulRun(), getDashboardData(7)]);
  const latestRefresh = run
    ? {
        startedAt: run.started_at,
        gleanMcpRan: (run.sources_succeeded ?? []).includes('glean-mcp'),
      }
    : null;
  return assessGleanMcpFreshness(views, { latestRefresh });
}

export { gleanMcpNeedsRefreshWarning };

export async function generateCseActivitySnapshot(opts?: {
  force?: boolean;
  anchor?: string;
  request?: Request;
  onProgress?: (progress: CseSnapshotJobProgress) => void;
}) {
  const report = (phase: string, current: number, total: number, label?: string) => {
    opts?.onProgress?.({ phase, current, total, label });
  };

  const root = mdasProjectRoot();
  const config = loadCseActivityConfig();

  report('load_mdas', 0, 3, 'Loading MDAS portfolio and WoW changes…');
  const [{ views, refreshId, startedAt }, wow, run] = await Promise.all([
    getDashboardData(7),
    getWoWChangeEvents(7),
    latestSuccessfulRun(),
  ]);
  report('load_mdas', 1, 3, `Loaded ${views.length} account views`);

  const gleanFreshness = assessGleanMcpFreshness(views, {
    latestRefresh:
      run && refreshId && run.id === refreshId
        ? {
            startedAt: run.started_at,
            gleanMcpRan: (run.sources_succeeded ?? []).includes('glean-mcp'),
          }
        : startedAt
          ? { startedAt, gleanMcpRan: false }
          : null,
  });
  const staleTotal = gleanFreshness.staleCount + gleanFreshness.neverEnrichedCount;
  const needsGleanRefresh = gleanMcpNeedsRefreshWarning(gleanFreshness);
  report(
    'load_mdas',
    2,
    3,
    needsGleanRefresh
      ? `Glean enrichment needs attention: ${staleTotal}/${gleanFreshness.expand3Total} accounts (${gleanFreshness.staleCount} stale, ${gleanFreshness.neverEnrichedCount} never queried)`
      : `Glean enrichment OK — ${gleanFreshness.freshCount}/${gleanFreshness.expand3Total} accounts fresh (Data Quality window)`,
  );

  report('build_snapshot', 0, 1, 'Building snapshot package and reports…');
  const pkg = generateWeeklySnapshotPackage({
    projectRoot: root,
    config,
    views,
    changeEvents: wow.events,
    ctaUpdates: ctaUpdatesInWindow(),
    mdasRefresh: { refreshId, startedAt },
    anchor: opts?.anchor ? new Date(opts.anchor) : undefined,
    force: opts?.force,
  });

  report('build_snapshot', 1, 1, `Saved snapshot ${pkg.snapshotDate}`);
  return pkg;
}

export function listCseSnapshots(): string[] {
  return listSnapshotDates(mdasProjectRoot(), loadCseActivityConfig());
}

export function getCseSnapshot(snapshotDate: string): WeeklySnapshot | null {
  return readSnapshot(mdasProjectRoot(), loadCseActivityConfig(), snapshotDate);
}

export function getManagerDashboardMarkdown(snapshotDate: string): string | null {
  const snapshot = getCseSnapshot(snapshotDate);
  if (snapshot) {
    return generateManagerDashboard(snapshot);
  }
  return readTextArtifact(
    mdasProjectRoot(),
    loadCseActivityConfig(),
    snapshotDate,
    'manager_dashboard.md',
  );
}

export function getTeamMemberReportMarkdown(
  snapshotDate: string,
  memberSlug: string,
): string | null {
  const config = loadCseActivityConfig();
  return readTextArtifact(
    mdasProjectRoot(),
    loadCseActivityConfig(),
    snapshotDate,
    join(config.individualReportOutputDir, `${memberSlug}.md`),
  );
}

export function regenerateManagerDashboard(snapshotDate: string): string | null {
  const snapshot = getCseSnapshot(snapshotDate);
  const config = loadCseActivityConfig();
  if (!snapshot) return null;
  const md = generateManagerDashboard(snapshot);
  const path = join(
    mdasProjectRoot(),
    config.snapshotOutputDir,
    snapshotDate,
    'manager_dashboard.md',
  );
  if (!existsSync(join(path, '..'))) return null;
  writeFileSync(path, md, 'utf-8');
  return md;
}

export async function regenerateTeamReports(snapshotDate: string): Promise<string[]> {
  const snapshot = getCseSnapshot(snapshotDate);
  const config = loadCseActivityConfig();
  if (!snapshot) return [];
  const teamMembers = dedupeTeamMembers(
    snapshot.metadata.teamMemberConfigs ??
      snapshot.metadata.teamMembersIncluded.map((name) => ({
        name,
        email: '',
        slackUserId: null,
        calendarId: null,
        crmOwnerId: null,
        mdasCseId: null,
        active: true,
      })),
  );
  const reports = generateAllTeamReports(snapshot, { ...config, teamMembers });
  const managerMd =
    readTextArtifact(mdasProjectRoot(), config, snapshotDate, 'manager_dashboard.md') ?? '';
  writeSnapshotFiles(mdasProjectRoot(), config, snapshot, managerMd, reports);
  return Object.keys(reports);
}

export function compareCseSnapshots(currentDate: string, priorDate?: string) {
  const current = getCseSnapshot(currentDate);
  const dates = listCseSnapshots();
  const prior =
    priorDate != null
      ? getCseSnapshot(priorDate)
      : dates.filter((d) => d < currentDate)[0]
        ? getCseSnapshot(dates.filter((d) => d < currentDate)[0]!)
        : null;
  if (!current) return null;
  return compareSnapshots(current, prior);
}

export function listTeamMemberSlugs(snapshotDate: string): { name: string; slug: string }[] {
  const snapshot = getCseSnapshot(snapshotDate);
  if (!snapshot) return [];
  const members = dedupeTeamMembers(
    snapshot.metadata.teamMemberConfigs ??
      snapshot.metadata.teamMembersIncluded.map((name) => ({
        name,
        email: '',
        slackUserId: null,
        calendarId: null,
        crmOwnerId: null,
        mdasCseId: null,
        active: true,
      })),
  );
  return members
    .filter((m) => m.active !== false)
    .map((m) => ({ name: m.name, slug: slugifyName(m.name) }));
}

export function listLeadershipReports(): { slug: string; title: string; path: string }[] {
  const dir = join(mdasProjectRoot(), 'docs/leadership');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      slug: f.replace(/\.md$/, ''),
      title: f.replace(/\.md$/, '').replace(/-/g, ' '),
      path: join(dir, f),
    }))
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

export function readLeadershipReport(slug: string): string | null {
  const path = join(mdasProjectRoot(), 'docs/leadership', `${slug}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}
