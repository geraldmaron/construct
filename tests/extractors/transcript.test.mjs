/**
 * tests/extractors/transcript.test.mjs — VTT, SRT, LRC, and .transcript extraction tests.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractTranscript } from '../../lib/extractors/transcript.mjs';

const TMP = join(tmpdir(), `construct-transcript-test-${Date.now()}`);

before(() => mkdirSync(TMP, { recursive: true }));
after(() => rmSync(TMP, { recursive: true, force: true }));

function write(name, content) {
  const p = join(TMP, name);
  writeFileSync(p, content);
  return p;
}

// ─── WebVTT tests ─────────────────────────────────────────────────────────────

describe('WebVTT extraction', () => {
  it('extracts cues from a basic VTT file', () => {
    const p = write('basic.vtt', [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      'Hello world',
      '',
      '00:00:04.000 --> 00:00:06.000',
      'Goodbye world',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.format, 'webvtt');
    assert.equal(result.structured.cues.length, 2);
    assert.equal(result.structured.cues[0].text, 'Hello world');
    assert.equal(result.structured.cues[0].start, 1);
    assert.equal(result.structured.cues[0].end, 3);
    assert.ok(result.text.includes('Hello world'));
    assert.deepEqual(result.droppedInfo, []);
  });

  it('extracts speaker names from voice spans', () => {
    const p = write('voice.vtt', [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      '<v Alice>Hello, this is Alice.',
      '',
      '00:00:04.000 --> 00:00:06.000',
      '<v Bob>And this is Bob.',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.deepEqual(result.structured.speakers, ['Alice', 'Bob']);
    assert.ok(result.text.includes('Alice: Hello, this is Alice.'));
    assert.ok(result.text.includes('Bob: And this is Bob.'));
  });

  it('preserves cue identifiers', () => {
    const p = write('ids.vtt', [
      'WEBVTT',
      '',
      'intro',
      '00:00:01.000 --> 00:00:03.000',
      'Introduction text',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.cues[0].identifier, 'intro');
  });

  it('preserves cue settings', () => {
    const p = write('settings.vtt', [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000 align:left',
      'Left-aligned text',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.cues[0].settings, 'align:left');
  });

  it('emits droppedInfo for NOTE blocks', () => {
    const p = write('notes.vtt', [
      'WEBVTT',
      '',
      'NOTE This is a comment',
      '',
      '00:00:01.000 --> 00:00:03.000',
      'Actual content',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.droppedInfo.length, 1);
    assert.equal(result.droppedInfo[0].kind, 'comment');
    assert.equal(result.droppedInfo[0].count, 1);
  });

  it('handles VTT without WEBVTT header gracefully', () => {
    const p = write('malformed.vtt', 'Not a VTT file\nJust text');
    const result = extractTranscript(p);
    assert.equal(result.structured, null);
    assert.equal(result.droppedInfo.length, 1);
  });
});

// ─── SRT tests ────────────────────────────────────────────────────────────────

describe('SRT extraction', () => {
  it('extracts cues from a basic SRT file', () => {
    const p = write('basic.srt', [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      'First subtitle',
      '',
      '2',
      '00:00:04,000 --> 00:00:06,000',
      'Second subtitle',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.format, 'srt');
    assert.equal(result.structured.cues.length, 2);
    assert.equal(result.structured.cues[0].text, 'First subtitle');
    assert.equal(result.structured.cues[0].start, 1);
    assert.deepEqual(result.droppedInfo, []);
  });

  it('strips HTML-like SRT tags', () => {
    const p = write('styled.srt', [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      '<b>Bold text</b>',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.cues[0].text, 'Bold text');
  });

  it('preserves sequential indices as identifiers', () => {
    const p = write('indexed.srt', [
      '42',
      '00:00:01,000 --> 00:00:03,000',
      'Line forty-two',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.cues[0].identifier, '42');
  });

  it('SRT speakers list is empty (SRT has no voice spans)', () => {
    const p = write('nospeaker.srt', [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'Hello',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.deepEqual(result.structured.speakers, []);
  });
});

// ─── LRC tests ────────────────────────────────────────────────────────────────

describe('LRC extraction', () => {
  it('extracts timestamped lines from LRC', () => {
    const p = write('lyrics.lrc', [
      '[ar:Test Artist]',
      '[ti:Test Song]',
      '',
      '[00:01.00]First line',
      '[00:03.50]Second line',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.format, 'lrc');
    assert.equal(result.structured.cues.length, 2);
    assert.equal(result.structured.cues[0].text, 'First line');
    assert.equal(result.structured.cues[0].start, 1);
    assert.equal(result.structured.meta.ar, 'Test Artist');
    assert.ok(result.text.includes('First line'));
  });
});

// ─── Plain transcript tests ───────────────────────────────────────────────────

describe('.transcript extraction', () => {
  it('detects speaker-prefixed lines', () => {
    const p = write('meeting.transcript', [
      'Alice: Hello everyone.',
      'Bob: Thanks for joining.',
      'Alice: Let\'s get started.',
    ].join('\n'));
    const result = extractTranscript(p);
    assert.equal(result.structured.format, 'transcript');
    assert.deepEqual(result.structured.speakers, ['Alice', 'Bob']);
    assert.ok(result.text.includes('Alice: Hello everyone.'));
    assert.equal(result.droppedInfo.length, 0);
  });
});
