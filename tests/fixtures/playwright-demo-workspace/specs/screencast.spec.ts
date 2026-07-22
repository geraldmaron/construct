import { test } from '@playwright/test';

test('screencast blank page demo', async ({ page }) => {
  const output = process.env.CONSTRUCT_DEMO_SCREENCAST_OUTPUT;
  if (output) {
    await page.screencast.start({ path: output, size: { width: 640, height: 360 } });
  }
  await page.goto('about:blank');
  if (output) {
    await page.screencast.stop();
  }
});
