/**
 * tests/cli-ux-isolation-gaps.test.mjs — CLI UX fixes from the isolated
 * pack/init/status pass: artifact validate type listing, tools bare Next:,
 * and quieter fresh-machine status formatting for optional missing credentials.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { formatStatusReport } from '../lib/status.mjs';
import { validateArtifactRelease } from '../lib/artifact-release-gate.mjs';
import { artifactTypes } from '../lib/artifact-manifest.mjs';
import { formatCommandHelp } from '../lib/cli-commands.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BIN = path.join(REPO, 'bin', 'construct');

function run(args, { cwd = REPO, home } = {}) {
  const homeDir = home || fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ux-home-'));
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      CONSTRUCT_HOME_OVERRIDE: homeDir,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
    },
  });
}

test('artifact validate unknown type lists valid types', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ux-artifact-'));
  try {
    const file = path.join(tmp, 'tiny.md');
    fs.writeFileSync(file, '# note\n\nhello\n');
    const result = validateArtifactRelease({ filePath: file, type: 'note' });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /Unknown artifact type: note/);
    assert.match(result.errors[0], /Valid types:/);
    for (const type of ['prd', 'adr', 'research-brief']) {
      assert.match(result.errors[0], new RegExp(`\\b${type}\\b`));
    }
  } finally {
    rmTmpDir(tmp);
  }
});

test('construct artifact validate missing args prints usage with valid types and Next', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ux-validate-help-'));
  try {
    const result = run(['artifact', 'validate'], { home });
    assert.notEqual(result.status, 0);
    const out = `${result.stdout}${result.stderr}`;
    assert.match(out, /Usage: construct artifact validate/);
    assert.match(out, /Valid types:/);
    assert.match(out, /Next: construct artifact validate/);
    const sample = artifactTypes()[0];
    if (sample) assert.match(out, new RegExp(`\\b${sample}\\b`));
  } finally {
    rmTmpDir(home);
  }
});

test('construct tools bare invocation shows Next: detect guidance', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ux-tools-'));
  try {
    const result = run(['tools'], { home });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    const out = `${result.stdout}${result.stderr}`;
    assert.match(out, /Usage: construct tools detect/);
    assert.match(out, /Next: construct tools detect/);
  } finally {
    rmTmpDir(home);
  }
});

test('tools --help surfaces Next detect guidance from the catalog', () => {
  const help = formatCommandHelp('tools');
  assert.match(help, /Next:/);
  assert.match(help, /tools detect/);
});

test('sync --help documents host selection flags', () => {
  const help = formatCommandHelp('sync');
  assert.match(help, /--all-hosts/);
  assert.match(help, /--with-<host>/);
  assert.match(help, /--hosts=/);
});

test('artifact --help documents --type and validate usage', () => {
  const help = formatCommandHelp('artifact');
  assert.match(help, /--type=<doc-type>/);
  assert.match(help, /validate/);
  assert.match(help, /Valid types|unknown --type/i);
});

test('formatStatusReport collapses optional missing-credentials embed noise', () => {
  const report = formatStatusReport({
    version: '0.0.0',
    deployment: { mode: 'solo' },
    system: {
      overall: { status: 'healthy', summary: 'ok' },
      services: [],
      integrations: { summary: '0 live · 3 unavailable', counts: { unavailable: 3 } },
    },
    features: [
      { name: 'GitHub', status: 'unavailable', message: 'Not configured in any host' },
      { name: 'Jira', status: 'unavailable', message: 'Not configured in any host' },
      { name: 'Slack', status: 'unavailable', message: 'Not configured in any host' },
      { name: 'Memory', status: 'configured', message: 'Configured in Claude' },
    ],
    embedProviders: {
      summary: '0 available · 3 unavailable',
      available: [],
      unavailable: [
        { id: 'github', reason: 'missing credentials: GITHUB_TOKEN' },
        { id: 'jira', reason: 'missing credentials: JIRA_EMAIL, JIRA_API_TOKEN' },
        { id: 'linear', reason: 'missing credentials: LINEAR_API_KEY' },
      ],
    },
  });

  assert.match(report, /3 optional integrations/);
  assert.match(report, /optional until you run `construct mcp add`/);
  assert.doesNotMatch(report, /✗\s+GitHub/);
  assert.match(report, /optional providers missing credentials/);
  assert.match(report, /github, jira, linear/);
  assert.doesNotMatch(report, /configured but unavailable — missing credentials/);
});
