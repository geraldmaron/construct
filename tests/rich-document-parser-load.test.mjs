/**
 * tests/rich-document-parser-load.test.mjs — RichDocument parser deps load lazily (construct-tsyfe.3.3).
 *
 * export-provider-contract and document-export must not require unified/remark/rehype at import
 * time so construct doctor and construct beads stay usable when parser deps are missing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('export-provider-contract imports without RichDocument parser adapters', async () => {
  await import('../lib/export-provider-contract.mjs');
});

test('document-export imports without RichDocument parser adapters', async () => {
  await import('../lib/document-export.mjs');
});

test('htmlToRichDocument fails with RICHDOCUMENT_PARSER_DEPS_MISSING when rehype-parse absent', () => {
  const script = `
    import { renameSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    const pkg = join(process.cwd(), 'node_modules', 'rehype-parse');
    const hidden = join(process.cwd(), 'node_modules', '.rehype-parse-hidden-test');
    let moved = false;
    if (existsSync(pkg)) {
      renameSync(pkg, hidden);
      moved = true;
    }
    try {
      const { htmlToRichDocument } = await import('./lib/rich-document.mjs');
      try {
        htmlToRichDocument('<article></article>');
        process.exit(2);
      } catch (err) {
        if (err.code !== 'RICHDOCUMENT_PARSER_DEPS_MISSING') {
          console.error(err);
          process.exit(3);
        }
      }
    } finally {
      if (moved) renameSync(hidden, pkg);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
