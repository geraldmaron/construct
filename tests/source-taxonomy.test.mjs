/**
 * tests/source-taxonomy.test.mjs — source credibility taxonomy is wired in.
 *
 * @enforces ADR-0017
 *
 * Bead construct-7zrh.1: pins that the research policy carries claim-relative
 * classing and the Admiralty grade, the community catalog exists, and the
 * research templates' sources tables actually expose the Reliability/Credibility
 * columns the policy requires (reusing artifact-table-has-columns).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { validateArtifactPostconditions } from '../lib/contracts/validate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');

test('research policy defines claim-relative classing and the Admiralty grade', () => {
  const policy = read('rules/common/research.md');
  assert.match(policy, /Source class is relative to the claim/);
  assert.match(policy, /Admiralty grade/);
  assert.match(policy, /reliability/i);
  assert.match(policy, /credibility/i);
});

test('the per-domain community source catalog exists with a table', () => {
  const catalog = read('rules/common/research-sources.md');
  assert.match(catalog, /Reddit/);
  assert.match(catalog, /r\/netsec|r\/LocalLLaMA|r\/devops/);
  assert.match(catalog, /Hacker News/);
});

test('research-brief sources table carries Reliability and Credibility columns', () => {
  const errors = validateArtifactPostconditions({
    contract: { postconditions: [{ id: 'rb', check: 'artifact-table-has-columns', columns: ['Class', 'Reliability', 'Credibility'] }] },
    artifactPath: join(REPO, 'templates/docs/research-brief.md'),
  });
  assert.deepEqual(errors, []);
});

test('evidence-brief sources table carries Reliability and Credibility columns', () => {
  const errors = validateArtifactPostconditions({
    contract: { postconditions: [{ id: 'eb', check: 'artifact-table-has-columns', columns: ['Class', 'Reliability', 'Credibility'] }] },
    artifactPath: join(REPO, 'templates/docs/evidence-brief.md'),
  });
  assert.deepEqual(errors, []);
});

test('researcher prompt teaches claim-relative classing and the grade', () => {
  const prompt = read('registry/worker-profiles/prompts/researcher.md');
  assert.match(prompt, /relative to the claim/);
  assert.match(prompt, /Admiralty/);
  assert.match(prompt, /research-sources\.md/);
});
