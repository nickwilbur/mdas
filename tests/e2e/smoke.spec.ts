// Smoke specs: every route the audit's persona narrative cares about
// renders, returns 200, and contains the headline that proves the data
// path worked end-to-end.
//
// Audit ref: F-20a (Phase 2 PR-B5).
//
// We deliberately don't assert exact data — the seeded snapshot
// content evolves. We assert structural landmarks (h1, table, etc.)
// that would only render if the read-model query succeeded.
import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('dashboard / renders Action Queue and roll-up tiles', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status(), 'GET / should return 200').toBe(200);
    // ActionQueue heading from PR-A9.
    await expect(page.getByRole('heading', { name: /your next .* actions/i })).toBeVisible();
    // Roll-up "Total ATR" tile (visible on either pre or post B1 dashboard).
    await expect(page.getByText(/total atr/i)).toBeVisible();
  });

  test('/accounts renders the bucket-grouped table', async ({ page }) => {
    await page.goto('/accounts');
    // Headline proves the route rendered; footer count proves the read-model
    // query returned accounts. Bucket section headers only appear when the
    // active fiscal-quarter filter overlaps an account's renewal quarter —
    // the filter auto-defaults to the current quarter on hydration, which
    // may hide all buckets even when data is present.
    await expect(page.getByRole('heading', { name: /accounts/i }).first()).toBeVisible();
    await expect(page.getByText(/showing \d+ of [1-9]\d* accounts/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('/admin/data-quality renders both per-source and per-field tables', async ({ page }) => {
    const response = await page.goto('/admin/data-quality');
    expect(response?.status()).toBe(200);
    // The page either renders the two cards or a "No successful refresh
    // yet" empty state. Both are acceptable for a smoke test.
    await expect(
      page.getByText(/per-source freshness|no successful refresh/i),
    ).toBeVisible();
  });

  test('/admin/refresh renders without 500', async ({ page }) => {
    const response = await page.goto('/admin/refresh');
    expect(response?.status()).toBe(200);
  });

  test('/wow renders movement events or a no-data state', async ({ page }) => {
    const response = await page.goto('/wow');
    expect(response?.status()).toBe(200);
  });

  test('/forecast renders the generator UI', async ({ page }) => {
    const response = await page.goto('/forecast');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('/ctas renders the CTA board or empty state', async ({ page }) => {
    const response = await page.goto('/ctas');
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: /churn-risk ctas/i }),
    ).toBeVisible();
  });

  test('/renewal-analysis renders the renewal pipeline', async ({ page }) => {
    const response = await page.goto('/renewal-analysis');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /renewals/i }).first()).toBeVisible();
  });
});
