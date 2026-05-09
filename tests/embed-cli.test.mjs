/**
 * tests/embed-cli.test.mjs — resolveEmbedStatus unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { resolveEmbedStatus } from '../lib/embed/cli.mjs';

describe('resolveEmbedStatus', () => {
  it('returns level=none when no provider credentials present', () => {
    const status = resolveEmbedStatus({});
    assert.equal(status.level, 'none');
  });

  it('returns level=stopped when GitHub token present but no daemon state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const status = resolveEmbedStatus({ GITHUB_TOKEN: 'ghp_fake' }, tmpDir);
    assert.equal(status.level, 'stopped');
    assert.ok(status.label.includes('stopped'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns level=stopped when Jira credentials present but no daemon state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const status = resolveEmbedStatus({
      JIRA_API_TOKEN: 'tok',
      JIRA_USER_EMAIL: 'a@b.com',
      JIRA_BASE_URL: 'https://x.atlassian.net',
    }, tmpDir);
    assert.equal(status.level, 'stopped');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns level=running when state file has live pid (self)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const runtimeDir = path.join(tmpDir, '.cx', 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'embed-daemon.json'),
      JSON.stringify({ pid: process.pid, configPath: 'auto', startedAt: new Date().toISOString() }),
    );
    const status = resolveEmbedStatus({ GITHUB_TOKEN: 'ghp_fake' }, tmpDir);
    assert.equal(status.level, 'running');
    assert.ok(status.label.includes('running'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns level=stopped when state file has dead pid', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const runtimeDir = path.join(tmpDir, '.cx', 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    // PID 999999999 is guaranteed non-existent
    fs.writeFileSync(
      path.join(runtimeDir, 'embed-daemon.json'),
      JSON.stringify({ pid: 999999999, configPath: 'auto', startedAt: new Date().toISOString() }),
    );
    const status = resolveEmbedStatus({ GITHUB_TOKEN: 'ghp_fake' }, tmpDir);
    assert.equal(status.level, 'stopped');
    fs.rmSync(tmpDir, { recursive: true });
  });
});
