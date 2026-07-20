/**
 * tests/orchestration-research-evidence-gate.test.mjs — kind-aware evidence gate.
 *
 * @enforces rule:common/no-fabrication
 *
 * The researcher persona forbids fabrication as an honor-system prompt; a weak
 * (including free-tier) model ignores it. These pin the deterministic backstop:
 * a substantial research answer with no citation of its expected evidence kind is
 * flagged, an honest short/insufficient-evidence answer is not, and the expected
 * kind follows the research mode (external → URL, codebase → file:line).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { gateResearchEvidence, inferEvidenceKind } from '../lib/orchestration/research-evidence-gate.mjs';

const LONG = 'Agentic platforms are software ecosystems for autonomous systems. '.repeat(20);

test('inferEvidenceKind maps request phrasing to the expected evidence kind', () => {
  assert.equal(inferEvidenceKind('Research agentic platforms'), 'external');
  assert.equal(inferEvidenceKind('trace the execution path through the codebase'), 'codebase');
  assert.equal(inferEvidenceKind('run user research and map friction points'), 'ux');
});

test('a substantial external-research answer with zero verifiable sources is flagged', () => {
  const v = gateResearchEvidence({ output: LONG, workerProfileId: 'researcher', request: 'Research agentic platforms' });
  assert.equal(v.applicable, true);
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'external');
  assert.match(v.reason, /verifiable/i);
});

test('external-research URLs require governed webEvidence; DOI and arXiv still pass', () => {
  const bareUrl = gateResearchEvidence({ output: `${LONG} https://nodejs.org/en/blog`, workerProfileId: 'researcher', request: 'Research node' });
  assert.equal(bareUrl.ok, false);
  assert.match(bareUrl.reason, /webEvidence/i);

  const backed = gateResearchEvidence({
    output: `${LONG} https://nodejs.org/en/blog`,
    workerProfileId: 'researcher',
    request: 'Research node',
    webEvidence: [{ url: 'https://nodejs.org/en/blog' }],
  });
  assert.equal(backed.ok, true);

  assert.equal(gateResearchEvidence({ output: `${LONG} doi: 10.1145/1234567`, workerProfileId: 'researcher', request: 'Research X' }).ok, true);
  assert.equal(gateResearchEvidence({ output: `${LONG} arxiv: 2401.01234`, workerProfileId: 'researcher', request: 'Research X' }).ok, true);
});

test('an honest short or self-declared insufficient-evidence answer is never penalized', () => {
  assert.equal(gateResearchEvidence({ output: 'No verifiable sources found.', workerProfileId: 'researcher', request: 'Research X' }).ok, true);
  assert.equal(gateResearchEvidence({ output: `${LONG} I could not reach the web to verify any of this.`, workerProfileId: 'researcher', request: 'Research X' }).ok, true);
});

test('codebase-mode requires file:line, not a URL', () => {
  const req = 'trace the execution path in the source code';
  assert.equal(gateResearchEvidence({ output: LONG, workerProfileId: 'researcher', request: req }).ok, false);
  assert.equal(gateResearchEvidence({ output: `${LONG} see lib/foo.mjs:42`, workerProfileId: 'researcher', request: req }).ok, true);
  assert.equal(gateResearchEvidence({ output: `${LONG} https://example.com`, workerProfileId: 'researcher', request: req }).ok, false);
});

test('the gate only applies to the research role', () => {
  assert.equal(gateResearchEvidence({ output: LONG, workerProfileId: 'engineer', request: 'x' }).applicable, false);
  assert.equal(gateResearchEvidence({ output: LONG, workerProfileId: 'engineer', request: 'x' }).ok, true);
});

test('localhost URLs inside fenced code are exempt from webEvidence requirement', () => {
  const output = `${LONG}\n\nExample:\n\`\`\`sh\ncurl http://localhost:3000/health\n\`\`\``;
  const verdict = gateResearchEvidence({ output, workerProfileId: 'researcher', request: 'Research node', webEvidence: [] });
  assert.equal(verdict.ok, false, 'still needs a verifiable external source');
});
