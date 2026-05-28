/**
 * tests/extractors/drop-info.test.mjs — tests for the shared drop-info factory.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeDropInfo, makeEnvelope } from '../../lib/extractors/shared/drop-info.mjs';

describe('makeDropInfo', () => {
  it('creates a drop-info object with required fields', () => {
    const d = makeDropInfo({ kind: 'table', count: 3, reason: 'flattened', recoverable: true });
    assert.equal(d.kind, 'table');
    assert.equal(d.count, 3);
    assert.equal(d.reason, 'flattened');
    assert.equal(d.recoverable, true);
  });

  it('defaults recoverable to false', () => {
    const d = makeDropInfo({ kind: 'animation', count: 1, reason: 'not preserved' });
    assert.equal(d.recoverable, false);
  });
});

describe('makeEnvelope', () => {
  it('creates an envelope with defaults', () => {
    const e = makeEnvelope({ text: 'hello' });
    assert.equal(e.text, 'hello');
    assert.equal(e.structured, null);
    assert.deepEqual(e.droppedInfo, []);
  });

  it('passes through structured and droppedInfo', () => {
    const structured = { format: 'webvtt', cues: [], speakers: [] };
    const droppedInfo = [makeDropInfo({ kind: 'comment', count: 2, reason: 'notes stripped' })];
    const e = makeEnvelope({ text: 'x', structured, droppedInfo });
    assert.deepEqual(e.structured, structured);
    assert.equal(e.droppedInfo.length, 1);
    assert.equal(e.droppedInfo[0].kind, 'comment');
  });

  it('defaults text to empty string', () => {
    const e = makeEnvelope();
    assert.equal(e.text, '');
  });
});
