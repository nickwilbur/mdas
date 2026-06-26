'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Check, Copy, ExternalLink, ChevronDown, ChevronUp, Filter, CheckCircle2, RotateCcw } from 'lucide-react';
import { safeHttpUrl, isLikelySfdcId } from '@/lib/url-safety';
import {
  lookupAccountHoverContext,
  type CTAAccountHoverContext,
} from '@/lib/cta-account-context';
import { correctCseOwner, resolveMentionTarget } from '@/lib/cta-utils';
import { SentimentBadge } from '@/components/ui';
import type { CSESentiment } from '@mdas/canonical';
import {
  CTA_PROGRESS_STATUSES,
  CTA_PROGRESS_STATUS_LABELS,
  isCtaOpen,
  type CTAProgressStatus,
} from '@mdas/cta-engine';
import {
  subscribeCtaGenerationJobPoll,
  type CtaGenerationJobStatus,
} from '@/lib/cta-generation-job-watch';

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
  renewal_opportunity_id?: string | null;
  renewal_opportunity_name?: string | null;
  assigned_owner?: CTAOwner | string | null;
  due_date?: string | null;
  progress_note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  owner_display?: string;
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
  atr_at_risk_usd?: number | null;
}

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
  data_quality_gap: 'Data Quality Gap',
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

function formatUsd(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function AccountHoverPopover({
  accountName,
  context,
}: {
  accountName: string;
  context: CTAAccountHoverContext | null;
}) {
  if (!context) {
    return <h3 className="text-sm font-semibold text-gray-900 truncate">{accountName}</h3>;
  }

  return (
    <div className="group/account relative min-w-0">
      <h3 className="cursor-default border-b border-dotted border-gray-400 text-sm font-semibold text-gray-900 truncate">
        {accountName}
      </h3>
      <div
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-3 shadow-lg group-hover/account:block"
        role="tooltip"
      >
        <div className="space-y-3 text-xs">
          <div>
            <p className="font-semibold uppercase tracking-wide text-gray-500">Overall Summary</p>
            <p className="mt-1 leading-relaxed text-gray-800">
              {context.overallSummary ?? '—'}
            </p>
          </div>
          <div>
            <p className="font-semibold uppercase tracking-wide text-gray-500">Cerebro Signals</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {context.cerebroSignals.map((signal) => (
                <div
                  key={signal.key}
                  className="flex items-center justify-between rounded border border-gray-100 px-2 py-1"
                >
                  <span className="text-gray-600">{signal.label}</span>
                  <span
                    className={clsx(
                      'font-medium tabular-nums',
                      signal.atRisk === true
                        ? 'text-red-700'
                        : signal.atRisk === false
                          ? 'text-gray-600'
                          : 'text-gray-400',
                    )}
                  >
                    {signal.atRisk == null ? '—' : signal.atRisk ? 'At risk' : 'OK'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="font-semibold uppercase tracking-wide text-gray-500">CSE Sentiment</p>
            {context.cseSentiment ? (
              <SentimentBadge value={context.cseSentiment as CSESentiment} />
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ownerMatches(
  a: CTAOwner | null | undefined,
  b: { name: string } | null | undefined,
): boolean {
  return Boolean(a && b && a.name === b.name);
}

function TeamHeaderBadges({ cta }: { cta: CTAEntry }) {
  const mention = resolveMentionTarget(cta);
  const displayCse = cta.cse ? correctCseOwner(cta.cse) ?? cta.cse : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-[10px]">
      {displayCse ? (
        <span
          className={clsx(
            'rounded px-1.5 py-0.5',
            ownerMatches(displayCse, mention.owner)
              ? 'bg-blue-100 font-semibold text-blue-800 ring-1 ring-blue-300'
              : 'bg-blue-50 text-blue-700',
          )}
          title={ownerMatches(displayCse, mention.owner) ? 'Tagged in Slack' : undefined}
        >
          CSE {displayCse.name}
        </span>
      ) : null}
      {cta.ae ? (
        <span
          className={clsx(
            'rounded px-1.5 py-0.5',
            ownerMatches(cta.ae, mention.owner)
              ? 'bg-gray-200 font-semibold text-gray-900 ring-1 ring-gray-400'
              : 'bg-gray-100 text-gray-600',
          )}
          title={ownerMatches(cta.ae, mention.owner) ? 'Tagged in Slack' : undefined}
        >
          AE {cta.ae.name}
        </span>
      ) : null}
      {!cta.cse && !cta.ae ? (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">No owner</span>
      ) : null}
    </div>
  );
}

function CTACard({
  cta,
  slackMessage,
  accountContext,
  onMarkDone,
  onReopen,
  onProgressUpdate,
  statusBusy,
  focused = false,
}: {
  cta: CTAEntry;
  slackMessage: string;
  accountContext: CTAAccountHoverContext | null;
  onMarkDone?: () => void;
  onReopen?: () => void;
  onProgressUpdate?: (patch: {
    status?: CTAProgressStatus;
    assigned_owner?: string | null;
    progress_note?: string | null;
  }) => void;
  statusBusy?: boolean;
  focused?: boolean;
}) {
  const [expanded, setExpanded] = useState(focused);
  const [noteDraft, setNoteDraft] = useState(cta.progress_note ?? '');
  const [ownerDraft, setOwnerDraft] = useState(
    cta.owner_display ?? ownerName(cta.primary_owner),
  );
  const playLabel = PLAY_TYPE_LABELS[cta.play_type] ?? cta.play_type;
  const playColor = PLAY_TYPE_COLORS[cta.play_type] ?? 'bg-gray-100 text-gray-800 ring-gray-300';
  const riskEmoji =
    cta.risk_color === '🔴' || cta.risk_color === 'Red' ? '🔴'
    : cta.risk_color === '🟡' || cta.risk_color === 'Yellow' ? '🟡'
    : '🟢';
  const borderColor = RISK_BORDER[cta.risk_color] ?? 'border-l-gray-300';
  const days = daysUntil(cta.deadline);

  // Defence-in-depth: CTA fields originate from a scan markdown / JSONL
  // file on disk. Validate every URL we render so a tampered file can't
  // inject javascript:/data: URLs into <a href>, and gate the computed
  // SFDC Lightning URL on a real-looking SFDC object id to prevent
  // path-style injection like Account/..%2Flogout.
  const safeSlackChannelUrl = safeHttpUrl(cta.destination_slack_channel);
  const sfdcAccountUrl = isLikelySfdcId(cta.salesforce_account_id)
    ? `https://zuora.lightning.force.com/lightning/r/Account/${cta.salesforce_account_id}/view`
    : null;

  return (
    <div
      id={`cta-card-${cta.cta_id}`}
      className={clsx(
        'rounded-lg border border-gray-200 border-l-4 bg-white shadow-sm',
        borderColor,
        focused && 'ring-2 ring-blue-400 ring-offset-1',
      )}
    >
      {/* Compact header row */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-sm" title={cta.risk_color}>{riskEmoji}</span>
          <AccountHoverPopover accountName={cta.account_name} context={accountContext} />
          {cta.atr_at_risk_usd != null && cta.atr_at_risk_usd > 0 && (
            <span
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-900 ring-1 ring-amber-200"
              title="Available to renew at risk"
            >
              ATR {formatUsd(cta.atr_at_risk_usd)}
            </span>
          )}
          {sfdcAccountUrl ? (
            <a
              href={sfdcAccountUrl}
              className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100"
              target="_blank"
              rel="noopener noreferrer"
              title="SFDC Account"
            >
              <ExternalLink className="h-2.5 w-2.5" /> SFDC
            </a>
          ) : null}
          {safeSlackChannelUrl && (
            <a
              href={safeSlackChannelUrl}
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
          <TeamHeaderBadges cta={cta} />
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
        {safeSlackChannelUrl && (
          <>
            <span className="text-gray-300">|</span>
            <a
              href={safeSlackChannelUrl}
              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3" /> Channel
            </a>
          </>
        )}
        {sfdcAccountUrl ? (
          <>
            <span className="text-gray-300">|</span>
            <a
              href={sfdcAccountUrl}
              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3" /> SFDC Account
            </a>
          </>
        ) : null}
        {isCtaOpen(cta.status) && onMarkDone && (
          <>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={onMarkDone}
              disabled={statusBusy}
              className="inline-flex items-center gap-0.5 font-medium text-green-700 hover:underline disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" />
              Mark done
            </button>
          </>
        )}
        {!isCtaOpen(cta.status) && onReopen && (
          <>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={onReopen}
              disabled={statusBusy}
              className="inline-flex items-center gap-0.5 font-medium text-blue-700 hover:underline disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Reopen
            </button>
          </>
        )}
        <span
          className={clsx(
            'ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase font-medium',
            cta.status === 'done'
              ? 'bg-green-50 text-green-700'
              : cta.status === 'blocked'
                ? 'bg-red-50 text-red-700'
                : cta.status === 'in_progress'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-blue-50 text-blue-700',
          )}
        >
          {CTA_PROGRESS_STATUS_LABELS[cta.status as CTAProgressStatus] ?? cta.status}
        </span>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3 text-xs">
          {/* Progress tracking */}
          {onProgressUpdate && (
            <div className="rounded border border-gray-200 bg-gray-50 p-2.5 space-y-2">
              <p className="font-medium uppercase tracking-wide text-gray-500">Progress</p>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-gray-600">
                  <span className="text-[10px] font-medium uppercase">Status</span>
                  <select
                    value={cta.status}
                    disabled={statusBusy}
                    onChange={(e) =>
                      onProgressUpdate({ status: e.target.value as CTAProgressStatus })
                    }
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                  >
                    {CTA_PROGRESS_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {CTA_PROGRESS_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-gray-600">
                  <span className="text-[10px] font-medium uppercase">Owner</span>
                  <input
                    type="text"
                    value={ownerDraft}
                    disabled={statusBusy}
                    onChange={(e) => setOwnerDraft(e.target.value)}
                    onBlur={() => {
                      const trimmed = ownerDraft.trim();
                      if (trimmed && trimmed !== (cta.owner_display ?? ownerName(cta.primary_owner))) {
                        onProgressUpdate({ assigned_owner: trimmed });
                      }
                    }}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-gray-600">
                <span className="text-[10px] font-medium uppercase">Latest update</span>
                <textarea
                  value={noteDraft}
                  disabled={statusBusy}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={() => {
                    if (noteDraft !== (cta.progress_note ?? '')) {
                      onProgressUpdate({ progress_note: noteDraft });
                    }
                  }}
                  rows={2}
                  placeholder="Add a progress note…"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                />
              </label>
              {cta.renewal_opportunity_name && (
                <p className="text-gray-500">
                  <span className="font-medium">Renewal opp:</span> {cta.renewal_opportunity_name}
                </p>
              )}
              {cta.updated_at && (
                <p className="text-[10px] text-gray-400">
                  Updated {cta.updated_at.slice(0, 16).replace('T', ' ')}
                </p>
              )}
            </div>
          )}

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
  accountContexts?: Record<string, CTAAccountHoverContext>;
  focusCtaId?: string | null;
}

type RiskFilter = 'all' | '🔴' | '🟡' | '🟢';
type BoardView = 'open' | 'done';

export function CTABoard({
  ctas: initialCtas,
  slackMessages,
  accountContexts = {},
  focusCtaId = null,
}: CTABoardProps) {
  const focusTarget = focusCtaId
    ? initialCtas.find((c) => c.cta_id === focusCtaId)
    : null;
  const [ctas, setCtas] = useState(initialCtas);
  const [boardView, setBoardView] = useState<BoardView>(
    focusTarget && !isCtaOpen(focusTarget.status) ? 'done' : 'open',
  );
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const updateCtaProgress = useCallback(
    async (
      ctaId: string,
      patch: {
        status?: CTAProgressStatus;
        assigned_owner?: string | null;
        progress_note?: string | null;
      },
    ) => {
      setStatusBusyId(ctaId);
      try {
        const res = await fetch(`/api/ctas/${encodeURIComponent(ctaId)}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { entry: Record<string, unknown> };
        setCtas((prev) =>
          prev.map((c) =>
            c.cta_id === ctaId
              ? {
                  ...c,
                  status: (data.entry.status as string) ?? c.status,
                  assigned_owner:
                    (data.entry.assigned_owner as CTAEntry['assigned_owner']) ??
                    c.assigned_owner,
                  progress_note:
                    (data.entry.progress_note as string | null) ?? c.progress_note,
                  owner_display:
                    typeof data.entry.assigned_owner === 'string'
                      ? data.entry.assigned_owner
                      : c.owner_display,
                  updated_at: (data.entry.updated_at as string) ?? new Date().toISOString(),
                  completed_at: (data.entry.completed_at as string | null) ?? c.completed_at,
                  last_checked_at:
                    (data.entry.last_checked_at as string) ?? new Date().toISOString(),
                }
              : c,
          ),
        );
      } finally {
        setStatusBusyId(null);
      }
    },
    [],
  );

  const markDone = useCallback(
    (ctaId: string) => updateCtaProgress(ctaId, { status: 'done' }),
    [updateCtaProgress],
  );

  const reopen = useCallback(
    (ctaId: string) => updateCtaProgress(ctaId, { status: 'open' }),
    [updateCtaProgress],
  );

  const owners = Array.from(new Set(ctas.map((c) => ownerName(c.primary_owner)))).sort();

  const isRed = (c: CTAEntry) => c.risk_color === '🔴' || c.risk_color === 'Red';
  const isYellow = (c: CTAEntry) => c.risk_color === '🟡' || c.risk_color === 'Yellow';

  const filtered = ctas.filter((c) => {
    const open = isCtaOpen(c.status);
    if (boardView === 'open' && !open) return false;
    if (boardView === 'done' && open) return false;
    if (riskFilter === '🔴' && !isRed(c)) return false;
    if (riskFilter === '🟡' && !isYellow(c)) return false;
    if (ownerFilter !== 'all' && ownerName(c.primary_owner) !== ownerFilter) return false;
    return true;
  });

  useEffect(() => {
    if (!focusCtaId) return;
    const el = document.getElementById(`cta-card-${focusCtaId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusCtaId, boardView, filtered.length]);

  const redCount = ctas.filter((c) => isCtaOpen(c.status) && isRed(c)).length;
  const yellowCount = ctas.filter((c) => isCtaOpen(c.status) && isYellow(c)).length;
  const openCount = ctas.filter((c) => isCtaOpen(c.status)).length;
  const doneCount = ctas.filter((c) => !isCtaOpen(c.status)).length;
  const overdueCount = ctas.filter(
    (c) => isCtaOpen(c.status) && daysUntil(c.deadline) < 0,
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
      {/* View tabs + summary */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => setBoardView('open')}
            className={clsx(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              boardView === 'open' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            Open ({openCount})
          </button>
          <button
            type="button"
            onClick={() => setBoardView('done')}
            className={clsx(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              boardView === 'done' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            Done ({doneCount})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total CTAs</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{openCount + doneCount}</div>
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
          {(riskFilter !== 'all' || ownerFilter !== 'all') && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              active
            </span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {filtered.length} of {boardView === 'open' ? openCount : doneCount} CTAs
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
            {boardView === 'done'
              ? 'No completed CTAs yet. Mark items done from the Open view.'
              : 'No open CTAs match the current filters.'}
          </div>
        ) : (
          filtered.map((cta) => (
            <CTACard
              key={cta.cta_id}
              cta={cta}
              slackMessage={slackMessages[cta.cta_id] ?? ''}
              accountContext={lookupAccountHoverContext(accountContexts, cta)}
              onMarkDone={
                boardView === 'open' && isCtaOpen(cta.status)
                  ? () => markDone(cta.cta_id)
                  : undefined
              }
              onReopen={
                boardView === 'done' && !isCtaOpen(cta.status)
                  ? () => reopen(cta.cta_id)
                  : undefined
              }
              onProgressUpdate={(patch) => updateCtaProgress(cta.cta_id, patch)}
              focused={focusCtaId === cta.cta_id}
              statusBusy={statusBusyId === cta.cta_id}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Generate CTAs Button ──────────────────────────────────────────────────

const CTA_PHASE_LABELS: Record<string, string> = {
  init: 'Initializing',
  snapshot: 'Loading snapshots',
  'sfdc-fallback': 'SFDC fallback',
  classify: 'Evaluating accounts',
};

function formatElapsed(startedAt: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function CtaGenerationProgressPanel({ job }: { job: CtaGenerationJobStatus }): JSX.Element {
  const progress = job.progress;
  const progressPct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;
  const phaseLabel = progress?.phase
    ? (CTA_PHASE_LABELS[progress.phase] ?? progress.phase)
    : 'Starting';

  return (
    <div className="absolute right-0 top-full z-20 mt-2 w-80 space-y-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-900">CTA Generation</span>
        <span className="text-xs tabular-nums text-gray-500">{formatElapsed(job.startedAt)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700">{phaseLabel}</span>
        <span className="tabular-nums text-blue-600">{progressPct}%</span>
      </div>
      {progress?.label ? (
        <p className="truncate text-xs text-gray-500" title={progress.label}>
          {progress.label}
        </p>
      ) : job.status === 'running' ? (
        <p className="text-xs text-gray-400">Waiting for progress from scanner…</p>
      ) : null}
      <p className="truncate font-mono text-[10px] text-gray-300" title={job.id}>
        job {job.id.slice(0, 8)}…
      </p>
    </div>
  );
}

export function GenerateCTAsButton() {
  const [job, setJob] = useState<CtaGenerationJobStatus | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ label: string; tone: 'ok' | 'warn' | 'err' } | null>(
    null,
  );
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const detachFromJob = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const clearStatusLater = useCallback(() => {
    if (clearMsgTimerRef.current) clearTimeout(clearMsgTimerRef.current);
    clearMsgTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setStatusMsg(null);
      setJob(null);
    }, 12_000);
  }, []);

  const attachToJob = useCallback(
    (jobId: string, resume = false) => {
      detachFromJob();
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }

      setJob({
        id: jobId,
        status: 'running',
        progress: null,
        result: null,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });
      if (resume) {
        setStatusMsg({
          label: 'Generation in progress — reconnected, watching…',
          tone: 'warn',
        });
      } else {
        setStatusMsg({ label: 'Starting CTA generation…', tone: 'warn' });
      }

      unsubscribeRef.current = subscribeCtaGenerationJobPoll(jobId, {
        onProgress: (sj) => {
          if (!mountedRef.current) return;
          setJob(sj);
          const pct =
            sj.progress && sj.progress.total > 0
              ? Math.round((sj.progress.current / sj.progress.total) * 100)
              : 0;
          const detail = sj.progress?.label ?? sj.progress?.phase ?? 'running';
          setStatusMsg({ label: `Generating… ${pct}% — ${detail}`, tone: 'warn' });
        },
        onPollError: (failures) => {
          if (!mountedRef.current || failures < 3) return;
          setStatusMsg({
            label: `Generation in progress — status API slow (${failures} retries)…`,
            tone: 'warn',
          });
        },
        onComplete: (sj) => {
          if (!mountedRef.current) return;
          setJob(sj);
          detachFromJob();
          if (sj.status === 'done') {
            setStatusMsg({
              label: `${sj.result?.ctaCount ?? 0} CTAs generated — reloading…`,
              tone: 'ok',
            });
            reloadTimerRef.current = setTimeout(() => window.location.reload(), 1500);
            return;
          }
          setStatusMsg({
            label: sj.error ?? 'Generation failed',
            tone: 'err',
          });
          clearStatusLater();
        },
      });
    },
    [clearStatusLater, detachFromJob],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detachFromJob();
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      if (clearMsgTimerRef.current) clearTimeout(clearMsgTimerRef.current);
    };
  }, [detachFromJob]);

  // Resume watching an in-flight generation after navigation or refresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ctas/generate', {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { jobId: string | null };
        if (!data.jobId) return;
        attachToJob(data.jobId, true);
      } catch {
        // No active job or transient error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachToJob]);

  const startGeneration = useCallback(async () => {
    detachFromJob();
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    setStatusMsg({ label: 'Starting CTA generation…', tone: 'warn' });

    try {
      const res = await fetch('/api/ctas/generate', { method: 'POST' });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // Another generation may already be running — attach instead of dead-ending.
        const activeRes = await fetch('/api/ctas/generate', { cache: 'no-store' });
        if (activeRes.ok) {
          const active = (await activeRes.json()) as { jobId: string | null };
          if (active.jobId) {
            setStatusMsg({
              label: 'Joined an in-flight generation — watching progress…',
              tone: 'warn',
            });
            attachToJob(active.jobId, true);
            return;
          }
        }
        setJob({
          id: '',
          status: 'error',
          progress: null,
          result: null,
          error: body.error ?? 'Another generation is already running',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
        setStatusMsg({
          label: body.error ?? 'Another generation is already running',
          tone: 'err',
        });
        clearStatusLater();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { jobId } = (await res.json()) as { jobId: string };
      attachToJob(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start';
      setJob({
        id: '',
        status: 'error',
        progress: null,
        result: null,
        error: message,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      setStatusMsg({ label: message, tone: 'err' });
      clearStatusLater();
    }
  }, [attachToJob, clearStatusLater, detachFromJob]);

  const isRunning = job?.status === 'running';
  const isDone = job?.status === 'done';
  const isError = job?.status === 'error';
  const toneClass =
    statusMsg?.tone === 'err'
      ? 'text-red-700'
      : statusMsg?.tone === 'warn'
        ? 'text-amber-700'
        : statusMsg?.tone === 'ok'
          ? 'text-emerald-700'
          : 'text-gray-600';

  return (
    <div className="relative">
      <div className="flex items-center gap-3">
        {statusMsg ? (
          <span className={`max-w-xs truncate text-xs font-medium ${toneClass}`} role="status" aria-live="polite">
            {statusMsg.label}
          </span>
        ) : null}

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
      {isRunning && job ? <CtaGenerationProgressPanel job={job} /> : null}
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
