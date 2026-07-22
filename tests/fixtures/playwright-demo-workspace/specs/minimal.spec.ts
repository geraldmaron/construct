import { test } from '@playwright/test';

test('minimal blank page demo', async ({ page }) => {
  await page.goto('about:blank');
});
