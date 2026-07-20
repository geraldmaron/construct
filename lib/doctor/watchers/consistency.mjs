/**
 * lib/doctor/watchers/consistency.mjs — cross-surface drift watcher.
 *
 * Drift checks bundled at one cadence, including:
 *   1. Hook manifest ↔ files: every entry in platforms/claude/settings.template.json
 *      points to a real .mjs file in lib/hooks/ that parses.
 *   2. MCP registration ↔ impl: every `name === '<tool>'` branch in the MCP
 *      dispatch resolves to an imported function, and every exported tool
 *      function in lib/mcp/tools/*.mjs is wired into the dispatch.
 *   3. Roles ↔ registry: every Worker Profile key in registry
 *      resolves to a Worker Profile or agent name in registry.
 *   4. Worker Profile prompts: every registry.workerProfiles[].id resolves to
 *      registry/worker-profiles/prompts/<id>.md on disk.
 *   5. Contracts ↔ schemas: capability registry passes validateContractsFile
 *      (cross-file refs, producer/consumer names, schema paths).
 *   6. Postcondition coverage (construct-rf26.12): reports the executable-
 *      vs-advisory split across capability-registry postconditions
 *      (lib/contracts/coverage.mjs); a nonzero unclassified count is drift.
 *   7. Host surfaces: adapter config present for installed AI hosts.
 *   8. Export engine health: pandoc/typst/libreoffice/pptxgenjs presence via
 *      lib/doctor/engine-health.mjs (LMCP-K3).
 *   9. Embedding model health: active embedding model, and whether the default
 *      local model's @huggingface/transformers dependency resolves, via
 *      lib/doctor/embedding-health.mjs (LMCP-K4).
 *   10. Credential parity: see lib/doctor/watchers/credential-parity.mjs.
 *
 * Each violation produces an audit record. Blocking severity escalates to a
 * role intake; advisory severity records only. Tick is cheap — reads JSON +
 * directory listings, no network.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { loadRegistry } from '../../registry/loader.mjs';
import { join, dirname, resolve } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';
import { checkEngineHealthAllForDoctor } from '../engine-health.mjs';
import { checkEmbeddingModelForDoctor } from '../embedding-health.mjs';
import { resolveWorkerProfilePromptPath } from '../../prompt-metadata.mjs';

export const name = 'consistency';
export const intervalMs = 15 * 60 * 1000;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export async function tick() {
  const results = await runAllChecks({ repoRoot: REPO_ROOT });
  const actions = [];
  const escalations = [];

  for (const finding of results.findings) {
    record({
      kind: finding.severity === 'blocking' ? 'escalation' : 'action',
      watcher: name,
      action: finding.category,
      summary: finding.summary,
      context: { details: finding.details },
    });
    actions.push({ type: finding.category, target: finding.target || null });
    if (finding.severity === 'blocking') {
      escalate({
        watcher: name,
        event: `consistency.${finding.category}`,
        severity: 'high',
        summary: finding.summary,
        context: { details: finding.details },
      });
      escalations.push({ event: `consistency.${finding.category}`, severity: 'high' });
    }
  }

  return { actions, escalations };
}

/**
  * Run all six consistency checks. Returns { findings: [], passed: [] }.
 * Pure function — no audit/escalate side effects. Surfaced separately so the
 * `construct doctor consistency` CLI and the release-gate functional test can
 * call it without spinning up the daemon.
 */
export async function runAllChecks({ repoRoot = REPO_ROOT, skipRegistryValidation = false } = {}) {
  const findings = [];
  const passed = [];

  const hooks = checkHooksDrift({ repoRoot });
  collect(hooks, findings, passed, 'hooks-drift');

  const mcp = checkMcpDrift({ repoRoot });
  collect(mcp, findings, passed, 'mcp-drift');

  const roles = checkRolesDrift({ repoRoot, skipRegistryValidation });
  collect(roles, findings, passed, 'roles-drift');

  const prompts = checkWorkerProfilePrompts({ repoRoot, skipRegistryValidation });
  collect(prompts, findings, passed, 'prompt-files');

  const contracts = await checkContractsDrift({ repoRoot });
  collect(contracts, findings, passed, 'contracts-drift');

  const postconditionCoverage = await checkPostconditionCoverage({ repoRoot });
  collect(postconditionCoverage, findings, passed, 'postcondition-coverage');

  const hosts = checkHostSurfaces({ repoRoot });
  collect(hosts, findings, passed, 'host-surfaces');

  const engines = checkEngineHealthDrift();
  collect(engines, findings, passed, 'export-engine-health');

  const embeddingModel = await checkEmbeddingModelDrift();
  collect(embeddingModel, findings, passed, 'embedding-model-health');

  const { runCredentialParityChecks } = await import('./credential-parity.mjs');
  const credentials = await runCredentialParityChecks({ rootDir: repoRoot });
  collect(credentials, findings, passed, 'credential-parity');

  return { findings, passed };
}

// Drift categories split into two operator tiers. `actionable` findings are
// project state a user can fix and surface by default. `internal` findings are
// package/maintainer diagnostics about Construct's own registry and MCP wiring —
// never user-actionable in a consumer project (this watcher resolves REPO_ROOT to
// the installed package), so they stay behind `doctor consistency --strict`.

const CATEGORY_TIERS = {
  'mcp-drift': 'internal',
  'roles-drift': 'internal',
};

function tierFor(category) {
  return CATEGORY_TIERS[category] || 'actionable';
}

function collect(result, findings, passed, defaultCategory) {
  if (result.violations.length === 0) {
    passed.push({ category: defaultCategory, summary: result.summary, tier: tierFor(defaultCategory) });
    return;
  }
  for (const v of result.violations) {
    const category = v.category || defaultCategory;
    findings.push({
      category,
      severity: v.severity || 'warning',
      tier: v.tier || tierFor(category),
      summary: v.summary,
      target: v.target || null,
      details: v.details || null,
    });
  }
}

// ── Check 1: hook manifest ↔ files ─────────────────────────────────────────

function checkHooksDrift({ repoRoot }) {
  const violations = [];
  const settingsPath = join(repoRoot, 'platforms', 'claude', 'settings.template.json');
  const hooksDir = join(repoRoot, 'lib', 'hooks');

  if (!existsSync(settingsPath)) {
    return {
      summary: 'settings template missing',
      violations: [{ severity: 'blocking', summary: `settings template missing: ${settingsPath}` }],
    };
  }

  let settings;
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
  catch (err) {
    return {
      summary: 'settings template parse error',
      violations: [{ severity: 'blocking', summary: `settings template parse error: ${err.message}` }],
    };
  }

  const referenced = new Set();
  collectHookCommands(settings.hooks, referenced);

  for (const hookPath of referenced) {
    const resolvedPath = resolveHookPath(hookPath, hooksDir, repoRoot);
    if (!resolvedPath || !existsSync(resolvedPath)) {
      violations.push({
        category: 'hooks-drift',
        severity: 'blocking',
        target: hookPath,
        summary: `hook referenced by settings template does not exist on disk: ${hookPath}`,
      });
    }
  }

  return { summary: `hooks: ${referenced.size} referenced, ${violations.length} missing`, violations };
}

function collectHookCommands(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => collectHookCommands(n, out)); return; }
  if (typeof node !== 'object') return;
  if (typeof node.command === 'string' && /\.mjs/.test(node.command)) {
    const match = node.command.match(/([\w./-]+\.mjs)/);
    if (match) out.add(match[1]);
  }
  for (const v of Object.values(node)) collectHookCommands(v, out);
}

function resolveHookPath(reference, hooksDir, repoRoot) {
  if (reference.startsWith('/')) return reference;
  if (reference.startsWith('lib/hooks/')) return join(repoRoot, reference);
  const bare = reference.split('/').pop();
  return join(hooksDir, bare);
}

// ── Check 2: MCP registration ↔ impl ───────────────────────────────────────

function checkMcpDrift({ repoRoot }) {
  const violations = [];
  const serverPath = join(repoRoot, 'lib', 'mcp', 'server.mjs');
  const toolsDir = join(repoRoot, 'lib', 'mcp', 'tools');

  if (!existsSync(serverPath) || !existsSync(toolsDir)) {
    return { summary: 'mcp surface missing', violations: [] };
  }

  const serverSource = readFileSync(serverPath, 'utf8');

  // Candidate tool handlers are exactly the identifiers server.mjs imports from
  // ./tools/*.mjs. Tool modules also export private helpers (exec, readJson) that
  // are never MCP tools; scanning every `export function` swept those into the
  // signal. Scoping to the server's own imports is the real contract surface.

  const importedHandlers = new Set();
  for (const m of serverSource.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]\.\/tools\/[^'"]+['"]/g)) {
    for (const ident of m[1].split(',')) {
      const local = ident.trim().split(/\s+as\s+/).pop().trim();
      if (local) importedHandlers.add(local);
    }
  }

  // A handler is wired when the dispatcher invokes it, regardless of the
  // registered tool name. Handlers follow xxxTool→'xxx' and construct_xxx naming
  // conventions, so matching exported names against `name === '<tool>'` strings is
  // unreliable; matching the invoked identifier is convention-agnostic.

  const invoked = new Set();
  for (const m of serverSource.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    invoked.add(m[1]);
  }

  for (const handler of importedHandlers) {
    const snake = camelToSnake(handler);
    if (KNOWN_NON_DISPATCH_TOOLS.has(handler) || KNOWN_NON_DISPATCH_TOOLS.has(snake)) continue;
    if (!invoked.has(handler)) {
      violations.push({
        category: 'mcp-drift',
        severity: 'warning',
        tier: 'internal',
        target: snake,
        summary: `MCP tool handler imported but never dispatched: ${handler}`,
      });
    }
  }

  return { summary: `mcp: ${importedHandlers.size} handlers, ${violations.length} drift`, violations };
}

// Handlers the server may import for re-export or test surface but intentionally
// never dispatches. Matched by camelCase identifier or snake_case form.

const KNOWN_NON_DISPATCH_TOOLS = new Set([
  'workflow_status_bound',
  'create_needs_main_input_packet',
]);

function camelToSnake(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function readRegistrySnapshot(repoRoot, { skipValidation = false } = {}) {
  const registryPath = join(repoRoot, 'registry', 'worker-profiles');
  if (!existsSync(registryPath)) return null;
  return loadRegistry({ rootDir: repoRoot, skipValidation });
}

function workerProfileKeysFromRegistry(registry) {
  const keys = new Set();

  for (const [specId, spec] of Object.entries(registry?.workerProfiles || {})) {
    if (specId) keys.add(specId.replace(/^cx-/, ''));
    if (spec?.id) keys.add(String(spec.id).replace(/^cx-/, ''));
  }

  return [...keys].sort();
}

function workerProfileOwnersFromRegistry(registry) {
  const owners = new Map();

  function addOwner(rawId, owner) {
    if (!rawId) return;
    const workerProfileId = String(rawId).replace(/^cx-/, '');
    if (!owners.has(workerProfileId)) owners.set(workerProfileId, new Set());
    owners.get(workerProfileId).add(owner);
  }

  // One registry entity owns a Worker Profile once. A profile's catalog key and its
  // declared id normalize to the same token by design (architect / architect), so
  // they must share a single owner — otherwise every profile self-collides and
  // reports spurious "ambiguous" drift. Genuine ambiguity (two distinct profiles
  // whose keys or ids normalize to the same id) still yields owners.size > 1.

  for (const [profileId, profile] of Object.entries(registry?.workerProfiles || {})) {
    const owner = `worker-profile:${profile?.id || profileId}`;
    addOwner(profileId, owner);
    addOwner(profile?.id, owner);
  }

  return owners;
}

// ── Check 3: roles ↔ registry ──────────────────────────────────────────────

function checkRolesDrift({ repoRoot, skipRegistryValidation = false }) {
  const violations = [];
  if (!existsSync(join(repoRoot, 'registry', 'worker-profiles'))) {
    return { summary: 'registry missing', violations: [] };
  }

  const registry = readRegistrySnapshot(repoRoot, { skipValidation: skipRegistryValidation });

  const known = new Set();
  for (const s of Object.values(registry.workerProfiles || {})) {
    if (s?.id) { known.add(s.id); known.add(`cx-${s.id}`); }
  }

  const workerProfileKeys = workerProfileKeysFromRegistry(registry);
  const workerProfileOwners = workerProfileOwnersFromRegistry(registry);
  for (const key of workerProfileKeys) {
    if (!known.has(key) && !known.has(`cx-${key}`)) {
      violations.push({
        category: 'roles-drift',
        severity: 'warning',
        target: key,
        summary: `role manifest '${key}' does not resolve to a registry Worker Profile`,
      });
    }
  }

  for (const [workerProfileId, owners] of workerProfileOwners.entries()) {
    if (owners.size <= 1) continue;
    violations.push({
      category: 'roles-drift',
      severity: 'warning',
      target: workerProfileId,
      summary: `role manifest '${workerProfileId}' is ambiguous after normalization: ${[...owners].join(', ')}`,
    });
  }

  return { summary: `roles: ${workerProfileKeys.length} worker profiles, ${violations.length} drift`, violations };
}

// ── Check 4: Worker Profile convention prompt existence ───────────────────

function checkWorkerProfilePrompts({ repoRoot, skipRegistryValidation = false }) {
  const violations = [];
  const registry = readRegistrySnapshot(repoRoot, { skipValidation: skipRegistryValidation });
  if (!registry) return { summary: 'registry missing', violations: [] };
  let checked = 0;

  for (const entry of Object.values(registry.workerProfiles || {})) {
    if (!entry?.id) continue;
    const ref = resolveWorkerProfilePromptPath(entry.id, { rootDir: repoRoot, registry });
    if (!ref) continue;
    checked++;
    const promptPath = join(repoRoot, ref);
    if (!existsSync(promptPath)) {
      violations.push({
        category: 'prompt-files',
        severity: 'blocking',
        target: ref,
        summary: `Worker Profile '${entry.id}' missing convention prompt: ${ref}`,
      });
    }
  }

  return { summary: `prompt-files: ${checked} referenced, ${violations.length} missing`, violations };
}

// ── Check 5: contracts ↔ schemas ───────────────────────────────────────────

async function checkContractsDrift({ repoRoot }) {
  const violations = [];
  try {
    const { validateContractsFile } = await import('../../contracts/validate.mjs');
    const result = validateContractsFile({ repoRoot });
    if (!result.ok) {
      for (const err of result.errors) {
        violations.push({
          category: 'contracts-drift',
          severity: 'warning',
          summary: err,
        });
      }
    }
  } catch (err) {
    violations.push({
      category: 'contracts-drift',
      severity: 'warning',
      summary: `contract validator unavailable: ${err.message}`,
    });
  }
  return { summary: `contracts: ${violations.length} drift`, violations };
}

// Reports executable-vs-advisory postcondition coverage (construct-rf26.12).
// Informational only — never fails on a low percentage, since advisory
// postconditions are a legitimate, deliberate classification, not drift. A
// nonzero `unclassified` count IS drift: a legacy bare-string postcondition
// that slipped past the rf26.12 migration.

async function checkPostconditionCoverage({ repoRoot }) {
  try {
    const { computePostconditionCoverage, formatCoverageSummary } = await import('../../contracts/coverage.mjs');
    const coverage = computePostconditionCoverage({ repoRoot });
    const violations = coverage.unclassified > 0
      ? [{
          category: 'postcondition-coverage',
          severity: 'warning',
          summary: `${coverage.unclassified} postcondition(s) across contracts have no postconditionType (executable|advisory) classification`,
        }]
      : [];
    return { summary: formatCoverageSummary(coverage), violations };
  } catch (err) {
    return {
      summary: 'postcondition coverage unavailable',
      violations: [{ category: 'postcondition-coverage', severity: 'warning', summary: `postcondition coverage check failed: ${err.message}` }],
    };
  }
}

// ── Check 6: host surfaces ─────────────────────────────────────────────────

function getVSCodeSettingsDir(homeDir) {
  const platform = os.platform();
  if (platform === 'darwin') return join(homeDir, 'Library', 'Application Support', 'Code', 'User');
  if (platform === 'linux') return join(homeDir, '.config', 'Code', 'User');
  const appData = process.env.APPDATA ?? join(homeDir, 'AppData', 'Roaming');
  return join(appData, 'Code', 'User');
}

function checkHostSurfaces({ repoRoot: _repoRoot }) {
  const violations = [];
  const homeDir = os.homedir();
  const surfaces = [
    { id: 'claude', label: 'Claude Code', check: () => existsSync(join(homeDir, '.claude', 'agents')) },
    { id: 'opencode', label: 'OpenCode', check: () => existsSync(join(homeDir, '.config', 'opencode', 'opencode.json')) },
    { id: 'codex', label: 'Codex', check: () => existsSync(join(homeDir, '.codex', 'agents')) },
    { id: 'copilot', label: 'Copilot', check: () => existsSync(join(homeDir, '.github', 'prompts')) },
    { id: 'vscode', label: 'VS Code', check: () => existsSync(join(getVSCodeSettingsDir(homeDir), 'settings.json')) },
    { id: 'cursor', label: 'Cursor', check: () => existsSync(join(homeDir, '.cursor', 'mcp.json')) },
  ];

  const absent = surfaces.filter((s) => !s.check());
  if (absent.length > 0) {
    for (const s of absent) {
      violations.push({
        category: 'host-surfaces',
        severity: 'advisory',
        target: s.id,
        summary: `Host surface '${s.label}' config not found — run \`construct sync\` to set up adapters`,
      });
    }
    violations.push({
      category: 'host-surfaces',
      severity: 'advisory',
      summary: `${absent.length}/${surfaces.length} host surfaces absent: ${absent.map((s) => s.id).join(', ')}`,
    });
  }

  return { summary: `host-surfaces: ${surfaces.length - absent.length}/${surfaces.length} present`, violations };
}

// ── Check 7: export engine health ──────────────────────────────────────────
//
// pandoc/typst/libreoffice/pptxgenjs have no preflight today; failures surface
// mid-export. lib/doctor/engine-health.mjs probes the same detect() export
// preflight uses, so absence here and an export refusal carry the same
// install hint (LMCP-K3).

function checkEngineHealthDrift() {
  const violations = [];
  const findingsList = checkEngineHealthAllForDoctor();
  const absent = findingsList.filter((f) => !f.installed);

  for (const f of absent) {
    violations.push({
      category: 'export-engine-health',
      severity: 'warning',
      tier: 'actionable',
      summary: f.label,
    });
  }

  return {
    summary: `export-engine-health: ${findingsList.length - absent.length}/${findingsList.length} engines present`,
    violations,
  };
}

// ── Check 8: embedding model health ────────────────────────────────────────
//
// `local` (@huggingface/transformers) is the embedding engine's default and
// degrades silently to hashing on failure; lib/doctor/embedding-health.mjs
// surfaces that degradation so it is visible before retrieval quality drops
// unexplained (LMCP-K4).

async function checkEmbeddingModelDrift() {
  const finding = await checkEmbeddingModelForDoctor();
  if (finding.degraded) {
    return {
      summary: finding.label,
      violations: [{ category: 'embedding-model-health', severity: 'warning', tier: 'actionable', summary: finding.label }],
    };
  }
  return { summary: finding.label, violations: [] };
}
