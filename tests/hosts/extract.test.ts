/**
 * tests/hosts/extract.test.ts — the executing half of the extraction ladder:
 * the probe is the admission gate for Docling, native text reads through the
 * sync rung, and everything unrunnable is a typed refusal carrying the
 * ladder's own remediation — never garbage bytes passed on as prose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeDocling, readSource } from '../../src/hosts/extract.ts';
import type { CommandRunner } from '../../src/hosts/extract.ts';

const answering =
  (status: number | null, stdout = '', stderr = ''): CommandRunner =>
  () => ({ status, stdout, stderr });

test('the probe records the version a present docling reports', () => {
  const probe = probeDocling(answering(0, 'Docling version: 2.5.1\n'));
  assert.equal(probe.available, true);
  assert.equal(probe.version, 'Docling version: 2.5.1');
  assert.match(probe.detail, /responded/);
});

test('a missing binary is an unavailable probe with its evidence, not a throw', () => {
  const probe = probeDocling(answering(null, '', 'ENOENT'));
  assert.equal(probe.available, false);
  assert.equal(probe.version, null);
  assert.match(probe.detail, /not found/);
});

test('native text extracts through the sync rung without any subprocess', () => {
  const result = readSource('/notes/meeting.md', {
    readFile: () => '# hello\n',
    run: () => {
      throw new Error('no subprocess may run for native text');
    },
  });
  assert.ok(result.ok);
  assert.equal(result.text, '# hello\n');
  assert.equal(result.tier, 'native-structured');
});

test('a docling-gated format with a failed probe is refused with the remediation stated', () => {
  const result = readSource('/inbox/report.docx', {
    docling: { available: false, version: null, detail: 'docling not found on PATH' },
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.remediation, 'the ladder names what would make it readable');
  assert.match(!result.ok ? (result.remediation ?? '') : '', /docling/i);
});

test('a probed-available docling runs the planned rung and its markdown is the text', () => {
  const result = readSource('/inbox/report.docx', {
    docling: { available: true, version: '2.5.1', detail: 'docling responded' },
    run: answering(0, '# Report\n\nbody\n'),
  });
  assert.ok(result.ok);
  assert.equal(result.method, 'docling');
  assert.match(result.ok ? result.text : '', /# Report/);
});

test('an unsupported extension is refused with the ladder’s conversion advice', () => {
  const result = readSource('/inbox/archive.tar.gz', {});
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /Unsupported/i);
});
