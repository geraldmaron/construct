/**
 * chat-evidence.test.mjs — Provenance verdict regression coverage.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveEvidenceVerdict, EVIDENCE_SCHEMA_VERSION } from '../lib/chat/evidence.mjs';

const overlay = { assumptionsBlocked: true };

test('evidence requires a completed successful result, not a tool request', () => {
  const pending = [{ id: 'r1', title: 'read', status: 'pending', input: { path: 'README.md' } }];
  assert.equal(deriveEvidenceVerdict({ overlay, tools: pending, assistant: 'README.md' }).status, 'insufficient_evidence');

  const denied = [{ ...pending[0], status: 'completed', content: { ok: false, denied: true } }];
  assert.equal(deriveEvidenceVerdict({ overlay, tools: denied, assistant: 'README.md' }).status, 'insufficient_evidence');
});

test('Gemma project-summary trace is uncited until it names the successful README.md source', () => {
  const tools = [{ id: 'r1', title: 'read', status: 'completed', input: { path: 'README.md' }, content: { ok: true, content: 'x' } }];
  const uncited = deriveEvidenceVerdict({ id: 'gemma-summary', overlay, tools, assistant: 'Construct is an agent.' });
  assert.equal(uncited.status, 'uncited_evidence');
  assert.equal(uncited.schemaVersion, EVIDENCE_SCHEMA_VERSION);
  assert.equal(uncited.records[0].turnId, 'gemma-summary');
  assert.deepEqual(uncited.reasonCodes, ['evidence_not_cited']);

  const cited = deriveEvidenceVerdict({ overlay, tools, assistant: 'According to README.md, Construct is an agent.' });
  assert.equal(cited.status, 'verified');
  assert.equal(cited.records[0].sourceId, 'repo:README.md');
});

test('only concrete successful evidence sources can verify a required turn', () => {
  const failed = [{ id: 'r1', title: 'read', status: 'failed', input: { path: 'README.md' }, content: { ok: true } }];
  const unrelated = [{ id: 's1', title: 'shell', status: 'completed', input: { command: 'pwd' }, content: { ok: true } }];
  const globOnly = [{ id: 'g1', title: 'glob', status: 'completed', input: { pattern: 'docs/**/*.md' }, content: { ok: true, matches: [] } }];
  for (const tools of [failed, unrelated, globOnly]) {
    assert.equal(deriveEvidenceVerdict({ overlay, tools, assistant: 'README.md' }).status, 'insufficient_evidence');
  }

  const hidden = deriveEvidenceVerdict({
    overlay,
    tools: [{ id: 'r1', title: 'read', status: 'completed', input: { path: 'README.md' }, content: { ok: true } }],
    assistant: 'README.md',
    evidenceVisible: false,
  });
  assert.equal(hidden.status, 'insufficient_evidence');
  assert.ok(hidden.reasonCodes.includes('evidence_layer_hidden'));
});

test('multiple concrete sources with partial citations are partially verified', () => {
  const tools = [
    { id: 'r1', title: 'read', status: 'completed', input: { path: 'README.md' }, content: { ok: true } },
    { id: 'r2', title: 'grep', status: 'completed', input: { pattern: 'version', glob: 'package*.json' }, content: { ok: true, matches: [{ file: 'package.json', line: 3 }] } },
  ];
  const verdict = deriveEvidenceVerdict({ overlay, tools, assistant: 'README.md describes the project.' });
  assert.equal(verdict.status, 'partially_verified');
  assert.deepEqual(verdict.citations, ['README.md']);
  assert.deepEqual(verdict.records.map((record) => record.target), ['README.md', 'package.json']);
});
