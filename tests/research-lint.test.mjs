/**
 * tests/research-lint.test.mjs — tests for lib/research-lint.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { formatResearchLintResults, lintResearchFile, lintResearchRepo } from '../lib/research-lint.mjs';

function makeTempFile(relPath, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-rlint-'));
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return { dir, full };
}

test('lintResearchFile flags missing required sections in research briefs', () => {
  const { dir, full } = makeTempFile('.cx/research/example.md', [
    '# Research Brief: Example',
    '',
    '- **Date**: 2026-04-21',
    '- **Author**: Construct',
    '',
    '## Question',
    'What is true?',
    '',
    '## Sources',
    'https://example.com',
  ].join('\n'));

  const result = lintResearchFile(full, { rootDir: dir });
  assert.ok(result.errors.some((entry) => entry.label.includes('missing required section: Method')));
  assert.ok(result.errors.some((entry) => entry.label.includes('missing confidence')));
});

test('lintResearchFile passes a minimally structured research brief', () => {
  const { dir, full } = makeTempFile('.cx/research/example.md', [
    '# Research Brief: Example',
    '',
    '- **Date**: 2026-04-21',
    '- **Author**: Construct',
    '- **Status**: complete',
    '',
    '## Question',
    'Which source is authoritative?',
    '',
    '## Method',
    'Checked .cx/research/, docs/, and https://example.com/docs on 2026-04-21.',
    '',
    '## Sources',
    '- internal: docs/README.md',
    '- primary: https://example.com/docs (access date 2026-04-21)',
    '',
    '## Findings',
    'Observation: the official docs are current. Inference: they should be treated as authoritative.',
    '',
    '## Confidence',
    'High confidence because the primary source is current and explicit.',
    '',
    '## References',
    '- https://example.com/docs',
  ].join('\n'));

  const result = lintResearchFile(full, { rootDir: dir });
  assert.equal(result.errors.length, 0);
});

test('lintResearchRepo scans evidence and signal briefs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-rlint-repo-'));
  fs.mkdirSync(path.join(dir, '.cx', 'knowledge', 'reference', 'evidence-briefs'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cx', 'knowledge', 'external', 'signals'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cx', 'knowledge', 'reference', 'evidence-briefs', 'brief.md'), [
    '# Evidence Brief: Example',
    '',
    '- **Date**: 2026-04-21',
    '- **Owner**: Construct',
    '',
    '## Decision this evidence informs',
    'A decision.',
    '',
    '## Evidence threshold',
    'Two independent sources.',
    '',
    '## Sources',
    '| source | source class | date | confidence |',
    '|---|---|---|---|',
    '| docs/README.md | internal | 2026-04-21 | high |',
    '',
    '## What we observed',
    'Observation: a thing happened.',
    '',
    '## Confidence',
    'High confidence.',
    '',
    '## Recommendation',
    'Proceed.',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '.cx', 'knowledge', 'external', 'signals', 'signal.md'), '# Signal Brief: weak\n');

  const results = lintResearchRepo({ rootDir: dir });
  assert.equal(results.length, 1);
  assert.match(results[0].path, /\.cx\/knowledge\/external\/signals\/signal\.md$/);
});

test('formatResearchLintResults returns non-zero exit for errors', () => {
  const { exitCode } = formatResearchLintResults([
    { path: '.cx/research/x.md', errors: [{ line: 1, label: 'missing required section' }], warnings: [] },
  ]);
  assert.equal(exitCode, 1);
});
