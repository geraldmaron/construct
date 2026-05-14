/**
 * tests/telemetry-intent-verifications.test.mjs — pin the verifier log shape.
 *
 * The offline tuning pipeline reads this log to find keyword/LLM
 * disagreements. The schema is load-bearing for that pipeline; pin every
 * field. Errors here must be silent so the routing path is never broken
 * by a bad log dir.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { logIntentVerification, summarizeIntentVerifications } from '../lib/telemetry/intent-verifications.mjs';

let tmpDir;
let logPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intent-log-'));
  logPath = path.join(tmpDir, 'intent-verifications.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('logIntentVerification', () => {
  it('writes the full schema needed for offline disagreement analysis', () => {
    logIntentVerification({
      request: 'design the platform infrastructure',
      specialist: 'cx-architect',
      flavor: 'platform',
      keywordVerdict: true,
      llmVerdict: true,
      agreed: true,
      confidence: 0.92,
      reason: 'core infra design',
      source: 'llm',
      latencyMs: 412,
    }, { logPath });

    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(entry.specialist, 'cx-architect');
    assert.equal(entry.flavor, 'platform');
    assert.equal(entry.keywordVerdict, true);
    assert.equal(entry.llmVerdict, true);
    assert.equal(entry.agreed, true);
    assert.equal(entry.confidence, 0.92);
    assert.equal(entry.source, 'llm');
    assert.equal(entry.latencyMs, 412);
    assert.equal(entry.requestExcerpt, 'design the platform infrastructure');
    assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('truncates the request excerpt to 200 chars to keep the log compact', () => {
    const long = 'x'.repeat(500);
    logIntentVerification({ request: long, specialist: 'cx-x', flavor: 'y' }, { logPath });
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(entry.requestExcerpt.length, 200);
  });

  it('truncates reason to 240 chars (matches verifyIntent contract)', () => {
    const long = 'r'.repeat(500);
    logIntentVerification({ request: 'a', specialist: 'cx-x', flavor: 'y', reason: long }, { logPath });
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(entry.reason.length, 240);
  });

  it('infers agreed from keyword + llm verdicts when not supplied', () => {
    logIntentVerification({ request: 'a', specialist: 'cx-x', flavor: 'y', keywordVerdict: true, llmVerdict: false }, { logPath });
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(entry.agreed, false);
  });

  it('never throws on unwritable log paths', () => {
    assert.doesNotThrow(() =>
      logIntentVerification(
        { request: 'a', specialist: 'cx-x', flavor: 'y' },
        { logPath: '/dev/null/intent.jsonl' },
      ),
    );
  });

  it('drops null events', () => {
    logIntentVerification(null, { logPath });
    assert.equal(fs.existsSync(logPath), false);
  });
});

describe('summarizeIntentVerifications', () => {
  it('rolls up agreement stats per (specialist, flavor)', () => {
    for (const verdict of [true, true, false]) {
      logIntentVerification({
        request: 'r', specialist: 'cx-architect', flavor: 'platform',
        keywordVerdict: true, llmVerdict: verdict, agreed: verdict,
        confidence: 0.9, source: 'llm', latencyMs: 100,
      }, { logPath });
    }
    const summary = summarizeIntentVerifications({ logPath });
    assert.equal(summary.totalEvents, 3);
    const slot = summary.byFlavor['cx-architect/platform'];
    assert.equal(slot.matches, 3);
    assert.equal(slot.agreed, 2);
    assert.equal(slot.disagreed, 1);
  });

  it('returns empty when no log exists', () => {
    const summary = summarizeIntentVerifications({ logPath: path.join(tmpDir, 'missing.jsonl') });
    assert.deepEqual(summary, { totalEvents: 0, byFlavor: {} });
  });
});
