/**
 * tests/certification/richdocument-production.test.mjs — production RichDocument path
 * certification (construct-tsyfe.3.7).
 *
 * Asserts corpus fidelity, provenance survival, droppedInfo truth, and durable evidence
 * persistence via lib/certification/richdocument-production.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatRichDocumentProductionReport,
  runRichDocumentProductionCertification,
} from '../../lib/certification/richdocument-production.mjs';
import { readCertificationRun } from '../../lib/certification/store.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('RichDocument production certification passes corpus, provenance, and droppedInfo gates', () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-prod-cert-'));
  try {
    const report = runRichDocumentProductionCertification({
      rootDir: REPO,
      persist: true,
      evidenceRootDir: evidenceRoot,
    });

    assert.equal(report.pass, true, formatRichDocumentProductionReport(report));
    assert.ok(report.corpus.fixtureCount >= 4, `expected >=4 corpus fixtures, got ${report.corpus.fixtureCount}`);
    assert.equal(report.provenance.sourceRefSurvived, true);
    assert.equal(report.provenance.citationsSurvived, true);
    assert.ok(report.droppedInfo.lossKinds.includes('thematic-break'));
    assert.ok(report.droppedInfo.lossKinds.includes('raw-html-block'));
    assert.equal(report.droppedInfo.cleanDropCount, 0);

    assert.ok(report.evidence?.runId);
    assert.ok(fs.existsSync(report.evidence.path));
    const loaded = readCertificationRun(report.evidence.runId, { rootDir: evidenceRoot });
    assert.equal(loaded.run.verdict.status, 'pass');
    assert.equal(loaded.run.scenarioId, 'richdocument.production-round-trip');
    assert.equal(loaded.run.evidenceVersion, 'richdocument-production:1');
    assert.ok(fs.existsSync(path.join(report.evidence.dir, 'output.json')));
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});
