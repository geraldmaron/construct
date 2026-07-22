/**
 * tests/functional/web-capability-gate-visibility.functional.test.mjs
 *
 * The web-capability grant ladder (WEB_SEARCH_URL -> provider-native ->
 * CONSTRUCT_ORCHESTRATION_WEB_DELEGATE -> unavailable, ADR-0050) determines
 * whether a web-capable specialist would degrade. Preflight and doctor must
 * both expose the resolved mode pre-run, advisory only — it never fails the
 * gate — and .env.example must document the two governing env vars.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildOrchestrationReadiness } from '../../lib/orchestration/readiness.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

function env(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-web-cap-vis-'));
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      CONSTRUCT_HOME_OVERRIDE: home,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      WEB_SEARCH_URL: '',
      CONSTRUCT_ORCHESTRATION_WEB_DELEGATE: '',
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
      OPENAI_API_KEY: '',
      ...extra,
    },
    cleanup() { rmTmpDir(home); },
  };
}

test('readiness surfaces webMode=unavailable pre-run when nothing is granted', () => {
  // A plain (non-process.env) env object keeps resolveEmbeddedModel's
  // allowAmbient mode off, so the assertion targets the grant ladder's own
  // logic rather than whatever credentials a given host machine has
  // configured (.env, shell rc, 1Password).
  const readiness = buildOrchestrationReadiness(
    { observedTools: ['orchestration_policy', 'orchestration_run'] },
    { env: { WEB_SEARCH_URL: '', CONSTRUCT_ORCHESTRATION_WEB_DELEGATE: '' }, cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'cx-web-cap-unavail-')) },
  );
  assert.equal(readiness.webMode, 'unavailable');
});

test('preflight surfaces webMode=governed when WEB_SEARCH_URL is set', () => {
  const ctx = env({ WEB_SEARCH_URL: 'http://127.0.0.1:9/search' });
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'orchestrate', 'preflight', '--json', '--no-probe',
      '--observed-tools=orchestration_policy,orchestration_run',
    ], { cwd: REPO, env: ctx.env, encoding: 'utf8', timeout: 20_000 });
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.webMode, 'governed');
  } finally {
    ctx.cleanup();
  }
});

test('construct doctor prints web capability as an advisory line that never fails the gate', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [BIN, 'doctor'], {
      cwd: REPO, env: ctx.env, encoding: 'utf8', timeout: 60_000,
    });
    const line = result.stdout.split('\n').find((l) => l.includes('Web capability:'));
    assert.ok(line, `doctor output should include a Web capability line.\nstdout: ${result.stdout.slice(0, 800)}`);
    assert.match(line, /✓/, 'web capability is advisory and must never fail the gate, even when unavailable');
  } finally {
    ctx.cleanup();
  }
});

test('.env.example documents both web-capability env vars', () => {
  const txt = fs.readFileSync(path.join(REPO, '.env.example'), 'utf8');
  assert.match(txt, /WEB_SEARCH_URL/);
  assert.match(txt, /CONSTRUCT_ORCHESTRATION_WEB_DELEGATE/);
});
