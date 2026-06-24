/**
 * lib/cli-service-inventory.mjs — auditable public CLI/catalog/docs inventory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CLI_COMMANDS } from './cli-commands.mjs';

function slugify(category) {
  return category.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function handlerNames(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, 'bin', 'construct'), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/\n {2,3}\[\s*'([^']+)'\s*,/g)) names.add(match[1]);
  return names;
}

/**
 * The catalog is the public-service source of truth. This projection joins it
 * to runtime dispatch and the generated reference pages so drift is observable
 * without treating internal handlers as public services.
 */
export function buildCliServiceInventory({ rootDir = process.cwd() } = {}) {
  const handlers = handlerNames(rootDir);
  return CLI_COMMANDS.filter((spec) => !spec.internal).map((spec) => {
    const page = path.join(rootDir, 'docs', 'guides', 'reference', 'cli', `${slugify(spec.category)}.md`);
    const pageText = fs.existsSync(page) ? fs.readFileSync(page, 'utf8') : '';
    return {
      name: spec.name,
      category: spec.category,
      runnable: handlers.has(spec.name),
      documented: pageText.includes(`## construct ${spec.name}`),
      usage: spec.usage,
      subcommands: (spec.subcommands ?? []).map((sub) => ({
        name: typeof sub === 'string' ? sub : sub.name,
        documented: typeof sub === 'string' ? true : Boolean(sub.desc || sub.description),
      })),
    };
  });
}
