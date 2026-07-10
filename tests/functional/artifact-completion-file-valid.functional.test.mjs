/**
 * tests/functional/artifact-completion-file-valid.functional.test.mjs — export is not completion
 * (construct-d1r7.12).
 *
 * A standard document workflow advances to file-valid only when the exported file clears integrity,
 * content roundtrip, and reference resolution — not merely by emitting bytes. These exercise the real
 * workflow + validators against a lenient artifact type (`changelog`) so the release gate does not
 * gate the export itself: a clean export reaches file-valid and completes; a broken local reference
 * exports but holds at exported, and the failure output names the missing state and format.
 *
 * Engine-dependent legs (Pandoc for html/docx) assert the contract either way — file-valid on a real
 * export, or a completion gap naming the format — so the run is meaningful on any runner.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runArtifactWorkflow, evaluateFormatCompletion } from '../../lib/artifact-workflow.mjs';
import { validateExportedDocument } from '../../lib/export-validate.mjs';
import { makeEvidence } from '../../lib/artifact-completion.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmTmpDir(dir); });

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-'));
  tmpDirs.push(dir);
  return dir;
}

const CHANGELOG = `---
title: Release Notes
owner: ops
date: 2026-07-08
---

# Release Notes

**Owner:** ops
**Date:** 2026-07-08

## Unreleased

We shipped the export validation pipeline and the certified document matrix this cycle. Every change is recorded with enough context that a reader can trace it back to the work that produced it.

## 1.5.0

Initial release of the document export adapters and the asset preservation pipeline.
`;

function runExport(dir, source, format, ext) {
  const src = path.join(dir, 'changelog.md');
  fs.writeFileSync(src, source);
  return runArtifactWorkflow(
    { input: `Export this changelog as ${format}.`, artifactType: 'changelog', sourcePath: src, outputPath: path.join(dir, `out.${ext}`), approvalMode: 'allow-durable-write' },
    { rootDir: REPO, cwd: dir },
  );
}

test('a clean standard export reaches file-valid, not merely exported', () => {
  const report = runExport(tmpDir(), CHANGELOG, 'html', 'html');
  if (report.status === 'completed-local-steps') {
    assert.equal(report.completionState, 'file-valid', 'a clean export must record file-valid evidence');
    const entry = report.completionByFormat.find((c) => c.format === 'html');
    assert.deepEqual(entry.missing, []);
    assert.equal(entry.met, true);
    assert.ok(report.completion.some((e) => e.state === 'file-valid' && !e.degradation && e.proof?.format === 'html'), 'ledger records per-format file-valid evidence');
  } else {
    assert.equal(report.status, 'completion-incomplete');
    assert.match(report.completionGaps.join(' '), /html/);
  }
});

test('export alone cannot complete a standard doc: a broken reference holds at exported', () => {
  const broken = `${CHANGELOG}\n## Screenshot\n\n![missing asset](./nope.png)\n`;
  const report = runExport(tmpDir(), broken, 'html', 'html');
  assert.equal(report.status, 'completion-incomplete');
  assert.equal(report.completionState, 'exported', 'a failed validity check must not advance past exported');
  assert.deepEqual(report.completionGaps, ['html: missing file-valid']);
  const entry = report.completionByFormat.find((c) => c.format === 'html');
  assert.deepEqual(entry.missing, ['file-valid']);
});

test('multi-format: each requested format is completed independently', () => {
  const dir = tmpDir();
  for (const [format, ext] of [['html', 'html'], ['docx', 'docx']]) {
    const report = runExport(dir, CHANGELOG, format, ext);
    const acceptable = report.status === 'completed-local-steps' || report.status === 'completion-incomplete';
    assert.ok(acceptable, `${format}: unexpected status ${report.status}`);
    if (report.status === 'completed-local-steps') {
      assert.equal(report.completionByFormat.find((c) => c.format === format)?.met, true);
    }
  }
});

test('the workflow completion ledger stays deterministic across identical runs', () => {
  const dir = tmpDir();
  const first = runExport(dir, CHANGELOG, 'html', 'html');
  const second = runExport(dir, CHANGELOG, 'html', 'html');
  assert.deepEqual(first.completionByFormat, second.completionByFormat);
  assert.equal(first.completionState, second.completionState);
});

test('the completion gate names the exact missing state and only enforces locally-producible states', () => {
  const contract = { qualityContract: { requiredStates: ['exported', 'file-valid', 'renderable'] } };
  const exportedOnly = [makeEvidence('exported', { actor: 'x', proof: { format: 'pdf' } })];
  const onlyExported = evaluateFormatCompletion(exportedOnly, 'pdf', contract);
  assert.deepEqual(onlyExported.missing, ['file-valid'], 'export-only must report file-valid missing');
  assert.deepEqual(onlyExported.pending, ['renderable'], 'renderable is host-owed, reported pending not missing');
  assert.equal(onlyExported.met, false);

  const validated = [...exportedOnly, makeEvidence('file-valid', { actor: 'x', proof: { format: 'pdf' } })];
  const done = evaluateFormatCompletion(validated, 'pdf', contract);
  assert.deepEqual(done.missing, []);
  assert.equal(done.met, true);

  const degraded = [makeEvidence('exported', { actor: 'x', proof: { format: 'pdf' } }), makeEvidence('file-valid', { actor: 'x', proof: { format: 'pdf' }, degradation: 'missing-dependency' })];
  assert.equal(evaluateFormatCompletion(degraded, 'pdf', contract).met, false, 'a degraded file-valid entry does not satisfy the gate');
});

test('validateExportedDocument fails a broken reference and degrades on a missing tool', () => {
  const dir = tmpDir();
  const src = path.join(dir, 'src.md');
  fs.writeFileSync(src, `# Doc\n\n## Overview\n\nBody with a reference.\n\n![x](./missing.png)\n`);
  const html = path.join(dir, 'ok.html');
  fs.writeFileSync(html, '<article><section><h1>Doc</h1><p>Body</p></section></article>');

  const broken = validateExportedDocument({ outputPath: html, format: 'html', sourceMarkdown: fs.readFileSync(src, 'utf8'), baseDir: dir });
  assert.equal(broken.hardFail, true, 'a missing local reference is a hard failure');
  assert.equal(broken.fileValid, false);

  const pdf = path.join(dir, 'x.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n');
  const degraded = validateExportedDocument({ outputPath: pdf, format: 'pdf', sourceMarkdown: '# T\n', baseDir: dir, env: { ...process.env, PATH: '' } });
  assert.equal(degraded.fileValid, false, 'a missing validator tool must not certify file-valid');
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.degradation, 'missing-dependency');
});
