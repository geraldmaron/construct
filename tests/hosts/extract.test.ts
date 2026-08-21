/**
 * tests/hosts/extract.test.ts — the executing half of the extraction ladder:
 * the probe is the admission gate for Docling, native text reads through the
 * sync rung, and everything unrunnable is a typed refusal carrying the
 * ladder's own remediation — never garbage bytes passed on as prose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeDocling, readSource } from '../../src/hosts/extract.ts';
import type { CommandRunner } from '../../src/hosts/extract.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(HERE, '..', '..', 'fixtures', 'extraction-ladder', 'samples');
const NO_DOCLING = { available: false, version: null, detail: 'docling not found on PATH' } as const;

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

/**
 * Per filetype, against the real minimal fixtures built by
 * scripts/build-extraction-ladder-fixtures.mjs: this is the "unreachable"
 * claim exercised through the actual bytes, not asserted from reading the
 * ladder's source. Every one of these refuses loudly — a typed `ok: false`
 * carrying the ladder's own reason and remediation — never a silent skip.
 * fixtures/extraction-ladder/runs/ holds the dated, committed record of the
 * same runs via scripts/probe-extraction-ladder.mjs.
 */
const UNREACHABLE_WITHOUT_DOCLING: readonly { readonly sample: string; readonly reasonPattern: RegExp }[] = [
  { sample: 'probe.pdf', reasonPattern: /PDF extraction requires unpdf or Docling/ },
  { sample: 'probe.docx', reasonPattern: /DOCX extraction requires mammoth or Docling/ },
  { sample: 'probe.xlsx', reasonPattern: /\.xlsx has no lightweight parser; Docling is unavailable/ },
  { sample: 'probe.pptx', reasonPattern: /\.pptx has no lightweight parser; Docling is unavailable/ },
  { sample: 'probe.png', reasonPattern: /\.png has no lightweight parser; Docling is unavailable/ },
];

for (const { sample, reasonPattern } of UNREACHABLE_WITHOUT_DOCLING) {
  test(`${sample} is refused loudly, not silently skipped, with no Docling installed`, () => {
    const result = readSource(join(SAMPLES, sample), { docling: NO_DOCLING });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, reasonPattern);
    assert.ok(result.remediation, 'a refusal without a way forward is a dead end, not an answer');
  });
}

test('probe.svg is refused with the diagram-specific reason, not the generic unsupported-type text', () => {
  const result = readSource(join(SAMPLES, 'probe.svg'), { docling: NO_DOCLING });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /diagram\/vector format/);
  assert.match(result.reason, /No rung reads it/);
  assert.doesNotMatch(result.reason, /Unsupported document type/);
});

test('a probed-available docling reaches the pptx rung too, once installed', () => {
  const result = readSource(join(SAMPLES, 'probe.pptx'), {
    docling: { available: true, version: '2.5.1', detail: 'docling responded' },
    run: () => ({ status: 0, stdout: '# probe\n', stderr: '' }),
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.method, 'docling');
  assert.match(result.text, /probe/);
});
