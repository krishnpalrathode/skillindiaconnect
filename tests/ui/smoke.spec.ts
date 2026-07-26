import { test, expect } from '@playwright/test';

// Runs under BOTH 'desktop' and 'android-constrained' projects (see playwright.config.ts).
// Proves: (1) web server starts, (2) landing page renders, (3) the constrained
// Pixel-5 project configuration executes without errors.
test('landing page shows SkillIndiaConnect', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SkillIndiaConnect' })).toBeVisible();
});
