import type { AccountView } from '@mdas/canonical';
import type { CseActivityConfig, TeamMemberConfig } from './types.js';

/** Per-account synthetic ids from mock seed data — not stable CSE user ids. */
export function isSyntheticCseId(id: string | null | undefined): boolean {
  return !id || /^U-CSE-/i.test(id);
}

/** Guess a Zuora email from a display name (e.g. "Kiran Rajan" → kiran.rajan@zuora.com). */
export function inferEmailFromCseName(name: string): string {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[parts.length - 1]}@zuora.com`;
  }
  if (parts.length === 1) return `${parts[0]}@zuora.com`;
  return '';
}

export function dedupeTeamMembers(members: TeamMemberConfig[]): TeamMemberConfig[] {
  const byName = new Map<string, TeamMemberConfig>();

  for (const member of members) {
    const key = member.name.trim().toLowerCase();
    if (!key) continue;

    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, member);
      continue;
    }

    // Prefer a real CRM user id over per-account synthetic ids.
    if (isSyntheticCseId(existing.mdasCseId) && !isSyntheticCseId(member.mdasCseId)) {
      byName.set(key, { ...member, email: member.email || existing.email });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the CSE team roster from Expand 3 account assignments in MDAS.
 * One entry per distinct assignedCSE name; Digital/unassigned accounts are skipped.
 */
export function inferTeamMembersFromViews(views: AccountView[]): TeamMemberConfig[] {
  const members: TeamMemberConfig[] = [];

  for (const view of views) {
    if (view.account.franchise !== 'Expand 3') continue;
    const cse = view.account.assignedCSE;
    if (!cse?.name?.trim()) continue;

    members.push({
      name: cse.name.trim(),
      email: inferEmailFromCseName(cse.name),
      slackUserId: null,
      calendarId: null,
      crmOwnerId: cse.id ?? null,
      mdasCseId: cse.id ?? null,
      active: true,
    });
  }

  return dedupeTeamMembers(members);
}

/** Portfolio account scopes derived from the current Expand 3 book. */
export function inferAccountScopesFromViews(views: AccountView[]): {
  expand3AccountIds: string[];
  renewalRiskAccountIds: string[];
  atrRelevantAccountIds: string[];
  strategicAccountIds: string[];
} {
  const expand3 = views
    .filter((v) => v.account.franchise === 'Expand 3')
    .map((v) => v.account.accountId);

  const renewalRisk = views
    .filter((v) => v.bucket === 'Saveable Risk' || v.bucket === 'Confirmed Churn')
    .map((v) => v.account.accountId);

  const atrRelevant = views
    .filter((v) => v.atrUSD > 0 || v.bucket !== 'Healthy')
    .map((v) => v.account.accountId);

  const strategic = [...views]
    .filter((v) => v.bucket !== 'Healthy' || v.atrUSD >= 100_000)
    .sort((a, b) => b.atrUSD - a.atrUSD)
    .slice(0, 30)
    .map((v) => v.account.accountId);

  return {
    expand3AccountIds: expand3,
    renewalRiskAccountIds: renewalRisk,
    atrRelevantAccountIds: atrRelevant,
    strategicAccountIds: strategic,
  };
}

/**
 * Merge static config with MDAS-inferred roster and portfolio scopes.
 * Team members are always inferred from Expand 3 assignments — never taken from config file.
 */
export function resolveCseActivityConfig(
  base: CseActivityConfig,
  views: AccountView[],
): CseActivityConfig {
  const scopes = inferAccountScopesFromViews(views);
  return {
    ...base,
    teamMembers: inferTeamMembersFromViews(views),
    expand3AccountIds:
      base.expand3AccountIds.length > 0 ? base.expand3AccountIds : scopes.expand3AccountIds,
    renewalRiskAccountIds:
      base.renewalRiskAccountIds.length > 0
        ? base.renewalRiskAccountIds
        : scopes.renewalRiskAccountIds,
    atrRelevantAccountIds:
      base.atrRelevantAccountIds.length > 0
        ? base.atrRelevantAccountIds
        : scopes.atrRelevantAccountIds,
    strategicAccountIds:
      base.strategicAccountIds.length > 0 ? base.strategicAccountIds : scopes.strategicAccountIds,
  };
}
