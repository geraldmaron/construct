/**
 * scripts/benchmarks/mailparser-vs-hand-rolled.mjs — prototype-only benchmark
 * comparing the hand-rolled MIME parser in lib/document-extract.mjs against
 * the `mailparser` npm package on a small representative .eml/.msg corpus.
 *
 * Scratch harness for construct-tsyfe.2.6 (Fable 5 program): not wired into
 * CI, not a shipped test, not imported by any lib/ or bin/ code. Requires
 * `mailparser` present in node_modules, installed via
 * `npm install --no-save mailparser` so package.json stays untouched.
 * Run: node scripts/benchmarks/mailparser-vs-hand-rolled.mjs
 *
 * Prints a markdown results table to stdout: per-fixture correctness fields
 * from both parsers side by side, plus a basic timing comparison over
 * repeated parses of the same corpus.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { extractDocumentText } from '../../lib/document-extract.mjs';

let simpleParser;
try {
  ({ simpleParser } = await import('mailparser'));
} catch {
  console.error('mailparser is not installed. Run: npm install --no-save mailparser');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '..', '..', 'tests', 'fixtures', 'email-mime');

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.eml') || f.endsWith('.msg'))
  .sort();

function runHandRolled(filePath) {
  try {
    const result = extractDocumentText(filePath);
    return {
      ok: true,
      subject: result.structured?.subject ?? null,
      from: result.structured?.from ?? null,
      attachments: (result.attachments || []).map((a) => (typeof a === 'string' ? a : a.filename)),
      textPreview: (result.text || '').slice(0, 160).replace(/\n/g, '\\n'),
      droppedInfo: (result.droppedInfo || []).map((d) => `${d.kind}:${d.count}`),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runMailparser(filePath) {
  const raw = readFileSync(filePath);
  try {
    const parsed = await simpleParser(raw);
    return {
      ok: true,
      subject: parsed.subject ?? null,
      from: parsed.from?.text ?? null,
      attachments: (parsed.attachments || []).map((a) => a.filename),
      textPreview: (parsed.text || '').slice(0, 160).replace(/\n/g, '\\n'),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const rows = [];
for (const name of fixtures) {
  const filePath = join(FIXTURE_DIR, name);
  const handRolled = runHandRolled(filePath);
  const mailParserResult = await runMailparser(filePath);
  rows.push({ name, handRolled, mailParserResult });
}

console.log('## Correctness — per fixture\n');
for (const { name, handRolled, mailParserResult } of rows) {
  console.log(`### ${name}\n`);
  console.log('| field | hand-rolled (current) | mailparser |');
  console.log('|---|---|---|');
  if (!handRolled.ok) {
    console.log(`| error | \`${handRolled.error}\` | — |`);
  }
  if (!mailParserResult.ok) {
    console.log(`| error | — | \`${mailParserResult.error}\` |`);
  }
  if (handRolled.ok || mailParserResult.ok) {
    console.log(`| subject | ${JSON.stringify(handRolled.subject ?? null)} | ${JSON.stringify(mailParserResult.subject ?? null)} |`);
    console.log(`| from | ${JSON.stringify(handRolled.from ?? null)} | ${JSON.stringify(mailParserResult.from ?? null)} |`);
    console.log(`| attachments | ${JSON.stringify(handRolled.attachments ?? null)} | ${JSON.stringify(mailParserResult.attachments ?? null)} |`);
    console.log(`| text preview | \`${handRolled.textPreview ?? ''}\` | \`${mailParserResult.textPreview ?? ''}\` |`);
    console.log(`| droppedInfo (hand-rolled only) | ${JSON.stringify(handRolled.droppedInfo ?? [])} | n/a |`);
  }
  console.log();
}

// --- basic timing: N repeated parses of the whole corpus, single process ---

const ITERATIONS = 200;

const handRolledStart = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  for (const name of fixtures) {
    try { extractDocumentText(join(FIXTURE_DIR, name)); } catch { /* counted in correctness table above */ }
  }
}
const handRolledMs = performance.now() - handRolledStart;

const mailparserStart = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  for (const name of fixtures) {
    try { await simpleParser(readFileSync(join(FIXTURE_DIR, name))); } catch { /* counted in correctness table above */ }
  }
}
const mailparserMs = performance.now() - mailparserStart;

const totalParses = ITERATIONS * fixtures.length;
console.log('## Basic performance\n');
console.log(`Corpus: ${fixtures.length} fixtures, ${ITERATIONS} iterations, ${totalParses} total parses per parser.\n`);
console.log('| parser | total ms | ms/parse |');
console.log('|---|---|---|');
console.log(`| hand-rolled | ${handRolledMs.toFixed(1)} | ${(handRolledMs / totalParses).toFixed(4)} |`);
console.log(`| mailparser | ${mailparserMs.toFixed(1)} | ${(mailparserMs / totalParses).toFixed(4)} |`);
