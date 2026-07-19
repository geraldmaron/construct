#!/usr/bin/env node
/** Ensure embedded Procedure discovery remains derived from the canonical catalog. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFINITIONS_PATH = join(HERE, '..', 'lib', 'embedded-contract', 'procedure-definitions.mjs');
const STATIC_ENTRY_PATTERN = /^\s*['"][a-z][a-z0-9-]*['"]\s*:\s*\{/m;

export function checkSource(source) {
  const errors = [];
  if (!/loadAllProcedures/.test(source) || !/\.\.\/procedures\/loader\.mjs/.test(source)) {
    errors.push('Procedure definitions must import loadAllProcedures from ../procedures/loader.mjs');
  }
  if (STATIC_ENTRY_PATTERN.test(source)) {
    errors.push('Procedure definitions contain a hand-authored catalog entry');
  }
  return errors;
}

export function checkAgainstProcedures(procedures, definitions) {
  const expected = new Set(procedures.filter((procedure) => procedure.type !== 'embed' && procedure.state !== 'removed').map((procedure) => procedure.id));
  const actual = new Set(definitions.map((definition) => definition.id));
  const errors = [];
  for (const id of expected) if (!actual.has(id)) errors.push(`Procedure '${id}' is missing from embedded definitions`);
  for (const id of actual) if (!expected.has(id)) errors.push(`Embedded definition '${id}' has no canonical Procedure`);
  return errors;
}

async function main() {
  const { loadAllProcedures } = await import('../lib/procedures/loader.mjs');
  const { listProcedureDefinitions } = await import('../lib/embedded-contract/procedure-definitions.mjs');
  const { procedures, errors: loadErrors } = loadAllProcedures();
  const errors = [
    ...checkSource(readFileSync(DEFINITIONS_PATH, 'utf8')),
    ...loadErrors,
    ...checkAgainstProcedures(procedures, listProcedureDefinitions()),
  ];
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Procedure definitions match ${procedures.length} canonical records`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Procedure definition drift check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
