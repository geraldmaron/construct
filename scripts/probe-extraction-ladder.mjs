#!/usr/bin/env node
/**
 * scripts/probe-extraction-ladder.mjs — record what the extraction ladder
 * actually does, per filetype, on THIS machine right now.
 *
 * Same discipline as scripts/probe-docling.mjs: a dependency is admitted
 * behind a probe, never on assertion. This drives the real executing half
 * (hosts/extract.ts readSource, fed by kernel/extract/ladder.ts
 * planExtraction) against the minimal real files
 * fixtures/extraction-ladder/samples/probe.* built by
 * scripts/build-extraction-ladder-fixtures.mjs, and writes one dated JSON
 * record per filetype to fixtures/extraction-ladder/runs/. Docling itself is
 * probed for real — the recorded rung is whichever one the ladder actually
 * reaches on the machine that ran this script, not an assumption about what a
 * clean install looks like.
 *
 * Re-run this after any change to the ladder's routing or refusal wording;
 * a diff in the committed runs/ output is the evidence that the change did
 * what it was meant to.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeDocling, readSource } from '../src/hosts/extract.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(HERE, '..', 'fixtures', 'extraction-ladder', 'samples');
const RUNS_DIR = join(HERE, '..', 'fixtures', 'extraction-ladder', 'runs');

const docling = probeDocling();
console.log(`docling probe: ${docling.detail}`);

mkdirSync(RUNS_DIR, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const probedAt = new Date().toISOString();

const samples = readdirSync(SAMPLES_DIR).sort();
if (samples.length === 0) {
  console.error('no samples found — run scripts/build-extraction-ladder-fixtures.mjs first');
  process.exit(1);
}

for (const sample of samples) {
  const ext = extname(sample).toLowerCase().slice(1) || 'none';
  const filePath = join(SAMPLES_DIR, sample);
  const read = readSource(filePath, { docling });

  const record = {
    extension: extname(sample).toLowerCase(),
    sample,
    probedAt,
    doclingProbe: docling,
    outcome: read.ok ? 'extracted' : 'refused',
    ...(read.ok
      ? { tier: read.tier, method: read.method, characters: read.text.length }
      : { reason: read.reason, remediation: read.remediation }),
  };

  const outFile = join(RUNS_DIR, `${today}-${ext}.json`);
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `${sample} -> ${record.outcome}` +
      (read.ok ? ` (${read.tier}/${read.method})` : ` — ${read.reason}`) +
      ` [${outFile}]`,
  );
}
