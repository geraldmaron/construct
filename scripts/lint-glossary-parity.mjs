#!/usr/bin/env node
/**
 * lint-glossary-parity.mjs — v2 renamed things constantly (persona/ring/trunk
 * became role/lesson/playbook mid-stream) with silent misses that broke
 * consumers for weeks (a graph node-prefix rename left 6 consumers empty).
 * This lint parses GLOSSARY.md as the single source of truth and fails CI if
 * a retired synonym appears in src/, packs/, or schemas/.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const GLOSSARY_SCOPE = [/^src\//, /^packs\//, /^schemas\//];
// src/kernel/intake/tables/ is ported corpus data, not prose, and holds two
// things the glossary cannot govern:
//   - match keywords, which are the words USERS write in their documents ("api
//     contract" is what a reader typed; rewriting it to "api brief" would stop
//     the classifier matching real input),
//   - v2 rdStage values, which are load-bearing output locked by the golden
//     corpus — renaming one is a behavior change, not a rename.
// The stage-vocabulary reconciliation is tracked separately; see construct-506.2.
const EXEMPT = [
  /\.test\.ts$/,
  /^scripts\/lint-glossary-parity\.mjs$/,
  /^src\/kernel\/intake\/tables\//,
];

function parseGlossary(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [, term, retired] = cells;
    if (!term || term === 'Term (use this)' || term.startsWith('---')) continue;
    if (retired && retired !== '—' && retired !== '-') {
      rows.push({ term, retired });
    }
  }
  return rows;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => GLOSSARY_SCOPE.some((re) => re.test(f)))
    .filter((f) => !EXEMPT.some((re) => re.test(f)));
}

const glossaryPath = new URL('../GLOSSARY.md', import.meta.url);
const glossaryText = readFileSync(glossaryPath, 'utf8');
const retiredTerms = parseGlossary(glossaryText);

let violations = 0;
for (const file of trackedFiles()) {
  const content = readFileSync(file, 'utf8');
  for (const { term, retired } of retiredTerms) {
    const re = new RegExp(`\\b${retired}\\b`, 'i');
    if (re.test(content)) {
      violations += 1;
      process.stderr.write(`glossary violation: ${file} uses retired term "${retired}" — use "${term}"\n`);
    }
  }
}

if (violations > 0) {
  process.stderr.write(`\n${violations} glossary violation(s).\n`);
  process.exit(1);
}
process.stdout.write('lint-glossary-parity: clean\n');
