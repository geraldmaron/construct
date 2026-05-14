/**
 * tests/review-prepare.test.mjs — intake review preparation contract.
 *
 * `prepareReviewForIngestedFile` runs three deterministic steps (lane
 * suggestion, hybrid corpus query, excerpt) and writes a packet to the
 * review queue. Pins the contract: hybrid query failure is non-fatal,
 * lane suggestion is best-effort, the packet always contains an excerpt
 * + query so the agent has enough to act without re-reading the file.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { prepareReviewForIngestedFile } from '../lib/review/prepare.mjs';
import { readEntry } from '../lib/review/queue.mjs';

let projectRoot;
let ingestedMd;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-review-prepare-'));
  ingestedMd = path.join(projectRoot, 'ingested.md');
  fs.writeFileSync(ingestedMd, [
    '# Postmortem: payment latency spike',
    '',
    'On 2026-05-12 a third-party rate-limit change caused our checkout endpoint',
    'to time out at p99. Root cause: cached client lacked exponential backoff.',
    '',
    '## Extracted Content',
    '',
    'The actual extracted content lives here, multiple paragraphs explaining',
    'the failure mode and proposed corrective action.',
  ].join('\n'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function ingestedFile() {
  return {
    sourcePath: '/some/inbox/postmortem-payment-latency.md',
    outputPath: ingestedMd,
    characters: 4321,
    knowledgeSubdir: 'decisions',
  };
}

describe('prepareReviewForIngestedFile', () => {
  it('writes a review packet with lane suggestion, related docs from hybrid query, and excerpt', async () => {
    const fakeRelated = [
      { source_path: 'docs/postmortems/0003-checkout.md', title: 'Earlier checkout postmortem', score: 0.81, summary: 'Related incident.' },
      { source_path: 'docs/adr/0012-retries.md', title: 'ADR: retry policy', score: 0.62, summary: '' },
    ];
    const result = await prepareReviewForIngestedFile({
      rootDir: projectRoot,
      ingestedFile: ingestedFile(),
      hybridSearchFn: async (_root, _query, _opts) => ({ results: fakeRelated }),
    });

    const entry = readEntry(projectRoot, result.id);
    assert.ok(entry, 'packet was written');
    assert.equal(entry.status, 'pending');
    assert.equal(entry.intake.sourcePath, '/some/inbox/postmortem-payment-latency.md');
    assert.equal(entry.suggestion?.lane, 'postmortems', 'docs-routing classifier matched postmortem keyword');
    assert.equal(entry.related.length, 2);
    assert.equal(entry.related[0].path, 'docs/postmortems/0003-checkout.md');
    assert.ok(entry.excerpt.includes('extracted content'), 'excerpt comes from below the marker');
    assert.ok(entry.query.length > 0, 'query non-empty');
  });

  it('keeps going when hybrid search throws (review is best-effort, not blocking)', async () => {
    const result = await prepareReviewForIngestedFile({
      rootDir: projectRoot,
      ingestedFile: ingestedFile(),
      hybridSearchFn: async () => { throw new Error('pgvector down'); },
    });
    const entry = readEntry(projectRoot, result.id);
    assert.deepEqual(entry.related, [], 'empty related on search failure');
    assert.ok(entry.excerpt.length > 0, 'still wrote the excerpt');
  });

  it('errors clearly on missing inputs', async () => {
    await assert.rejects(
      () => prepareReviewForIngestedFile({ rootDir: projectRoot, ingestedFile: {} }),
      /sourcePath is required/,
    );
  });
});
