// Belt-and-suspenders runtime guard for xoxc browser-session tokens.
//
// xoxc tokens are extremely dangerous if leaked — they grant the entire
// Slack access of the user they were extracted from, including DMs and
// private channels. If a .env containing one ends up committed to git,
// it's a meaningful security incident.
//
// This module runs once per process when xoxc is configured. It:
//
//   1. Verifies the repo's .gitignore covers `.env` and `.env.local`.
//   2. Verifies git ls-files does NOT show .env or .env.local tracked.
//   3. Logs a loud warning summarizing the risks (TOS, audit-log
//      visibility, blast radius, machine-locked usage).
//
// On a git-tracking violation it THROWS at module import — the Next
// server will fail to boot the affected route until the file is
// untracked. This is intentional: the cost of crashing dev is much
// smaller than the cost of an accidental token commit.

import 'server-only';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SENSITIVE_FILES = ['.env', '.env.local', '.env.development', '.env.production'];

export class XoxcSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XoxcSafetyError';
  }
}

let checked = false;
let warnedRisk = false;

/**
 * Call once per request that uses xoxc auth. Idempotent within a
 * process. Throws XoxcSafetyError on git-tracking violations.
 */
export function assertXoxcSafetyOrThrow(): void {
  if (checked) return;
  checked = true;

  // Find the repo root by walking up from cwd until we see a .git dir.
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    // Not running inside a git checkout — common in production
    // containers. Skip the git-tracking check, but still emit the
    // one-time risk warning below.
    emitRiskWarningOnce();
    return;
  }

  // 1. Confirm .gitignore covers our env files.
  const giPath = join(repoRoot, '.gitignore');
  let gi = '';
  if (existsSync(giPath)) {
    gi = readFileSync(giPath, 'utf-8');
  }
  const missingIgnores = SENSITIVE_FILES.filter((f) => !gitignoreCovers(gi, f));
  if (missingIgnores.length > 0) {
    throw new XoxcSafetyError(
      `SLACK_XOXC_TOKEN is configured but .gitignore does not cover: ` +
        missingIgnores.join(', ') +
        `. Add these to .gitignore before starting the server with an xoxc token. ` +
        `Refusing to boot — the risk of accidentally committing the token is too high.`,
    );
  }

  // 2. Confirm git is not currently tracking any of them.
  let tracked: string[] = [];
  try {
    const out = execSync('git ls-files -- ' + SENSITIVE_FILES.map((f) => `'${f}'`).join(' '), {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
      .toString('utf-8')
      .trim();
    tracked = out ? out.split('\n').filter(Boolean) : [];
  } catch {
    // git not available — skip silently. .gitignore check above is the
    // belt; this is the suspenders.
  }
  if (tracked.length > 0) {
    throw new XoxcSafetyError(
      `SLACK_XOXC_TOKEN is configured AND these env files are currently tracked by git: ` +
        tracked.join(', ') +
        `. Run \`git rm --cached ${tracked.join(' ')}\` and commit before restarting. ` +
        `Refusing to boot — the token may already be in your repo history.`,
    );
  }

  emitRiskWarningOnce();
}

function emitRiskWarningOnce(): void {
  if (warnedRisk) return;
  warnedRisk = true;
  // eslint-disable-next-line no-console
  console.warn(
    '\n' +
      '┌─ SLACK_XOXC_TOKEN in use ──────────────────────────────────────────────┐\n' +
      '│ Browser-session token (xoxc-) — read-only mapping use only.            │\n' +
      "│   • Against Slack TOS section 4 ('only use Slack-provided interfaces'). │\n" +
      '│   • Visible to your Slack workspace admin in API audit logs.            │\n' +
      "│   • Acts as YOU — blast radius = your full Slack access.                │\n" +
      "│   • Token rotates on session refresh; expect to re-paste periodically.  │\n" +
      '│   • Sends (chat.postMessage) are HARD-REJECTED by the gate regardless. │\n' +
      "│   • Swap for SLACK_BOT_TOKEN once admin approval lands. It's an env    │\n" +
      '│     swap with no code change.                                          │\n' +
      '└────────────────────────────────────────────────────────────────────────┘\n',
  );
}

function findRepoRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function gitignoreCovers(gitignore: string, filename: string): boolean {
  // Two-pass walk: first apply ignore rules, then un-apply negation
  // rules (lines starting with `!`). Matches the semantics that
  // `.env.example` is git-tracked even though `.env.*` would otherwise
  // exclude it.
  const lines = gitignore
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  let ignored = false;
  for (const line of lines) {
    const negate = line.startsWith('!');
    const pat = negate ? line.slice(1) : line;
    if (matchesPattern(pat, filename)) {
      ignored = !negate;
    }
  }
  return ignored;
}

function matchesPattern(pat: string, filename: string): boolean {
  // Exact / root-anchored match.
  if (pat === filename) return true;
  if (pat === '/' + filename) return true;
  if (pat === './' + filename) return true;
  // .env* — matches .env, .env.local, .env.development, etc.
  if (pat === '.env*' && filename.startsWith('.env')) return true;
  // .env.* — matches .env.local, .env.development, .env.production
  // (but NOT bare .env). Matches gitignore semantics for `.env.*`.
  if (pat === '.env.*' && filename.startsWith('.env.')) return true;
  // *.env — files ending in .env (rare but supported).
  if (pat === '*.env' && filename.endsWith('.env')) return true;
  return false;
}
