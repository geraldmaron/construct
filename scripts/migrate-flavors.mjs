#!/usr/bin/env node
/**
 * scripts/migrate-flavors.mjs — One-shot backfill of profile metadata into
 * skills/roles/*.md overlays.
 *
 * Idempotent. Every overlay gets:
 *   - profiles: [rnd]   (added if missing; existing values preserved)
 *   - cap: 1            (added if missing)
 *   - version: 2        (bumped from 1 to mark the migration)
 *
 * Writes a .bak sibling per touched file the first time it runs. Re-running
 * is safe and does not re-bake .bak files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(REPO_ROOT, 'skills', 'roles');
// Overlays may start with an HTML comment before the YAML frontmatter,
// so anchor on line-start (m flag) rather than string-start.
const FRONTMATTER_RE = /^(---\n)([\s\S]*?)(\n---)/m;

let touched = 0;
let alreadyMigrated = 0;

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.md') || f === 'README.md') continue;
  const full = path.join(DIR, f);
  const original = fs.readFileSync(full, 'utf8');
  const m = FRONTMATTER_RE.exec(original);
  if (!m) {
    console.warn(`skip (no frontmatter): ${f}`);
    continue;
  }
  const body = m[2];
  const hasProfiles = /^profiles:/m.test(body);
  const hasCap = /^cap:/m.test(body);

  if (hasProfiles && hasCap) {
    alreadyMigrated++;
    continue;
  }

  let newBody = body;
  if (!hasProfiles) {
    newBody = newBody.replace(/version:\s*\d+/, (line) => `${line}\nprofiles: [rnd]`);
    if (!/^profiles:/m.test(newBody)) newBody += '\nprofiles: [rnd]';
  }
  if (!hasCap) {
    newBody = newBody.replace(/profiles: \[[^\]]*\]/, (line) => `${line}\ncap: 1`);
    if (!/^cap:/m.test(newBody)) newBody += '\ncap: 1';
  }
  // Bump version to mark the migration, idempotently.
  if (/^version:\s*1\s*$/m.test(newBody)) {
    newBody = newBody.replace(/^version:\s*1\s*$/m, 'version: 2');
  }

  const updated = original.replace(FRONTMATTER_RE, `${m[1]}${newBody}${m[3]}`);

  const bak = `${full}.bak`;
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, original);
  fs.writeFileSync(full, updated);
  touched++;
}

console.log(`migrate-flavors: touched ${touched}, already migrated ${alreadyMigrated}`);
