/**
 * tests/functional/host-capability-matrix.functional.test.mjs
 *
 * Characterization tests for the host-parity-gate (self-audit construct-rr63.4.1). These PIN the
 * current `checkParity()` behavior so the file-parity-vs-capability-parity gap is a tested fact:
 * today a host is judged by config-file presence and content, never by whether it is installed or
 * able to call its MCP servers, and the result carries no capability dimension at all. When the
 * Wave-4 implementation adds capability reporting (`callable`, `degradationReason`, an `expectedTier`
 * per host), these assertions are updated deliberately — they are the gate that makes that change
 * visible rather than silent. Contract: synthesis/host-capability-matrix.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkParity } from '../../lib/parity.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const CAPABILITY_FIELDS = ['callable', 'reachable', 'discoverable', 'degradationReason', 'installed'];

const homes = [];
function emptyHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-host-cap-'));
  homes.push(dir);
  return dir;
}
test.after(() => { for (const d of homes) { try { rmTmpDir(d); } catch {} } });

test('a fleet of entirely absent hosts still passes parity (not-installed reads as healthy)', () => {
  const r = checkParity({ homeDir: emptyHome() });
  assert.equal(r.ok, true, 'parity is ok when every host is merely absent');
  assert.ok(r.surfaces.every((s) => s.status === 'absent'), 'every surface is absent with an empty home');
  assert.ok(r.summary.every((line) => /: not installed$/.test(line)), 'absent is summarized as "not installed"');
});

test('the parity result carries no capability dimension today', () => {
  const r = checkParity({ homeDir: emptyHome() });
  assert.deepEqual(Object.keys(r).sort(), ['ok', 'summary', 'surfaces'], 'no capabilityMatrix at the top level');
  for (const s of r.surfaces) {
    for (const field of CAPABILITY_FIELDS) {
      assert.ok(!(field in s), `surface ${s.surface} must not yet expose capability field "${field}"`);
    }
  }
});

test('writing a config file flips the verdict by file content alone, with no callability check', () => {
  const homeDir = emptyHome();
  fs.mkdirSync(path.join(homeDir, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {} }));

  const cursor = checkParity({ homeDir }).surfaces.find((s) => s.surface === 'cursor');
  assert.notEqual(cursor.status, 'absent', 'a present config file moves cursor off "absent" regardless of install state');
  assert.ok(['ok', 'drift'].includes(cursor.status), 'the new status is derived from file content (ok|drift)');
  for (const field of CAPABILITY_FIELDS) {
    assert.ok(!(field in cursor), `cursor verdict still proves file content, not capability ("${field}" absent)`);
  }
});
