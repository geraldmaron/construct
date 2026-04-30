/**
 * lib/embed/target-resolver.mjs — target discovery and routing for embed mode.
 *
 * Resolution order:
 *   1. Explicit targets from config (targets[])
 *   2. Provider-linked discovery (e.g., Jira issue references a GitHub repo)
 *   3. Broadened search if nothing actionable matched
 *   4. Workspace fallback (~/.construct/workspace) — always present
 *
 * Each resolved target is a normalized object:
 *   { type, ref?, path?, access, provider?, docs? }
 *
 * access:
 *   - 'local'   → filesystem path exists, read/write via fs
 *   - 'remote'  → interact via provider API only
 *   - 'hybrid'  → local clone exists AND remote provider available
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WORKSPACE_PATH, WORKSPACE_DOCS_LANES } from './config.mjs';

/**
 * Resolve all actionable targets for this embed cycle.
 *
 * @param {object} config           - Parsed embed config (from loadEmbedConfig/normalize)
 * @param {object} providerRegistry - ProviderRegistry instance for remote lookups
 * @param {object} [opts]
 * @param {object[]} [opts.signals] - Signals from sources (issues, PRs, etc.) that may reference repos
 * @returns {Promise<ResolvedTarget[]>}
 */
export async function resolveTargets(config, providerRegistry, opts = {}) {
  const resolved = [];
  const seen = new Set();

  // Phase 1: Explicit targets from config
  for (const t of config.targets ?? []) {
    const rt = resolveExplicit(t);
    const key = targetKey(rt);
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(rt);
    }
  }

  // Phase 2: Provider-linked discovery from source signals
  if (opts.signals?.length) {
    const discovered = discoverFromSignals(opts.signals, providerRegistry);
    for (const rt of discovered) {
      const key = targetKey(rt);
      if (!seen.has(key)) {
        seen.add(key);
        resolved.push(rt);
      }
    }
  }

  // Phase 3: Ensure workspace fallback
  const hasWorkspace = resolved.some((t) => t.type === 'workspace');
  if (!hasWorkspace) {
    resolved.push({
      type: 'workspace',
      path: DEFAULT_WORKSPACE_PATH,
      access: 'local',
      docs: WORKSPACE_DOCS_LANES,
    });
  }

  return resolved;
}

/**
 * Resolve a single explicit target config entry into a normalized target.
 */
function resolveExplicit(target) {
  if (target.type === 'workspace') {
    return {
      type: 'workspace',
      path: target.path ?? DEFAULT_WORKSPACE_PATH,
      access: 'local',
      docs: WORKSPACE_DOCS_LANES,
    };
  }

  // type: repo
  const hasLocal = target.path && fs.existsSync(target.path);
  const hasRemote = !!target.ref;

  let access = 'remote';
  if (hasLocal && hasRemote) access = 'hybrid';
  else if (hasLocal) access = 'local';

  return {
    type: target.type,
    ref: target.ref ?? null,
    path: hasLocal ? target.path : null,
    access,
    provider: target.provider ?? inferProvider(target.ref),
    docs: target.docs ?? null,
  };
}

/**
 * Extract repo references from source signals (issues, PRs, commits that mention repos).
 */
function discoverFromSignals(signals, _providerRegistry) {
  const discovered = [];
  const repoPattern = /(?:github\.com|gitlab\.com)[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;

  for (const signal of signals) {
    const text = signal.body ?? signal.description ?? signal.title ?? '';
    let match;
    while ((match = repoPattern.exec(text)) !== null) {
      const ref = match[0].replace(/^(github\.com|gitlab\.com)[/:]/, '$1/');
      discovered.push({
        type: 'repo',
        ref,
        path: null,
        access: 'remote',
        provider: ref.startsWith('github') ? 'github' : 'gitlab',
        docs: null,
        discoveredFrom: signal.id ?? signal.url ?? 'signal',
      });
    }
  }

  return discovered;
}

/**
 * Infer provider from a ref string.
 */
function inferProvider(ref) {
  if (!ref) return null;
  if (ref.includes('github.com') || ref.includes('github:')) return 'github';
  if (ref.includes('gitlab.com') || ref.includes('gitlab:')) return 'gitlab';
  if (ref.includes('bitbucket')) return 'bitbucket';
  return null;
}

/**
 * Deduplication key for a target.
 */
function targetKey(t) {
  if (t.type === 'workspace') return 'workspace:' + (t.path ?? 'default');
  return `${t.type}:${t.ref ?? ''}:${t.path ?? ''}`;
}

/**
 * Given resolved targets and an artifact type, determine where to route output.
 *
 * Routing logic:
 *   - If a target has a matching docs lane, route there
 *   - If no specific target matches, route to workspace
 *
 * @param {ResolvedTarget[]} targets
 * @param {string} artifactType - e.g. 'adrs', 'prds', 'memos', 'notes', 'intake'
 * @returns {ResolvedTarget}
 */
export function routeArtifact(targets, artifactType) {
  // Prefer non-workspace target with matching docs lane
  for (const t of targets) {
    if (t.type === 'workspace') continue;
    if (t.access === 'local' || t.access === 'hybrid') {
      // Local targets can receive docs directly
      return t;
    }
  }

  // Fall back to workspace
  const workspace = targets.find((t) => t.type === 'workspace');
  return workspace ?? { type: 'workspace', path: DEFAULT_WORKSPACE_PATH, access: 'local', docs: WORKSPACE_DOCS_LANES };
}

/**
 * Resolve the filesystem path for writing an artifact to a target.
 *
 * @param {ResolvedTarget} target
 * @param {string} artifactType - docs lane (adrs, prds, memos, notes, intake)
 * @param {string} filename
 * @returns {string} Absolute file path
 */
export function resolveArtifactPath(target, artifactType, filename) {
  const base = target.path ?? DEFAULT_WORKSPACE_PATH;
  return path.join(base, 'docs', artifactType, filename);
}
