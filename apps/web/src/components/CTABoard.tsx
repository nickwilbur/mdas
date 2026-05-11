'use client';

import { useState, useCallback } from 'react';
import clsx from 'clsx';
import { Check, Copy, ExternalLink, ChevronDown, ChevronUp, Filter } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CTAOwner {
  name: string;
  slack_handle?: string;
  role: string;
}

export interface CTAFollowThrough {
  expected_artifact?: string;
  check_back_date?: string;
  auto_check_query?: string;
  escalation_owner?: string;
  escalation_trigger?: string;
  if_no_response_by?: string;
  then?: string;
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
  situation_read?: string | null;
  point_of_view?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PLAY_TYPE_LABELS: Record<string, string> = {
  surprise_churn_watch: 'Surprise Churn Watch',
  utilization_risk: 'Utilization Risk',
  dark_renewal: 'Dark Renewal',
  dark_account: 'Dark Account',
  scale_engagement: 'Scale Engagement',
  expertise_risk: 'Expertise Risk',
  engagement_risk: 'Engagement Risk',
  pricing_risk: 'Pricing Risk',
  suite_risk: 'Suite Risk',
  share_risk: 'Share Risk',
  legacy_tech_risk: 'Legacy Tech Risk',
  sentiment_stale: 'Sentiment Stale',
  confirmed_churn_retro: 'Confirmed Churn Retro',
  churn_retro: 'Churn Retro',
  managed_wind_down: 'Managed Wind-Down',
  no_strategic_engagement: 'No Strategic Engagement',
};

const PLAY_TYPE_COLORS: Record<string, string> = {
  surprise_churn_watch: 'bg-red-100 text-red-800 ring-red-300',
  utilization_risk: 'bg-orange-100 text-orange-800 ring-orange-300',
  dark_renewal: 'bg-zinc-700 text-zinc-100 ring-zinc-500',
  scale_engagement: 'bg-blue-100 text-blue-800 ring-blue-300',
  expertise_risk: 'bg-purple-100 text-purple-800 ring-purple-300',
  engagement_risk: 'bg-pink-100 text-pink-800 ring-pink-300',
  pricing_risk: 'bg-rose-100 text-rose-800 ring-rose-300',
  confirmed_churn_retro: 'bg-gray-800 text-white ring-gray-600',
  churn_retro: 'bg-gray-800 text-white ring-gray-600',
  managed_wind_down: 'bg-slate-100 text-slate-800 ring-slate-300',
  no_strategic_engagement: 'bg-indigo-100 text-indigo-800 ring-indigo-300',
  dark_account: 'bg-zinc-800 text-zinc-100 ring-zinc-600',
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

const RISK_BORDER: Record<string, string> = {
  Red: 'border-l-red-500',
  '🔴': 'border-l-red-500',
  Yellow: 'border-l-amber-400',
  '🟡': 'border-l-amber-400',
  Green: 'border-l-emerald-400',
  '🟢': 'border-l-emerald-400',
};

function CTACard({ cta, slackMessage }: { cta: CTAEntry; slackMessage: string }) {
  const [expanded, setExpanded] = useState(false);
  const playLabel = PLAY_TYPE_LABELS[cta.play_type] ?? cta.play_type;
  const playColor = PLAY_TYPE_COLORS[cta.play_type] ?? 'bg-gray-100 text-gray-800 ring-gray-300';
  const riskEmoji =
    cta.risk_color === '🔴' || cta.risk_color === 'Red' ? '🔴'
    : cta.risk_color === '🟡' || cta.risk_color === 'Yellow' ? '🟡'
    : '🟢';
  const borderColor = RISK_BORDER[cta.risk_color] ?? 'border-l-gray-300';
  const days = daysUntil(cta.deadline);

  return (
    <div className={clsx('rounded-lg border border-gray-200 border-l-4 bg-white shadow-sm', borderColor)}>
      {/* Compact header row */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-sm" title={cta.risk_color}>{riskEmoji}</span>
          <h3 className="text-sm font-semibold text-gray-900 truncate">{cta.account_name}</h3>
          {cta.renewal_opportunity_url ? (
            <a
              href={cta.renewal_opportunity_url}
              className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
              target="_blank"
              rel="noopener noreferrer"
              title="SFDC Opportunity"
            >
              <ExternalLink className="h-2.5 w-2.5" /> SFDC Opp
            </a>
          ) : cta.salesforce_account_id ? (
            <a
              href={`https://zuora.lightning.force.com/lightning/r/Account/${cta.salesforce_account_id}/view`}
              className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100"
              target="_blank"
              rel="noopener noreferrer"
              title="SFDC Account"
            >
              <ExternalLink className="h-2.5 w-2.5" /> SFDC
            </a>
          ) : null}
          {cta.destination_slack_channel && (
            <a
              href={cta.destination_slack_channel}
              className="inline-flex items-center gap-0.5 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-100"
              target="_blank"
              rel="noopener noreferrer"
              title="Slack Channel"
            >
              <ExternalLink className="h-2.5 w-2.5" /> Slack
            </a>
          )}
          <span className={clsx('rounded px-2 py-0.5 text-[10px] font-medium ring-1', playColor)}>
            {playLabel}
          </span>
          <span className={clsx('text-[10px] tabular-nums font-medium', deadlineColor(cta.deadline))}>
            {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `${days}d`}
          </span>
          {cta.team_aware && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
              Team Aware
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex gap-1 text-[10px] text-gray-500">
            {cta.ae && <span className="rounded bg-gray-100 px-1.5 py-0.5">{cta.ae.name}</span>}
            {cta.cse && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{cta.cse.name}</span>}
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Slack message — the hero element */}
      <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-800 text-xs font-bold text-white">
            NW
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-bold text-gray-900">Nick Wilbur</span>
              <span className="text-[11px] text-gray-400">draft</span>
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-gray-800">{slackMessage}</p>
          </div>
          <CopyButton text={slackMessage} label="Copy" />
        </div>
      </div>

      {/* Quick action links row */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-1.5 text-[11px] text-gray-500">
        <span><span className="font-medium text-gray-600">Deadline</span> <span className={deadlineColor(cta.deadline)}>{cta.deadline}</span></span>
        <span className="text-gray-300">|</span>
        <span><span className="font-medium text-gray-600">Check-back</span> {cta.check_back_date}</span>
        {cta.destination_slack_channel && (
          <>
            <span className="text-gray-300">|</span>
            <a
              href={cta.destination_slack_channel}
              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3" /> Channel
            </a>
          </>
        )}
        {cta.renewal_opportunity_url ? (
          <>
            <span className="text-gray-300">|</span>
            <a
              href={cta.renewal_opportunity_url}
              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3" /> SFDC Opp
            </a>
          </>
        ) : cta.salesforce_account_id ? (
          <>
            <span className="text-gray-300">|</span>
            <a
              href={`https://zuora.lightning.force.com/lightning/r/Account/${cta.salesforce_account_id}/view`}
              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3" /> SFDC Account
            </a>
          </>
        ) : null}
        <span
          className={clsx(
            'ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase font-medium',
            cta.status === 'open'
              ? 'bg-blue-50 text-blue-700'
              : cta.status === 'closed_done'
                ? 'bg-green-50 text-green-700'
                : 'bg-gray-100 text-gray-600',
          )}
        >
          {cta.status.replace('_', ' ')}
        </span>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3 text-xs">
          {/* v2 Reasoning Audit — Situation Read + POV (private, not posted) */}
          {(cta.situation_read || cta.point_of_view) && (
            <div className="rounded bg-blue-50 p-2.5">
              {cta.situation_read && (
                <>
                  <p className="font-medium uppercase tracking-wide text-blue-800">
                    Situation Read
                  </p>
                  <p className="mt-1 leading-relaxed text-blue-900">{cta.situation_read}</p>
                </>
              )}
              {cta.point_of_view && (
                <>
                  <p className="mt-2 font-medium uppercase tracking-wide text-blue-800">
                    Point of View
                  </p>
                  <p className="mt-1 leading-relaxed text-blue-900">{cta.point_of_view}</p>
                </>
              )}
            </div>
          )}

          {/* CSE Sentiment Commentary — full text in details */}
          {cta.cse_sentiment_commentary && (
            <div className="rounded bg-amber-50 p-2.5">
              <p className="font-medium uppercase tracking-wide text-amber-800">
                CSE Commentary
                {cta.commentary_last_updated && (
                  <span className="ml-1.5 font-normal normal-case text-amber-600">
                    · updated {cta.commentary_last_updated.slice(0, 10)}
                  </span>
                )}
              </p>
              <p className="mt-1 leading-relaxed text-amber-900">{cta.cse_sentiment_commentary}</p>
            </div>
          )}

          {/* Drivers */}
          {cta.drivers && cta.drivers.length > 0 && (
            <div>
              <p className="font-medium uppercase tracking-wide text-gray-500">Drivers</p>
              <ul className="mt-1 space-y-0.5 text-gray-700">
                {cta.drivers.map((d, i) => (
                  <li key={i}>
                    <span className="mr-1 text-gray-400">·</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Requested Action */}
          {cta.requested_action && (
            <div>
              <p className="font-medium uppercase tracking-wide text-gray-500">Requested Action</p>
              <p className="mt-1 text-gray-700">{cta.requested_action}</p>
            </div>
          )}

          {/* Expected Artifact */}
          {cta.expected_artifact && (
            <div>
              <p className="font-medium uppercase tracking-wide text-gray-500">Expected Artifact</p>
              <p className="mt-1 text-gray-700">{cta.expected_artifact}</p>
            </div>
          )}

          {/* Data Gaps */}
          {cta.data_gaps && cta.data_gaps.length > 0 && (
            <div className="rounded bg-amber-50 p-2.5">
              <p className="font-medium uppercase tracking-wide text-amber-700">Data Gaps</p>
              <ul className="mt-1 space-y-0.5 text-amber-800">
                {cta.data_gaps.map((g, i) => (
                  <li key={i}>⚠ {g}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Follow-Through */}
          {cta.follow_through && (
            <div>
              <p className="font-medium uppercase tracking-wide text-gray-500">Follow-Through</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
                {cta.follow_through.if_no_response_by && (
                  <span><span className="font-medium">No response by:</span> {cta.follow_through.if_no_response_by}</span>
                )}
                {cta.follow_through.then && (
                  <span><span className="font-medium">→</span> {cta.follow_through.then}</span>
                )}
                {cta.follow_through.escalation_owner && (
                  <span><span className="font-medium">Escalation:</span> {cta.follow_through.escalation_owner}</span>
                )}
              </div>
            </div>
          )}

          {/* Team */}
          <div className="flex flex-wrap gap-3 text-gray-500">
            {cta.ae && <span><span className="font-medium">AE:</span> {cta.ae.name}</span>}
            {cta.cse && <span><span className="font-medium">CSE:</span> {cta.cse.name}</span>}
            {cta.tam && <span><span className="font-medium">TAM:</span> {cta.tam.name}</span>}
            {cta.esa && <span><span className="font-medium">ESA:</span> {cta.esa.name}</span>}
            {!cta.cse && <span className="text-amber-600 font-medium">No CSE assigned</span>}
          </div>
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

  const isRed = (c: CTAEntry) => c.risk_color === '🔴' || c.risk_color === 'Red';
  const isYellow = (c: CTAEntry) => c.risk_color === '🟡' || c.risk_color === 'Yellow';

  const filtered = ctas.filter((c) => {
    if (riskFilter === '🔴' && !isRed(c)) return false;
    if (riskFilter === '🟡' && !isYellow(c)) return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (ownerFilter !== 'all' && ownerName(c.primary_owner) !== ownerFilter) return false;
    return true;
  });

  const redCount = ctas.filter(isRed).length;
  const yellowCount = ctas.filter(isYellow).length;
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

// ── Generate CTAs Button ──────────────────────────────────────────────────

interface GenerateJob {
  id: string;
  status: 'running' | 'done' | 'error';
  progress: { phase: string; current: number; total: number; label?: string } | null;
  result: { ctaCount: number } | null;
  error: string | null;
}

export function GenerateCTAsButton() {
  const [job, setJob] = useState<GenerateJob | null>(null);

  const startGeneration = useCallback(async () => {
    try {
      const res = await fetch('/api/ctas/generate', { method: 'POST' });
      const { jobId } = await res.json();
      setJob({ id: jobId, status: 'running', progress: null, result: null, error: null });

      // Poll for progress
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/ctas/generate/${jobId}`);
          const data = await statusRes.json();
          setJob(data);
          if (data.status === 'done' || data.status === 'error') {
            clearInterval(poll);
            // Reload page after success to show new CTAs
            if (data.status === 'done') {
              setTimeout(() => window.location.reload(), 1500);
            }
          }
        } catch {
          clearInterval(poll);
        }
      }, 1000);
    } catch {
      setJob({ id: '', status: 'error', progress: null, result: null, error: 'Failed to start' });
    }
  }, []);

  const isRunning = job?.status === 'running';
  const isDone = job?.status === 'done';
  const isError = job?.status === 'error';
  const progressPct = job?.progress
    ? Math.round((job.progress.current / job.progress.total) * 100)
    : 0;

  return (
    <div className="flex items-center gap-3">
      {/* Progress indicator */}
      {isRunning && job.progress && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="tabular-nums">{progressPct}%</span>
          {job.progress.label && (
            <span className="max-w-[200px] truncate text-gray-400">{job.progress.label}</span>
          )}
        </div>
      )}
      {isDone && job.result && (
        <span className="text-xs text-green-600 font-medium">
          {job.result.ctaCount} CTAs generated — reloading…
        </span>
      )}
      {isError && (
        <span className="text-xs text-red-600 font-medium truncate max-w-[200px]">
          {job.error ?? 'Generation failed'}
        </span>
      )}

      <button
        onClick={startGeneration}
        disabled={isRunning}
        className={clsx(
          'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors',
          isRunning
            ? 'bg-gray-400 text-white cursor-not-allowed'
            : isDone
              ? 'bg-green-600 text-white'
              : isError
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-gray-900 text-white hover:bg-gray-800',
        )}
      >
        {isRunning ? (
          <>
            <span className="animate-spin text-base leading-none">⏳</span>
            Generating…
          </>
        ) : isDone ? (
          <>
            <Check className="h-4 w-4" />
            Done
          </>
        ) : (
          <>
            <span className="text-base leading-none">⚡</span>
            Generate CTAs
          </>
        )}
      </button>
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
