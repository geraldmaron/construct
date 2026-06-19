/**
 * apps/dashboard/e2e/demo/agentic-platforms-prd.spec.ts — publish guardrails demo recording.
 *
 * Walks the terminal cockpit on /chat/ and executes demo script steps via /demo
 * slash commands for Playwright video output.
 */

import { test, expect } from '@playwright/test';

test('agentic platforms prd — chat cockpit demo walkthrough', async ({ page }) => {
  await page.goto('/chat/');
  await expect(page.getByTestId('terminal-cockpit')).toBeVisible({ timeout: 30_000 });

  const prompt = page.locator('#construct-prompt');
  await expect(prompt).toBeVisible({ timeout: 15_000 });

  await prompt.fill('/demo steps');
  await prompt.press('Enter');
  await page.waitForTimeout(1200);
  await expect(page.getByText(/Demo steps/i)).toBeVisible({ timeout: 10_000 });

  for (let i = 0; i < 5; i += 1) {
    await prompt.fill('/demo next');
    await prompt.press('Enter');
    await page.waitForTimeout(1500);
  }

  await expect(page.getByText(/Step 5|Publish PASS|styled PDF/i)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2000);
});
