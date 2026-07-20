/**
 * lib/certification/extraction-ladder-certification.mjs — end-to-end extraction ladder certification.
 *
 * Corpus-driven routing, contract, and packed-artifact checks for the ingestion
 * extraction ladder (construct-tsyfe.2.11). Hermetic via injectable docling extractors.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CORPUS_DIR,
  loadCorpusManifest,
  resolveCorpusFixturePath,
} from '../document-extract/corpus-benchmark.mjs';
import { extractViaExtractionLadder } from '../document-extract/extraction-ladder.mjs';
import { validateExtractionProviderResult } from '../document-extract/extraction-result-contract.mjs';
import { enrichDoclingSidecarResult } from '../document-extract/docling-rich-document.mjs';
import { writeIngestExtractionSidecars } from '../document-ingest.mjs';

const EMAIL_FIXTURE_DIR = 'tests/fixtures/email-mime';
const REQUIRED_EMAIL_FIXTURES = [
  '01-plain-text.eml',
  '04-multipart-attachment.eml',
  '08-attachment-path-traversal.eml',
  '09-zip-bomb-suspect.eml',
];

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

async function unpdfPresent() {
  try {
    await import('unpdf');
    return true;
  } catch {
    return false;
  }
}

async function mammothPresent() {
  try {
    await import('mammoth');
    return true;
  } catch {
    return false;
  }
}

function validateEmailFixtureCatalog(root) {
  const errors = [];
  for (const file of REQUIRED_EMAIL_FIXTURES) {
    const abs = path.join(root, EMAIL_FIXTURE_DIR, file);
    if (!fs.existsSync(abs)) errors.push(`missing email regression fixture: ${EMAIL_FIXTURE_DIR}/${file}`);
  }
  return errors;
}

function validatePackedArtifacts({ root, fixtureId, ladderResult }) {
  const errors = [];
  if (!ladderResult.providerRepresentation) return errors;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-extraction-cert-'));
  try {
    const outputPath = path.join(tmpDir, `${fixtureId}.pdf.md`);
    const enriched = enrichDoclingSidecarResult({
      markdown: ladderResult.text,
      metadata: ladderResult.metadata ?? {},
      structuredDict: ladderResult.providerRepresentation,
      droppedInfo: ladderResult.droppedInfo ?? [],
    }, { title: fixtureId });

    const { providerArtifactPath, richArtifactPath } = writeIngestExtractionSidecars({
      richDoc: enriched.structured ?? ladderResult.structured,
      extracted: enriched,
      assetBaseDir: tmpDir,
      outputPath,
    });

    if (!providerArtifactPath || !richArtifactPath) {
      errors.push(`${fixtureId}: expected provider and rich sidecars when structured output present`);
      return errors;
    }
    if (!fs.existsSync(providerArtifactPath) || !fs.existsSync(richArtifactPath)) {
      errors.push(`${fixtureId}: sidecar files not written`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return errors;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {Function} [opts.doclingExtract]
 * @returns {Promise<{ pass: boolean, fixtures: object[], errors: string[], evidencePath: string|null }>}
 */
export async function validateExtractionLadderCertification({
  rootDir,
  doclingExtract,
} = {}) {
  const root = findConstructRoot(rootDir);
  const errors = [...validateEmailFixtureCatalog(root)];
  const fixtures = [];

  const hasUnpdf = await unpdfPresent();
  const hasMammoth = await mammothPresent();
  if (!hasUnpdf && !hasMammoth) {
    return {
      pass: false,
      fixtures: [],
      errors: ['unpdf and mammoth are both unavailable; cannot certify routing ladder'],
      evidencePath: null,
    };
  }

  const manifest = loadCorpusManifest();
  const simulatedDocling = doclingExtract ?? (async (fixturePath) => enrichDoclingSidecarResult({
    markdown: 'Docling certification markdown body',
    metadata: { sourcePath: fixturePath },
    droppedInfo: [],
    structuredDict: {
      schema_name: 'DoclingDocument',
      tables: [{ data: { grid: [[{ text: 'Metric' }, { text: 'Value' }]] } }],
      pages: [{ page_no: 1, size: { width: 612, height: 792 } }],
      texts: [{ label: 'paragraph', text: 'Docling certification markdown body' }],
    },
  }, { title: path.basename(fixturePath) }));

  const lightweightDocxExtract = hasMammoth
    ? undefined
    : async (fixturePath) => {
      const fixture = manifest.fixtures.find((entry) => resolveCorpusFixturePath(entry, CORPUS_DIR) === fixturePath);
      if (!fixture || fixture.format !== 'docx') return { text: '', extractionMethod: 'mammoth' };
      return {
        text: `Construct corpus ${fixture.id} mammoth body`,
        extractionMethod: 'mammoth',
      };
    };

  for (const fixture of manifest.fixtures) {
    const fixturePath = resolveCorpusFixturePath(fixture, CORPUS_DIR);

    const ladderResult = await extractViaExtractionLadder(fixturePath, {
      doclingExtract: simulatedDocling,
      doclingRemoteExtract: null,
      ...(lightweightDocxExtract ? { lightweightDocxExtract } : {}),
    });

    const contract = validateExtractionProviderResult({
      text: ladderResult.text ?? '',
      extractionMethod: ladderResult.extractionMethod,
      characters: ladderResult.characters ?? (ladderResult.text ?? '').length,
      truncated: Boolean(ladderResult.truncated),
      droppedInfo: ladderResult.droppedInfo ?? [],
      structured: ladderResult.structured ?? null,
    });

    const routingOk = ladderResult.routingTier === fixture.expectedRoutingTier;
    if (!routingOk) {
      errors.push(`${fixture.id}: routed to ${ladderResult.routingTier}, expected ${fixture.expectedRoutingTier}`);
    }
    if (!contract.ok) {
      errors.push(`${fixture.id}: contract invalid (${contract.errors.join('; ')})`);
    }

    if (fixture.expectedRoutingTier === 'docling-local' && ladderResult.providerRepresentation) {
      errors.push(...validatePackedArtifacts({ root, fixtureId: fixture.id, ladderResult }));
    }

    fixtures.push({
      id: fixture.id,
      expectedRoutingTier: fixture.expectedRoutingTier,
      routingTier: ladderResult.routingTier,
      routingOk,
      contractOk: contract.ok,
      extractionMethod: ladderResult.extractionMethod,
    });
  }

  const evidenceDir = path.join(root, 'tests', 'certification', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, 'extraction-ladder-certification.json');
  const evidence = {
    schema: 'construct/certification/extraction-ladder/1',
    generatedAt: new Date().toISOString(),
    pass: errors.length === 0,
    fixtures,
    emailFixtures: REQUIRED_EMAIL_FIXTURES.map((file) => path.join(EMAIL_FIXTURE_DIR, file)),
    errors,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  return {
    pass: errors.length === 0,
    fixtures,
    errors,
    evidencePath: path.relative(root, evidencePath),
  };
}
