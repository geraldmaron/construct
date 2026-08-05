/**
 * tests/kernel/implication/corpus-split.test.ts — the seal on the expanded corpus's
 * corpus.
 *
 * Every corpus this project has built died the same death: it was measured
 * against, then tuned against, and by the time anyone quoted its number the
 * number no longer meant what it said. `labeled` shared an author with the
 * catalog. `held-out` stopped being held out the moment the catalog was tuned
 * until it passed. `fresh` says in its own `status` field that committing it
 * spent it.
 *
 * So this corpus was authored in two halves and only one of them may be looked
 * at. That is a discipline, and a discipline nobody enforces is a preference.
 * These tests are the enforcement: the sealed half must stay unread by every
 * scorer in the repo, the two halves must not overlap, and every outcome must
 * carry the provenance that makes its label arguable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';

interface Provenance {
  readonly setting: string;
  readonly authoredBlind: boolean;
  readonly coder1: string[];
  readonly coder2: string[];
  readonly resolution: string;
}

interface Outcome {
  readonly id: string;
  readonly outcome: string;
  readonly expect: string[];
  readonly provenance: Provenance;
}

function load(name: string): { note: string; partition: string; outcomes: Outcome[] } {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
}

const unspent = load('unspent-outcomes.json');
const sealed = load('sealed-outcomes.json');

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * The seal is on *loading* the file, not on naming it: prose may point at the
 * sealed half (this whole file does), but a string literal holding its name is
 * a reader waiting to happen. So the guard looks for the name inside quotes.
 */
const LOADS_SEALED = /['"`][^'"`\s]*sealed-outcomes\.json/;

/** Every file that could read a fixture: the shipped kernel and the scripts. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|mjs|js|sh)$/.test(entry)) found.push(path);
  }
  return found;
}

test('the sealed half is read by nothing in src/ or scripts/', () => {
  const readers: string[] = [];
  for (const file of [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'scripts'))]) {
    if (LOADS_SEALED.test(readFileSync(file, 'utf8'))) readers.push(file);
  }
  assert.deepEqual(
    readers,
    [],
    'a sealed corpus that something scores against is not sealed — it is the next spent corpus:\n' +
      readers.join('\n'),
  );
});

test('the sealed half is scored by no test but this one', () => {
  const here = fileURLToPath(import.meta.url);
  const readers: string[] = [];
  for (const file of sourceFiles(join(ROOT, 'tests'))) {
    if (file === here) continue;
    if (LOADS_SEALED.test(readFileSync(file, 'utf8'))) readers.push(file);
  }
  assert.deepEqual(readers, [], `the seal is broken by:\n${readers.join('\n')}`);
});

test('this test never scores the sealed half against the map either', () => {
  // The seal covers this file too. It may assert on shape and provenance; it may
  // not learn the miss rate, because learning it here is the same act as
  // learning it anywhere else.
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const imports = source.match(/^import .*$/gm) ?? [];
  assert.deepEqual(
    imports.filter((line) => line.includes('implication/map.ts')),
    [],
    'this file must not import the matcher — reading the sealed number is what spends it',
  );
});

test('the two halves are disjoint and together are the whole corpus', () => {
  const ids = new Set(unspent.outcomes.map((o) => o.id));
  for (const o of sealed.outcomes) {
    assert.ok(!ids.has(o.id), `${o.id} appears in both halves`);
  }
  const texts = new Set(unspent.outcomes.map((o) => o.outcome.toLowerCase()));
  for (const o of sealed.outcomes) {
    assert.ok(!texts.has(o.outcome.toLowerCase()), `${o.id} duplicates wording in the measured half`);
  }
  assert.equal(unspent.outcomes.length + sealed.outcomes.length, 144);
});

test('both halves carry every setting, so neither is one author\'s whole output', () => {
  const settings = (o: Outcome[]) => new Set(o.map((x) => x.provenance.setting));
  const a = settings(unspent.outcomes);
  const b = settings(sealed.outcomes);
  assert.equal(a.size, 8, 'the measured half should carry all eight settings');
  assert.deepEqual([...a].sort(), [...b].sort(), 'the halves must span the same settings');
});

test('the measured half carries enough labels for the question it is asked', () => {
  // RESEARCH-DECISIONS.md section 1: distinguishing a true miss rate of 0.30
  // from the 0.15 target at 80% power, two-sided 5%, needs 64 labels. A
  // partition below that cannot answer the question it exists to answer.
  const labels = (o: Outcome[]) => o.reduce((a, x) => a + x.expect.length, 0);
  assert.ok(labels(unspent.outcomes) >= 64, `measured half has ${labels(unspent.outcomes)} labels, under 64`);
  assert.ok(labels(sealed.outcomes) >= 64, `sealed half has ${labels(sealed.outcomes)} labels, under 64`);
});

test('every outcome records how it was authored and how it was labeled', () => {
  const known = new Set(DOMAINS.map((d) => d.domain));
  for (const half of [unspent, sealed]) {
    for (const o of half.outcomes) {
      assert.ok(o.provenance, `${o.id} has no provenance`);
      assert.equal(o.provenance.authoredBlind, true, `${o.id} was not authored blind`);
      assert.ok(o.provenance.setting.length > 0, `${o.id} names no setting`);
      assert.ok(
        ['both coders agreed', 'adjudicated'].includes(o.provenance.resolution),
        `${o.id} has an unrecognised resolution "${o.provenance.resolution}"`,
      );
      for (const domain of [...o.expect, ...o.provenance.coder1, ...o.provenance.coder2]) {
        assert.ok(known.has(domain), `${o.id} names unknown domain "${domain}"`);
      }
      if (o.provenance.resolution === 'both coders agreed') {
        assert.deepEqual(
          [...o.expect].sort(),
          [...o.provenance.coder1].sort(),
          `${o.id} claims agreement but its expect set differs from the coders'`,
        );
      }
    }
  }
});

test('the corpus does not reuse wording from the corpora it replaces', () => {
  const older = new Set<string>();
  for (const name of ['labeled-outcomes.json', 'held-out-outcomes.json', 'fresh-outcomes.json']) {
    for (const o of load(name).outcomes) older.add(o.outcome.toLowerCase());
  }
  for (const half of [unspent, sealed]) {
    for (const o of half.outcomes) {
      assert.ok(!older.has(o.outcome.toLowerCase()), `${o.id} is copied from an older corpus`);
    }
  }
});
