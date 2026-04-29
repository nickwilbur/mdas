// axe-core accessibility scan over the routes the audit's findings
// touched (F-07, F-10, F-11). We scan with WCAG 2 A + AA + best-practice
// rules, allow-list a small set of rules that we know are unimprovable
// without theme-system changes, and fail on any other violation.
//
// Audit ref: F-20a (Phase 2 PR-B5), F-07 / F-10 / F-11.
//
// The allow-list is intentionally small and documented. Anything new
// added here must come with a comment explaining why it's deferred.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Rules we accept failing (with reason). Empty today; document overrides
// inline rather than silently disabling rules.
const ACCEPTED_VIOLATIONS: string[] = [
  // e.g. 'color-contrast' — would be added with: "Tailwind palette
  // mismatch on bg-amber-400 + text-black; awaiting Phase 3 theme pass."
];

const ROUTES = [
  '/',
  '/accounts',
  '/admin/data-quality',
  '/admin/refresh',
  '/wow',
  '/forecast',
];

for (const route of ROUTES) {
  test(`a11y: ${route}`, async ({ page }) => {
    await page.goto(route);
    // Wait for any loading-shimmer state to settle so axe scans the
    // post-hydration tree, not a server-rendered placeholder.
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze();

    const violations = results.violations.filter(
      (v) => !ACCEPTED_VIOLATIONS.includes(v.id),
    );

    if (violations.length > 0) {
      // Build a compact summary so the CI log is actionable.
      const summary = violations
        .map(
          (v) =>
            `  - ${v.id} (${v.impact}) — ${v.help}\n    nodes: ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        )
        .join('\n');
      throw new Error(
        `axe found ${violations.length} a11y violation(s) on ${route}:\n${summary}\nSee ${results.url} for details.`,
      );
    }
    expect(violations).toHaveLength(0);
  });
}
