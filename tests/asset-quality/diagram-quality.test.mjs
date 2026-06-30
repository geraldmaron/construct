/**
 * tests/asset-quality/diagram-quality.test.mjs — Guards diagram quality heuristics (cuxq.6.1).
 *
 * These assert quality, not syntax: each anti-diagram trips its heuristic (node density, label
 * readability, flowchart non-happy-path coverage, sequence participants), and well-formed
 * diagrams stay clean. The render path proves a diagram compiles; this proves it is legible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDiagramQuality, lintDocumentDiagrams, MAX_NODES, MAX_LABEL_CHARS } from '../../lib/diagram-quality.mjs';

function codes(result) {
  return [...new Set(result.findings.map((f) => f.code))];
}

test('a flowchart past the node limit trips node_density_high', () => {
  let src = 'flowchart LR\n';
  for (let i = 0; i < MAX_NODES + 4; i += 1) src += `  N${i} --> N${i + 1}\n`;
  const result = analyzeDiagramQuality(src, { lang: 'mermaid' });
  assert.equal(result.kind, 'flowchart');
  assert.ok(codes(result).includes('node_density_high'), JSON.stringify(result.findings));
});

test('a decision node with only the happy path trips decision_without_branches', () => {
  const src = 'flowchart TD\n  A[Start] --> D{Valid?}\n  D -->|yes| B[Proceed]\n';
  const result = analyzeDiagramQuality(src, { lang: 'mermaid' });
  assert.ok(codes(result).includes('decision_without_branches'), JSON.stringify(result.findings));
});

test('a decision with yes and no branches stays clean', () => {
  const src = 'flowchart TD\n  A[Start] --> D{Valid?}\n  D -->|yes| B[Proceed]\n  D -->|no| C[Reject]\n';
  const result = analyzeDiagramQuality(src, { lang: 'mermaid' });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('an over-long node label trips label_too_long', () => {
  const long = 'x'.repeat(MAX_LABEL_CHARS + 5);
  const src = `flowchart LR\n  A[${long}] --> B[ok]\n  A --> C[no]\n`;
  const result = analyzeDiagramQuality(src, { lang: 'mermaid' });
  assert.ok(codes(result).includes('label_too_long'), JSON.stringify(result.findings));
});

test('unlabeled edges are idiomatic and never flagged (dependency/data-flow graphs)', () => {
  const src = 'flowchart LR\n  A --> B\n  B --> C\n  C --> D\n  D --> E\n';
  const result = analyzeDiagramQuality(src, { lang: 'mermaid' });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('a single-participant sequence trips sequence_too_few_participants', () => {
  const src = 'sequenceDiagram\n  participant A\n  A->>A: self call\n';
  const result = analyzeDiagramQuality(src, { lang: 'mermaid' });
  assert.equal(result.kind, 'sequence');
  assert.ok(codes(result).includes('sequence_too_few_participants'), JSON.stringify(result.findings));
});

test('a well-formed sequence with labeled messages stays clean', () => {
  const src = 'sequenceDiagram\n  participant C as Client\n  participant S as Server\n  C->>S: request\n  S-->>C: response\n';
  const result = analyzeDiagramQuality(src, { lang: 'mermaid' });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('lintDocumentDiagrams flattens findings across every fenced diagram in a document', () => {
  const doc = [
    '# Doc', '',
    '```mermaid', 'flowchart TD', '  A --> D{ok?}', '  D -->|yes| B', '```', '',
    '```mermaid', 'sequenceDiagram', '  participant A', '  A->>A: self', '```', '',
  ].join('\n');
  const result = lintDocumentDiagrams(doc);
  assert.equal(result.ok, false);
  const codes = result.warnings.map((w) => w.code);
  assert.ok(codes.includes('decision_without_branches'));
  assert.ok(codes.includes('sequence_too_few_participants'));
  assert.deepEqual([...new Set(result.warnings.map((w) => w.diagram))], [1, 2]);
});

test('a clean document yields no diagram warnings', () => {
  const doc = '# Doc\n\n```mermaid\nflowchart TD\n  A --> D{ok?}\n  D -->|yes| B\n  D -->|no| C\n```\n';
  assert.equal(lintDocumentDiagrams(doc).ok, true);
});

test('a labeled d2 graph stays clean; an oversize one trips node_density_high', () => {
  const clean = 'client -> gateway: call\ngateway -> db: query\n';
  assert.equal(analyzeDiagramQuality(clean, { lang: 'd2' }).ok, true);

  let big = '';
  for (let i = 0; i < MAX_NODES + 4; i += 1) big += `n${i} -> n${i + 1}: step\n`;
  assert.ok(codes(analyzeDiagramQuality(big, { lang: 'd2' })).includes('node_density_high'));
});
