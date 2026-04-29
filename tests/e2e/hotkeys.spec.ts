// Regression spec for PR-A7 (F-11) — global keyboard hotkeys.
//
// Asserts:
//   - `/` focuses the data-hotkey-search input.
//   - `?` toggles the help dialog (open + close on Escape).
//   - `j` / `k` move focus to the next / previous data-hotkey-row.
//
// Run order matters here because the hotkeys hook uses a single
// document-level keydown listener; the test sequences key events and
// verifies focus / aria-state invariants between them.
import { test, expect } from '@playwright/test';

test.describe('hotkeys (F-11)', () => {
  test('/ focuses the search box and ? opens help, Esc closes', async ({ page }) => {
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    // Slash should focus the search input even when the body has focus.
    await page.keyboard.press('/');
    const search = page.locator('[data-hotkey-search]');
    await expect(search).toBeFocused();

    // ? toggles help even from inside an input (PR-A7 deliberate behavior).
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
    await expect(dialog).toBeVisible();

    // Escape closes the help overlay and does not navigate away.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('j / k move focus between data-hotkey-row elements', async ({ page }) => {
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('[data-hotkey-row]');
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'needs at least 2 rows seeded');

    // From a neutral starting state, press j twice — focus should land
    // on the 2nd row (j moves forward, then forward again).
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(rows.nth(1)).toBeFocused();

    // k moves back to the previous row.
    await page.keyboard.press('k');
    await expect(rows.nth(0)).toBeFocused();
  });
});
