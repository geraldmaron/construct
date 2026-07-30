/**
 * tests/rich-document-parser-load.test.mjs — RichDocument parser deps load lazily (construct-tsyfe.3.3).
 *
 * export-provider-contract and document-export must not require unified/remark/rehype at import
 * time so construct doctor and construct beads stay usable when parser deps are missing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('export-provider-contract imports without RichDocument parser adapters', async () => {
  await import('../lib/export-provider-contract.mjs');
});

test('document-export imports without RichDocument parser adapters', async () => {
  await import('../lib/document-export.mjs');
});

test('htmlToRichDocument fails with RICHDOCUMENT_PARSER_DEPS_MISSING when parser deps are absent', () => {
  // The absent-dependency state has to exist somewhere the rest of the suite
  // cannot see. A copy of lib/ with no node_modules beside it resolves every
  // local import and none of the npm ones, which is the condition under test.
  // Hiding a package inside the checkout's own node_modules would produce the
  // same failure here and an unrelated ERR_MODULE_NOT_FOUND in every test that
  // imports it concurrently.

  const sandbox = mkdtempSync(join(tmpdir(), 'construct-parser-deps-'));
  try {
    cpSync(join(REPO, 'lib'), join(sandbox, 'lib'), { recursive: true });
    const entry = pathToFileURL(join(sandbox, 'lib', 'rich-document.mjs')).href;

    // Resolution succeeding here means the sandbox is not dep-free — an
    // ancestor directory supplied the packages. Exit 2 surfaces that as a
    // failure rather than letting the assertion pass for the wrong reason.

    const script = `
      const { htmlToRichDocument } = await import(${JSON.stringify(entry)});
      try {
        htmlToRichDocument('<article></article>');
        process.exit(2);
      } catch (err) {
        if (err.code !== 'RICHDOCUMENT_PARSER_DEPS_MISSING') {
          console.error(err);
          process.exit(3);
        }
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: sandbox,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
