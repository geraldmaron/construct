/**
 * lib/embed/demand-fetch.mjs — on-demand provider snapshot.
 *
 * Fires a targeted one-shot snapshot for a named source when knowledge is
 * stale or absent. Called from the MCP `provider_fetch` tool when Construct
 * detects a user question names a known configured repo or project.
 *
 * Design:
 *   - Resolves source config from env (same path as the daemon's auto-discovery)
 *   - Matches a query string against known repo names, project keys, and aliases
 *   - Runs a single provider.fetch() call for the matched source
 *   - Writes results as observations into the knowledge base
 *   - Returns a structured result the MCP layer can surface directly
 *
 * This does NOT require the daemon to be running.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConstructEnv } from '../env-config.mjs';
import { addObservation } from '../observation-store.mjs';

// ─── Source name resolution ──────────────────────────────────────────────────

/**
 * Build a flat list of known source identifiers from env.
 * Maps each identifier to a { provider, ref } descriptor.
 *
 * @param {object} env
 * @returns {{ id: string, provider: string, ref: string, display: string }[]}
 */
export function resolveKnownSources(env = process.env) {
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
export function matchSourceFromQuery(query, env = process.env) {
  const sources = resolveKnownSources(env);
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
export async function demandFetch({ query, rootDir, env } = {}) {
  const resolvedEnv = env ?? loadConstructEnv();
  const root = rootDir ?? (resolvedEnv.CX_DATA_DIR?.trim() || homedir());

  const match = matchSourceFromQuery(query, resolvedEnv);
  if (!match) {
    // No specific source match — fetch from all configured providers
    return demandFetchAll({ query, rootDir: root, env: resolvedEnv });
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

  // Build a minimal source descriptor for this provider
  const source = buildSourceDescriptor(match, resolvedEnv);

  let rawItems = [];
  try {
    rawItems = await provider.fetch(source);
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

  // Write each item as an observation so future queries find them in the knowledge base
  let written = 0;
  for (const item of rawItems) {
    try {
      addObservation(root, {
        role: 'construct',
        category: 'insight',
        summary: item.title ?? item.summary ?? item.id,
        content: buildObservationContent(item, match),
        tags: ['demand-fetch', match.provider, match.ref ?? match.provider],
        confidence: 0.9,
        source: `demand-fetch:${match.provider}`,
      });
      written++;
    } catch { /* non-fatal — continue */ }
  }

  return {
    ok: true,
    reason: 'fetched',
    message: `Fetched ${rawItems.length} item(s) from ${match.display} and stored ${written} observation(s)`,
    items: rawItems,
    match,
    written,
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
async function demandFetchAll({ query, rootDir, env } = {}) {
  const { ProviderRegistry } = await import('./providers/registry.mjs');
  const registry = await ProviderRegistry.fromEnv(env);
  const providerNames = registry.names();

  if (!providerNames.length) {
    return {
      ok: false,
      reason: 'no_providers',
      message: 'No provider credentials configured in config.env',
      items: [],
    };
  }

  const allItems = [];
  const errors = [];
  const sources = resolveKnownSources(env);

  // Group known sources by provider so we can batch-fetch per-provider
  const byProvider = new Map();
  for (const src of sources) {
    if (!byProvider.has(src.provider)) byProvider.set(src.provider, []);
    byProvider.get(src.provider).push(src);
  }

  // Also include providers that have no explicit sources (Jira, Linear default fetch)
  for (const name of providerNames) {
    if (!byProvider.has(name)) byProvider.set(name, []);
  }

  for (const [providerName, provSources] of byProvider) {
    const provider = registry.get(providerName);
    if (!provider) continue;

    // Build source descriptors — one per known source, or a default if none listed
    const descriptors = provSources.length > 0
      ? provSources.map(s => buildSourceDescriptor(s, env))
      : [buildSourceDescriptor({ provider: providerName, ref: null, display: providerName }, env)];

    for (const descriptor of descriptors) {
      try {
        const items = await provider.fetch(descriptor);
        if (items?.length) {
          allItems.push(...items);
          let written = 0;
          for (const item of items) {
            try {
              addObservation(rootDir, {
                role: 'construct',
                category: 'insight',
                summary: item.title ?? item.summary ?? item.id,
                content: buildObservationContent(item, { provider: providerName, ref: descriptor.repos?.[0] ?? descriptor.team ?? null, display: descriptor.repos?.[0] ?? providerName }),
                tags: ['demand-fetch', 'universal', providerName],
                confidence: 0.85,
                source: `demand-fetch:all:${providerName}`,
              });
              written++;
            } catch { /* non-fatal */ }
          }
        }
      } catch (err) {
        errors.push({ provider: providerName, ref: descriptor.repos?.[0] ?? null, error: err.message });
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

function buildSourceDescriptor(match, env) {
  if (match.provider === 'github') {
    return {
      provider: 'github',
      repos: [match.ref],
      refs: ['prs', 'issues'],
      limit: 25,
    };
  }
  if (match.provider === 'jira') {
    return {
      provider: 'jira',
      refs: ['issues'],
      jql: match.ref
        ? `project = "${match.ref}" AND statusCategory != Done ORDER BY updated DESC`
        : (env.JIRA_DEFAULT_JQL ?? 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'),
      limit: 50,
    };
  }
  if (match.provider === 'linear') {
    return {
      provider: 'linear',
      refs: ['issues'],
      team: match.ref ?? null,
      limit: 50,
    };
  }
  return { provider: match.provider };
}

function buildObservationContent(item, match) {
  const lines = [`Source: ${match.display}`, `Provider: ${match.provider}`];
  if (item.url) lines.push(`URL: ${item.url}`);
  if (item.state ?? item.status) lines.push(`Status: ${item.state ?? item.status}`);
  if (item.body ?? item.description) {
    const body = String(item.body ?? item.description ?? '').slice(0, 500);
    if (body) lines.push(`\n${body}`);
  }
  return lines.join('\n');
}
