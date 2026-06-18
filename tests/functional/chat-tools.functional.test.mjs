/**
 * tests/functional/chat-tools.functional.test.mjs — the owned loop's tool
 * primitives and permission/sandbox gate, exercised in an isolated tmpdir.
 *
 * These are the side-effecting primitives the loop calls (read/write/edit/glob/
 * grep/shell); this test runs the real executors against real files with no model
 * or SDK, asserting both the happy path and the safety invariants ADR-0041 owns:
 * paths stay inside the workspace unless danger-full-access is granted, edits
 * refuse a non-unique target, and the gate blocks mutating tools under a read-only
 * sandbox while always allowing read-only tools.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readFileTool, writeFileTool, editFileTool, globTool, grepTool, shellTool,
} from '../../apps/chat/engine/tools/primitives.mjs';
import { createPermissionGate } from '../../apps/chat/engine/tools/permission.mjs';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-tools-'));
  return dir;
}

test('write/read/edit round-trip inside the workspace', () => {
  const cwd = tmp();
  try {
    assert.equal(writeFileTool({ cwd, path: 'src/a.txt', content: 'hello world' }).ok, true);
    const read = readFileTool({ cwd, path: 'src/a.txt' });
    assert.equal(read.content, 'hello world');

    const edit = editFileTool({ cwd, path: 'src/a.txt', oldString: 'world', newString: 'construct' });
    assert.equal(edit.replacements, 1);
    assert.equal(readFileTool({ cwd, path: 'src/a.txt' }).content, 'hello construct');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('edit refuses a non-unique oldString unless replaceAll', () => {
  const cwd = tmp();
  try {
    writeFileTool({ cwd, path: 'a.txt', content: 'x x x' });
    const refused = editFileTool({ cwd, path: 'a.txt', oldString: 'x', newString: 'y' });
    assert.equal(refused.ok, false);
    const all = editFileTool({ cwd, path: 'a.txt', oldString: 'x', newString: 'y', replaceAll: true });
    assert.equal(all.replacements, 3);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('path traversal outside the workspace is refused', () => {
  const cwd = tmp();
  try {
    assert.throws(() => readFileTool({ cwd, path: '../../../etc/hosts' }), /outside the workspace/);
    // danger-full-access opts out of the guard
    const out = readFileTool({ cwd, path: '../../../etc/hostname', allowOutside: true });
    assert.equal(typeof out.ok, 'boolean');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('glob and grep find files and matching lines', () => {
  const cwd = tmp();
  try {
    writeFileTool({ cwd, path: 'src/one.mjs', content: 'export const TOKEN = 1;\nconst other = 2;' });
    writeFileTool({ cwd, path: 'src/two.mjs', content: 'const plain = 3;' });
    writeFileTool({ cwd, path: 'readme.md', content: '# docs' });

    const glob = globTool({ cwd, pattern: 'src/*.mjs' });
    assert.deepEqual(glob.matches.sort(), ['src/one.mjs', 'src/two.mjs']);

    const grep = grepTool({ cwd, pattern: 'TOKEN', glob: '**/*.mjs' });
    assert.equal(grep.matches.length, 1);
    assert.equal(grep.matches[0].file, 'src/one.mjs');
    assert.equal(grep.matches[0].line, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('shell runs a bounded command and captures stdout', async () => {
  const cwd = tmp();
  try {
    const result = await shellTool({ cwd, command: 'echo construct-ok' });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /construct-ok/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('permission gate: read-only sandbox blocks mutating tools, allows reads', async () => {
  const gate = createPermissionGate({ getSandbox: () => 'read-only', getPermissionMode: () => 'allow_once' });
  assert.equal((await gate.check('read', {})).allowed, true);
  const write = await gate.check('write', {});
  assert.equal(write.allowed, false);
  assert.match(write.reason, /read-only/);
});

test('permission gate: ask mode defers to the handler and allow_always sticks', async () => {
  let calls = 0;
  const gate = createPermissionGate({
    getSandbox: () => 'workspace-write',
    getPermissionMode: () => 'ask',
    requestPermission: async () => { calls += 1; return 'allow_always'; },
  });
  assert.equal((await gate.check('write', {})).allowed, true);
  assert.equal((await gate.check('edit', {})).allowed, true);
  assert.equal(calls, 1, 'allow_always is sticky for the rest of the session');
});

test('permission gate: danger-full-access grants allowOutside', async () => {
  const gate = createPermissionGate({ getSandbox: () => 'danger-full-access', getPermissionMode: () => 'allow_once' });
  const verdict = await gate.check('shell', {});
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.allowOutside, true);
});
