/**
 * tests/intake-prepare.test.mjs — R&D intake preparation contract.
 *
 * `prepareIntakeForIngestedFile` runs four deterministic steps (lane
 * suggestion, hybrid corpus query, excerpt, R&D triage) and writes a
 * packet to the intake queue. Pins the contract: hybrid query failure
 * is non-fatal, lane suggestion is best-effort, the packet always
 * contains an excerpt + query + triage so the agent has enough to act
 * without re-reading the file.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { prepareIntakeForIngestedFile } from '../lib/intake/prepare.mjs';
import { FilesystemIntakeQueue } from '../lib/intake/queue.mjs';

let projectRoot;
let ingestedMd;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intake-prepare-'));
  ingestedMd = path.join(projectRoot, 'ingested.md');
  fs.writeFileSync(ingestedMd, [
    '# Postmortem: payment latency spike',
    '',
    'Front-matter / metadata above the extracted-content marker is stripped',
    'by the daemon before classification runs.',
    '',
    '## Extracted Content',
    '',
    'On 2026-05-12 a third-party rate-limit change caused a checkout outage.',
    'Latency spike at p99 preceded the failure; PagerDuty fired. PostgreSQL',
    'replica availability dropped briefly during recovery.',
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

describe('prepareIntakeForIngestedFile', () => {
  it('writes an intake packet with lane suggestion, related docs, excerpt, and triage', async () => {
    const fakeRelated = [
      { source_path: 'docs/postmortems/0003-checkout.md', title: 'Earlier checkout postmortem', score: 0.81, summary: 'Related incident.' },
      { source_path: 'docs/decisions/adr/0012-retries.md', title: 'ADR: retry policy', score: 0.62, summary: '' },
    ];
    const result = await prepareIntakeForIngestedFile({
      rootDir: projectRoot,
      ingestedFile: ingestedFile(),
      hybridSearchFn: async (_root, _query, _opts) => ({ results: fakeRelated }),
    });

    const entry = new FilesystemIntakeQueue(projectRoot).read(result.id);
    assert.ok(entry, 'packet was written');
    assert.equal(entry.status, 'pending');
    assert.equal(entry.intake.sourcePath, '/some/inbox/postmortem-payment-latency.md');
    assert.equal(entry.suggestion?.lane, 'postmortems', 'docs-routing classifier matched postmortem keyword');
    assert.equal(entry.related.length, 2);
    assert.equal(entry.related[0].path, 'docs/postmortems/0003-checkout.md');
    assert.ok(entry.excerpt.includes('rate-limit change'), 'excerpt comes from below the marker');
    assert.ok(!entry.excerpt.includes('above the extracted-content marker'), 'pre-marker metadata is stripped');
    assert.ok(entry.query.length > 0, 'query non-empty');
    assert.ok(entry.triage, 'triage block present');
    assert.equal(entry.triage.intakeType, 'incident', 'incident keywords (latency spike, outage) win the classification');
    assert.equal(entry.triage.primaryOwner, 'sre');
    assert.ok(Array.isArray(entry.triage.recommendedChain));
  });

  it('keeps going when hybrid search throws (intake is best-effort, not blocking)', async () => {
    const result = await prepareIntakeForIngestedFile({
      rootDir: projectRoot,
      ingestedFile: ingestedFile(),
      hybridSearchFn: async () => { throw new Error('pgvector down'); },
    });
    const entry = new FilesystemIntakeQueue(projectRoot).read(result.id);
    assert.deepEqual(entry.related, [], 'empty related on search failure');
    assert.ok(entry.excerpt.length > 0, 'still wrote the excerpt');
    assert.ok(entry.triage, 'triage still computed');
  });

  it('errors clearly on missing inputs', async () => {
    await assert.rejects(
      () => prepareIntakeForIngestedFile({ rootDir: projectRoot, ingestedFile: {} }),
      /sourcePath is required/,
    );
  });

  it('stamps tag suggestions onto the packet when triage confidence crosses the auto-threshold', async () => {
    const result = await prepareIntakeForIngestedFile({
      rootDir: projectRoot,
      ingestedFile: ingestedFile(),
      hybridSearchFn: async () => [
        { id: 'docs/a.md', path: 'docs/a.md', tags: ['intake/incident', 'severity/p0'], score: 0.9 },
        { id: 'docs/b.md', path: 'docs/b.md', tags: ['intake/incident', 'severity/p0'], score: 0.85 },
      ],
    });
    const entry = new FilesystemIntakeQueue(projectRoot).read(result.id);
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0, 'expected tag suggestions on packet');
    const tagIds = entry.tags.map((t) => t.tag);
    // Two related docs carry 'severity/p0' → eligible for inheritance.
    assert.ok(tagIds.includes('severity/p0'), `expected severity/p0 from related-inherit, got ${JSON.stringify(tagIds)}`);
    // Every suggestion carries a source attribution that downstream
    // consumers can use to render the "why this tag" trail.
    for (const t of entry.tags) {
      assert.ok(t.source, `each tag suggestion has a source attribution: ${JSON.stringify(t)}`);
      assert.ok(typeof t.confidence === 'number', `each tag suggestion has a numeric confidence: ${JSON.stringify(t)}`);
    }
  });

  it('omits the tags field when nothing is suggested (no fabrication)', async () => {
    const result = await prepareIntakeForIngestedFile({
      rootDir: projectRoot,
      ingestedFile: ingestedFile(),
      hybridSearchFn: async () => [],
      classifyFn: () => ({ intakeType: 'unknown', confidence: 0, primaryOwner: 'unknown', recommendedChain: [] }),
    });
    const entry = new FilesystemIntakeQueue(projectRoot).read(result.id);
    assert.equal(entry.tags, undefined, 'tags must be absent when no suggestions, not [] (avoid empty-field noise)');
  });
});
