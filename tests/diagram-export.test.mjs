/**
 * tests/diagram-export.test.mjs — headless Chrome probe + browser resolution.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HEADLESS_BROWSER_PROBE_ARGS,
  buildDistributionDiagramEnv,
  resolvePuppeteerExecutable,
} from '../lib/diagram-export.mjs';

test('HEADLESS_BROWSER_PROBE_ARGS includes --use-mock-keychain for macOS headless probes', () => {
  assert.ok(HEADLESS_BROWSER_PROBE_ARGS.includes('--use-mock-keychain'));
  assert.ok(HEADLESS_BROWSER_PROBE_ARGS.includes('--headless'));
  assert.ok(HEADLESS_BROWSER_PROBE_ARGS.includes('--no-sandbox'));
});

test('resolvePuppeteerExecutable finds Linux Playwright and Puppeteer cache layouts', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-browser-home-'));
  try {
    const pw = path.join(home, '.cache', 'ms-playwright', 'chromium-1200', 'chrome-linux64', 'chrome');
    fs.mkdirSync(path.dirname(pw), { recursive: true });
    fs.writeFileSync(pw, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(pw, 0o755);
    assert.equal(resolvePuppeteerExecutable({ HOME: home }), pw);

    const puppeteerCache = path.join(home, '.local', 'mermaid-cli', 'puppeteer-cache');
    const puppeteerChrome = path.join(puppeteerCache, 'chrome', 'linux-131.0.0', 'chrome-linux64', 'chrome');
    fs.mkdirSync(path.dirname(puppeteerChrome), { recursive: true });
    fs.writeFileSync(puppeteerChrome, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(puppeteerChrome, 0o755);
    assert.equal(
      resolvePuppeteerExecutable({ HOME: home, PUPPETEER_CACHE_DIR: puppeteerCache }),
      puppeteerChrome,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buildDistributionDiagramEnv merges executablePath into mermaid puppeteer config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-pptr-env-'));
  try {
    const chrome = path.join(home, 'chrome-bin');
    fs.writeFileSync(chrome, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(chrome, 0o755);
    const env = buildDistributionDiagramEnv({
      ...process.env,
      HOME: home,
      PUPPETEER_EXECUTABLE_PATH: chrome,
      PATH: home,
    });
    assert.equal(env.PUPPETEER_EXECUTABLE_PATH, chrome);
    assert.ok(env.CONSTRUCT_MERMAID_PPTR_CONFIG);
    const cfg = JSON.parse(fs.readFileSync(env.CONSTRUCT_MERMAID_PPTR_CONFIG, 'utf8'));
    assert.equal(cfg.executablePath, chrome);
    assert.ok(Array.isArray(cfg.args));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
