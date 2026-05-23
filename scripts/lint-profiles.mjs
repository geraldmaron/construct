#!/usr/bin/env node
/**
 * scripts/lint-profiles.mjs — Profile + flavor lint gate.
 *
 * Runs three checks: curated profile shape, per-flavor frontmatter, per-role
 * cap. Exits 0 clean, 1 on any violation. Use --quiet to suppress per-file
 * output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listProfiles, loadProfile } from '../lib/profiles/loader.mjs';
import { FLAVOR_CAP_PER_ROLE_PER_PROFILE, listAllFlavors, perRoleFlavorCount, validateFlavor } from '../lib/flavors/loader.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLAVORS_DIR = path.join(REPO_ROOT, 'skills', 'roles');
const quiet = process.argv.includes('--quiet');

let failed = 0;

function fail(msg) { failed++; console.error(`  ✗ ${msg}`); }
function ok(msg) { if (!quiet) console.log(`  ✓ ${msg}`); }

function checkProfile(id) {
  const p = loadProfile(id);
  if (!p) return fail(`profile ${id} did not load`);
  if (!p.id || !/^[a-z][a-z0-9-]{1,30}$/.test(p.id)) fail(`profile ${id}: bad id`);
  if (!Array.isArray(p.roles) || p.roles.length === 0) fail(`profile ${id}: no roles`);
  if (p.roles && p.roles.length > 80) fail(`profile ${id}: roles exceed 80`);
  if (!p.intake?.types || p.intake.types.length > 24) fail(`profile ${id}: intake.types missing or >24`);
  if (!p.intake?.stages || p.intake.stages.length > 12) fail(`profile ${id}: intake.stages missing or >12`);

  if (Array.isArray(p.departments)) {
    if (p.departments.length > 12) fail(`profile ${id}: departments exceed 12`);
    for (const [i, dept] of p.departments.entries()) {
      if (!dept?.id) fail(`profile ${id}: departments[${i}].id missing`);
      if (!dept?.charter || dept.charter.length < 20) {
        fail(`profile ${id}: departments[${i}=${dept?.id || '?'}].charter must be a real mission statement (>= 20 chars)`);
      }
      if (!Array.isArray(dept?.roles) || dept.roles.length === 0) {
        fail(`profile ${id}: departments[${i}=${dept?.id || '?'}].roles must be non-empty`);
      } else if (dept.roles.length > 20) {
        fail(`profile ${id}: departments[${i}=${dept?.id || '?'}].roles exceeds 20`);
      }
      for (const r of dept.roles || []) {
        if (!p.roles.includes(r)) {
          fail(`profile ${id}: departments[${i}=${dept?.id || '?'}] role ${r} not declared in profile.roles`);
        }
      }
    }
  }

  ok(`profile ${id}`);
}

function checkFlavor(file) {
  const errors = validateFlavor(path.join(FLAVORS_DIR, file));
  if (errors.length > 0) for (const e of errors) fail(e);
  else ok(`flavor ${file}`);
}

function checkPerRoleCap(id) {
  const counts = perRoleFlavorCount(id);
  for (const [role, count] of Object.entries(counts)) {
    if (count > FLAVOR_CAP_PER_ROLE_PER_PROFILE) {
      fail(`profile ${id} role ${role}: ${count} flavors exceeds cap ${FLAVOR_CAP_PER_ROLE_PER_PROFILE}`);
    }
  }
}

console.log('lint:profiles');

const ids = listProfiles();
for (const id of ids) checkProfile(id);

const flavorFiles = fs.readdirSync(FLAVORS_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
for (const f of flavorFiles) checkFlavor(f);

for (const id of ids) checkPerRoleCap(id);

if (failed === 0) {
  console.log(`\nlint:profiles — clean (${ids.length} profile${ids.length === 1 ? '' : 's'}, ${flavorFiles.length} overlay${flavorFiles.length === 1 ? '' : 's'})`);
  process.exit(0);
} else {
  console.error(`\nlint:profiles — ${failed} violation${failed === 1 ? '' : 's'}`);
  process.exit(1);
}
