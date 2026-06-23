/**
 * templates/demos/playwright/demo-recording.config.mjs — Playwright config scaffold.
 *
 * Copied to .cx/demos/playwright.config.mjs on `construct demo init`. webServer
 * command/url come from DEMO_WEB_SERVER_* env injected by recordPlaywrightDemo.
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_OUTPUT = process.env.DEMO_OUTPUT_DIR || path.join(DEMO_ROOT, '.cx', 'demos');

const webServerCommand = process.env.DEMO_WEB_SERVER_COMMAND;
const webServerUrl = process.env.DEMO_WEB_SERVER_URL;

export default defineConfig({
  testDir: path.join(DEMO_ROOT, '.cx', 'demos', 'specs'),
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || webServerUrl || 'http://127.0.0.1:3456',
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
  webServer: process.env.SKIP_WEBSERVER || process.env.CHECKLY || !webServerCommand
    ? undefined
    : {
        command: webServerCommand,
        url: webServerUrl || process.env.BASE_URL || 'http://127.0.0.1:3456',
        reuseExistingServer: !process.env.CI,
        timeout: Number(process.env.DEMO_WEB_SERVER_TIMEOUT || 120_000),
        cwd: process.env.DEMO_WEB_SERVER_CWD || DEMO_ROOT,
      },
});
