/**
 * lib/orchestration/context-bindings.mjs — resolve per-run context-target
 * bindings for orchestration runs (bead construct-760c.4).
 *
 * An orchestration run can name which registered source targets it should draw
 * context from — `contextTargets: [{id, role?}]`. This module validates those
 * ids against the project's effective `sources.targets[]` at PLAN time and
 * resolves each to a binding record persisted on the run for audit and picked up
 * by the run's retrieval path. An unknown id is a hard error before any task is
 * built (never a silent skip), so a run never plans against context it can't
 * reach.
 *
 * `role` is an optional free-form hint (e.g. "tracker", "reference") threaded
 * verbatim onto the binding — there is no role enum in core. Content-capable
 * targets (directory / synced corpus, via lib/sources/content-roots.mjs) also
 * carry a resolved `contentRoot` so a directory-bound run can read the docs
 * directly; targets with no local content (a tracker like jira) resolve to a
 * binding with `contentRoot: null` and provider identity only.
 */

import { resolveEffectiveSourceTargetsFromConfig } from '../config/source-targets.mjs';
import { resolveContentRoots } from '../sources/content-roots.mjs';

export class ContextTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContextTargetError';
    this.code = 'CONTEXT_TARGET_UNKNOWN';
  }
}

function normalizeRequests(contextTargets) {
  if (contextTargets == null) return [];
  const list = Array.isArray(contextTargets) ? contextTargets : [contextTargets];
  return list
    .map((entry) => (typeof entry === 'string' ? { id: entry } : entry))
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim())
    .map((entry) => ({ id: entry.id.trim(), role: entry.role != null ? String(entry.role) : null }));
}

/**
 * Resolve requested context targets into binding records, or throw
 * ContextTargetError naming the offending id and the known ids. Returns an empty
 * array when nothing is requested — the caller then falls back to today's
 * implicit source resolution, unchanged.
 *
 * @param {Array<{id: string, role?: string}>|string[]} contextTargets
 * @param {object} opts
 * @param {object} opts.config    loaded project config
 * @param {object} [opts.env]
 * @param {string} [opts.cwd]     project root, for content-root resolution
 * @returns {{id, provider, role, resolution, contentRoot, ref}[]}
 */
export function resolveContextBindings(contextTargets, { config, env = process.env, cwd = process.cwd() } = {}) {
  const requests = normalizeRequests(contextTargets);
  if (!requests.length) return [];

  const targets = resolveEffectiveSourceTargetsFromConfig(config, env);
  const byId = new Map(targets.map((t) => [t.id, t]));
  const contentRoots = resolveContentRoots(targets, { projectRoot: cwd });
  const rootByTargetId = new Map(contentRoots.map((r) => [r.origin.targetId, r]));

  const bindings = [];
  const seen = new Set();
  for (const req of requests) {
    if (seen.has(req.id)) continue;
    seen.add(req.id);

    const target = byId.get(req.id);
    if (!target) {
      const known = [...byId.keys()].join(', ') || '(none registered)';
      throw new ContextTargetError(`unknown context target "${req.id}" — known targets: ${known}`);
    }
    const root = rootByTargetId.get(req.id) || null;
    bindings.push({
      id: target.id,
      provider: target.provider,
      role: req.role,
      resolution: 'resolved',
      contentRoot: root ? root.dir : null,
      ref: root ? root.origin.ref : null,
    });
  }
  return bindings;
}
