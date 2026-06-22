/**
 * scripts/generate-deck-examples.mjs — regenerate branded deck HTML + PPTX for local review.
 *
 * Writes gitignored outputs under .tmp/distribution-examples/ from
 * tests/fixtures/publish/golden-deck-platform.md. Requires pptxgenjs (optionalDep)
 * and pandoc on PATH for HTML deck export.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportMarkdown } from '../lib/document-export.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-deck-platform.md');
const OUT_DIR = path.join(REPO, '.tmp', 'distribution-examples');
const DECK_HTML = path.join(OUT_DIR, 'construct-deck-example.html');
const DECK_PPTX = path.join(OUT_DIR, 'construct-deck-example.pptx');

function main() {
  if (!fs.existsSync(FIXTURE)) {
    console.error(`Fixture missing: ${FIXTURE}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pptx = exportMarkdown({
    inputPath: FIXTURE,
    outputPath: DECK_PPTX,
    format: 'pptx',
    repoRoot: REPO,
  });
  if (!pptx.ok) {
    console.error(`PPTX export failed: ${pptx.message}`);
    process.exit(1);
  }
  console.log(`Wrote ${path.relative(REPO, pptx.outputPath)} (${fs.statSync(DECK_PPTX).size} bytes)`);

  const deck = exportMarkdown({
    inputPath: FIXTURE,
    outputPath: DECK_HTML,
    format: 'deck',
    repoRoot: REPO,
  });
  if (!deck.ok) {
    console.error(`Deck HTML export failed: ${deck.message}`);
    console.error('Install pandoc to generate the HTML deck example.');
    process.exit(1);
  }
  console.log(`Wrote ${path.relative(REPO, deck.outputPath)} (${fs.statSync(DECK_HTML).size} bytes)`);
}

main();
