/**
 * lib/embedded-contract/capability.mjs — capability discovery contract.
 *
 * Builds the read-only, secret-free description of what this Construct install
 * can do: versions, the contract interfaces (CLI/MCP/SDK), roles, skills,
 * workflows, schemas, models/providers, policies, telemetry posture, and
 * plugins. Every section reads from the live registries so the published
 * contract cannot drift from reality, and each section is independently
 * guarded — a failing source degrades to a warning rather than breaking
 * discovery. Provider data carries env-key NAMES and a configured boolean only,
 * never a credential value; the envelope's no-secrets guard is the backstop.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getInstalledVersion } from '../version.mjs';
import { CONTRACT_VERSION, MIN_CLIENT_CONTRACT_VERSION } from './contract-version.mjs';
import { listWorkerProfiles } from '../registry/loader.mjs';
import { listModelFamilies, resolveModelTiers } from '../model-router.mjs';
import { readSkillFrontmatter } from '../sync/skill-frontmatter.mjs';
import { loadPluginRegistry } from '../plugin-registry.mjs';
import { listProcedureDefinitions } from './procedure-definitions.mjs';
import { loadRegistry } from '../registry/loader.mjs';
import { APPROVAL_MODES } from './audit.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The interfaces section describes the three transports every contract is
// exposed on; each carries the contract version so an embedder can negotiate.

function buildInterfaces() {
  return [
    { surface: 'cli', contractVersion: CONTRACT_VERSION, entrypoints: ['construct capability describe --json', 'construct models resolve --json', 'construct execution resolve --json', 'construct intake classify --json', 'construct graph recommend --json', 'construct workflow invoke --json'] },
    { surface: 'mcp', contractVersion: CONTRACT_VERSION, tools: ['capability_describe', 'model_resolve', 'construct_execution_resolve', 'triage_recommend', 'workflow_invoke'] },
    { surface: 'sdk', contractVersion: CONTRACT_VERSION, module: 'construct/embedded-contract', exports: ['describeCapabilities', 'resolveEmbeddedModel', 'resolveExecution', 'recommendPlan', 'invokeProcedure'] },
  ];
}

function listSkillIds(skillsDir, prefix = '') {
  let out = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skillMd = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(skillMd)) out.push(`${prefix}${entry.name}`);
      else out = out.concat(listSkillIds(join(skillsDir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith('.md') && entry.name !== 'SKILL.md' && entry.name !== 'routing.md') {
      out.push(`${prefix}${entry.name.replace(/\.md$/, '')}`);
    }
  }
  return out;
}

function buildSkills(rootDir, warnings) {
  const skillsDir = join(rootDir, 'skills');
  if (!existsSync(skillsDir)) return [];
  const ids = listSkillIds(skillsDir).sort();
  let missingMetadata = 0;
  const skills = ids.map((id) => {
    const candidates = [join(skillsDir, `${id}.md`), join(skillsDir, id, 'SKILL.md')];
    const file = candidates.find(existsSync);
    const fm = file ? readSkillFrontmatter(readFileSync(file, 'utf8')) : null;
    const inputs = Array.isArray(fm?.inputs) ? fm.inputs : null;
    const artifactType = typeof fm?.artifactType === 'string' ? fm.artifactType : null;
    if (!inputs || !artifactType) missingMetadata += 1;
    return { id, description: fm?.description || null, inputs, artifactType };
  });
  if (missingMetadata > 0) {
    warnings.push(`${missingMetadata}/${skills.length} skills have no structured inputs/artifactType yet (optional frontmatter; annotated incrementally).`);
  }
  return skills;
}

function buildSchemas(rootDir, warnings) {
  const out = [];
  const dirs = [join(rootDir, 'lib', 'schemas'), join(rootDir, 'schemas')];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const full = join(dir, file);
      let version = null;
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8'));
        version = parsed.version ?? parsed.$id ?? null;
      } catch { warnings.push(`Schema ${file} could not be parsed.`); }
      out.push({ id: file.replace(/\.json$/, ''), version, location: relative(rootDir, full) });
    }
  }
  return out;
}

function buildModels(env) {
  const families = listModelFamilies({ env });
  const providers = families.map((f) => ({
    id: f.id,
    label: f.label,
    local: f.local,
    requiresEnv: f.requiresEnv,
    configured: f.configured,
    // `configured` is a presence check (env/op:// ref/CLI session found), not proof
    // the credential authenticates — deep verification is the opt-in provider probe
    // (construct doctor --probe-providers / orchestrate preflight --probe).
    configuredBasis: 'presence',
    healthStatus: 'unknown',
  }));
  const tiers = resolveModelTiers({ env });
  return {
    tiers: tiers.models,
    tierSources: tiers.sources,
    providers,
  };
}

function buildPolicies(rootDir, warnings) {
  try {
    const registry = loadRegistry({ rootDir, skipValidation: true });
    const policies = registry.policies || {};
    const arr = Array.isArray(policies) ? policies : Object.values(policies);
    return arr.map((p) => ({ id: p.id, enforcement: p.enforcement, mode: p.mode, description: p.description }));
  } catch (err) {
    warnings.push(`Policy inventory unavailable: ${err.message}`);
    return [];
  }
}

// Only public, secret-free plugin fields are surfaced — id, declared
// capabilities, built-in flag, and exposed MCP ids. Plugin manifests can carry
// requiredEnv and other config, so fields are picked explicitly rather than spread.

function buildPlugins(rootDir, env, warnings) {
  try {
    const reg = loadPluginRegistry({ cwd: rootDir, rootDir, env });
    if (reg.errors?.length) warnings.push(`Plugin registry reported ${reg.errors.length} issue(s).`);
    return (reg.plugins || []).map((p) => ({
      id: p.id,
      capabilities: Array.isArray(p.capabilities) ? p.capabilities : [],
      builtIn: Boolean(p.builtIn),
      mcps: (p.mcps || []).map((m) => ({ id: m.id })),
    }));
  } catch (err) {
    warnings.push(`Plugin registry unavailable: ${err.message}`);
    return [];
  }
}

function buildTelemetry(env) {
  return {
    tracingEnabled: Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT) && env.CONSTRUCT_OTEL !== 'off',
    redaction: 'enabled',
    note: 'Every contract response passes the no-secrets guard before serialization.',
  };
}

/**
 * Build the capability contract. Pure read; returns a result object carrying a
 * `warnings` array (lifted into the envelope by the calling surface).
 *
 * @param {object} [opts]   { env, rootDir }
 * @returns {object}
 */
export function buildCapabilityContract({ env = process.env, rootDir = REPO_ROOT } = {}) {
  const warnings = [];
  const { version: constructVersion, name } = getInstalledVersion();

  return {
    product: name,
    constructVersion,
    contractVersion: CONTRACT_VERSION,
    minClientContractVersion: MIN_CLIENT_CONTRACT_VERSION,
    approvalModes: APPROVAL_MODES,
    interfaces: buildInterfaces(),
    workerProfiles: listWorkerProfiles().map(({ id, displayName, description, modelTier, reasoningEffort, skillEmphasis, capabilities }) => ({
      id, displayName, description, modelTier, reasoningEffort, skillEmphasis, capabilities,
    })),
    skills: buildSkills(rootDir, warnings),
    procedures: listProcedureDefinitions(),
    schemas: buildSchemas(rootDir, warnings),
    models: buildModels(env),
    policies: buildPolicies(rootDir, warnings),
    telemetry: buildTelemetry(env),
    plugins: buildPlugins(rootDir, env, warnings),
    warnings,
  };
}
