/**
 * scripts/build-reference-docx.mjs — regenerate the Construct-branded pandoc
 * reference doc for DOCX/DOC export.
 *
 * Pandoc copies paragraph and character styles from a --reference-doc when it
 * produces docx, so construct-branded exports render in distribution typography:
 * Space Grotesk for headings and body (the brand sans) and JetBrains Mono for
 * code. The brand is monochrome ink, so typography — not color — carries the
 * branding. Rather than hand-author an opaque binary, this generator starts from
 * pandoc's own default reference doc and patches only the theme fonts and the
 * Verbatim code font, so templates/distribution/construct-reference.docx stays
 * reproducible and auditable: rerun this script to refresh it after a pandoc
 * upgrade or a brand-font change.
 *
 * Requires pandoc (canonical source of the default reference doc) plus zip/unzip
 * on PATH. Maintainer-only — never invoked on user machines or at export time.
 * Run: node scripts/build-reference-docx.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(REPO_ROOT, 'templates', 'distribution', 'construct-reference.docx');

const SANS = 'Space Grotesk';
const MONO = 'JetBrains Mono';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || r.error?.message || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed (status ${r.status}): ${detail}`);
  }
  return r;
}

// Each needle must be present in the pandoc default before substitution; an
// absent needle means the default diverges from these strings, so fail loudly
// instead of silently shipping an unbranded reference doc.

function patch(file, replacements) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [needle, value] of replacements) {
    if (!text.includes(needle)) throw new Error(`expected to find ${JSON.stringify(needle)} in ${path.basename(file)} — pandoc default changed; update ${path.basename(fileURLToPath(import.meta.url))}`);
    text = text.split(needle).join(value);
  }
  fs.writeFileSync(file, text);
}

function assertContains(file, marker) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(marker)) throw new Error(`post-patch check failed: ${marker} not present in ${path.basename(file)}`);
}

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-refdoc-build-'));
  const basePath = path.join(work, 'reference.docx');
  const unpacked = path.join(work, 'unpacked');

  const base = run('pandoc', ['--print-default-data-file', 'reference.docx'], { encoding: 'buffer' });
  fs.writeFileSync(basePath, base.stdout);
  run('unzip', ['-o', '-q', basePath, '-d', unpacked]);

  const themePath = path.join(unpacked, 'word', 'theme', 'theme1.xml');
  const stylesPath = path.join(unpacked, 'word', 'styles.xml');
  const fontTablePath = path.join(unpacked, 'word', 'fontTable.xml');

  patch(themePath, [
    ['typeface="Aptos Display"', `typeface="${SANS}"`],
    ['typeface="Aptos"', `typeface="${SANS}"`],
  ]);
  patch(stylesPath, [
    ['w:ascii="Consolas" w:hAnsi="Consolas"', `w:ascii="${MONO}" w:hAnsi="${MONO}"`],
  ]);

  const fontDecls = `  <w:font w:name="${SANS}"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>\n  <w:font w:name="${MONO}"><w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>\n</w:fonts>`;
  patch(fontTablePath, [['</w:fonts>', fontDecls]]);

  assertContains(themePath, `typeface="${SANS}"`);
  assertContains(stylesPath, `w:ascii="${MONO}"`);
  assertContains(fontTablePath, `w:name="${MONO}"`);

  const entries = fs.readdirSync(unpacked);
  const outPath = path.join(work, 'construct-reference.docx');
  run('zip', ['-r', '-X', '-q', outPath, ...entries], { cwd: unpacked });

  fs.copyFileSync(outPath, TARGET);
  fs.rmSync(work, { recursive: true, force: true });

  const bytes = fs.statSync(TARGET).size;
  process.stdout.write(`wrote ${path.relative(REPO_ROOT, TARGET)} (${bytes} bytes) — ${SANS} headings/body, ${MONO} code\n`);
}

main();
