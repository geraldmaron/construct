#!/usr/bin/env node
/**
 * scripts/labeling-kit/generate-sheets.mjs — blind per-coder labeling sheets
 * for the multi-coder agreement study (construct-2jb.3).
 *
 * Draws outcomes from the held-out and fresh corpora ONLY
 * (tests/kernel/implication/fixtures/{held-out,fresh}-outcomes.json) — never
 * from labeled-outcomes.json, which was authored alongside the domain catalog
 * and is the exact single-author circularity construct-gsf identified. Every
 * outcome drawn here was written situation-first by someone who was not
 * looking at the catalog while writing it.
 *
 * The existing `expect` (and `category`, which leaks a hint toward the
 * expected domain) fields are stripped before a sheet is written: a coder
 * must never see anyone's prior answer, including the corpus author's own.
 *
 * All coders label the SAME set of outcomes — alpha requires overlapping
 * units — but each coder's sheet independently shuffles the presentation
 * order, seeded from the coder's own name, so no coder can infer another
 * coder's answers from position, and no coder can reconstruct the corpora's
 * original order (which groups outcomes by category and would itself be a
 * hint).
 *
 * This script produces empty answer fields only. It does not label anything,
 * and it must never be modified to do so — see CLAUDE.md and the bead notes:
 * agent-generated labels here would recreate the single-author circularity
 * with a model as the author.
 *
 * Usage:
 *   node scripts/labeling-kit/generate-sheets.mjs <coder-name> [<coder-name> ...]
 *   node scripts/labeling-kit/generate-sheets.mjs alice bob carol
 *
 * Writes one sheet per coder to scripts/labeling-kit/sheets/<coder-name>.json
 * plus a manifest recording provenance.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DOMAINS } from '../../src/kernel/implication/domains.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = join(ROOT, 'tests/kernel/implication/fixtures');
const OUT_DIR = join(ROOT, 'scripts/labeling-kit/sheets');

// Only non-circular, situation-first corpora. Order matters not at all here —
// it is reshuffled per coder below — but is fixed so the POOL is identical
// across runs and across coders.
const SOURCE_CORPORA = ['held-out-outcomes.json', 'fresh-outcomes.json'];
const MIN_OUTCOMES = 30;

/** Deterministic PRNG (mulberry32) so a coder's shuffle is reproducible from
 *  their name alone, without needing to store per-run random state. */
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffled(items, seedString) {
  const rand = mulberry32(hashSeed(seedString));
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function loadPool() {
  const pool = [];
  for (const file of SOURCE_CORPORA) {
    const parsed = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
    for (const o of parsed.outcomes) {
      // Strip `expect` and `category` deliberately: neither may reach a coder.
      pool.push({ id: `${file.replace('-outcomes.json', '')}:${o.id}`, outcome: o.outcome });
    }
  }
  return pool;
}

function main() {
  const coders = process.argv.slice(2);
  if (coders.length < 2) {
    console.error('usage: node scripts/labeling-kit/generate-sheets.mjs <coder-name> [<coder-name> ...]');
    console.error('  needs at least 2 coder names (the study needs >= 2 independent coders)');
    process.exit(1);
  }

  const pool = loadPool();
  if (pool.length < MIN_OUTCOMES) {
    console.error(`pool has only ${pool.length} outcomes, need >= ${MIN_OUTCOMES}`);
    process.exit(1);
  }

  // The pool itself is drawn once, in a fixed (non-coder-dependent) shuffle,
  // so every coder gets the identical SET of outcomes — only presentation
  // order differs per coder below. Every outcome in the non-circular pool is
  // used: the pool is already the corpora's full 34, all above MIN_OUTCOMES,
  // and there is no reason to discard usable, non-model-authored outcomes.
  const finalDrawn = shuffled(pool, 'construct-2jb.3:draw');

  const catalog = DOMAINS.map((d) => ({ domain: d.domain, concern: d.concern }));

  mkdirSync(OUT_DIR, { recursive: true });

  for (const coder of coders) {
    const order = shuffled(finalDrawn, `construct-2jb.3:order:${coder}`);
    const sheet = {
      coder,
      instructions: 'See scripts/labeling-kit/CODER-INSTRUCTIONS.md before labeling.',
      catalog,
      outcomes: order.map((o, i) => ({
        sheetPosition: i + 1,
        id: o.id,
        outcome: o.outcome,
        // Fill with an array of zero or more domain names from `catalog`
        // above. Leave [] if none apply. Do not leave null.
        labels: null,
      })),
    };
    const path = join(OUT_DIR, `${coder}.json`);
    writeFileSync(path, JSON.stringify(sheet, null, 2) + '\n');
    console.log(`wrote ${path} (${sheet.outcomes.length} outcomes)`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    coders,
    sourceCorpora: SOURCE_CORPORA,
    poolSize: pool.length,
    outcomesPerSheet: finalDrawn.length,
    note: 'labels field is null (unlabeled) in every generated sheet; no agent or script has populated it',
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${join(OUT_DIR, 'manifest.json')}`);
}

main();
