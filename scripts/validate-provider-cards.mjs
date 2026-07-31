/**
 * scripts/validate-provider-cards.mjs — Provider Card registry validator.
 *
 * Reads registry/provider-cards.json (or --path override) and validates it
 * against schemas/provider-card.schema.json via
 * lib/providers/provider-card.mjs's validateProviderCardRegistry, which
 * checks the top-level `{version, providers}` shape, every provider entry's
 * required fields (id, kind, versionPolicy, healthCheck, fallback, owner,
 * removalCriteria) and enum values, and duplicate ids.
 *
 * Exits non-zero and names every offending field/entry if validation fails —
 * mirrors scripts/validate-dep-intent.mjs's exit-code contract
 * (acceptance criteria 2-3).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProviderCardRegistry, DEFAULT_REGISTRY_PATH } from '../lib/providers/provider-card.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const pathFlagIdx = argv.indexOf('--path');
  const registryPath = pathFlagIdx !== -1 && argv[pathFlagIdx + 1]
    ? resolve(ROOT, argv[pathFlagIdx + 1])
    : DEFAULT_REGISTRY_PATH;
  return { registryPath };
}

function loadJSON(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[error] Failed to load ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

const { registryPath } = parseArgs(process.argv.slice(2));

if (!existsSync(registryPath)) {
  console.error(`[error] Provider Card registry not found: ${registryPath}`);
  process.exit(1);
}

const doc = loadJSON(registryPath);
const result = validateProviderCardRegistry(doc);

if (!result.ok) {
  console.error(`\n[error] ${result.errors.length} Provider Card validation error(s) in ${registryPath}:`);
  for (const err of result.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`[ok] All ${result.count} Provider Card(s) in ${registryPath} validate against schemas/provider-card.schema.json.`);
process.exit(0);
