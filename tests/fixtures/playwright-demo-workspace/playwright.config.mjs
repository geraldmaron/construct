/**
 * tests/fixtures/playwright-demo-workspace/playwright.config.mjs — isolated demo recording workspace.
 */

import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(ROOT, 'specs'),
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    video: process.env.CONSTRUCT_DEMO_RECORDING_MODE === 'screencast' ? 'off' : 'on',
    viewport: { width: 640, height: 360 },
  },
  projects: [{ name: 'demo-recording' }],
  outputDir: process.env.DEMO_OUTPUT_DIR || path.join(ROOT, 'output'),
});
