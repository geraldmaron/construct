#!/usr/bin/env node
/**
 * scripts/migrate-specialist-prompt-frontmatter.mjs — bulk-wrap legacy specialist
 * prompts with hybrid frontmatter from specialists/registry.json (ADR-0037 phase 2).
 *
 * Emit-neutral: preserves each prompt body byte-for-byte (plus trailing newline).
 * Writes golden body fixtures under tests/fixtures/specialist-prompt-emit/.
 * Run: node scripts/migrate-specialist-prompt-frontmatter.mjs [--write-goldens]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertLegacyPromptFile } from '../lib/specialists/scaffold.mjs';
import { readPromptBody } from '../lib/prompt-composer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const writeGoldens = process.argv.includes('--write-goldens');

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'specialists', 'registry.json'), 'utf8'));
const agents = registry.specialists || [];

let converted = 0;
let skipped = 0;
const goldenDir = path.join(ROOT, 'tests', 'fixtures', 'specialist-prompt-emit');
fs.mkdirSync(goldenDir, { recursive: true });

for (const entry of agents) {
  const role = entry.name;
  if (!role || !entry.promptFile) continue;
  const result = convertLegacyPromptFile({ rootDir: ROOT, role, registryEntry: entry });
  if (result.converted) converted += 1;
  else skipped += 1;

  if (writeGoldens) {
    const id = `cx-${role}`;
    const body = readPromptBody(`specialists/prompts/${id}.md`, ROOT);
    fs.writeFileSync(path.join(goldenDir, `${id}.body.txt`), body.endsWith('\n') ? body : `${body}\n`);
  }
}

console.log(`converted=${converted} skipped=${skipped}${writeGoldens ? ' goldens=written' : ''}`);
