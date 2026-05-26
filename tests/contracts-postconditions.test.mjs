/**
 * tests/contracts-postconditions.test.mjs — coverage for structured postcondition checks.
 *
 * Covers the three check kinds exposed by validatePostconditions:
 *   - artifact-has-frontmatter-field
 *   - artifact-has-section
 *   - artifact-claims-cited
 *
 * Plus integration with validateHandoff when the handoff envelope carries
 * `artifactPath` pointing to a file on disk.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validatePostconditions, validateHandoff } from '../lib/contracts/validate.mjs';

function makeArtifact(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-pc-'));
  const file = path.join(dir, 'artifact.md');
  fs.writeFileSync(file, content, 'utf8');
  return { dir, file };
}

test('artifact-has-frontmatter-field: passes when field present', () => {
  const { file } = makeArtifact('---\nintake_id: construct-foo\n---\n\n# body\n');
  const errors = validatePostconditions({
    contract: {
      postconditions: [
        { id: 'requires-intake', check: 'artifact-has-frontmatter-field', field: 'intake_id' },
      ],
    },
    artifactPath: file,
  });
  assert.deepEqual(errors, []);
});

test('artifact-has-frontmatter-field: fails when field missing', () => {
  const { file } = makeArtifact('---\ntitle: PRD\n---\n\nbody\n');
  const errors = validatePostconditions({
    contract: {
      postconditions: [
        { id: 'requires-intake', check: 'artifact-has-frontmatter-field', field: 'intake_id' },
      ],
    },
    artifactPath: file,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires-intake/);
  assert.match(errors[0], /intake_id/);
});

test('artifact-has-section: passes when section present', () => {
  const { file } = makeArtifact('# Title\n\n## Problem\n\nlorem\n\n## Rejected Alternatives\n\nfoo\n');
  const errors = validatePostconditions({
    contract: {
      postconditions: [
        { id: 'has-rejected', check: 'artifact-has-section', section: 'Rejected Alternatives' },
      ],
    },
    artifactPath: file,
  });
  assert.deepEqual(errors, []);
});

test('artifact-has-section: fails when section absent', () => {
  const { file } = makeArtifact('# Title\n\n## Problem\n\nlorem\n');
  const errors = validatePostconditions({
    contract: {
      postconditions: [
        { id: 'has-rejected', check: 'artifact-has-section', section: 'Rejected Alternatives' },
      ],
    },
    artifactPath: file,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Rejected Alternatives/);
});

test('artifact-claims-cited: passes when percentages are cited', () => {
  const { file } = makeArtifact('# Body\n\nLatency dropped 30% under load [source: bench-042].\n');
  const errors = validatePostconditions({
    contract: {
      postconditions: [
        { id: 'numeric-cited', check: 'artifact-claims-cited' },
      ],
    },
    artifactPath: file,
  });
  assert.deepEqual(errors, []);
});

test('artifact-claims-cited: fails on uncited percentages', () => {
  const { file } = makeArtifact('# Body\n\nLatency dropped 30% under load.\n');
  const errors = validatePostconditions({
    contract: {
      postconditions: [
        { id: 'numeric-cited', check: 'artifact-claims-cited' },
      ],
    },
    artifactPath: file,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /numeric-cited/);
  assert.match(errors[0], /uncited numeric claim/);
});

test('artifact-claims-cited: skips numbers in tables and code blocks', () => {
  const body = [
    '# Body',
    '',
    '| Metric | Target |',
    '|---|---|',
    '| Latency | 30% reduction |',
    '',
    '```',
    'reduction: 50%',
    '```',
    '',
    'Outside table or code: latency dropped 30% [source: foo].',
  ].join('\n');
  const { file } = makeArtifact(body);
  const errors = validatePostconditions({
    contract: {
      postconditions: [{ id: 'numeric-cited', check: 'artifact-claims-cited' }],
    },
    artifactPath: file,
  });
  assert.deepEqual(errors, []);
});

test('descriptive (string) postconditions are ignored by the validator', () => {
  const { file } = makeArtifact('# body\n');
  const errors = validatePostconditions({
    contract: {
      postconditions: [
        'PRD Problem section traces to PRD Problem, not to tickets',
        'Every functional requirement traces to observed user evidence',
      ],
    },
    artifactPath: file,
  });
  assert.deepEqual(errors, []);
});

test('validateHandoff integrates postcondition checks via artifactPath', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-pc-int-'));
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'prd'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'prd', 'fixture.md'), '# PRD\n\nbody without sections\n');
  fs.writeFileSync(path.join(root, 'agents', 'contracts.json'), JSON.stringify({
    version: 1,
    terminalStates: ['DONE'],
    severities: { blocking: [], warning: [], info: [] },
    contracts: [
      {
        id: 'test-contract',
        producer: 'cx-product-manager',
        consumer: 'cx-architect',
        input: { mustContain: [] },
        output: {},
        postconditions: [
          { id: 'has-problem', check: 'artifact-has-section', section: 'Problem' },
        ],
      },
    ],
  }, null, 2));

  const result = validateHandoff({
    producer: 'cx-product-manager',
    consumer: 'cx-architect',
    artifact: { artifactPath: 'docs/prd/fixture.md' },
    contractsPath: path.join(root, 'agents', 'contracts.json'),
    repoRoot: root,
    enforcement: 'block',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED_CONTRACT');
  assert.ok(result.errors.some((e) => e.includes('Problem')));

  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});
