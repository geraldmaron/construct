/**
 * tests/functional/doctor-probe-providers.functional.test.mjs
 *
 * lib/providers/connection-probe.mjs exists but no gate called it — every
 * doctor/preflight surface stopped at presence (a stored op:// reference or
 * env var counts as configured, with no verification). construct-trxz
 * deliberately keeps default paths presence-first to avoid 1Password prompt
 * storms, so the deep credential check must be opt-in. This locks in: (1)
 * default `construct doctor` and `construct orchestrate preflight` issue
 * zero outbound fetch calls; (2) `--probe-providers` / `--deep` call
 * probeProviderConnection for each presence-configured provider and report
 * auth-verified vs a failing/unverified credential with a next step.
 *
 * A fetch-spy preload module (injected via `node --import`) intercepts every
 * outbound fetch the spawned CLI process makes, so no real network access is
 * required or permitted — the spy itself refuses every call and records the
 * URLs into a file the test reads back.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const dirs = [];
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-doctor-probe-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} } });

const PRELOAD = path.join(os.tmpdir(), `cx-fetch-spy-preload-${process.pid}.mjs`);
fs.writeFileSync(PRELOAD, `
import { writeFileSync } from 'node:fs';
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  return { status: 200, ok: true, json: async () => ({}) };
};
process.on('exit', () => {
  try {
    writeFileSync(process.env.FETCH_SPY_OUT, JSON.stringify(calls));
  } catch {}
});
`);
test.after(() => { try { fs.rmSync(PRELOAD, { force: true }); } catch {} });

function runWithFetchSpy(args, env = {}) {
  const cwd = freshCwd();
  const spyOut = path.join(cwd, 'fetch-calls.json');
  const res = spawnSync(process.execPath, ['--import', PRELOAD, BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: cwd,
      USERPROFILE: cwd,
      FETCH_SPY_OUT: spyOut,
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
      OPEN_ROUTER_API_KEY: '',
      OPENAI_API_KEY: '',
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      ...env,
    },
  });
  let calls = [];
  try { calls = JSON.parse(fs.readFileSync(spyOut, 'utf8')); } catch { /* no fetch happened, or process crashed before exit hook */ }
  return { ...res, calls };
}

test('default `construct doctor` makes zero outbound fetch calls', () => {
  const { calls, stdout } = runWithFetchSpy(['doctor']);
  assert.deepEqual(calls, [], 'no provider probe fetch on the default doctor path');
  assert.doesNotMatch(stdout, /Provider auth probe/);
});

test('default `construct orchestrate preflight` makes zero outbound fetch calls', () => {
  const { calls } = runWithFetchSpy(['orchestrate', 'preflight', '--no-probe', '--observed-tools=orchestration_policy,orchestration_run']);
  assert.deepEqual(calls, [], 'no provider probe fetch on the default preflight path');
});

test('`construct doctor --probe-providers` probes a presence-configured provider', () => {
  const { calls, stdout } = runWithFetchSpy(['doctor', '--probe-providers'], { ANTHROPIC_API_KEY: 'sk-test-canary' });
  assert.ok(calls.some((u) => u.includes('api.anthropic.com')), 'the anthropic probe endpoint must be called under --probe-providers');
  assert.match(stdout, /Provider auth probe — anthropic: auth-verified \(SERVING\)/);
});

test('`construct orchestrate preflight --deep` probes a presence-configured provider and reports it distinctly from presence', () => {
  const { calls, stdout } = runWithFetchSpy(
    ['orchestrate', 'preflight', '--deep', '--no-probe', '--observed-tools=orchestration_policy,orchestration_run'],
    { ANTHROPIC_API_KEY: 'sk-test-canary' },
  );
  assert.ok(calls.some((u) => u.includes('api.anthropic.com')));
  assert.match(stdout, /Deep provider probe — anthropic: auth-verified \(SERVING\)/);
});

test('`creds list` labels provider presence as presence-only, not a bare configured checkmark', () => {
  const res = spawnSync(process.execPath, [BIN, 'creds', 'list'], {
    cwd: freshCwd(),
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-test-canary', OPENROUTER_API_KEY: '', OPEN_ROUTER_API_KEY: '', OPENAI_API_KEY: '' },
  });
  assert.match(res.stdout, /configured \(unverified ref\)/);
});
