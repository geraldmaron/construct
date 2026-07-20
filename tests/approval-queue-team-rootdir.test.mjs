/**
 * tests/approval-queue-team-rootdir.test.mjs — team-mode approval queue path canonicalization.
 *
 * construct-4uxq0.14.7: CLI and daemon must address the same queue file even when
 * invoked from divergent cwds under the same project.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ApprovalQueue } from '../lib/embed/approval-queue.mjs';
import { resolveRootDir } from '../lib/project-root.mjs';

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-team-queue-'));
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(root, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(root, '.construct', 'context.md'), '# team queue test\n');
  return { root, nested };
}

test('team mode canonicalizes queue path from nested cwd', () => {
  const { root, nested } = mkProject();
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'team' };
  const wrongRoot = nested;
  const canonical = resolveRootDir(env, nested);
  assert.equal(fs.realpathSync(canonical), fs.realpathSync(root));

  const cliPath = ApprovalQueue.resolvePersistPath(wrongRoot, 'team', { env, cwd: nested, canonicalize: true });
  const daemonPath = ApprovalQueue.resolvePersistPath(root, 'team', { env, cwd: root, canonicalize: true });
  assert.equal(cliPath, daemonPath);
  assert.equal(cliPath, path.join(root, '.construct', 'approvals', 'queue.jsonl'));
});

test('solo mode ignores cwd canonicalization and uses doctor root', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-solo-queue-'));
  const env = {
    CONSTRUCT_DEPLOYMENT_MODE: 'solo',
    CONSTRUCT_HOME_OVERRIDE: home,
  };
  const p = ApprovalQueue.resolvePersistPath('/wrong/install/root', 'solo', { env, cwd: '/wrong/install/root' });
  assert.match(p, /approvals[/\\]queue\.jsonl$/);
  assert.ok(p.includes(home) || p.includes('.local'));
});
