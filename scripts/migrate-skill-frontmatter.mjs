#!/usr/bin/env node
/**
 * scripts/migrate-skill-frontmatter.mjs — One-shot migration of HTML-comment
 * preamble to YAML frontmatter on skills/**\/\*.md files.
 *
 * The HTML comment format is:
 *   <!--
 *   skills/category/name.md (Display Name) Description text.
 *   More description.
 *   -->
 *
 * The YAML frontmatter target format (matching skills/roles/ shape):
 *   ---
 *   name: name-from-filename
 *   description: first-sentence from comment
 *   ---
 *
 * The script:
 *   - Idempotent: skips files that already have YAML frontmatter.
 *   - Dry-run by default (pass --apply to write).
 *   - Reports every file it would touch and every file it skips.
 *   - Refuses to overwrite an existing YAML frontmatter block (skip + warn).
 *
 * Usage:
 *   node scripts/migrate-skill-frontmatter.mjs          # dry-run
 *   node scripts/migrate-skill-frontmatter.mjs --apply  # write changes
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(MODULE_DIR, '..');
const SKILLS_DIR = join(ROOT_DIR, 'skills');
const APPLY = process.argv.includes('--apply');
const QUIET = process.argv.includes('--quiet');

function log(msg) { if (!QUIET) process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('[migrate-skill-frontmatter] ' + msg + '\n'); }

// Walk skills/ directory recursively for .md files.
function* walkSkills(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walkSkills(full);
    } else if (stat.isFile() && extname(entry) === '.md') {
      yield full;
    }
  }
}

// Parse the HTML comment preamble from a skill file.
// Returns { name, description } or null if no preamble found.
function parseHtmlPreamble(content) {
  const match = content.match(/^<!--\n([\s\S]*?)-->/);
  if (!match) return null;
  const body = match[1].trim();
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // First line format: "path (Display Name) description..." or "path description..."
  const firstLine = lines[0];
  const parenMatch = firstLine.match(/^skills\/[^\s]+ \(([^)]+)\)\s*(.*)/);
  let name = '';
  let descLines = [];

  if (parenMatch) {
    name = parenMatch[1];
    const rest = parenMatch[2].trim();
    if (rest) descLines.push(rest);
    descLines.push(...lines.slice(1));
  } else {
    // Derive name from path on first line.
    const pathMatch = firstLine.match(/^skills\/[^/]+\/([^.\s]+)/);
    name = pathMatch ? pathMatch[1].replace(/-/g, ' ') : '';
    // Rest of lines after the path/description line are description.
    const afterPath = firstLine.replace(/^skills\/[^\s]+\s*/, '').trim();
    if (afterPath) descLines.push(afterPath);
    descLines.push(...lines.slice(1));
  }

  const description = descLines
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Take only the first sentence.
    .replace(/\.\s+.*$/, '.')
    .replace(/^Use this skill when /, 'Use when ')
    .slice(0, 200);

  return { name: name.trim(), description: description.trim() };
}

// Check if file already has YAML frontmatter.
function hasYamlFrontmatter(content) {
  return /^---\n/.test(content);
}

let total = 0;
let migrated = 0;
let skipped = 0;
let noComment = 0;

for (const filePath of walkSkills(SKILLS_DIR)) {
  total++;
  const content = readFileSync(filePath, 'utf8');

  if (hasYamlFrontmatter(content)) {
    log(`  skip (already has frontmatter): ${filePath.replace(ROOT_DIR + '/', '')}`);
    skipped++;
    continue;
  }

  const preamble = parseHtmlPreamble(content);
  if (!preamble) {
    log(`  skip (no HTML comment preamble): ${filePath.replace(ROOT_DIR + '/', '')}`);
    noComment++;
    continue;
  }

  // Build YAML frontmatter.
  const nameFromFile = basename(filePath, '.md');
  const yamlName = preamble.name || nameFromFile;
  const yamlDesc = preamble.description || `Skill: ${nameFromFile}`;

  const frontmatter = `---\nname: ${yamlName}\ndescription: "${yamlDesc.replace(/"/g, '\\"')}"\n---\n`;

  // Replace the HTML comment block with YAML frontmatter.
  const newContent = content.replace(/^<!--\n[\s\S]*?-->\n*/, frontmatter);

  log(`  ${APPLY ? 'migrate' : 'would migrate'}: ${filePath.replace(ROOT_DIR + '/', '')}`);
  log(`    name: ${yamlName}`);
  log(`    description: ${yamlDesc.slice(0, 80)}${yamlDesc.length > 80 ? '...' : ''}`);

  if (APPLY) {
    writeFileSync(filePath, newContent);
    migrated++;
  } else {
    migrated++;
  }
}

log('');
log(`Results: ${total} files scanned, ${migrated} ${APPLY ? 'migrated' : 'would migrate'}, ${skipped} skipped (already done), ${noComment} skipped (no comment)`);
if (!APPLY && migrated > 0) {
  log('Run with --apply to write changes.');
}
