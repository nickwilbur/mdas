'use client';

import { useState, useCallback } from 'react';
import clsx from 'clsx';
import { Check, Copy, ExternalLink, ChevronDown, ChevronUp, Filter } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CTAOwner {
  name: string;
  slack_handle: string;
  role: string;
}

export interface CTAFollowThrough {
  expected_artifact: string;
  check_back_date: string;
  auto_check_query: string;
  escalation_owner: string;
  escalation_trigger: string;
}

export interface CTAEntry {
  cta_id: string;
  account_name: string;
  salesforce_account_id: string | null;
  play_type: string;
  risk_color: string;
  primary_owner: string | CTAOwner;
  cc_owners?: CTAOwner[];
  destination_slack_channel?: string | null;
  drivers?: string[];
  requested_action?: string;
  deadline: string;
  check_back_date: string;
  expected_artifact: string;
  follow_through?: CTAFollowThrough;
  posted_at: string;
  posted_to_channel: string;
  status: string;
  last_checked_at: string | null;
  escalation_message_id: string | null;
  renewal_opportunity_url?: string | null;
  slack_message?: string;
  data_gaps?: string[];
  ae?: CTAOwner | null;
  cse?: CTAOwner | null;
  tam?: CTAOwner | null;
  esa?: CTAOwner | null;
  cse_sentiment_commentary?: string | null;
  commentary_last_updated?: string | null;
  team_aware?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PLAY_TYPE_LABELS: Record<string, string> = {
  surprise_churn_watch: 'Surprise Churn Watch',
  utilization_risk: 'Utilization Risk',
  dark_renewal: 'Dark Renewal',
  scale_engagement: 'Scale Engagement',
  expertise_risk: 'Expertise Risk',
  engagement_risk: 'Engagement Risk',
  pricing_risk: 'Pricing Risk',
  suite_risk: 'Suite Risk',
  share_risk: 'Share Risk',
  legacy_tech_risk: 'Legacy Tech Risk',
  sentiment_stale: 'Sentiment Stale',
  confirmed_churn_retro: 'Confirmed Churn Retro',
  managed_wind_down: 'Managed Wind-Down',
  no_strategic_engagement: 'No Strategic Engagement',
};

const PLAY_TYPE_COLORS: Record<string, string> = {
  surprise_churn_watch: 'bg-red-100 text-red-800 ring-red-300',
  utilization_risk: 'bg-orange-100 text-orange-800 ring-orange-300',
  dark_renewal: 'bg-amber-100 text-amber-800 ring-amber-300',
  scale_engagement: 'bg-blue-100 text-blue-800 ring-blue-300',
  expertise_risk: 'bg-purple-100 text-purple-800 ring-purple-300',
  engagement_risk: 'bg-pink-100 text-pink-800 ring-pink-300',
  pricing_risk: 'bg-rose-100 text-rose-800 ring-rose-300',
  confirmed_churn_retro: 'bg-gray-800 text-white ring-gray-600',
  managed_wind_down: 'bg-slate-100 text-slate-800 ring-slate-300',
  no_strategic_engagement: 'bg-indigo-100 text-indigo-800 ring-indigo-300',
};

function ownerName(owner: string | CTAOwner): string {
  return typeof owner === 'string' ? owner : owner.name;
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function deadlineColor(dateStr: string): string {
  const days = daysUntil(dateStr);
  if (days < 0) return 'text-red-700 font-semibold';
  if (days <= 3) return 'text-orange-700 font-semibold';
  if (days <= 7) return 'text-amber-700';
  return 'text-gray-600';
}

// ── Copy Button ────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
        copied
          ? 'border-green-300 bg-green-50 text-green-700'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

// ── CTA Card ───────────────────────────────────────────────────────────────

function CTACard({ cta, slackMessage }: { cta: CTAEntry; slackMessage: string }) {
  const [expanded, setExpanded] = useState(false);
  const playLabel = PLAY_TYPE_LABELS[cta.play_type] ?? cta.play_type;
  const playColor = PLAY_TYPE_COLORS[cta.play_type] ?? 'bg-gray-100 text-gray-800 ring-gray-300';
  const riskEmoji = cta.risk_color === '🔴' ? '🔴' : cta.risk_color === '🟡' ? '🟡' : '🟢';

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-base" title={cta.risk_color}>
            {riskEmoji}
          </span>
          <h3 className="text-sm font-semibold text-gray-900">{cta.account_name}</h3>
          <span className={clsx('rounded px-2 py-0.5 text-[11px] font-medium ring-1', playColor)}>
            {playLabel}
          </span>
          <span
            className={clsx(
              'rounded px-1.5 py-0.5 text-[10px] uppercase',
              cta.status === 'open'
                ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                : cta.status === 'closed_done'
                  ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                  : 'bg-gray-100 text-gray-600',
            )}
          >
            {cta.status}
          </span>
          {/* Team members */}
          <div className="flex flex-wrap gap-1.5 text-[10px] text-gray-600">
            {cta.ae && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium">
                AE: {cta.ae.name}
              </span>
            )}
            {cta.cse && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium">
                CSE: {cta.cse.name}
              </span>
            )}
            {cta.tam && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium">
                TAM: {cta.tam.name}
              </span>
            )}
            {cta.esa && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium">
                ESA: {cta.esa.name}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={clsx('text-xs tabular-nums', deadlineColor(cta.deadline))}>
            {daysUntil(cta.deadline) < 0
              ? `${Math.abs(daysUntil(cta.deadline))}d overdue`
              : daysUntil(cta.deadline) === 0
                ? 'Due today'
                : `${daysUntil(cta.deadline)}d left`}
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* CSE Sentiment Commentary */}
      {cta.cse_sentiment_commentary && (
        <div className="border-b border-gray-100 bg-amber-50/50 px-4 py-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-xs">📋</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">
                CSE Sentiment Commentary
                {cta.commentary_last_updated && (
                  <span className="ml-1.5 font-normal normal-case text-amber-600">
                    (updated {cta.commentary_last_updated.slice(0, 10)})
                  </span>
                )}
                {cta.team_aware && (
                  <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-green-700">
                    Team Aware
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-900">{cta.cse_sentiment_commentary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Slack Message */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Slack Message</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">{slackMessage}</p>
          </div>
          <div className="shrink-0 pt-4">
            <CopyButton text={slackMessage} label="Copy" />
          </div>
        </div>
      </div>

      {/* Owner + Deadline Row */}
      <div className="flex flex-wrap items-center gap-4 border-t border-gray-100 px-4 py-2 text-xs text-gray-600">
        <span>
          <span className="font-medium">Owner:</span> {ownerName(cta.primary_owner)}
        </span>
        <span>
          <span className="font-medium">Deadline:</span>{' '}
          <span className={deadlineColor(cta.deadline)}>{cta.deadline}</span>
        </span>
        <span>
          <span className="font-medium">Check-back:</span> {cta.check_back_date}
        </span>
        {cta.renewal_opportunity_url && (
          <a
            href={cta.renewal_opportunity_url}
            className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3" /> SFDC Opp
          </a>
        )}
        {cta.destination_slack_channel && (
          <a
            href={cta.destination_slack_channel}
            className="inline-flex items-center gap-1 text-blue-700 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3" /> Slack Channel
          </a>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
          {cta.drivers && cta.drivers.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Drivers</p>
              <ul className="mt-1 space-y-0.5">
                {cta.drivers.map((d, i) => (
                  <li key={i} className="text-sm text-gray-700">
                    <span className="mr-1.5 text-gray-400">•</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cta.requested_action && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Requested Action
              </p>
              <p className="mt-1 text-sm text-gray-700">{cta.requested_action}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Expected Artifact
            </p>
            <p className="mt-1 text-sm text-gray-700">{cta.expected_artifact}</p>
          </div>
          {cta.data_gaps && cta.data_gaps.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Data Gaps</p>
              <ul className="mt-1 space-y-0.5">
                {cta.data_gaps.map((g, i) => (
                  <li key={i} className="text-xs text-amber-700">
                    <span className="mr-1.5">⚠</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cta.follow_through && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Follow-Through Contract
              </p>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>
                  <span className="font-medium">Escalation owner:</span>{' '}
                  {cta.follow_through.escalation_owner}
                </span>
                <span>
                  <span className="font-medium">Escalation trigger:</span>{' '}
                  {cta.follow_through.escalation_trigger}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────

interface CTABoardProps {
  ctas: CTAEntry[];
  slackMessages: Record<string, string>;
}

type RiskFilter = 'all' | '🔴' | '🟡' | '🟢';
type StatusFilter = 'all' | 'open' | 'closed_done' | 'stalled';

export function CTABoard({ ctas, slackMessages }: CTABoardProps) {
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  const owners = Array.from(new Set(ctas.map((c) => ownerName(c.primary_owner)))).sort();

  const filtered = ctas.filter((c) => {
    if (riskFilter !== 'all' && c.risk_color !== riskFilter) return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (ownerFilter !== 'all' && ownerName(c.primary_owner) !== ownerFilter) return false;
    return true;
  });

  const redCount = ctas.filter((c) => c.risk_color === '🔴').length;
  const yellowCount = ctas.filter((c) => c.risk_color === '🟡').length;
  const openCount = ctas.filter((c) => c.status === 'open').length;
  const overdueCount = ctas.filter(
    (c) => c.status === 'open' && daysUntil(c.deadline) < 0,
  ).length;

  const copyAll = useCallback(async () => {
    const allMessages = filtered
      .map((c) => slackMessages[c.cta_id] ?? '')
      .filter(Boolean)
      .join('\n\n---\n\n');
    await navigator.clipboard.writeText(allMessages);
  }, [filtered, slackMessages]);

  return (
    <div className="space-y-4">
      {/* Summary Tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total CTAs</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{ctas.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Open</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-blue-700">{openCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            🔴 Critical / 🟡 High
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {redCount} / {yellowCount}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Overdue</div>
          <div
            className={clsx(
              'mt-1 text-2xl font-semibold tabular-nums',
              overdueCount > 0 ? 'text-red-700' : 'text-green-700',
            )}
          >
            {overdueCount}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {(riskFilter !== 'all' || statusFilter !== 'all' || ownerFilter !== 'all') && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              active
            </span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {filtered.length} of {ctas.length} CTAs
          </span>
          <CopyAllButton onClick={copyAll} count={filtered.length} />
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Risk
            </label>
            <div className="mt-1 flex gap-1">
              {(['all', '🔴', '🟡'] as RiskFilter[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setRiskFilter(v)}
                  className={clsx(
                    'rounded px-2.5 py-1 text-xs font-medium',
                    riskFilter === v
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                  )}
                >
                  {v === 'all' ? 'All' : v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Status
            </label>
            <div className="mt-1 flex gap-1">
              {(['all', 'open', 'closed_done', 'stalled'] as StatusFilter[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setStatusFilter(v)}
                  className={clsx(
                    'rounded px-2.5 py-1 text-xs font-medium',
                    statusFilter === v
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                  )}
                >
                  {v === 'all' ? 'All' : v.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Owner
            </label>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="mt-1 block rounded border border-gray-300 bg-white px-2 py-1 text-xs"
            >
              <option value="all">All</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setRiskFilter('all');
                setStatusFilter('all');
                setOwnerFilter('all');
              }}
              className="text-xs text-blue-700 hover:underline"
            >
              Reset filters
            </button>
          </div>
        </div>
      )}

      {/* CTA Cards */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            No CTAs match the current filters.
          </div>
        ) : (
          filtered.map((cta) => (
            <CTACard
              key={cta.cta_id}
              cta={cta}
              slackMessage={slackMessages[cta.cta_id] ?? ''}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Copy All Button ────────────────────────────────────────────────────────

function CopyAllButton({ onClick, count }: { onClick: () => void; count: number }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(async () => {
    await onClick();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onClick]);

  return (
    <button
      onClick={handleClick}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
        copied
          ? 'border-green-300 bg-green-50 text-green-700'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied!' : `Copy all ${count}`}
    </button>
  );
}
