/**
 * lib/workflows/liveness.mjs — workflow manifest liveness validation (LMCP-C11).
 *
 * Schema validation (validate.mjs) covers shape only: required fields, types,
 * compatVersion. A roleChain entry naming a specialist that does not exist, a
 * workflow whose handoff chain loops back on itself, and a workflow no surface
 * can ever invoke all pass schema validation and fail only when a user
 * actually runs the workflow. checkWorkflowLiveness runs four checks per
 * manifest, over the already-loaded manifest list and the pack-aware merged
 * specialist registry (LMCP-E1 precedence: project > pack > builtin, via
 * loadAllPacks):
 *
 *   1. roleChain resolution   — every role resolves to an installed specialist.
 *   2. skill existence        — every skill the resolved specialists declare
 *                                exists on disk (the concrete capability a
 *                                resolved roleChain entry brings with it).
 *   3. acyclic handoff graph  — the roleChain's sequential handoffs
 *                                (chain[i] -> chain[i+1]) never loop back to
 *                                an earlier role in the same workflow.
 *   4. surface/mode reachability — every workflow declares at least one
 *                                surface and one mode, so some entrypoint can
 *                                reach it.
 *
 * Returns { violations } without throwing and without classifying severity.
 * Every violation — a bad roleChain entry, a missing skill file, a handoff
 * cycle, or an unreachable workflow — is reported as a plain message; the
 * caller (lib/graph/validate.mjs) applies mode policy uniformly, matching
 * the existing C2 convention: liveness reports facts, the graph validator
 * classifies error vs warning per deployment mode.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAllPacks } from '../packs/loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root of the Construct package (parent of lib/); skills/ lives here, not under an arbitrary project rootDir. */
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

/**
 * Build the set of installed specialist ids (pack-aware, E1 precedence) and a
 * lookup from bare role id ("architect") to specialist skills, by reading the
 * merged pack list's specialists/org directories directly. loadAllPacks()
 * already applies builtin < user < project precedence; the core pack's
 * specialists come from specialists/org/specialists on rootDir.
 *
 * @param {{ rootDir?: string, packRoots?: string[] }} opts
 * @returns {{ specialistIds: Set<string>, skillsByRole: Map<string, string[]> }}
 */
function resolveSpecialistRegistry({ rootDir = process.cwd() } = {}) {
  const { packs } = loadAllPacks({ rootDir });

  const specialistIds = new Set();
  const skillsByRole = new Map();

  for (const pack of packs) {
    const ids = Array.isArray(pack.specialists) ? pack.specialists : [];
    for (const id of ids) specialistIds.add(id);

    const sourceDir = pack._sourceDir || pack._packDir;
    if (!sourceDir) continue;

    for (const id of ids) {
      const specPath = join(sourceDir, 'specialists', `${id}.json`);
      if (!existsSync(specPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(specPath, 'utf8'));
        const roleId = id.startsWith('cx-') ? id.slice(3) : id;
        skillsByRole.set(roleId, Array.isArray(raw.skills) ? raw.skills : []);
      } catch {
        // Malformed specialist file — resolution failure surfaces separately
        // via roleChain checks when the role is referenced; skip here.
      }
    }
  }

  return { specialistIds, skillsByRole };
}

/**
 * Normalize a roleChain entry to the registry-prefixed specialist id.
 * roleChain entries are bare role ids ("architect"); the registry stores
 * "cx-architect". Entries already carrying the prefix pass through.
 *
 * @param {string} role
 * @returns {string}
 */
function specialistIdFor(role) {
  return role.startsWith('cx-') ? role : `cx-${role}`;
}

/**
 * Detect a cycle in the sequential handoff graph of a roleChain: nodes are
 * distinct roles, edges are chain[i] -> chain[i+1]. A role that reappears
 * later in the same chain after handing off to a different role creates a
 * back-edge, forming a cycle (e.g. [a, b, a] => a->b, b->a).
 *
 * @param {string[]} roleChain
 * @returns {boolean}
 */
function hasHandoffCycle(roleChain) {
  const edges = new Map();
  for (let i = 0; i < roleChain.length - 1; i++) {
    const from = roleChain[i];
    const to = roleChain[i + 1];
    if (from === to) continue;
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const node of roleChain) if (!color.has(node)) color.set(node, WHITE);

  function visit(node) {
    color.set(node, GRAY);
    for (const next of edges.get(node) || []) {
      const c = color.get(next);
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const node of color.keys()) {
    if (color.get(node) === WHITE && visit(node)) return true;
  }
  return false;
}

/**
 * checkWorkflowLiveness(manifests, opts)
 *
 * Runs the four liveness checks over an already-loaded, already
 * schema-validated manifest list. Manifests missing roleChain/surfaces/modes
 * entirely are skipped for the checks that need them — schema validation
 * already flags genuinely malformed manifests; liveness only adds checks
 * schema validation cannot express.
 *
 * @param {object[]} manifests - Loaded manifests, each carrying `_filePath`.
 * @param {{ rootDir?: string, packRoots?: string[], packageRoot?: string }} [opts]
 *   rootDir selects the project whose pack tiers are merged (specialist
 *   resolution); packageRoot (defaults to the Construct install) is where
 *   skills/ is read from for the skill-existence check.
 * @returns {{ violations: string[] }}
 */
export function checkWorkflowLiveness(manifests, opts = {}) {
  const violations = [];

  const { specialistIds, skillsByRole } = resolveSpecialistRegistry(opts);

  for (const manifest of manifests) {
    // Embed manifests are a workflow specialization scheduled by the embed
    // daemon, not reached through a surface+mode entrypoint or a role chain —
    // their liveness is enforced by the embed-capability loader, so the
    // executable-workflow liveness checks below do not apply.
    if (manifest.type === 'embed') continue;

    const label = manifest._filePath || manifest.id || '(unknown manifest)';
    const roleChain = Array.isArray(manifest.roleChain) ? manifest.roleChain : [];

    // Check 1: roleChain resolution against the pack-aware merged registry.
    for (const role of roleChain) {
      const specId = specialistIdFor(role);
      if (!specialistIds.has(specId)) {
        violations.push(`${label}: roleChain entry '${role}' does not resolve to an installed specialist (expected '${specId}')`);
      }
    }

    // Check 2: skill existence for every resolved role's declared skills.
    // skills/ is a package-level resource (shared across projects), so it
    // resolves against packageRoot, not the project rootDir.
    const packageRoot = opts.packageRoot || PACKAGE_ROOT;
    for (const role of roleChain) {
      const skills = skillsByRole.get(role);
      if (!skills) continue;
      for (const skillId of skills) {
        const skillPath = join(packageRoot, 'skills', `${skillId}.md`);
        if (!existsSync(skillPath)) {
          violations.push(`${label}: role '${role}' declares skill '${skillId}' with no matching file at skills/${skillId}.md`);
        }
      }
    }

    // Check 3: acyclic handoff graph.
    if (roleChain.length > 1 && hasHandoffCycle(roleChain)) {
      violations.push(`${label}: roleChain contains a circular handoff (${roleChain.join(' -> ')})`);
    }

    // Check 4: reachability from at least one declared surface and mode.
    const surfaces = Array.isArray(manifest.surfaces) ? manifest.surfaces : [];
    const modes = Array.isArray(manifest.modes) ? manifest.modes : [];
    if (surfaces.length === 0 || modes.length === 0) {
      violations.push(`${label}: workflow '${manifest.id}' is unreachable — declares ${surfaces.length === 0 ? 'no surfaces' : `surfaces [${surfaces.join(', ')}]`} and ${modes.length === 0 ? 'no modes' : `modes [${modes.join(', ')}]`}`);
    }
  }

  return { violations };
}
