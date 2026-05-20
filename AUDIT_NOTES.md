# MDAS Audit Notes

Audit performed: 2026-05-20.

## 1. Application structure

MDAS is a TypeScript monorepo (npm workspaces, vitest, no React tests yet)
that builds a **read-only** Customer Solutions Engineering decision-support
dashboard for the Expand 3 franchise at Zuora.

```
apps/
  web/      Next.js 14 App Router UI + a small "read" JSON API.
  worker/   Long-running Node process that drains a Postgres LISTEN/NOTIFY
            queue (refresh_jobs) and orchestrates per-source adapter runs.
packages/
  canonical/             Shared domain types (CanonicalAccount, CanonicalOpportunity, AccountView, ChangeEvent).
  scoring/               Pure functions: bucket, risk score, deep-equal.
  forecast-generator/    Plaintext quarterly churn-forecast renderer
                         (consumed by /api/forecast and CLI).
  db/                    pg Pool + typed query helpers (snapshots, runs, jobs, audit).
  adapters/read/*        Per-source adapters (Salesforce / Cerebro-via-Glean /
                         Gainsight / Staircase-Gmail / Zuora-MCP / Glean-MCP /
                         local-snapshots). Each exports `isReadOnly: true`.
  adapters/mock/         236-account fixtures used for offline dev + seed.
scripts/                 ci-guard, migrate, seed, generate-ctas, SFDC schema tools.
```

### Read-only enforcement

Three layered guards:
- No `packages/adapters/write/*` directory (`ci-guard.mjs` greps).
- Each read adapter exports `isReadOnly: true` (also asserted by ci-guard).
- `readOnlyGuard()` in adapter shared lib refuses HTTP verbs other than `GET/POST(read)/HEAD/OPTIONS`.

### Auth posture

Two modes, both server-only — the browser never sees a Glean token:

- `AUTH_MODE=none` (default): a single service `GLEAN_MCP_TOKEN` used for all
  requests. Suitable for single-user / localhost.
- `AUTH_MODE=okta`: scaffold only. `/api/auth/okta` returns 501 with an
  admin checklist; `/api/glean/*` returns 501 via `resolveGleanCredsForRequest`
  so a manager flipping the flag prematurely gets actionable output.

## 2. Risks and weaknesses found

| # | Area | Severity | Note |
|---|------|----------|------|
| 1 | `apps/web/src/components/CTABoard.tsx` | **Security (low–med)** | `<a href={cta.renewal_opportunity_url}>`, `<a href={cta.destination_slack_channel}>` and `https://zuora.lightning.force.com/lightning/r/Account/${cta.salesforce_account_id}/view` interpolate values that originate from a tracked-in-repo markdown / JSONL file. If that file is ever tampered with (or generated from external input in the future), `javascript:alert(1)` URLs and SFDC-ID-path-injection are possible. Mitigation: a `safeHttpUrl()` helper that requires `http(s)`, plus a validator for SFDC IDs. |
| 2 | `apps/web/src/lib/cta-utils.ts::generateSlackMessage` | **Bug** | The function's docblock explicitly says “Renewal opp link at end when URL exists”, but the implementation never appends the link. A pre-existing test (`apps/web/src/lib/cta-utils.test.ts:381`) has been **failing for ~9 days**. |
| 3 | `scripts/generate-ctas.test.ts:125` | **Test contradiction** | Asserts `expect(msg).toContain('sentiment is red')`. The authoritative spec in `apps/web/src/lib/cta-utils.test.ts:214–216` and :285 asserts `expect(msg).not.toContain('sentiment is red')`. Both cannot pass; the scripts test was stale relative to the v2 voice. |
| 4 | `apps/web/src/app/api/ctas/generate/route.ts` | **DX** | Uses CommonJS `require('fs')` inside an ESM Next module; the rest of the file uses ESM `import`. Confusing and inconsistent. |
| 5 | `apps/web/src/app/api/glean/search/route.ts` | **DX / dead code** | `return out instanceof Response ? out : out;` is a no-op ternary (both branches identical). The pattern appears in chat/document/health too. |
| 6 | `apps/web/src/app/api/glean/search/route.ts` pageSize | **Validation** | `Math.min(Math.max(body.pageSize ?? 25, 1), 100)` returns `NaN` when callers pass a non-numeric `pageSize` (e.g. JSON string). Coerce + finite-check. |
| 7 | `packages/forecast-generator/src/index.ts` (unstaged work) | **In-progress** | The unstaged churn-save-target filter is internally consistent with its own test suite (which now passes). Left as-is. |
| 8 | `apps/web/src/lib/cta-generation-jobs.ts` | OK | In-memory job store is bounded by both TTL and a hard cap, with logged prunes. Acceptable for the single-process Next workload it serves. |
| 9 | `apps/web/src/app/api/refresh/route.ts` actor | Note (not fixed) | Audit actor is hard-coded `manual:nick`. Single-user app — but tracked here for follow-up when AUTH_MODE=okta lands so the real session principal is logged. |

Not changed (intentionally):
- The `AUTH_MODE=okta` scaffold (501 + checklist) is the correct posture
  until the Okta + Glean admin tickets close. The hard-coded `manual:nick`
  audit actor will be replaced at the same time.
- The CTA generation route's `spawn('npx', ['tsx', ...])` lookup — the args
  are hardcoded (no user input) and the project-root resolver handles
  the two known cwds.
- The pre-existing 2 jsforce / Stage_Num__c locale tests already cover F-21/F-22.
- The unstaged `forecastCategory` work is consistent with its own test suite.

## 3. Areas changed in this audit

- `apps/web/src/lib/cta-utils.ts` — implement the documented Renewal-opp Slack
  mrkdwn link append; add internal `safeHttpUrl()` use so a tampered URL
  doesn't render as `<javascript:...|Renewal opp>` in Slack.
- `apps/web/src/components/CTABoard.tsx` — wrap externally-sourced URLs
  through a `safeHttpUrl()` helper (new `apps/web/src/lib/url-safety.ts`),
  and validate `salesforce_account_id` before interpolating into the SFDC URL.
- `apps/web/src/lib/url-safety.ts` — new tiny helper + tests.
- `apps/web/src/app/api/ctas/generate/route.ts` — replace `require('fs')`
  with a top-level ESM `import` and minor cleanup.
- `apps/web/src/app/api/glean/{search,chat,document,health}/route.ts` —
  drop the no-op `out instanceof Response ? out : out` ternary; clamp + finite-check
  numeric inputs in search.
- `scripts/generate-ctas.test.ts` — fix the contradictory `'sentiment is red'`
  assertion to match the v2 voice asserted in `cta-utils.test.ts`.

## 4. Test-coverage strategy

- Add unit tests for `safeHttpUrl()` covering: `http`, `https`, `javascript:`,
  `data:`, relative URLs, empty/null, query strings preserved.
- Add unit tests for the SFDC-id validator (`isLikelySfdcId`).
- Add a regression test for `generateSlackMessage` that pins the appended
  `<URL|Renewal opp>` mrkdwn format.
- Add a regression test that `generateSlackMessage` strips a hostile
  `javascript:` URL out of the Slack link.
- Re-run the existing 223-test vitest suite; fix the 2 pre-existing failures.

---

## 5. Outcome (filled in at end of audit)

### Files changed
- `apps/web/src/lib/cta-utils.ts`
- `apps/web/src/lib/cta-utils.test.ts`
- `apps/web/src/lib/url-safety.ts` (new)
- `apps/web/src/lib/url-safety.test.ts` (new)
- `apps/web/src/components/CTABoard.tsx`
- `apps/web/src/app/api/ctas/generate/route.ts`
- `apps/web/src/app/api/glean/search/route.ts`
- `apps/web/src/app/api/glean/chat/route.ts`
- `apps/web/src/app/api/glean/document/route.ts`
- `apps/web/src/app/api/glean/health/route.ts`
- `scripts/generate-ctas.test.ts`

### Issues fixed
1. Slack-mrkdwn Renewal opp link now appended (documented behaviour that
   was missing — fixed `cta-utils.test.ts:381` regression).
2. `javascript:` / non-`http(s)` URL injection in the CTA card is now blocked
   at render time. SFDC account IDs are validated against the SFDC 15/18-char
   prefix before being interpolated.
3. Numeric search `pageSize` no longer collapses to `NaN` on non-numeric input.
4. Dead-code ternary removed from all four Glean route handlers.
5. CommonJS `require('fs')` inside an ESM Next route replaced with a top-level
   `import`.
6. Contradictory CTA test fixed: `scripts/generate-ctas.test.ts` now asserts
   the v2 voice (`not.toContain('sentiment is red')`).

### Tests added
- `apps/web/src/lib/url-safety.test.ts` (8 new tests).
- One new regression in `apps/web/src/lib/cta-utils.test.ts` asserting
  that a hostile URL is dropped from the Renewal opp link.

### Commands run
- `npm run ci:guard` — pass.
- `npm run lint` — pass (`tsc -b --pretty`).
- `npm test` — pass (vitest, full repo).

### Remaining risks / recommended follow-up
- **AUTH_MODE=okta** still a scaffold; complete the two admin tickets in
  `docs/integrations/glean.md` Option B, then wire NextAuth and replace the
  hard-coded `manual:nick` audit actor with the session principal.
- **CTA page reads from disk on every request** (`force-dynamic` Server
  Component reads `expand3_cta_scan_*.md` + `expand3_cta_log.jsonl`). For
  the single-user / small-cardinality use case this is fine. If the
  application grows to multiple users, cache the parse with a watcher or
  move to Postgres-backed CTA storage.
- **forecastCategory** rollout (unstaged work) needs a worker re-seed so
  legacy snapshots pick up the field; legacy null-tolerant code path is
  already in place.
- Consider adding `@axe-core/playwright` coverage of the CTA board (a11y
  not yet exercised end-to-end).
