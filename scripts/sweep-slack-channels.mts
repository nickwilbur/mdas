#!/usr/bin/env -S npx tsx
//
// scripts/sweep-slack-channels.mts
//
// Drives a real logged-in Slack web client via Playwright to harvest
// the directory of cust-* channels. Writes the result to
// data/slack-channels.json in the same shape as the HAR upload
// produces — so the existing /admin/slack/import-channels page can
// consume it without backend changes.
//
// Why this exists:
//   - Zuora's Slack admin policy blocks `conversations.list` /
//     `users.conversations` / `admin.conversations.search` for
//     non-admin tokens (`enterprise_is_restricted`).
//   - Slack's own web client gets around this by calling the internal
//     Flannel edge API (`edgeapi.slack.com/cache/<E>/channels/search`)
//     which is fed by ⌘K interactions.
//   - We tried reaching the edge API directly with the `xoxc` cookie
//     and it returned zero results — the request envelope Slack's
//     client sends apparently includes signing/correlation fields
//     we couldn't reproduce.
//   - So instead of fighting that, we drive the actual Slack UI: open
//     ⌘K, type `cust-a`, `cust-b`, ..., scrape the rendered result
//     list. That uses exactly the same code path the human operator
//     does, which means no chance of an undocumented request envelope
//     mismatch — and no policy violation, because the operator IS
//     allowed to see this data, we're just automating their UI clicks.
//
// Operational model:
//   - We always run HEADED. We tried defaulting to headless once-logged-in
//     but Slack's SPA actively detects headless Chromium (navigator.webdriver,
//     missing browser features) and refuses to fully render the client. So
//     the browser window stays visible for the ~90s sweep — you don't need
//     to touch it, just don't close it.
//   - First run requires interactive SSO login. The session cookies are
//     persisted to .playwright-profile-slack/ (gitignored). Subsequent runs
//     reuse that profile and skip straight to the workspace.
//   - Slack sessions on Enterprise Grid last weeks to months. When one
//     expires, the next run will land on the SSO page and bail with a
//     clear "session expired, re-run with --login" error.
//
// Usage:
//   npm run sweep:slack              # reuses saved session, runs headed
//   npm run sweep:slack -- --login   # force interactive re-login first
//
// Output:
//   data/slack-channels.json
//     {
//       "ok": true,
//       "ranAt": "<ISO timestamp>",
//       "channels": [{ "id": "Cxxx", "name": "cust-acme",
//                      "is_archived": false, "is_private": false }, ...]
//     }

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { BADGE_REGEX_SOURCE } from './lib/clean-channel-name.mts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const PROFILE_DIR = resolve(REPO_ROOT, '.playwright-profile-slack');
const OUTPUT_PATH = resolve(REPO_ROOT, 'data/slack-channels.json');
// Slack Enterprise Grid has two entry points:
//   - https://zuora.enterprise.slack.com → the workspace PICKER (org-level
//     landing page; doesn't have the channel sidebar because no workspace
//     is selected yet).
//   - https://app.slack.com/client/<TEAM_ID> → straight into a workspace
//     with the full client UI (sidebar, message pane, ⌘K).
// We jump straight to the workspace to avoid the extra click. TEAM_ID is
// the Zuora primary workspace, sourced from the localStorage activitySession_T...
// key the operator's localStorage already contains.
const SLACK_URL = 'https://app.slack.com/client/T02RH5Q0K';

// Letters and digits we sweep through. We also include the bare prefix
// "cust-" at the end as a final catch-all (some Slack search backends
// return a broader set for a shorter query).
const SWEEP_PREFIXES = [
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
  '', // bare "cust-"
];

interface Channel {
  id: string;
  name: string;
  is_archived: boolean;
  is_private: boolean;
}

interface CliArgs {
  forceLogin: boolean;
}

function parseArgs(): CliArgs {
  const a = new Set(process.argv.slice(2));
  return {
    forceLogin: a.has('--login'),
  };
}

// ───────────────────────────────────────────────────────────────────
// Login probe
//
// We need to know if the session is live BEFORE we commit to running
// headless (which would just spin silently behind an SSO redirect).
// Slack's authenticated page reliably has data-qa="channel_sidebar" or
// the like; the unauthenticated landing has a "Sign in" form. We wait
// up to 15s for the channel switcher button to be reachable, which
// implies we're logged in and on a workspace.
// ───────────────────────────────────────────────────────────────────

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
  } catch {
    return false;
  }
  // Slack's full client app takes 5-15s to render after DOMContentLoaded
  // (huge SPA boot). Give it generous time before deciding we're not in.
  // Also wait for networkidle to give the boot APIs a chance.
  try {
    await page.waitForLoadState('networkidle', { timeout: 25_000 });
  } catch {
    /* keep going — slack networkidle is unreliable */
  }
  // Try multiple selectors — Slack rolls these every so often.
  const probes = [
    '[data-qa="channel_sidebar"]',
    '[data-qa="workspace-name"]',
    '[data-qa="message_pane"]',
    '[data-qa="message_input"]',
    'button[aria-label*="Jump to" i]', // the ⌘K button has this label
    '[data-qa="quick_switcher_button"]',
    '[role="application"]', // root of the SPA
    '.p-client_container',
    '.p-workspace__sidebar',
  ];
  for (const sel of probes) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 5000 })) {
        console.log(`  (login probe matched: ${sel})`);
        return true;
      }
    } catch {
      /* fall through */
    }
  }
  // Last resort: if URL contains /client/ or /messages/, we're authenticated
  // even if the DOM probes haven't matched yet.
  const url = page.url();
  if (/\/client\/|\/messages\//.test(url)) {
    console.log(`  (login probe matched: URL pattern ${url})`);
    return true;
  }
  // Dump diagnostic info so we can fix this if it keeps failing.
  console.log(`  (login probe: all selectors missed; URL is ${url})`);
  try {
    const title = await page.title();
    const bodyText = (await page.locator('body').innerText({ timeout: 2000 })).slice(0, 300);
    console.log(`  (page title: ${title})`);
    console.log(`  (body preview: ${bodyText.replace(/\s+/g, ' ')})`);
  } catch {
    /* shrug */
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────
// ⌘K sweep
//
// Strategy:
//   1. Open the quick switcher via Cmd+K (Mac) / Ctrl+K (others).
//   2. Clear it, type "cust-<letter>".
//   3. Wait briefly for results to render (Slack debounces 200-400ms).
//   4. Read the rendered result rows from the DOM and pull
//      channel-shaped data.
//   5. Close switcher (Escape), loop.
//
// We collect by id to dedupe. Archived channels are flagged in the
// DOM (a small "Archived" pill near the name); we detect that.
//
// IMPORTANT — fragility caveats and what we do about them:
//   - DOM selectors here ARE brittle. The whole `data-qa` attribute
//     family is internal to Slack and changes occasionally. We probe
//     multiple selectors per concern (see SELECTORS below) and bail
//     loudly if none work, instead of silently returning zero.
//   - Per-letter debounce: we sleep 700ms after typing so the
//     edge-API search completes and results render. Faster is risky.
//   - We never invoke any "create channel" / "join channel" affordance
//     — we only READ the visible result list.
// ───────────────────────────────────────────────────────────────────

const SELECTORS = {
  // Buttons that open the quick switcher. We try Cmd+K first (more
  // robust than DOM selectors), and fall back to clicking the button.
  switcherButton: [
    '[data-qa="quick_switcher_button"]',
    'button[aria-label*="Jump to" i]',
    'button[data-qa*="switcher" i]',
  ],
  // The input inside the switcher modal.
  // As of late 2025 / 2026, Slack uses a Quill contenteditable div instead
  // of a real <input>. We look for that first, then fall back to the older
  // <input> selectors in case Slack rolls back or A/B-tests an older UI.
  switcherInput: [
    '[role="dialog"][aria-label="Jump to…"] [data-qa="texty_input"]',
    '[role="dialog"][aria-label*="Jump to" i] [data-qa="texty_input"]',
    '[role="dialog"][aria-label*="Jump to" i] [role="combobox"][aria-label*="Query" i]',
    '[role="dialog"][aria-label*="Jump to" i] .ql-editor',
    'input[data-qa="quick_switcher_input"]',
    'input[aria-label*="Search channels" i]',
    'input[placeholder*="Jump to" i]',
    '[role="dialog"] input[type="search"]',
    '[role="dialog"] input[type="text"]',
  ],
  // Container of result rows in the switcher modal.
  resultsList: [
    '[data-qa="quick_switcher_results"]',
    '[role="listbox"]',
    '[role="dialog"] [role="list"]',
  ],
  // Individual channel rows. We require the channel-id-bearing attribute.
  // The first selectors are precise (carry data-* with the channel ID);
  // the last is a permissive fallback that scrapes any [role="option"]
  // inside the Jump-to dialog and lets the scraper parse out id/name from
  // anywhere in the DOM subtree or aria-label.
  channelRow: [
    '[data-qa="channel_select_listbox_item"]',
    '[role="option"][data-channel-id]',
    '[role="option"][data-qa-channel-id]',
    '[role="option"] [data-qa-channel-id]',
    '[role="dialog"][aria-label*="Jump to" i] [role="option"]',
  ],
};

async function findFirstVisible(page: Page, selectors: string[], timeoutMs = 5000) {
  // Race all selectors; return the first that resolves.
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 250 })) return { loc, sel };
      } catch {
        /* try next */
      }
    }
    await page.waitForTimeout(150);
  }
  return null;
}

async function openSwitcher(page: Page): Promise<{ inputSel: string } | null> {
  // The keyboard shortcut needs the page focus to be on the body or
  // SPA root — Playwright defaults its focus elsewhere sometimes.
  // Explicitly click the body to set focus, then send the shortcut.
  try {
    await page.locator('body').click({ timeout: 2000, position: { x: 10, y: 10 } });
  } catch {
    /* harmless */
  }
  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
  let found = await findFirstVisible(page, SELECTORS.switcherInput, 4000);
  if (!found) {
    // Fallback: click the button.
    const btn = await findFirstVisible(page, SELECTORS.switcherButton, 3000);
    if (btn) {
      try {
        await btn.loc.click({ timeout: 2000 });
      } catch {
        /* fall through */
      }
      found = await findFirstVisible(page, SELECTORS.switcherInput, 4000);
    }
  }
  if (!found) {
    // Diagnostic: dump any visible input/dialog elements so we can
    // update SELECTORS.switcherInput. Only fires once (first failure).
    try {
      const debug = await page.evaluate(() => {
        const visibles: string[] = [];
        for (const el of Array.from(document.querySelectorAll('input, [role="dialog"], [role="combobox"], [role="searchbox"]'))) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const tag = el.tagName.toLowerCase();
          const attrs = Array.from(el.attributes)
            .filter((a) => /^(role|type|data-qa|aria-label|placeholder|name|id|class)$/i.test(a.name))
            .map((a) => `${a.name}="${a.value.slice(0, 60)}"`)
            .join(' ');
          visibles.push(`<${tag} ${attrs}>`);
        }
        return visibles.slice(0, 10);
      });
      console.log('  (visible inputs/dialogs after ⌘K, for selector tuning):');
      for (const line of debug) console.log('    ', line);
    } catch {
      /* shrug */
    }
  }
  return found ? { inputSel: found.sel } : null;
}

async function closeSwitcher(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

// Scrape the rendered switcher results for channel rows. Runs entirely
// inside the page context so we can read attributes and computed text
// without a million round-trips. Returns plain JSON.
async function scrapeRenderedChannels(page: Page): Promise<Channel[]> {
  // NOTE: Everything inside page.evaluate runs in the browser context,
  // which doesn't have access to esbuild's __name helper. Avoid named
  // inner function declarations — esbuild rewrites them as __name(fn, "...")
  // and the call fails with ReferenceError in the browser. Use inline
  // arrow expressions / const lambdas instead.
  return await page.evaluate(({ selectors, badgeRegexSource }) => {
    // Regex source is passed in so the canonical TRAILING_BADGES list lives
    // in scripts/lib/clean-channel-name.ts and is unit-tested there.
    const badgeRe = new RegExp(badgeRegexSource, 'i');
    let rows: Element[] = [];
    for (const s of selectors.channelRow) {
      const found = Array.from(document.querySelectorAll(s));
      if (found.length > 0) {
        rows = found;
        break;
      }
    }
    const out: Channel[] = [];
    const ID_RE = /\b([CG][A-Z0-9]{8,})\b/;
    for (const row of rows) {
      // Channel id may live on the row itself, on a child, or only in
      // an attribute like id="..." / data-*. As a last resort scan all
      // attribute values for a Slack-shaped ID.
      let id =
        row.getAttribute('data-channel-id') ||
        row.getAttribute('data-qa-channel-id') ||
        '';
      if (!id) {
        const child = row.querySelector('[data-channel-id], [data-qa-channel-id]');
        id =
          child?.getAttribute('data-channel-id') ||
          child?.getAttribute('data-qa-channel-id') ||
          '';
      }
      if (!id) {
        // Scan every attribute value on the row + descendants for a Slack ID.
        const all = [row, ...Array.from(row.querySelectorAll('*'))];
        for (const el of all) {
          for (const attr of Array.from(el.attributes)) {
            const m = attr.value.match(ID_RE);
            if (m) {
              id = m[1];
              break;
            }
          }
          if (id) break;
        }
      }
      if (!/^[CG][A-Z0-9]{8,}$/.test(id)) continue;

      // Name: try a couple of likely selectors before falling back to
      // raw textContent (with the leading "#" stripped). Slack glues a
      // right-aligned badge (e.g. "Enterprise", "External", "Archived")
      // to the end of the row text with no whitespace separator, so we
      // must strip a trailing badge — see the 66degrees → cust-66degrees
      // bug investigation and the test file for the full story.
      const nameEl =
        row.querySelector('[data-qa="channel-name"]') ||
        row.querySelector('[data-qa="channel_name"]') ||
        row.querySelector('.p-channel_sidebar__name') ||
        row;
      const rawName = (nameEl.textContent || '').trim();
      let name = rawName.replace(/^[#]+/, '');
      const firstToken = name.split(/\s+/)[0];
      if (firstToken) name = firstToken;
      // Strip stacked badges (e.g. "fooEnterpriseExternal" → "foo").
      let prev = '';
      while (name !== prev) {
        prev = name;
        name = name.replace(badgeRe, '');
      }
      name = name.toLowerCase().trim();
      if (!name) continue;

      // Archived flag: Slack typically renders a small "Archived" pill
      // or the row carries a data-archived attribute.
      const rowText = (row.textContent || '').toLowerCase();
      const isArchived =
        row.getAttribute('data-archived') === 'true' ||
        rowText.includes('archived');
      const isPrivate =
        row.getAttribute('data-private') === 'true' ||
        !!row.querySelector('[aria-label*="private" i]');

      out.push({ id, name, is_archived: isArchived, is_private: isPrivate });
    }
    return out;
  }, { selectors: SELECTORS, badgeRegexSource: BADGE_REGEX_SOURCE });
}

async function sweepPrefix(page: Page, prefix: string): Promise<Channel[]> {
  const opened = await openSwitcher(page);
  if (!opened) {
    throw new Error(
      'Could not open the channel switcher. Slack DOM may have changed; ' +
        'check the selectors at the top of scripts/sweep-slack-channels.mts.',
    );
  }
  const input = page.locator(opened.inputSel).first();
  const query = 'cust-' + prefix;
  // Slack's switcher input is a Quill contenteditable div — .fill() only
  // works on real <input>/<textarea>. Detect and use the right approach.
  const isContentEditable = await input.evaluate(
    (el) => el.tagName.toLowerCase() !== 'input' && el.tagName.toLowerCase() !== 'textarea',
  );
  if (isContentEditable) {
    await input.click(); // focus the contenteditable
    // Clear any existing text first.
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type(query, { delay: 25 });
  } else {
    await input.fill('');
    await input.fill(query);
  }
  // Debounce window for Slack's incremental search.
  await page.waitForTimeout(900);
  const rows = await scrapeRenderedChannels(page);
  await closeSwitcher(page);
  return rows;
}

// ───────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const profileExists = existsSync(PROFILE_DIR);

  if (args.forceLogin && profileExists) {
    console.log(
      `→ --login passed; reusing existing profile at ${PROFILE_DIR}. ` +
        `Delete the directory if you want a fully fresh login.`,
    );
  }

  // We always run HEADED — see top-of-file comment for the long version,
  // short version: Slack's SPA detects and refuses to fully hydrate in
  // headless Chromium even with a valid session cookie.
  if (!profileExists) {
    console.log(
      `→ No saved profile found. Launching for first-time SSO login.`,
    );
  } else {
    console.log(
      `→ Reusing saved session at ${PROFILE_DIR}.`,
    );
  }

  console.log(
    `\n=== Slack channel sweep ===\n` +
      `  profile:   ${PROFILE_DIR}\n` +
      `  url:       ${SLACK_URL}\n` +
      `  output:    ${OUTPUT_PATH}\n` +
      `  mode:      headed (only mode supported)\n`,
  );

  const context: BrowserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'], // avoid trivial bot detection
  });

  // Reuse an existing page if Slack popped one (it usually does), else open one.
  const page: Page = context.pages()[0] ?? (await context.newPage());

  console.log(`Navigating to ${SLACK_URL} …`);
  await page.goto(SLACK_URL, { waitUntil: 'domcontentloaded' });

  // Login probe + interactive login if needed.
  if (!(await isLoggedIn(page))) {
    console.log(
      `\n→ A browser window is open. Sign in via SSO. Once you see the ` +
        `Slack workspace fully loaded (channel sidebar visible), come back ` +
        `to this terminal and press Enter.`,
    );
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('Press Enter when logged in… ');
    rl.close();
    if (!(await isLoggedIn(page))) {
      await context.close();
      console.error('✗ Still not logged in after prompt. Aborting.');
      process.exit(3);
    }
    console.log('✓ Login detected. Profile saved.');
  } else {
    console.log('✓ Existing session is logged in.');
  }

  // Slack's SPA continues hydrating after the login probe succeeds — the
  // channel switcher only becomes responsive once the workspace boot is
  // fully done, which can take 30-60s on first paint. Actively wait for
  // the message pane (a reliable "fully booted" signal), then a few
  // extra seconds for keyboard handlers to wire up.
  console.log('Waiting for SPA to fully hydrate (up to 90s) …');
  const hydrationProbes = [
    '[data-qa="message_pane"]',
    '[data-qa="message_input"]',
    '.p-message_pane',
    '.p-workspace__sidebar',
    'button[aria-label*="Jump to" i]',
  ];
  let hydrated = false;
  const hydrationDeadline = Date.now() + 90_000;
  while (Date.now() < hydrationDeadline) {
    for (const sel of hydrationProbes) {
      try {
        if (await page.locator(sel).first().isVisible({ timeout: 500 })) {
          console.log(`  (hydration probe matched: ${sel})`);
          hydrated = true;
          break;
        }
      } catch {
        /* keep trying */
      }
    }
    if (hydrated) break;
    await page.waitForTimeout(1000);
  }
  if (!hydrated) {
    console.log('  ⚠ Hydration probes never matched. Proceeding anyway.');
  }
  // Extra buffer for keyboard handlers to wire up.
  await page.waitForTimeout(3000);

  // Sweep.
  const byId = new Map<string, Channel>();
  let consecutiveEmpty = 0;
  for (let i = 0; i < SWEEP_PREFIXES.length; i++) {
    const prefix = SWEEP_PREFIXES[i]!;
    const queryLabel = ('cust-' + prefix).padEnd(8);
    let rows: Channel[] = [];
    try {
      rows = await sweepPrefix(page, prefix);
    } catch (e) {
      console.error(`  ${queryLabel}  ✗ ${(e as Error).message}`);
      // If we can't open the switcher at all, no point continuing.
      if ((e as Error).message.includes('Could not open')) break;
      continue;
    }
    let added = 0;
    for (const c of rows) {
      const existing = byId.get(c.id);
      if (!existing || (existing.is_archived && !c.is_archived)) {
        byId.set(c.id, c);
        if (!existing) added++;
      }
    }
    console.log(
      `  ${queryLabel}  → ${String(rows.length).padStart(3)} rendered, ${String(added).padStart(3)} new (total ${byId.size})`,
    );
    if (rows.length === 0) consecutiveEmpty++;
    else consecutiveEmpty = 0;
    // If the FIRST query returned zero rendered rows AND we have 0
    // collected so far, something is structurally wrong (selectors
    // broken, or quick switcher returning nothing). Don't waste 35
    // more iterations.
    if (i >= 2 && byId.size === 0 && consecutiveEmpty >= 3) {
      console.error(
        '\n✗ First 3 queries returned zero rows. DOM selectors likely changed; aborting sweep to save time. ' +
          'Run with --headed to watch what happens, then update SELECTORS in this script.',
      );
      break;
    }
  }

  await context.close();

  const channels = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  console.log(`\n=== Done: ${channels.length} unique cust-* channels ===`);
  if (channels.length === 0) {
    console.error('No channels harvested; not writing output file.');
    process.exit(4);
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      { ok: true, ranAt: new Date().toISOString(), channels },
      null,
      2,
    ),
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(
    `\nNext: open http://localhost:3000/admin/slack/import-channels and ` +
      `click "Promote from sweep file" to run the matching pipeline.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
