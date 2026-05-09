/**
 * tests/hook-log.test.mjs — tests for the centralized hook failure logger.
 *
 * Verifies that logHookFailure writes structured JSONL, never throws, and
 * tolerates write-side failures gracefully. The HOME env is overridden so
 * tests don't pollute the real ~/.cx directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after, beforeEach } from 'node:test';

let tmpHome;
let originalHome;
let logHookFailure;

before(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-hook-log-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  const mod = await import('../lib/hooks/_lib/log.mjs');
  logHookFailure = mod.logHookFailure;
});

after(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  const logPath = path.join(tmpHome, '.cx', 'hook-failures.jsonl');
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
});

describe('logHookFailure', () => {
  it('writes a JSONL entry with hook id, phase, and message', () => {
    logHookFailure({ hook: 'test-hook', err: new Error('boom'), phase: 'parse' });
    const content = fs.readFileSync(path.join(tmpHome, '.cx', 'hook-failures.jsonl'), 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.hook, 'test-hook');
    assert.equal(entry.phase, 'parse');
    assert.equal(entry.message, 'boom');
    assert.ok(entry.ts);
    assert.ok(entry.pid);
  });

  it('accepts a string error', () => {
    logHookFailure({ hook: 'a', err: 'something broke' });
    const content = fs.readFileSync(path.join(tmpHome, '.cx', 'hook-failures.jsonl'), 'utf8');
    const entry = JSON.parse(content.trim());
    assert.equal(entry.message, 'something broke');
    assert.equal(entry.stack, null);
  });

  it('truncates long string fields in input', () => {
    logHookFailure({ hook: 'a', err: 'e', input: { command: 'a'.repeat(500) } });
    const entry = JSON.parse(fs.readFileSync(path.join(tmpHome, '.cx', 'hook-failures.jsonl'), 'utf8').trim());
    assert.ok(entry.input.command.length <= 201);
    assert.match(entry.input.command, /…$/);
  });

  it('summarizes arrays and objects in input rather than embedding them', () => {
    logHookFailure({
      hook: 'a',
      err: 'e',
      input: { args: ['a', 'b', 'c'], nested: { foo: 1 } },
    });
    const entry = JSON.parse(fs.readFileSync(path.join(tmpHome, '.cx', 'hook-failures.jsonl'), 'utf8').trim());
    assert.equal(entry.input.args, '[3 items]');
    assert.equal(entry.input.nested, '[object]');
  });

  it('never throws even when given malformed input', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    assert.doesNotThrow(() => logHookFailure({ hook: 'a', err: 'e', input: cyclic }));
  });
});
