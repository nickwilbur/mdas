import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CseActivityConfig, WeeklySnapshot } from './types.js';
import { slugifyName } from './format.js';
import { dedupeTeamMetrics } from './metrics.js';

export function snapshotDir(root: string, config: CseActivityConfig, snapshotDate: string): string {
  return join(root, config.snapshotOutputDir, snapshotDate);
}

export function writeSnapshotFiles(
  root: string,
  config: CseActivityConfig,
  snapshot: WeeklySnapshot,
  managerDashboardMd: string,
  teamReports: Record<string, string>,
): string {
  const dir = snapshotDir(root, config, snapshot.metadata.snapshotDate);
  const memberDir = join(dir, config.individualReportOutputDir);
  mkdirSync(memberDir, { recursive: true });

  writeFileSync(join(dir, 'snapshot_metadata.json'), JSON.stringify(snapshot.metadata, null, 2));
  writeFileSync(
    join(dir, 'team_activity_normalized.json'),
    JSON.stringify(snapshot.teamActivity, null, 2),
  );
  writeFileSync(
    join(dir, 'account_activity_normalized.json'),
    JSON.stringify(snapshot.accountActivity, null, 2),
  );
  writeFileSync(join(dir, 'calendar_activity.json'), JSON.stringify(snapshot.calendarActivity, null, 2));
  writeFileSync(join(dir, 'slack_activity.json'), JSON.stringify(snapshot.slackActivity, null, 2));
  writeFileSync(join(dir, 'crm_activity.json'), JSON.stringify(snapshot.crmActivity, null, 2));
  writeFileSync(
    join(dir, 'renewal_risk_activity.json'),
    JSON.stringify(snapshot.renewalRiskActivity, null, 2),
  );
  writeFileSync(
    join(dir, 'ai_enablement_activity.json'),
    JSON.stringify(snapshot.aiEnablementActivity, null, 2),
  );
  writeFileSync(join(dir, 'manager_dashboard.md'), managerDashboardMd, 'utf-8');

  for (const [name, md] of Object.entries(teamReports)) {
    writeFileSync(join(memberDir, `${slugifyName(name)}.md`), md, 'utf-8');
  }

  return dir;
}

export function readSnapshot(root: string, config: CseActivityConfig, snapshotDate: string): WeeklySnapshot | null {
  const dir = snapshotDir(root, config, snapshotDate);
  const metaPath = join(dir, 'snapshot_metadata.json');
  if (!existsSync(metaPath)) return null;
  const metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const readJson = (file: string) =>
    JSON.parse(readFileSync(join(dir, file), 'utf-8'));
  return {
    metadata,
    teamActivity: readJson('team_activity_normalized.json'),
    accountActivity: readJson('account_activity_normalized.json'),
    teamMetrics: dedupeTeamMetrics(metadata.teamMetrics ?? []),
    accountMetrics: metadata.accountMetrics ?? [],
    sourceCoverage: metadata.sourceCoverage ?? [],
    calendarActivity: readJson('calendar_activity.json'),
    slackActivity: readJson('slack_activity.json'),
    crmActivity: readJson('crm_activity.json'),
    renewalRiskActivity: readJson('renewal_risk_activity.json'),
    aiEnablementActivity: readJson('ai_enablement_activity.json'),
  };
}

export function listSnapshotDates(root: string, config: CseActivityConfig): string[] {
  const base = join(root, config.snapshotOutputDir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
}

export function readTextArtifact(
  root: string,
  config: CseActivityConfig,
  snapshotDate: string,
  relativePath: string,
): string | null {
  const path = join(snapshotDir(root, config, snapshotDate), relativePath);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}
