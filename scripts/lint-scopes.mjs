#!/usr/bin/env node
/**
 * scripts/lint-scopes.mjs — Work-scope + flavor lint gate.
 *
 * Curated scopes live in specialists/org/scopes/. Teams and roles are org-
 * derived at runtime; lint checks scope shape and flavor caps only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listScopes, loadScope } from '../lib/scopes/loader.mjs';
import { FLAVOR_CAP_PER_ROLE_PER_SCOPE, perRoleFlavorCount, validateFlavor } from '../lib/flavors/loader.mjs';
import { validateSkills } from '../lib/validators/skills.mjs';
import { validateSkillEffectiveness } from '../lib/validators/skill-effectiveness.mjs';
import { auditSkillComposition } from '../lib/skills/composition-graph.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES_DIR = path.join(REPO_ROOT, 'specialists', 'org', 'scopes');
const FLAVORS_DIR = path.join(REPO_ROOT, 'skills', 'roles');
const quiet = process.argv.includes('--quiet');

let failed = 0;

function fail(msg) { failed++; console.error(`  ✗ ${msg}`); }
function ok(msg) { if (!quiet) console.log(`  ✓ ${msg}`); }

function checkScope(id) {
  const rawPath = path.join(SCOPES_DIR, `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const p = loadScope(id, { rootDir: REPO_ROOT });

  if (!p) return fail(`scope ${id} did not load`);
  if (!p.id || !/^[a-z][a-z0-9-]{1,30}$/.test(p.id)) fail(`scope ${id}: bad id`);
  if (!raw.intake?.types || raw.intake.types.length > 24) fail(`scope ${id}: intake.types missing or >24`);
  if (!raw.intake?.stages || raw.intake.stages.length > 12) fail(`scope ${id}: intake.stages missing or >12`);

  if (raw.departments?.length) fail(`scope ${id}: departments[] must not be authored`);
  if (raw.teams?.length) fail(`scope ${id}: teams[] must not be authored — use specialists/org`);
  if (raw.roles?.length) fail(`scope ${id}: roles[] must not be authored — use specialists/org`);
  if (raw.teamSource || raw.roleSource) fail(`scope ${id}: teamSource/roleSource are retired`);

  const enrichedRoles = Array.isArray(p.roles) ? p.roles : [];
  if (enrichedRoles.length === 0) fail(`scope ${id}: org roles did not enrich`);
  if (enrichedRoles.length > 80) fail(`scope ${id}: roles exceed 80`);

  if (!Array.isArray(p.teams) || p.teams.length < 6) {
    fail(`scope ${id}: org must enrich at least six teams/groups`);
  }

  ok(`scope ${id}`);
}

function checkFlavor(file) {
  const errors = validateFlavor(path.join(FLAVORS_DIR, file));
  if (errors.length > 0) for (const e of errors) fail(e);
  else ok(`flavor ${file}`);
}

function checkPerRoleCap(id) {
  const counts = perRoleFlavorCount(id);
  for (const [role, count] of Object.entries(counts)) {
    if (count > FLAVOR_CAP_PER_ROLE_PER_SCOPE) {
      fail(`scope ${id} role ${role}: ${count} flavors exceeds cap ${FLAVOR_CAP_PER_ROLE_PER_SCOPE}`);
    }
  }
}

console.log('lint:scopes');

const ids = listScopes();
for (const id of ids) checkScope(id);

const flavorFiles = fs.readdirSync(FLAVORS_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
for (const f of flavorFiles) checkFlavor(f);

for (const id of ids) checkPerRoleCap(id);

const skillsRoot = path.join(REPO_ROOT, 'skills');
const skillsResult = validateSkills([skillsRoot]);
if (!skillsResult.valid) {
  for (const e of skillsResult.errors.slice(0, 50)) fail(`skills: ${e}`);
  if (skillsResult.errors.length > 50) fail(`skills: …and ${skillsResult.errors.length - 50} more`);
} else {
  ok(`skills structure (${skillsResult.skills?.length ?? skillsResult.errors.length + skillsResult.warnings.length} files)`);
}

const routingPath = path.join(skillsRoot, 'routing.json');
if (fs.existsSync(routingPath)) {
  try {
    const routing = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
    const routes = routing.routes || routing;
    if (!Array.isArray(routes) || routes.length === 0) fail('routing.json: routes array missing or empty');
    else {
      for (const route of routes) {
        const target = route.path || route.skill || route.skillId || route.target;
        const keywords = route.keywords || route.triggers;
        if (!target) fail('routing.json: route missing path/skill target');
        else {
          const skillPath = path.join(skillsRoot, `${target}.md`);
          if (!fs.existsSync(skillPath)) fail(`routing.json: target missing on disk: ${target}`);
        }
        if (!keywords || (Array.isArray(keywords) && keywords.length === 0)) {
          fail(`routing.json: route ${target} missing keywords`);
        }
      }
      ok(`routing.json (${routes.length} routes)`);
    }
  } catch (e) {
    fail(`routing.json: ${e.message}`);
  }
}

const effectiveness = validateSkillEffectiveness({ rootDir: REPO_ROOT });
if (!effectiveness.valid) {
  for (const e of effectiveness.errors.slice(0, 30)) fail(`effectiveness: ${e}`);
  if (effectiveness.errors.length > 30) fail(`effectiveness: …and ${effectiveness.errors.length - 30} more`);
} else {
  ok(`skill effectiveness (${effectiveness.checked} files)`);
}

const composition = auditSkillComposition({ rootDir: REPO_ROOT });
if (!composition.pass) {
  for (const b of composition.blocking.slice(0, 20)) fail(`composition: ${b}`);
} else {
  ok('skill composition graph');
}

if (failed === 0) {
  console.log(`\nlint:scopes — clean (${ids.length} scope${ids.length === 1 ? '' : 's'}, ${flavorFiles.length} overlay${flavorFiles.length === 1 ? '' : 's'})`);
  process.exit(0);
} else {
  console.error(`\nlint:scopes — ${failed} violation${failed === 1 ? '' : 's'}`);
  process.exit(1);
}
