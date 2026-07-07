/**
 * lib/embed/capability-lifecycle.mjs — enable/disable/status/dry-run surface
 * for embed capabilities (ADR-0061 §4, LMCP-P2).
 *
 * `enableCapability` / `disableCapability` persist the per-project tier
 * manifest at `.cx/embed/<id>.manifest.json` (via lib/embed/capability-loader.mjs);
 * a capability is only ever active when this file exists with `embed.enabled
 * === true` — pack/builtin tiers ship it merely *available*, and enablement
 * is explicit opt-in, never a default. `listCapabilities` and
 * `capabilityStatus` read the merged D1 view plus the durable last-tick
 * record the daemon-registration helper in lib/embed/capability-jobs.mjs
 * writes. `resolveCapabilityChain` resolves the full binding chain
 * (specialist → providers → filter → framework → authority → runtime) and
 * returns it without calling a model or touching the last-tick record — a
 * pure read, matching the ADR's "execute nothing" requirement.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadEmbedCapabilities,
  readProjectEmbedManifest,
  validateEmbedManifest,
  writeProjectEmbedManifest,
} from './capability-loader.mjs';
import { resolveRuntime } from './capability-runtime.mjs';

/** Durable per-capability last-tick record directory. */
export function capabilityStatusDir(rootDir = process.cwd()) {
  return join(rootDir, '.cx', 'runtime', 'embed-capabilities');
}

function capabilityStatusPath(id, rootDir = process.cwd()) {
  return join(capabilityStatusDir(rootDir), `${id}.json`);
}

/**
 * Read the durable last-tick record for a capability. Returns null when the
 * capability has never ticked (e.g. just enabled, daemon not yet started).
 */
export function readCapabilityTick(id, rootDir = process.cwd()) {
  const p = capabilityStatusPath(id, rootDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write the durable last-tick record for a capability. Exported so the
 * daemon's registered job body (this bead's stub, F5's real body) has one
 * place to record `ran | skipped-with-reason | error` outcomes.
 */
export function writeCapabilityTick(id, tick, rootDir = process.cwd()) {
  const dir = capabilityStatusDir(rootDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(capabilityStatusPath(id, rootDir), `${JSON.stringify(tick, null, 2)}\n`);
}

/**
 * List every discoverable embed capability with its merged manifest,
 * project-tier enabled/override state, and loader errors. Each entry:
 *   { id, available: true, enabled, manifest, source: 'project'|'pack'|'builtin' }
 */
export function listCapabilities({ rootDir = process.cwd(), packRoots, knownSpecialists } = {}) {
  const { capabilities, errors } = loadEmbedCapabilities({ rootDir, packRoots, knownSpecialists });

  const entries = capabilities.map((manifest) => {
    const override = readProjectEmbedManifest(manifest.id, rootDir);
    const enabled = override?.manifest?.embed?.enabled === true;
    return {
      id: manifest.id,
      available: true,
      enabled,
      manifest,
      source: override ? 'project' : (manifest._filePath?.includes(join('.cx', 'embed')) ? 'project' : 'pack-or-builtin'),
    };
  });

  return { capabilities: entries, errors };
}

/**
 * Enable a capability: merge the pack/builtin-default manifest (if any) with
 * an optional override, stamp `embed.enabled: true`, validate the resulting
 * manifest against the ADR-0061 schema, and write it to the project tier.
 * Fails closed — an invalid manifest is never written; the returned result
 * carries the JSON-schema-style error paths instead.
 *
 * @returns {{ ok: true, filePath: string, manifest: object } | { ok: false, errors: string[] }}
 */
export function enableCapability(id, { rootDir = process.cwd(), overrides = {}, packRoots, knownSpecialists } = {}) {
  const { capabilities, errors: loadErrors } = loadEmbedCapabilities({ rootDir, packRoots, knownSpecialists });
  const defaultManifest = capabilities.find((c) => c.id === id);

  if (!defaultManifest && Object.keys(overrides).length === 0) {
    return {
      ok: false,
      errors: [`embed capability '${id}' not found in any tier (pack defaults or .cx/embed/) and no overrides supplied to define it`, ...loadErrors],
    };
  }

  const base = defaultManifest ?? { id, type: 'embed', version: '1.0.0', defaultApprovalMode: 'proposal-only', embed: {} };
  const candidate = {
    ...base,
    ...overrides,
    embed: { ...base.embed, ...(overrides.embed ?? {}), enabled: true },
  };
  delete candidate._filePath;

  const result = validateEmbedManifest(candidate, { filePath: `.cx/embed/${id}.manifest.json`, knownSpecialists });
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }

  const filePath = writeProjectEmbedManifest(id, candidate, rootDir);
  return { ok: true, filePath, manifest: candidate };
}

/**
 * Disable a capability: if a project-tier override exists, stamp
 * `embed.enabled: false` in place (preserving any project overrides) rather
 * than deleting the file — a subsequent `enable` should not silently lose
 * prior project-tier customization. Idempotent: disabling an
 * already-disabled or never-enabled capability succeeds without error.
 */
export function disableCapability(id, { rootDir = process.cwd() } = {}) {
  const existing = readProjectEmbedManifest(id, rootDir);
  if (!existing) {
    return { ok: true, filePath: null, wasEnabled: false };
  }

  const manifest = {
    ...existing.manifest,
    embed: { ...existing.manifest.embed, enabled: false },
  };
  const filePath = writeProjectEmbedManifest(id, manifest, rootDir);
  return { ok: true, filePath, wasEnabled: existing.manifest?.embed?.enabled === true };
}

/**
 * Resolve the full binding chain for a capability without side effects —
 * no model call, no last-tick record written. Returns the same shape
 * `construct embed dry-run <id>` prints.
 */
export async function resolveCapabilityChain(id, { rootDir = process.cwd(), env = process.env, packRoots, knownSpecialists } = {}) {
  const { capabilities, errors } = loadEmbedCapabilities({ rootDir, packRoots, knownSpecialists });
  const manifest = capabilities.find((c) => c.id === id);
  if (!manifest) {
    return { ok: false, errors: [`embed capability '${id}' not found`, ...errors] };
  }

  const embed = manifest.embed;
  const runtime = await resolveRuntime(embed.runtime, env);

  return {
    ok: true,
    id,
    chain: {
      specialist: embed.specialist,
      providerBindings: embed.providerBindings,
      filter: embed.filter ?? null,
      framework: embed.framework,
      outputContract: embed.outputContract,
      proposalAuthority: embed.proposalAuthority,
      cadence: embed.cadence ?? null,
      runtime: { declared: embed.runtime, ...runtime },
    },
  };
}

/**
 * Per-specialist status: enabled state, bound providers, filter, runtime
 * resolution, and the last durable tick record (`ran | skipped-with-reason |
 * error`, or null if the capability has never ticked).
 */
export async function capabilityStatus(id, { rootDir = process.cwd(), env = process.env, packRoots, knownSpecialists } = {}) {
  const chain = await resolveCapabilityChain(id, { rootDir, env, packRoots, knownSpecialists });
  if (!chain.ok) return chain;

  const override = readProjectEmbedManifest(id, rootDir);
  const enabled = override?.manifest?.embed?.enabled === true;
  const lastTick = readCapabilityTick(id, rootDir);

  return {
    ok: true,
    id,
    enabled,
    chain: chain.chain,
    lastTick,
  };
}

/**
 * Enumerate the enabled-set as the daemon should register it: every
 * discoverable capability whose project-tier manifest carries
 * `embed.enabled === true`. Per ADR-0061, enablement is explicit opt-in —
 * a project-tier file with no `enabled` field, or any value other than
 * `true`, is not active. Both the CLI (`embed list`) and the daemon's
 * startup registration read this same definition of "enabled", so there
 * is one source of truth and no drift between what a user sees and what
 * actually schedules.
 */
export function enabledCapabilityIds({ rootDir = process.cwd(), packRoots, knownSpecialists } = {}) {
  const { capabilities } = listCapabilities({ rootDir, packRoots, knownSpecialists });
  return capabilities.filter((c) => c.enabled).map((c) => c.id);
}

/**
 * Remove the durable last-tick record for a capability. Exported for test
 * cleanup and for `disable` callers that want a clean status surface.
 */
export function clearCapabilityTick(id, rootDir = process.cwd()) {
  const p = capabilityStatusPath(id, rootDir);
  if (existsSync(p)) rmSync(p, { force: true });
}
