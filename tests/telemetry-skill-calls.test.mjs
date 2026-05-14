/**
 * tests/telemetry-skill-calls.test.mjs — pin the skill-call telemetry contract.
 *
 * The audit pipeline depends on every load writing exactly one JSONL line
 * with a stable shape. Disable kill switch is honored; bad input is dropped
 * silently; the summarize helper aggregates calls + sources + last-called.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { logSkillCall, summarizeSkillCalls } from '../lib/telemetry/skill-calls.mjs';

let tmpDir;
let logPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-skill-calls-'));
  logPath = path.join(tmpDir, 'skill-calls.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('logSkillCall', () => {
  it('writes one JSONL line per call with skillId, source, ts', () => {
    logSkillCall({ skillId: 'roles/engineer', source: 'mcp' }, { logPath, env: {} });
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.skillId, 'roles/engineer');
    assert.equal(entry.source, 'mcp');
    assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes callerContext when provided', () => {
    logSkillCall(
      { skillId: 'roles/architect.security', source: 'prompt-composer', callerContext: 'cx-architect' },
      { logPath, env: {} },
    );
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(entry.callerContext, 'cx-architect');
  });

  it('appends across multiple calls (concurrent-safe shape)', () => {
    logSkillCall({ skillId: 'a', source: 'mcp' }, { logPath, env: {} });
    logSkillCall({ skillId: 'b', source: 'role-preload' }, { logPath, env: {} });
    logSkillCall({ skillId: 'a', source: 'mcp' }, { logPath, env: {} });
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 3, 'append-only, no overwrite');
  });

  it('honors CONSTRUCT_SKILL_TELEMETRY=off kill switch', () => {
    logSkillCall({ skillId: 'roles/engineer', source: 'mcp' }, { logPath, env: { CONSTRUCT_SKILL_TELEMETRY: 'off' } });
    assert.equal(fs.existsSync(logPath), false, 'kill switch prevents file creation');
  });

  it('drops malformed events silently (no skillId, no source)', () => {
    logSkillCall(null, { logPath, env: {} });
    logSkillCall({}, { logPath, env: {} });
    logSkillCall({ skillId: 'x' }, { logPath, env: {} });
    logSkillCall({ source: 'mcp' }, { logPath, env: {} });
    assert.equal(fs.existsSync(logPath), false, 'no file written for invalid events');
  });

  it('creates parent directory if missing', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c', 'skill-calls.jsonl');
    logSkillCall({ skillId: 'x', source: 'mcp' }, { logPath: nested, env: {} });
    assert.equal(fs.existsSync(nested), true);
  });

  it('never throws on unwritable log path', () => {
    assert.doesNotThrow(() =>
      logSkillCall({ skillId: 'x', source: 'mcp' }, { logPath: '/dev/null/skill-calls.jsonl', env: {} }),
    );
  });
});

describe('summarizeSkillCalls', () => {
  it('aggregates calls, distinct sources, and last-called timestamp per skill', () => {
    const t0 = new Date(Date.now() - 1000).toISOString();
    const t1 = new Date().toISOString();
    fs.writeFileSync(logPath, [
      JSON.stringify({ ts: t0, skillId: 'roles/engineer', source: 'mcp' }),
      JSON.stringify({ ts: t1, skillId: 'roles/engineer', source: 'prompt-composer', callerContext: 'cx-engineer' }),
      JSON.stringify({ ts: t0, skillId: 'roles/architect', source: 'mcp' }),
    ].join('\n') + '\n');

    const summary = summarizeSkillCalls({ logPath });
    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.skills['roles/engineer'].calls, 2);
    assert.deepEqual(summary.skills['roles/engineer'].sources, ['mcp', 'prompt-composer']);
    assert.equal(summary.skills['roles/engineer'].lastCalledAt, t1);
    assert.equal(summary.skills['roles/architect'].calls, 1);
  });

  it('returns empty result when log does not exist', () => {
    const summary = summarizeSkillCalls({ logPath: path.join(tmpDir, 'never-written.jsonl') });
    assert.deepEqual(summary, { totalEvents: 0, skills: {} });
  });

  it('skips malformed lines without throwing', () => {
    fs.writeFileSync(logPath, [
      JSON.stringify({ ts: '2026-01-01T00:00:00Z', skillId: 'x', source: 'mcp' }),
      'not-json',
      JSON.stringify({ noSkillIdHere: true }),
    ].join('\n') + '\n');
    const summary = summarizeSkillCalls({ logPath });
    assert.equal(summary.totalEvents, 3, 'counts raw lines');
    assert.equal(Object.keys(summary.skills).length, 1, 'only the one valid entry aggregates');
  });
});
