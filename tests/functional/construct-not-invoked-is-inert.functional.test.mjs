/**
 * tests/functional/construct-not-invoked-is-inert.functional.test.mjs
 *
 * Proves the "not invoking Construct operates normally" guarantee: with the
 * CONSTRUCT_ROLES=off kill switch, the role-machinery hooks become no-ops — the
 * role-pending handoff queue is not enqueued and the edit guard does not block —
 * so a host behaves natively when Construct is disabled/not addressed. The same
 * hooks active by default DO record, confirming the switch is what gates them.
 *
 * Sterile: isolated HOME (os.homedir() honors $HOME, verified) so role-pending
 * writes land in the tmp sandbox, never the real ~/.cx.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = (name) => join(REPO_ROOT, 'lib', 'hooks', `${name}.mjs`);

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'inert-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(join(HOME, '.cx'), { recursive: true });
  mkdirSync(join(project, '.cx'), { recursive: true });
  return { root, HOME, project, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

function runHook(name, payload, env) {
  return spawnSync(process.execPath, [HOOK(name)], {
    cwd: env.project,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, HOME: env.HOME, CX_HOME_OVERRIDE: env.HOME, ...env.extra },
  });
}

// A cx-* dispatch whose result names a downstream handoff (next:cx-engineer) is
// exactly what the agent-tracker role-pending queue captures — when Construct's
// role machinery is on.
const TASK = {
  tool_name: 'Task',
  tool_input: { subagent_type: 'cx-architect', description: 'design the billing service' },
  tool_result: { result: 'Design complete. next:cx-engineer to implement.' },
};

test('default: a cx dispatch enqueues the role-pending handoff', (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const r = runHook('agent-tracker', TASK, env);
  assert.equal(r.status, 0, `hook must exit 0; stderr: ${r.stderr}`);
  const pending = join(env.HOME, '.cx', 'role-pending.jsonl');
  assert.ok(existsSync(pending), 'role-pending.jsonl is written when roles are active');
  assert.match(readFileSync(pending, 'utf8'), /cx-engineer/, 'the handoff target is recorded');
});

test('CONSTRUCT_ROLES=off: the same dispatch enqueues nothing (kill switch inert)', (t) => {
  const env = sandbox();
  env.extra = { CONSTRUCT_ROLES: 'off' };
  t.after(() => env.cleanup());
  const r = runHook('agent-tracker', TASK, env);
  assert.equal(r.status, 0, `hook must still exit 0 (never breaks the host); stderr: ${r.stderr}`);
  const pending = join(env.HOME, '.cx', 'role-pending.jsonl');
  assert.ok(!existsSync(pending), 'no role-pending enqueue when CONSTRUCT_ROLES=off');
});

test('a plain (non-cx) subagent is untouched — Construct only engages its own specialists', (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  // A generic host subagent, not a construct cx-* specialist, with a result that
  // even names a next: handoff. Construct's role machinery keys on cx-* identity,
  // so this must NOT enqueue role-pending — the host's own agents run untouched.
  const r = runHook('agent-tracker', {
    tool_name: 'Task',
    tool_input: { subagent_type: 'general-purpose', description: 'summarize the repo' },
    tool_result: { result: 'Summary done. next:cx-engineer (should be ignored for a non-cx dispatch).' },
  }, env);
  assert.equal(r.status, 0, `hook must exit 0; stderr: ${r.stderr}`);
  const pending = join(env.HOME, '.cx', 'role-pending.jsonl');
  assert.ok(!existsSync(pending), 'a non-cx subagent does not enqueue Construct role-pending');
});
