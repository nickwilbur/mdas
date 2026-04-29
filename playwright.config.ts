// Playwright + axe-core E2E + a11y harness.
//
// Audit ref: F-20 (a). PR-B5 (Phase 2).
//
// This config does NOT seed the database — it expects a seeded
// stack to already be reachable at PLAYWRIGHT_BASE_URL (default
// http://localhost:3000). The CI workflow `e2e` job seeds with
// `make seed` before invoking `npx playwright test`.
//
// Locally:
//   docker compose up -d postgres
//   npm run migrate && npm run seed
//   npm --workspace apps/web run dev   # in another terminal
//   npx playwright test
//
// On a manager's machine without docker:
//   PLAYWRIGHT_BASE_URL=https://staging.mdas.internal npx playwright test
//
// Why no `webServer` block: the worker isn't started by Playwright,
// and bringing it up via Playwright's `webServer` would entangle
// E2E setup with worker boot semantics. The CI workflow handles
// process lifecycle explicitly.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Capture traces on first retry only — they're heavy and we don't
  // want to slow down green runs.
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // 1 retry in CI absorbs flakes from cold Postgres without masking
  // real regressions.
  retries: process.env.CI ? 1 : 0,
  // Conservative parallelism — the dashboard reads against a single
  // Postgres are cheap, but axe scans are CPU-heavy.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
  ],
  expect: {
    // Default 5s expect timeout is too tight for our cold-start-heavy
    // first-page render against a real Postgres.
    timeout: 10_000,
  },
});
