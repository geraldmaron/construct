/**
 * scripts/capture-legacy-dispatcher-golden.mjs — one-shot capture of the
 * predecessor's route scoring, frozen into
 * tests/kernel/routing/fixtures/dispatcher-golden.json.
 *
 * Same discipline as the classifier capture: the port is locked to what v2
 * actually returned, not to a reading of its source. v2's suggestSkills only
 * takes routes off disk, so each case's route table is written into a tmpdir as
 * skills/routing.json and v2 is pointed at it.
 *
 * Scope note: v2 also folded deliverable-manifest entries into the scored set
 * when the intent mentioned "prd" or "adr". That is host data, not kernel
 * logic — the port takes an already-merged `routes` list — so the capture runs
 * against an empty manifest and the corpus stays a pure test of scoring.
 *
 * Needs a construct-legacy checkout; NOT part of the test run. The frozen JSON
 * is. A diff on re-run is a real behavior change.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyCheckout } from './lib/legacy-checkout.mjs';

const LEGACY = legacyCheckout();

const { suggestSkills } = await import(`${LEGACY}/lib/skills/router.mjs`);

const casesUrl = new URL('../tests/kernel/routing/fixtures/dispatcher-cases.json', import.meta.url);
const CASES = JSON.parse(readFileSync(casesUrl, 'utf8'));

const golden = [];
for (const c of CASES) {
  // A fresh root per case: v2 caches routes per rootDir, and reusing one root
  // would serve the first case's table to every later case.
  const root = mkdtempSync(join(tmpdir(), 'dispatcher-golden-'));
  try {
    mkdirSync(join(root, 'skills'), { recursive: true });
    writeFileSync(join(root, 'skills', 'routing.json'), JSON.stringify({ routes: c.routes }));
    const result = suggestSkills({ intent: c.intent, limit: c.limit ?? 5, rootDir: root });
    golden.push({ name: c.name, intent: c.intent, routes: c.routes, limit: c.limit ?? 5, result });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const out = new URL('../tests/kernel/routing/fixtures/dispatcher-golden.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(golden, null, 2)}\n`);
console.log(`captured ${golden.length} cases -> ${out.pathname}`);
