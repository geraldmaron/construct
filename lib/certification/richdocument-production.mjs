/**
 * lib/certification/richdocument-production.mjs — production RichDocument path certification
 * (construct-tsyfe.3.7).
 *
 * Corpus-driven hermetic checks over the ingest → RichDocument → export path now wired by
 * construct-tsyfe.3.4 / .3.5: round-trip text fidelity, provenance survival on the HTML
 * canonical surface (sourceRef / citations), and truthful droppedInfo signaling. Persists a
 * certification-store run so the evidence-tier convention has a durable artifact.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildIngestRichDocument,
  renderIngestMarkdownFromRichDocument,
} from '../document-ingest.mjs';
import { exportFromSource } from '../export-from-source.mjs';
import {
  htmlToRichDocument,
  makeCitation,
  makeParagraphBlock,
  makeRichDocument,
  makeRun,
  makeSection,
  richDocumentToHtml,
} from '../rich-document.mjs';
import { richDocumentBodyToMarkdown, richDocumentToMarkdown } from '../rich-document-export.mjs';
import { writeCertificationRun } from './store.mjs';

const CORPUS_REL = path.join('tests', 'fixtures', 'rich-document-corpus');
const FIDELITY_FLOOR = 0.99;
const EVIDENCE_VERSION = 'richdocument-production:1';
const SCENARIO_ID = 'richdocument.production-round-trip';
const CAPABILITY_ID = 'document.richdocument-production';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function plainText(doc) {
  const parts = [];
  const walkRuns = (runs) => (runs || []).forEach((r) => parts.push(r.text));
  const walkBlocks = (blocks) => (blocks || []).forEach((b) => {
    if (!b) return;
    if (b.runs) walkRuns(b.runs);
    if (b.items) b.items.forEach((item) => walkBlocks(item));
    if (b.headers) b.headers.forEach((c) => walkRuns(c.runs));
    if (b.rows) b.rows.forEach((row) => row.forEach((c) => walkRuns(c.runs)));
    if (b.caption) walkRuns(b.caption);
    if (b.text) parts.push(b.text);
    if (b.source) parts.push(b.source);
    if (b.blocks) walkBlocks(b.blocks);
  });
  (doc.sections || []).forEach((s) => walkBlocks(s.blocks));
  return parts.join(' ');
}

function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[`*_#>|[\]().!~$-]/g, ' ').split(/\s+/).filter(Boolean);
}

function diceSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const ma = new Map();
  ta.forEach((t) => ma.set(t, (ma.get(t) || 0) + 1));
  const mb = new Map();
  tb.forEach((t) => mb.set(t, (mb.get(t) || 0) + 1));
  let inter = 0;
  for (const [t, c] of ma) inter += Math.min(c, mb.get(t) || 0);
  const total = ta.length + tb.length;
  return total === 0 ? 1 : (2 * inter) / total;
}

function collectDroppedInfo(doc) {
  const out = [];
  const walk = (blocks) => (blocks || []).forEach((b) => {
    if (!b) return;
    if (b.type === 'droppedInfo') out.push({ kind: b.kind, count: b.count, reason: b.reason });
    if (b.items) b.items.forEach((item) => walk(item));
    if (b.blocks) walk(b.blocks);
  });
  (doc.sections || []).forEach((s) => walk(s.blocks));
  return out;
}

function listCorpusMarkdown(root) {
  const dir = path.join(root, CORPUS_REL);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((f) => path.join(CORPUS_REL, f));
}

function certifyCorpusFidelity(root) {
  const results = [];
  const errors = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-prod-corpus-'));

  try {
    for (const rel of listCorpusMarkdown(root)) {
      const abs = path.join(root, rel);
      const md = fs.readFileSync(abs, 'utf8');
      const title = path.basename(rel, '.md');
      const ingested = buildIngestRichDocument(md, { title });

      const ingestWrapped = renderIngestMarkdownFromRichDocument({
        richDoc: ingested,
        sourcePath: abs,
        extractedAt: '1970-01-01T00:00:00.000Z',
        title,
        extractionMethod: 'richdocument-production-cert',
        characters: md.length,
        truncated: false,
        outputPath: path.join(tmpRoot, `${title}.md`),
        cwd: tmpRoot,
        metadata: {},
      });
      const bodyFromIngest = richDocumentBodyToMarkdown(ingested);
      if (!ingestWrapped.includes(bodyFromIngest.trim())) {
        errors.push(`${rel}: ingest render missing RichDocument body`);
      }

      // Export the IR serialization (not the ingest wrapper) so fidelity measures
      // document content rather than ingest frontmatter scaffolding.
      const irPath = path.join(tmpRoot, `${title}.ir.md`);
      fs.writeFileSync(irPath, richDocumentToMarkdown(ingested), 'utf8');
      const exportPath = path.join(tmpRoot, `${title}.exported.md`);
      const exported = exportFromSource({
        inputPath: irPath,
        outputPath: exportPath,
        format: 'md',
        cwd: tmpRoot,
        repoRoot: root,
      });

      const item = {
        fixture: rel,
        exportOk: exported.ok === true,
        exportPath: exported.exportPath || null,
        fidelity: null,
        ingestRenderOk: ingestWrapped.includes(bodyFromIngest.trim()),
        pass: false,
        errors: [],
      };

      if (!item.ingestRenderOk) {
        item.errors.push('ingest render missing RichDocument body');
      }
      if (!exported.ok) {
        item.errors.push(exported.message || 'exportFromSource failed');
        errors.push(`${rel}: export failed`);
        results.push(item);
        continue;
      }
      if (exported.exportPath !== 'richdocument') {
        item.errors.push(`expected exportPath richdocument, got ${exported.exportPath}`);
        errors.push(`${rel}: not richdocument export path`);
      }

      const exportedMd = fs.readFileSync(exportPath, 'utf8');
      const reparsed = buildIngestRichDocument(exportedMd, { title });
      const score = diceSimilarity(plainText(ingested), plainText(reparsed));
      item.fidelity = score;
      if (score < FIDELITY_FLOOR) {
        item.errors.push(`fidelity ${(score * 100).toFixed(1)}% below ${(FIDELITY_FLOOR * 100).toFixed(0)}%`);
        errors.push(`${rel}: fidelity ${(score * 100).toFixed(1)}%`);
      }

      item.pass = item.errors.length === 0;
      if (!item.pass && item.ingestRenderOk === false) errors.push(`${rel}: ingest render`);
      results.push(item);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  return { results, errors, pass: errors.length === 0 };
}

function certifyProvenanceSurvival() {
  const sourceRef = {
    kind: 'artifact',
    id: 'CX-PROV-1',
    uri: 'tests/fixtures/rich-document-corpus/adr-0001-zero-npm-core.md',
  };
  const citations = [makeCitation({ sourceRef, locator: 'section-1', credibilityTier: 'primary' })];
  const doc = makeRichDocument(
    { title: 'Provenance survival', docId: 'CX-PROV', artifactType: 'adr' },
    [
      makeSection({
        id: 'sec-1',
        level: 1,
        title: 'Provenance',
        sourceRef,
        blocks: [
          makeParagraphBlock({
            runs: [makeRun({ text: 'Cited claim survives HTML round-trip.', marks: [], citations })],
          }),
        ],
      }),
    ],
  );

  const html = richDocumentToHtml(doc);
  const roundTripped = htmlToRichDocument(html);
  const section = roundTripped.sections?.[0];
  const run = section?.blocks?.find((b) => b.type === 'paragraph')?.runs?.[0];
  const errors = [];

  if (!section?.sourceRef || section.sourceRef.id !== sourceRef.id) {
    errors.push('section.sourceRef did not survive HTML round-trip');
  }
  if (!Array.isArray(run?.citations) || run.citations[0]?.sourceRef?.id !== sourceRef.id) {
    errors.push('run.citations did not survive HTML round-trip');
  }
  if (run?.citations?.[0]?.locator !== 'section-1') {
    errors.push('citation locator did not survive HTML round-trip');
  }

  return {
    pass: errors.length === 0,
    errors,
    sourceRefSurvived: Boolean(section?.sourceRef?.id === sourceRef.id),
    citationsSurvived: Boolean(run?.citations?.[0]?.sourceRef?.id === sourceRef.id),
  };
}

function certifyDroppedInfoTruth() {
  const withLoss = buildIngestRichDocument(
    '# Loss fixture\n\nParagraph before rule.\n\n---\n\nParagraph after rule.\n\n<div class="raw">raw html block</div>\n',
    { title: 'loss' },
  );
  const clean = buildIngestRichDocument(
    '# Clean fixture\n\nJust a paragraph with **bold** and a [link](https://example.com).\n',
    { title: 'clean' },
  );

  const lossDrops = collectDroppedInfo(withLoss);
  const cleanDrops = collectDroppedInfo(clean);
  const errors = [];

  const kinds = new Set(lossDrops.map((d) => d.kind));
  if (!kinds.has('thematic-break')) errors.push('expected droppedInfo kind thematic-break for --- rule');
  if (!kinds.has('raw-html-block')) errors.push('expected droppedInfo kind raw-html-block for raw HTML');
  if (cleanDrops.length > 0) {
    errors.push(`clean fixture produced spurious droppedInfo: ${JSON.stringify(cleanDrops)}`);
  }

  for (const drop of lossDrops) {
    if (!drop.kind || !drop.reason) errors.push(`incomplete droppedInfo entry: ${JSON.stringify(drop)}`);
  }

  return {
    pass: errors.length === 0,
    errors,
    lossKinds: [...kinds].sort(),
    cleanDropCount: cleanDrops.length,
    bodyMentionsLoss: /dropped/i.test(richDocumentBodyToMarkdown(withLoss)),
  };
}

/**
 * runRichDocumentProductionCertification — hermetic production-path certification.
 *
 * Returns a report plus optional persisted certification-store path when persist is true.
 */
export function runRichDocumentProductionCertification({
  rootDir,
  persist = true,
  evidenceRootDir,
} = {}) {
  const root = findConstructRoot(rootDir);
  const startedAt = new Date();
  const corpus = certifyCorpusFidelity(root);
  const provenance = certifyProvenanceSurvival();
  const dropped = certifyDroppedInfoTruth();

  const gates = [
    { id: 'corpus-fidelity', pass: corpus.pass, detail: corpus.pass ? null : corpus.errors.join('; ') },
    { id: 'provenance-survival', pass: provenance.pass, detail: provenance.pass ? null : provenance.errors.join('; ') },
    { id: 'dropped-info-truth', pass: dropped.pass, detail: dropped.pass ? null : dropped.errors.join('; ') },
  ];
  const pass = gates.every((g) => g.pass);
  const finishedAt = new Date();
  const corpusFiles = listCorpusMarkdown(root);
  const fixturePath = corpusFiles[0]
    ? path.join(root, corpusFiles[0])
    : path.join(root, CORPUS_REL, 'meta.json');
  const fixtureSha = fs.existsSync(fixturePath) ? sha256File(fixturePath) : sha256Text('missing');

  const report = {
    pass,
    gates,
    corpus: {
      pass: corpus.pass,
      fixtureCount: corpus.results.length,
      results: corpus.results,
      errors: corpus.errors,
    },
    provenance,
    droppedInfo: dropped,
    evidenceVersion: EVIDENCE_VERSION,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };

  let evidence = null;
  if (persist) {
    const storeRoot = evidenceRootDir || root;
    const runId = `richdocument-production-${startedAt.toISOString().replace(/[:.]/g, '-')}`;
    const written = writeCertificationRun({
      schemaVersion: 1,
      id: runId,
      scenarioId: SCENARIO_ID,
      capabilityId: CAPABILITY_ID,
      model: {
        provider: 'hermetic',
        requestedId: 'fixture/rich-document-corpus',
        resolvedId: 'fixture/rich-document-corpus',
        tier: 'hermetic',
        paidOptIn: false,
      },
      fixture: {
        path: path.relative(root, fixturePath) || CORPUS_REL,
        sha256: fixtureSha,
      },
      verdict: {
        status: pass ? 'pass' : 'fail',
        source: 'deterministic',
        reason: pass ? null : gates.filter((g) => !g.pass).map((g) => g.id).join(','),
      },
      gates,
      qualitative: null,
      timing: {
        latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      },
      cost: null,
      artifacts: null,
      evidenceVersion: EVIDENCE_VERSION,
      createdAt: finishedAt.toISOString(),
    }, {
      rootDir: storeRoot,
      outputs: { json: report },
    });
    evidence = { runId, path: written.path, dir: written.dir };
    report.evidence = evidence;
  }

  return report;
}

export function formatRichDocumentProductionReport(report) {
  const lines = [
    `RichDocument production certification: ${report.pass ? 'PASS' : 'FAIL'}`,
    `  corpus: ${report.corpus.fixtureCount} fixtures, ${report.corpus.pass ? 'ok' : 'failed'}`,
    `  provenance: ${report.provenance.pass ? 'ok' : 'failed'}`,
    `  droppedInfo: ${report.droppedInfo.pass ? 'ok' : 'failed'}`,
  ];
  for (const gate of report.gates) {
    lines.push(`  gate ${gate.id}: ${gate.pass ? 'pass' : 'FAIL'}${gate.detail ? ` (${gate.detail})` : ''}`);
  }
  if (report.evidence?.path) lines.push(`  evidence: ${report.evidence.path}`);
  return lines.join('\n');
}
