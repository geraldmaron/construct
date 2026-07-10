/**
 * tests/hooks/graph-impact-advisory.test.mjs — advisory PostToolUse hook behavior.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..');
const HOOK = path.join(ROOT, 'lib', 'hooks', 'graph-impact-advisory.mjs');

function runHook({ filePath = '', cwd = ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: '',
    cwd,
    env: {
      ...process.env,
      TOOL_INPUT_FILE_PATH: filePath,
      CLAUDE_PROJECT_DIR: cwd,
      ...env,
    },
    timeout: 10000,
  });
}

describe('graph-impact-advisory hook', () => {
  it('exits clean for non-code paths', () => {
    const r = runHook({ filePath: path.join(ROOT, 'README.md') });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  it('advises when graph is absent on lib edits', (t) => {
    const emptyRoot = mkdtempSync(path.join(tmpdir(), 'construct-graph-hook-'));
    t.after(() => rmTmpDir(emptyRoot));
    const relFile = 'lib/example.mjs';
    const r = runHook({ filePath: path.join(emptyRoot, relFile), cwd: emptyRoot });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /no \.construct\/graph\/ present/);
  });
});
