/**
 * lib/packs/core-pack.mjs — programmatic builtin core pack loader.
 *
 * Reads specialists/org/ directory structure and wraps it as the
 * @construct/core pack. This is the builtin tier pack that provides
 * all default specialists, teams, and prompts shipped with Construct.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

export function loadCorePack(rootDir = PACKAGE_ROOT) {
  const orgDir = join(rootDir, 'specialists', 'org');
  const specialistDir = join(orgDir, 'specialists');
  const teamDir = join(orgDir, 'teams');

  const specialists = existsSync(specialistDir)
    ? readdirSync(specialistDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    : [];

  const teams = existsSync(teamDir)
    ? readdirSync(teamDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    : [];

  const prompts = {};
  for (const specId of specialists) {
    try {
      const spec = JSON.parse(readFileSync(join(specialistDir, `${specId}.json`), 'utf8'));
      if (spec.promptFile) prompts[specId] = spec.promptFile;
    } catch {}
  }

  return {
    id: '@construct/core',
    version: '0.0.0',
    compatVersion: 1,
    teams,
    specialists,
    prompts,
    _tier: 'builtin',
    _sourceDir: orgDir,
  };
}