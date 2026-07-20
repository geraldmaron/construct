/**
 * tests/doctor/host-config.test.mjs — host config warnings only when host installed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildHostConfigChecks } from '../../lib/doctor/host-config.mjs';

test('omits host config checks when no hosts are installed', () => {
  const checks = buildHostConfigChecks('/tmp/home', {
    hosts: [
      { host: 'OpenCode', availability: 'missing' },
      { host: 'Claude Code', availability: 'missing' },
      { host: 'Codex', availability: 'missing' },
      { host: 'Copilot', availability: 'missing' },
    ],
  });
  assert.equal(checks.length, 0);
});

test('omits host config checks before machine setup completes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-host-'));
  try {
    const checks = buildHostConfigChecks(home, {
      hosts: [{ host: 'OpenCode', availability: 'installed' }],
    });
    assert.equal(checks.length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('includes OpenCode config check only when OpenCode is installed', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-host-ready-'));
  try {
    const configRoot = path.join(home, '.config', 'construct');
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(path.join(configRoot, 'config.env'), 'BOOTSTRAP_CHECKED=1\n');

    const checks = buildHostConfigChecks(home, {
      hosts: [{ host: 'OpenCode', availability: 'installed' }],
    });
    assert.equal(checks.length, 1);
    assert.equal(checks[0].label, 'OpenCode config exists');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
