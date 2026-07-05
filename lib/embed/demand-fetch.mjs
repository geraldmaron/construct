/**
 * lib/embed/demand-fetch.mjs — on-demand provider snapshot.
 *
 * Fires a targeted one-shot snapshot for a named source when knowledge is
 * stale or absent. Triggered by the MCP `provider_fetch` tool when Construct
 * detects a user question names a known configured repo or project.
 *
 * Design:
 *   - Resolves source config from env (same path as the daemon's auto-discovery)
 *   - Matches a query string against known repo names, project keys, and aliases
 *   - Runs a single provider.read() call for the matched source
 *   - Writes results as observations into the knowledge base
 *   - Returns a structured result the MCP layer can surface directly
 *
 * Does NOT require the daemon to be running.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConstructEnv } from '../env-config.mjs';
import { addObservation } from '../observation-store.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import {
  resolveEffectiveSourceTargetsFromConfig,
  resolveKnownSourcesFromTargets,
} from '../config/source-targets.mjs';
import { getSourceTargetDescriptor, renderTemplate } from '../config/source-target-registry.mjs';

// ─── Self-query detection ────────────────────────────────────────────────────

/**
 * Detect queries that are asking about Construct itself (not an external provider).
 * These should route to knowledge_search, not to external providers.
 *
 * IMPORTANT: Only match when the query is clearly about Construct-the-tool,
 * not about an external repo/project that happens to use similar words.
 * When in doubt, let matchSourceFromQuery() decide — provider queries should
 * never be blocked by this gate.
 */
const SELF_QUERY_PATTERNS = [
  /\bconstruct\b/i,
  /\bwhat (is|are) (this|the) (tool|system|agent|platform)\b/i,
  /\bhow does (this|the) (tool|system|agent) work\b/i,
  /\bwhat can (you|it|this) do\b/i,
  /\bwhat commands?\b/i,
  /\bavailable commands?\b/i,
  /\bembed (mode|daemon)\b/i,
  /\bauthority guard\b/i,
  /\bcx[\s\/]knowledge\b/i,
  /\bprovider (framework|interface|abstraction)\b/i,
];

/**
 * @param {string} query
 * @returns {boolean}
 */
function isSelfQuery(query) {
  if (!query) return false;
  return SELF_QUERY_PATTERNS.some(re => re.test(query));
}

// ─── Source name resolution ──────────────────────────────────────────────────

/**
 * Build a flat list of known source identifiers from env.
 * Maps each identifier to a { provider, ref } descriptor.
 *
 * @param {object} env
 * @returns {{ id: string, provider: string, ref: string, display: string }[]}
 */
export function resolveKnownSources(env = process.env, cwd = process.cwd()) {
  const { config } = loadProjectConfig(cwd, env);
  const targets = resolveEffectiveSourceTargetsFromConfig(config, env);
  if (targets.length > 0) {
    return resolveKnownSourcesFromTargets(targets);
  }

  const sources = [];

  // GitHub repos
  const repos = (env.GITHUB_REPOS ?? '').split(',').map(r => r.trim()).filter(Boolean);
  for (const repo of repos) {
    const short = repo.split('/').pop(); // "project-iverson" from "hashicorp/project-iverson"
    sources.push({ id: repo.toLowerCase(), provider: 'github', ref: repo, display: repo });
    sources.push({ id: short.toLowerCase(), provider: 'github', ref: repo, display: repo });
    // Normalised: "projectiverson", "iverson"
    sources.push({ id: short.replace(/-/g, '').toLowerCase(), provider: 'github', ref: repo, display: repo });
    // Last word: "iverson" from "project-iverson"
    const words = short.split('-');
    if (words.length > 1) {
      sources.push({ id: words[words.length - 1].toLowerCase(), provider: 'github', ref: repo, display: repo });
    }
  }

  // Jira projects
  const jiraUrl = (env.JIRA_BASE_URL ?? '').trim();
  if (jiraUrl) {
    // JIRA_PROJECTS=PLAT,INF,ENG — optional explicit list
    const projects = (env.JIRA_PROJECTS ?? '').split(',').map(p => p.trim()).filter(Boolean);
    for (const proj of projects) {
      sources.push({ id: proj.toLowerCase(), provider: 'jira', ref: proj, display: `Jira/${proj}` });
    }
    // Always add a generic "jira" entry
    sources.push({ id: 'jira', provider: 'jira', ref: null, display: 'Jira' });
  }

  // Linear
  if (env.LINEAR_API_KEY) {
    sources.push({ id: 'linear', provider: 'linear', ref: null, display: 'Linear' });
    const teams = (env.LINEAR_TEAMS ?? '').split(',').map(t => t.trim()).filter(Boolean);
    for (const team of teams) {
      sources.push({ id: team.toLowerCase(), provider: 'linear', ref: team, display: `Linear/${team}` });
    }
  }

  return sources;
}

/**
 * Match a free-text query against known source identifiers.
 * Returns the best match or null.
 *
 * @param {string} query
 * @param {object} env
 * @returns {{ provider: string, ref: string, display: string } | null}
 */
export function matchSourceFromQuery(query, env = process.env, cwd = process.cwd()) {
  const sources = resolveKnownSources(env, cwd);
  const q = query.toLowerCase();

  // Exact or substring match — longest id wins
  const matches = sources.filter(s => q.includes(s.id));
  if (!matches.length) return null;

  // Prefer longer (more specific) ids
  matches.sort((a, b) => b.id.length - a.id.length);
  return matches[0];
}

// ─── On-demand fetch ─────────────────────────────────────────────────────────

/**
 * Fire a targeted one-shot fetch for a named source. When no specific source
 * matches the query, falls back to fetching from ALL configured providers
 * (the "I don't know what you mean, pull everything fresh" path).
 *
 * @param {object} opts
 * @param {string} opts.query        - Free-text query naming the source
 * @param {string} [opts.rootDir]    - Data root dir (default: homedir())
 * @param {object} [opts.env]        - Env override
 * @returns {Promise<DemandFetchResult>}
 */
export async function demandFetch({ query, rootDir, env, cwd, teamId = null, targetIds = null, registry: injectedRegistry = null, providerRegistry = null } = {}) {
  const resolvedEnv = env ?? loadConstructEnv();
  const root = rootDir ?? (resolvedEnv.CX_DATA_DIR?.trim() || homedir());
  const projectRoot = cwd ?? root;

  // Team-scoped fetch: resolve the team's declared sources and drive the fetch
  // from them. A requested target outside the team is a typed OUT_OF_SCOPE error
  // — never a silent wrong-source fetch. Resolution is by typed selector, so the
  // team's effective sources are stable rather than substring-matched.
  if (teamId) {
    const { resolveTeamSources } = await import('../config/source-targets.mjs');
    let registry = injectedRegistry;
    if (!registry) {
      const { loadRegistry } = await import('../registry/loader.mjs');
      try { registry = loadRegistry({ rootDir: projectRoot, skipValidation: true }); } catch { registry = null; }
    }
    let targets = resolveTeamSources(teamId, { registry, config: {}, env: resolvedEnv });
    if (Array.isArray(targetIds) && targetIds.length) {
      const known = new Set(targets.map((t) => t.id));
      const unknown = targetIds.filter((id) => !known.has(id));
      if (unknown.length) {
        return { ok: false, reason: 'OUT_OF_SCOPE', message: `target_ids not in team ${teamId}: ${unknown.join(', ')}`, items: [], teamId, targetIds };
      }
      targets = targets.filter((t) => targetIds.includes(t.id));
    }
    if (targets.length) {
      return demandFetchTeam({ teamId, targets, rootDir: root, env: resolvedEnv, providerRegistry });
    }
  }

  const match = matchSourceFromQuery(query, resolvedEnv, projectRoot);

  // Self-referential queries about Construct itself → route to knowledge_search,
  // but only when no external provider source was matched.
  if (!match && isSelfQuery(query)) {
    const { knowledgeSearch } = await import('../knowledge/search.mjs');
    const result = knowledgeSearch({ query, topK: 5 });
    return {
      ok: result.ok,
      reason: result.ok ? 'knowledge_search' : 'knowledge_search_empty',
      message: result.message,
      items: result.hits.map(h => ({
        title: h.heading || h.file,
        summary: h.text,
        url: null,
        state: null,
        source: h.file,
      })),
      knowledgeHits: result.hits,
      sources: result.sources,
    };
  }

  if (!match) {
    return demandFetchAll({ query, rootDir: root, env: resolvedEnv, cwd: projectRoot });
  }

  // Dynamically import provider registry to avoid loading all providers at module init
  const { ProviderRegistry } = await import('./providers/registry.mjs');
  const registry = await ProviderRegistry.fromEnv(resolvedEnv);
  const provider = registry.get(match.provider);

  if (!provider) {
    return {
      ok: false,
      reason: 'provider_not_registered',
      message: `Provider "${match.provider}" is not registered (check credentials in config.env)`,
      items: [],
      match,
    };
  }

  // Build read calls for the matched source and execute them
  const readCalls = buildReadCalls(match, resolvedEnv, projectRoot);
  if (!readCalls.length) {
    return {
      ok: false,
      reason: 'unsupported_provider',
      message: `No read strategy defined for provider "${match.provider}"`,
      items: [],
      match,
    };
  }

  let rawItems = [];
  try {
    for (const { ref, opts } of readCalls) {
      const items = await provider.read(ref, opts);
      if (items?.length) rawItems.push(...items);
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'fetch_error',
      message: `Failed to fetch from ${match.display}: ${err.message}`,
      items: [],
      match,
    };
  }

  if (!rawItems?.length) {
    return {
      ok: true,
      reason: 'empty',
      message: `${match.display} returned no items (check permissions or try again)`,
      items: [],
      match,
    };
  }

  // Separate real items from error sentinels the provider may have returned
  const errorItems = rawItems.filter(i => i.type === 'error');
  const dataItems = rawItems.filter(i => i.type !== 'error');

  if (!dataItems.length && errorItems.length) {
    const errMsg = errorItems.map(i => i.message).join('; ');
    return {
      ok: false,
      reason: 'provider_error',
      message: `${match.display} returned errors: ${errMsg}`,
      items: [],
      errors: errorItems,
      match,
    };
  }

  // Write each item as an observation so future queries find them in the knowledge base
  let written = 0;
  for (const item of dataItems) {
    try {
      addObservation(root, {
        role: 'construct',
        category: 'insight',
        summary: item.title ?? item.summary ?? item.id,
        content: buildObservationContent(item, match),
        tags: ['demand-fetch', match.provider, match.ref ?? match.provider, ...(teamId ? [`team:${teamId}`] : [])],
        confidence: 0.9,
        source: `demand-fetch:${match.provider}`,
      });
      written++;
    } catch (err) { process.stderr.write('[demand-fetch.mjs] store-observation: ' + (err?.message ?? String(err)) + '\n'); }
  }

  return {
    ok: true,
    reason: 'fetched',
    message: `Fetched ${dataItems.length} item(s) from ${match.display} and stored ${written} observation(s)${errorItems.length ? ` (${errorItems.length} error(s): ${errorItems.map(i => i.message).join('; ')})` : ''}`,
    items: dataItems,
    match,
    written,
    errors: errorItems.length ? errorItems : undefined,
    ...(teamId ? { teamId } : {}),
  };
}

// ─── Universal fetch (all providers) ─────────────────────────────────────────

/**
 * Fetch from ALL configured providers. Used when no specific source matches a
 * query — gives Construct a broad current-state refresh across every integration.
 *
 * @param {object} opts
 * @param {string} [opts.query]    - Original query (for logging/tagging only)
 * @param {string} [opts.rootDir]  - Data root dir
 * @param {object} [opts.env]      - Resolved env
 * @returns {Promise<DemandFetchResult>}
 */
async function demandFetchAll({ query, rootDir, env, cwd } = {}) {
  const { ProviderRegistry } = await import('./providers/registry.mjs');
  const registry = await ProviderRegistry.fromEnv(env);
  const projectRoot = cwd ?? rootDir ?? process.cwd();
  const { config } = loadProjectConfig(projectRoot, env);
  const targets = resolveEffectiveSourceTargetsFromConfig(config, env);
  const scoped = targets.length > 0;

  const providerNames = scoped
    ? [...new Set(targets.map((t) => t.provider))].filter((name) => registry.get(name))
    : registry.names();

  if (!providerNames.length) {
    return {
      ok: false,
      reason: 'no_providers',
      message: scoped
        ? 'No provider credentials configured for the declared source targets'
        : 'No provider credentials configured in config.env',
      items: [],
    };
  }

  const allItems = [];
  const errors = [];
  const sources = resolveKnownSources(env, projectRoot);

  // Group known sources by provider so we can batch-fetch per-provider
  const byProvider = new Map();
  for (const src of sources) {
    if (!byProvider.has(src.provider)) byProvider.set(src.provider, []);
    byProvider.get(src.provider).push(src);
  }

  for (const name of providerNames) {
    if (!byProvider.has(name)) byProvider.set(name, []);
  }

  if (scoped) {
    for (const key of [...byProvider.keys()]) {
      if (!providerNames.includes(key)) byProvider.delete(key);
    }
  }

  for (const [providerName, provSources] of byProvider) {
    const provider = registry.get(providerName);
    if (!provider) continue;

    // Build read calls — one set per known source, or a default if none listed
    const matchList = provSources.length > 0
      ? provSources
      : (scoped ? [] : [{ provider: providerName, ref: null, display: providerName }]);

    if (!matchList.length) continue;

    for (const src of matchList) {
      const readCalls = buildReadCalls(src, env, projectRoot);
      if (!readCalls.length) continue;
      for (const { ref, opts, display } of readCalls) {
        try {
          const items = await provider.read(ref, opts);
          if (items?.length) {
            allItems.push(...items);
            for (const item of items) {
              try {
                addObservation(rootDir, {
                  role: 'construct',
                  category: 'insight',
                  summary: item.title ?? item.summary ?? item.id,
                  content: buildObservationContent(item, { provider: providerName, ref: src.ref, display: display ?? src.display ?? providerName }),
                  tags: ['demand-fetch', 'universal', providerName],
                  confidence: 0.85,
                  source: `demand-fetch:all:${providerName}`,
                });
              } catch (err) { process.stderr.write('[demand-fetch.mjs] universal-store-obs: ' + (err?.message ?? String(err)) + '\n'); }
            }
          }
        } catch (err) {
          errors.push({ provider: providerName, ref: src.ref ?? null, error: err.message });
        }
      }
    }
  }

  const knownSourceList = sources.map(s => s.display).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none';

  if (!allItems.length && errors.length) {
    return {
      ok: false,
      reason: 'fetch_errors',
      message: `Universal fetch failed for all providers. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join('; ')}`,
      items: [],
      errors,
    };
  }

  return {
    ok: true,
    reason: allItems.length ? 'fetched_all' : 'empty_all',
    message: allItems.length
      ? `Universal fetch: ${allItems.length} item(s) from ${providerNames.join(', ')}${errors.length ? ` (${errors.length} provider error(s))` : ''}`
      : `Universal fetch returned no items from any provider (${knownSourceList})`,
    items: allItems,
    written: allItems.length,
    providers: providerNames,
    errors: errors.length ? errors : undefined,
    query,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a list of { ref, opts } pairs to pass to provider.read(ref, opts).
 *
 * Dispatches on the matched provider's manifest-derived `sourceTarget.demandFetch`
 * descriptor (lib/config/source-target-registry.mjs) rather than naming
 * providers — a provider whose descriptor declares `queryDynamicJql` gets
 * jira's recency-guarded/targeted JQL construction, one with `queryOptsKind:
 * 'scalar'` gets linear's single-value opts, one with `querySupported: false`
 * (or no `demandFetch` block at all) is skipped, and everything else gets
 * github's fixed-array-opts, multi-ref shape.
 *
 * @param {{ provider: string, ref: string|null, display: string }} match
 * @param {object} env
 * @returns {{ ref: string, opts: object, display: string }[]}
 */
function buildReadCalls(match, env, cwd = process.cwd()) {
  const descriptor = getSourceTargetDescriptor(match.provider);
  const df = descriptor?.demandFetch;
  if (!df || df.querySupported === false) return [];

  if (df.queryDynamicJql) {
    const dj = df.queryDynamicJql;
    const { config } = loadProjectConfig(cwd, env);
    const projects = resolveEffectiveSourceTargetsFromConfig(config, env)
      .filter((t) => t.provider === match.provider)
      .map((t) => t.selector[descriptor.selector.field]);
    const projectList = projects.length
      ? projects
      : (env[dj.legacyProjectsEnvVar] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const recencyDays = parseInt(env[dj.recencyEnvVar], 10) || dj.recencyDefaultDays;

    let jql;
    if (match.ref) {
      // Targeted fetch — no recency cutoff, user asked for this value specifically
      jql = renderTemplate(dj.singleTemplate, { value: match.ref });
    } else if (projectList.length > 0) {
      // Broad/fallback fetch — scoped to configured values with recency guard
      const quoted = projectList.map((p) => `"${p}"`).join(', ');
      jql = renderTemplate(dj.broadTemplate, { values: quoted, recencyDays });
    } else {
      // Nothing configured — skip rather than defaulting to an unscoped query
      return [];
    }
    return [{ ref: df.targetRefs[0], opts: { jql, limit: df.queryDefaultLimit }, display: match.display }];
  }

  if (df.queryOptsKind === 'scalar') {
    const value = df.queryOptsNullable ? (match.ref ?? null) : match.ref;
    return [{ ref: df.queryRefs[0], opts: { [df.queryOptsField]: value, limit: df.queryDefaultLimit }, display: match.display }];
  }

  const opts = { [df.queryOptsField]: [match.ref], limit: df.queryDefaultLimit };
  return df.queryRefs.map((ref) => ({ ref, opts, display: match.display }));
}

// Read calls for one resolved team source, honoring the target's own filters
// (jira jql, github refs/limit, slack oldest) rather than the generic defaults.
// Same manifest-derived dispatch as buildReadCalls, keyed on target.provider.

function buildReadCallsForTarget(target) {
  const descriptor = getSourceTargetDescriptor(target.provider);
  const sel = target.selector ?? {};
  const f = target.filters ?? {};
  const display = `${target.provider}/${descriptor ? (sel[descriptor.selector.field] ?? target.id) : target.id}`;
  const df = descriptor?.demandFetch;
  if (!df) return [];

  const limit = Number.isInteger(f.limit) ? f.limit : df.targetDefaultLimit;

  if (df.targetJqlTemplate) {
    const jql = typeof f[df.targetJqlFilterKey] === 'string'
      ? f[df.targetJqlFilterKey]
      : renderTemplate(df.targetJqlTemplate, { value: sel[descriptor.selector.field] });
    return [{ ref: df.targetRefs[0], opts: { jql, limit }, display }];
  }

  if (df.targetOptsKind === 'scalar') {
    return [{ ref: df.targetRefs[0], opts: { [df.targetOptsField]: sel[descriptor.selector.field], limit }, display }];
  }

  if (df.targetRefsFilterKey) {
    const refs = Array.isArray(f[df.targetRefsFilterKey]) ? f[df.targetRefsFilterKey] : df.targetRefs;
    const opts = { [df.targetOptsField]: [sel[descriptor.selector.field]], limit };
    return refs.map((ref) => ({ ref, opts, display }));
  }

  const opts = { [df.targetOptsField]: [sel[descriptor.selector.field]], limit };
  for (const key of df.targetExtraFilterKeys ?? []) {
    if (key === 'oldest') opts.oldest = Number.isInteger(f.oldest) ? f.oldest : df.targetOldestDefault;
  }
  return [{ ref: df.targetRefs[0], opts, display }];
}

// Drive the fetch from a team's resolved sources: one provider read per target,
// every observation tagged team:<id> + target:<id> so results stay retrievable by
// team scope. providerRegistry is injectable for hermetic tests.

async function demandFetchTeam({ teamId, targets, rootDir, env, providerRegistry = null }) {
  let registry = providerRegistry;
  if (!registry) {
    const { ProviderRegistry } = await import('./providers/registry.mjs');
    registry = await ProviderRegistry.fromEnv(env);
  }

  const allItems = [];
  const errors = [];
  let written = 0;

  for (const target of targets) {
    const provider = registry.get(target.provider);
    if (!provider) {
      errors.push({ provider: target.provider, targetId: target.id, message: `provider "${target.provider}" not registered` });
      continue;
    }
    for (const { ref, opts, display } of buildReadCallsForTarget(target)) {
      try {
        const items = await provider.read(ref, opts);
        for (const item of items ?? []) {
          if (item.type === 'error') { errors.push(item); continue; }
          allItems.push(item);
          try {
            addObservation(rootDir, {
              role: 'construct',
              category: 'insight',
              summary: item.title ?? item.summary ?? item.id,
              content: buildObservationContent(item, { provider: target.provider, ref: target.id, display }),
              tags: ['demand-fetch', 'team', target.provider, `team:${teamId}`, `target:${target.id}`],
              confidence: 0.88,
              source: `demand-fetch:team:${teamId}:${target.id}`,
            });
            written++;
          } catch (err) { process.stderr.write('[demand-fetch.mjs] team-store-obs: ' + (err?.message ?? String(err)) + '\n'); }
        }
      } catch (err) {
        errors.push({ provider: target.provider, targetId: target.id, message: err.message });
      }
    }
  }

  return {
    ok: errors.length === 0 || allItems.length > 0,
    reason: allItems.length ? 'team_fetched' : 'team_empty',
    message: `Fetched ${allItems.length} item(s) from team ${teamId} (${targets.length} source(s)), stored ${written} observation(s)`,
    items: allItems,
    teamId,
    targetIds: targets.map((t) => t.id),
    written,
    errors: errors.length ? errors : undefined,
  };
}

function buildObservationContent(item, match) {
  const lines = [`Source: ${match.display}`, `Provider: ${match.provider}`];
  if (item.url) lines.push(`URL: ${item.url}`);

  if (item.type === 'meta') {
    if (item.description) lines.push(`Description: ${item.description}`);
    if (item.language)    lines.push(`Language: ${item.language}`);
    if (item.visibility)  lines.push(`Visibility: ${item.visibility}`);
    if (item.topics?.length) lines.push(`Topics: ${item.topics.join(', ')}`);
    if (item.defaultBranch) lines.push(`Default branch: ${item.defaultBranch}`);
    if (item.pushedAt)    lines.push(`Last push: ${item.pushedAt}`);
    return lines.join('\n');
  }

  if (item.type === 'doc') {
    if (item.path) lines.push(`Path: ${item.path}`);
    if (item.content) lines.push(`\n${item.content}`);
    return lines.join('\n');
  }

  if (item.state ?? item.status) lines.push(`Status: ${item.state ?? item.status}`);
  if (item.body ?? item.description) {
    const body = String(item.body ?? item.description ?? '').slice(0, 500);
    if (body) lines.push(`\n${body}`);
  }
  return lines.join('\n');
}
