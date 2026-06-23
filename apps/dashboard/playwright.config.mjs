/**
 * apps/dashboard/playwright.config.mjs — Playwright config for dashboard demo recordings.
 *
 * Starts lib/server for static dashboard routes; writes video artifacts to
 * DEMO_OUTPUT_DIR or .cx/demos/dashboard under the repo root.
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = path.join(ROOT, 'lib', 'server', 'index.mjs');
const DEMO_OUTPUT = process.env.DEMO_OUTPUT_DIR
  || path.join(ROOT, '.cx', 'demos', 'dashboard');

export default defineConfig({
  testDir: './e2e',
  testMatch: 'demo/**/*.spec.ts',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4242',
    trace: 'off',
    screenshot: 'off',
    video: 'on',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'demo-recording',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: DEMO_OUTPUT,
  webServer: process.env.CHECKLY || process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: `node "${SERVER}"`,
        url: 'http://127.0.0.1:4242',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: '4242',
          NODE_ENV: 'test',
          CONSTRUCT_DEMO: process.env.CONSTRUCT_DEMO || 'agentic-platforms-prd',
          CONSTRUCT_DEMO_ARTIFACT_DIR: process.env.CONSTRUCT_DEMO_ARTIFACT_DIR || '',
          DEMO_ARTIFACT_FILE: process.env.DEMO_ARTIFACT_FILE || '',
        },
      },
});
