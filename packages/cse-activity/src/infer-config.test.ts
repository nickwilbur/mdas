import { describe, it, expect } from 'vitest';
import type { AccountView } from '@mdas/canonical';
import {
  dedupeTeamMembers,
  inferEmailFromCseName,
  inferTeamMembersFromViews,
  inferAccountScopesFromViews,
  resolveCseActivityConfig,
} from './infer-config.js';
import { DEFAULT_CSE_ACTIVITY_CONFIG } from './config-defaults.js';

function view(
  accountId: string,
  franchise: string,
  cse: { id: string; name: string } | null,
  bucket: AccountView['bucket'] = 'Healthy',
  atrUSD = 0,
): AccountView {
  return {
    account: {
      accountId,
      accountName: accountId,
      franchise,
      assignedCSE: cse,
    },
    bucket,
    atrUSD,
  } as AccountView;
}

describe('inferEmailFromCseName', () => {
  it('builds first.last@zuora.com from display names', () => {
    expect(inferEmailFromCseName('Kiran Rajan')).toBe('kiran.rajan@zuora.com');
  });
});

describe('inferTeamMembersFromViews', () => {
  it('dedupes CSEs from Expand 3 assignedCSE only', () => {
    const views = [
      view('a1', 'Expand 3', { id: 'U1', name: 'Kiran Rajan' }),
      view('a2', 'Expand 3', { id: 'U1', name: 'Kiran Rajan' }),
      view('a3', 'Expand 3', { id: 'U2', name: 'Shwetha Ravindran' }),
      view('a4', 'Digital', { id: 'U3', name: 'Other CSE' }),
      view('a5', 'Expand 3', null),
    ];
    const team = inferTeamMembersFromViews(views);
    expect(team).toHaveLength(2);
    expect(team.map((m) => m.name).sort()).toEqual(['Kiran Rajan', 'Shwetha Ravindran']);
    expect(team[0]!.mdasCseId).toBeTruthy();
    expect(team[0]!.email).toMatch(/@zuora\.com$/);
  });

  it('dedupes by name when mock data uses per-account U-CSE ids', () => {
    const views = [
      view('a1', 'Expand 3', { id: 'U-CSE-01', name: 'Kiran Rajan' }),
      view('a2', 'Expand 3', { id: 'U-CSE-02', name: 'Kiran Rajan' }),
      view('a3', 'Expand 3', { id: 'U-CSE-03', name: 'Kiran Rajan' }),
    ];
    expect(inferTeamMembersFromViews(views)).toHaveLength(1);
    expect(dedupeTeamMembers(views.map((v) => ({
      name: v.account.assignedCSE!.name,
      email: 'kiran.rajan@zuora.com',
      slackUserId: null,
      calendarId: null,
      crmOwnerId: v.account.assignedCSE!.id,
      mdasCseId: v.account.assignedCSE!.id,
      active: true,
    })))).toHaveLength(1);
  });
});

describe('inferAccountScopesFromViews', () => {
  it('derives portfolio account lists from views', () => {
    const views = [
      view('e1', 'Expand 3', { id: 'U1', name: 'A' }, 'Saveable Risk', 50_000),
      view('e2', 'Expand 3', { id: 'U2', name: 'B' }, 'Healthy', 0),
      view('d1', 'Digital', { id: 'U3', name: 'C' }, 'Healthy', 0),
    ];
    const scopes = inferAccountScopesFromViews(views);
    expect(scopes.expand3AccountIds).toEqual(['e1', 'e2']);
    expect(scopes.renewalRiskAccountIds).toEqual(['e1']);
    expect(scopes.atrRelevantAccountIds).toContain('e1');
  });
});

describe('resolveCseActivityConfig', () => {
  it('always infers teamMembers and fills empty account scopes', () => {
    const views = [view('e1', 'Expand 3', { id: 'U1', name: 'Kiran Rajan' }, 'Saveable Risk')];
    const resolved = resolveCseActivityConfig(DEFAULT_CSE_ACTIVITY_CONFIG, views);
    expect(resolved.teamMembers).toHaveLength(1);
    expect(resolved.expand3AccountIds).toEqual(['e1']);
    expect(resolved.renewalRiskAccountIds).toEqual(['e1']);
  });
});
