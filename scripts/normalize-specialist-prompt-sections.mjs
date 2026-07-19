/**
 * scripts/normalize-specialist-prompt-sections.mjs — one-shot body normalization for
 * specialist prompts: bold anti-fabrication lines become ## headings; missing Output
 * format sections get a minimal canonical block. Idempotent — safe to re-run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePromptFiles } from '../lib/worker-profiles/prompt-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS_DIR = path.join(ROOT, 'specialists', 'prompts');

const OUTPUT_FORMAT_FALLBACK = `## Output format

Follow the repository specialist handoff contract. Cite sources for load-bearing claims, surface unknowns as \`[unverified]\`, and return DONE, BLOCKED, or NEEDS_MAIN_INPUT — never reply directly to the user.`;

function hasHeading(body, title) {
  const target = String(title).trim().toLowerCase();
  const re = /^#{1,6}\s+(.+)$/gm;
  let m;
  while ((m = re.exec(body))) {
    if (m[1].trim().toLowerCase() === target) return true;
  }
  return false;
}

function normalizeBody(body) {
  let next = body;

  next = next.replace(
    /^\*\*Anti-fabrication contract\*\*:\s*(.+)$/m,
    '## Anti-fabrication contract\n\n$1',
  );

  if (!hasHeading(next, 'Output format')) {
    next = `${next.trimEnd()}\n\n${OUTPUT_FORMAT_FALLBACK}\n`;
  }

  return next;
}

function normalizeFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return false;
  const body = raw.slice(m[0].length);
  const normalizedBody = normalizeBody(body);
  if (normalizedBody === body) return false;
  fs.writeFileSync(filePath, `${m[0]}${normalizedBody}`);
  return true;
}

const changed = [];
for (const name of fs.readdirSync(PROMPTS_DIR).sort()) {
  if (!name.endsWith('.md')) continue;
  const filePath = path.join(PROMPTS_DIR, name);
  if (normalizeFile(filePath)) changed.push(name);
}

const result = validatePromptFiles({ rootDir: ROOT });
process.stdout.write(`normalized ${changed.length} file(s): ${changed.join(', ') || '(none)'}\n`);
process.stdout.write(`lint: ${result.errors.length} error(s), ${result.warnings.length} warning(s)\n`);
if (result.errors.length) {
  for (const e of result.errors) process.stderr.write(`  error  ${e}\n`);
  process.exit(1);
}
if (result.warnings.length) {
  for (const w of result.warnings) process.stderr.write(`  warn  ${w}\n`);
  process.exit(1);
}
