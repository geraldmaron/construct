/**
 * apps/dashboard/e2e/demo/cockpit-tour.spec.ts — dashboard demo recording.
 *
 * Walks doctor and terminal cockpit chat for publish pipeline demos.
 * Uses data-testid locators for stable Playwright video output.
 */

import { test, expect } from '@playwright/test';

test('cockpit tour — doctor and chat', async ({ page }) => {
  await page.goto('/doctor');
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  await page.goto('/chat');
  await expect(page.getByTestId('terminal-cockpit')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
});
