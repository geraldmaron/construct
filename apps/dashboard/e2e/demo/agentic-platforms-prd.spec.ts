/**
 * apps/dashboard/e2e/demo/agentic-platforms-prd.spec.ts — publish guardrails demo recording.
 *
 * Act 1: branded terminal cockpit on /chat/ with /demo walkthrough.
 * Act 2: open exported PDF via /demo-preview/ and scroll through the artifact.
 */

import { test, expect, type Page } from '@playwright/test';
import { revealArtifact } from './_helpers/scroll-artifact.ts';

async function runCockpitWalkthrough(page: Page) {
  await page.goto('/chat/');
  await expect(page.getByTestId('terminal-cockpit')).toBeVisible({ timeout: 30_000 });

  const prompt = page.locator('#construct-prompt');
  await expect(prompt).toBeVisible({ timeout: 15_000 });

  await prompt.fill('/demo steps');
  await prompt.press('Enter');
  await page.waitForTimeout(1500);
  await expect(page.getByText(/Demo steps/i)).toBeVisible({ timeout: 10_000 });

  for (let i = 0; i < 5; i += 1) {
    await prompt.fill('/demo next');
    await prompt.press('Enter');
    await page.waitForTimeout(1800);
  }

  await expect(page.getByText(/^Step 5: Publish PASS/i)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2000);
}

test('agentic platforms prd — cockpit walkthrough and PDF scroll', async ({ page }) => {
  test.setTimeout(180_000);
  await runCockpitWalkthrough(page);
  await revealArtifact(page, {
    file: process.env.DEMO_ARTIFACT_FILE || 'prd-platform.pdf',
    basePath: '/demo-preview',
    mode: process.env.DEMO_ARTIFACT_REVEAL_MODE || 'constructPreview',
  });
});
