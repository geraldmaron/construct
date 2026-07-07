/**
 * tests/providers/breaker-status.test.mjs — LMCP-B9: circuit-breaker state
 * surfaced in construct status. Fixture-forces a provider breaker OPEN and
 * asserts buildStatus()/formatStatusReport() report it; a healthy breaker
 * (or no breaker at all) reports CLOSED with no false alarm.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStatus, formatStatusReport } from '../../lib/status.mjs';
import { resolveProviders } from '../../lib/providers/registry.mjs';
import { getBreaker, clearBreakerRegistry } from '../../lib/providers/circuit-breaker.mjs';

// fn is async; this must await it before cleanup, or the finally block
// deletes rootDir/homeDir out from under fn's still-pending work.

async function withProjectAndHome(fn) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-breaker-status-project-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-breaker-status-home-'));
  fs.mkdirSync(path.join(homeDir, '.claude', 'agents'), { recursive: true });
  try {
    return await fn({ rootDir, homeDir });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

test.beforeEach(() => {
  clearBreakerRegistry();
});

test('a healthy provider set reports CLOSED for every configured provider', async () => {
  await withProjectAndHome(async ({ rootDir, homeDir }) => {
    const status = await buildStatus({ rootDir, cwd: rootDir, homeDir, env: process.env });
    assert.ok(status.providerBreakers);
    assert.ok(status.providerBreakers.entries.length > 0, 'expected at least one built-in data-source provider');
    for (const entry of status.providerBreakers.entries) {
      assert.equal(entry.state, 'CLOSED');
      assert.equal(entry.open, false);
    }
    assert.equal(status.providerBreakers.openCount, 0);
    assert.match(status.providerBreakers.summary, /all circuits closed/);
  });
});

test('a fixture-forced OPEN breaker is reported in buildStatus and the rendered report', async () => {
  await withProjectAndHome(async ({ rootDir, homeDir }) => {
    const { providers } = await resolveProviders({ rootDir, env: process.env });
    const anyProviderId = Object.keys(providers)[0];
    assert.ok(anyProviderId, 'expected at least one resolvable built-in provider for this fixture');

    const breaker = getBreaker(`provider:${anyProviderId}`, { failureThreshold: 5, cooldownMs: 30_000 });
    for (let i = 0; i < 5; i++) breaker._recordFailure();

    const status = await buildStatus({ rootDir, cwd: rootDir, homeDir, env: process.env });
    const entry = status.providerBreakers.entries.find((e) => e.id === anyProviderId);
    assert.ok(entry);
    assert.equal(entry.state, 'OPEN');
    assert.equal(entry.open, true);
    assert.equal(entry.failures, 5);
    assert.equal(status.providerBreakers.openCount, 1);
    assert.match(status.providerBreakers.summary, /1 of \d+ provider circuit\(s\) OPEN/);

    const report = formatStatusReport(status);
    assert.match(report, /Provider circuits:/);
    assert.match(report, new RegExp(`${anyProviderId}\\s+OPEN`));
  });
});
