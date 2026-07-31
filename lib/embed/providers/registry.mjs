/**
 * lib/embed/providers/registry.mjs — ProviderRegistry.
 *
 * Holds named provider instances and exposes an async factory that builds
 * the standard set from the unified extension manifest registry
 * (lib/extensions/*) rather than a second, hardcoded env-var table. Each
 * embed-mode provider implements:
 *
 *   read(ref, opts)  → Promise<Item[]>
 *     ref:  source-type string e.g. 'prs', 'issues', 'commits', 'messages'
 *     opts: source config fields (repo, channel, project, …)
 *
 *   write(action)    → Promise<void>   (optional — only mutation providers)
 *     action: { type, channel?, text?, … }
 *
 * `fromEnv()` reads the merged builtin/user/project manifest tiers, keeps
 * only `kind: 'data-source'` manifests that declare the `read` capability
 * and have a registered embed adapter (ADAPTERS below), and gates each on
 * the credential predicate declared next to that adapter. A manifest with
 * no adapter entry, or whose credential predicate fails, is never silently
 * dropped: `fromEnv()` also returns the unavailable set with a reason so
 * callers (construct status, `describe()`) can surface "configured but
 * unavailable" instead of a provider that appears to simply not exist.
 *
 * Providers are registered by name and can be swapped for test doubles.
 */

import { loadManifestsFromDir, mergeManifests, resolveManifestDirs } from '../../extensions/loader.mjs';

/**
 * Registered embed adapters keyed by unified-manifest id. Each entry names
 * the module to dynamically import, the aliases to register the instance
 * under, how to build the constructor options from env, and a credential
 * predicate over the manifest's own `secretEnvKeys` — so "is this provider
 * usable" is derived from the manifest's declared keys, not re-hardcoded.
 *
 * `credentials` is one of:
 *   { anyOf: [...] }  — usable if at least one listed env var is set (GitHub)
 *   { allOf: [...] }  — usable only if every listed env var is set (Jira)
 *   null              — no credentials required, always usable (directory)
 */
const ADAPTERS = {
  directory: {
    aliases: ['directory', 'dir'],
    credentials: null,
    load: () => import('./directory.mjs'),
    build: (mod) => new mod.DirectoryProvider(),
  },
  github: {
    aliases: ['github', 'gh'],
    credentials: { anyOf: ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GH_TOKEN'] },
    load: () => import('./github.mjs'),
    build: (mod, env) => new mod.GitHubProvider({
      token: env.GITHUB_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN || env.GH_TOKEN,
    }),
  },
  slack: {
    aliases: ['slack'],
    credentials: { anyOf: ['SLACK_BOT_TOKEN'] },
    load: () => import('./slack.mjs'),
    build: (mod, env) => new mod.SlackProvider({
      token: env.SLACK_BOT_TOKEN,
      teamId: env.SLACK_TEAM_ID,
    }),
  },
  linear: {
    aliases: ['linear'],
    credentials: { anyOf: ['LINEAR_API_KEY'] },
    load: () => import('./linear.mjs'),
    build: (mod, env) => new mod.LinearProvider({
      apiKey: env.LINEAR_API_KEY,
    }),
  },
  'atlassian-jira': {
    aliases: ['jira', 'atlassian'],
    credentials: { allOf: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] },
    load: () => import('./jira.mjs'),
    build: (mod, env) => new mod.JiraProvider({
      baseUrl: env.JIRA_BASE_URL,
      email: env.JIRA_EMAIL,
      token: env.JIRA_API_TOKEN,
    }),
  },
  'atlassian-confluence': {
    aliases: ['confluence'],
    credentials: { allOf: ['CONFLUENCE_BASE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN'] },
    load: () => import('./confluence.mjs'),
    build: (mod, env) => new mod.ConfluenceProvider({
      baseUrl: env.CONFLUENCE_BASE_URL,
      email: env.CONFLUENCE_EMAIL,
      token: env.CONFLUENCE_API_TOKEN,
    }),
  },
};

function credentialStatus(predicate, env) {
  if (!predicate) return { ok: true, missing: [] };
  if (predicate.anyOf) {
    const ok = predicate.anyOf.some((key) => !!env[key]);
    return { ok, missing: ok ? [] : predicate.anyOf };
  }
  if (predicate.allOf) {
    const missing = predicate.allOf.filter((key) => !env[key]);
    return { ok: missing.length === 0, missing };
  }
  return { ok: true, missing: [] };
}

/**
 * Load the merged data-source manifests (builtin < user < project tiers)
 * that also carry a registered embed adapter. Manifests for kinds embed
 * mode cannot use (e.g. ingestion-provider) are excluded here rather than
 * downstream, so every caller of this helper sees the same candidate set.
 */
function candidateManifests(rootDir) {
  const { builtin, user, project } = resolveManifestDirs({ rootDir });
  const { manifests: builtinManifests } = loadManifestsFromDir(builtin);
  const { manifests: userManifests } = loadManifestsFromDir(user);
  const { manifests: projectManifests } = loadManifestsFromDir(project);
  const merged = mergeManifests(builtinManifests, userManifests, projectManifests);

  return merged.filter((m) => (
    m.kind === 'data-source' &&
    Array.isArray(m.capabilities) &&
    m.capabilities.includes('read') &&
    Object.prototype.hasOwnProperty.call(ADAPTERS, m.id)
  ));
}

export class ProviderRegistry {
  #providers = new Map();
  #unavailable = [];

  /**
   * Register a provider under one or more names.
   * @param {string|string[]} names
   * @param {object} provider
   */
  register(names, provider) {
    for (const name of [].concat(names)) {
      this.#providers.set(name, provider);
    }
    return this;
  }

  /**
   * Retrieve a provider by name. Returns null if not registered.
   * @param {string} name
   */
  get(name) {
    return this.#providers.get(name) ?? null;
  }

  /**
   * Build the union of all registered providers' default sources.
   * Called when no embed.yaml is present.
   * @param {object} env  - Merged environment (for providers that need it, e.g. GitHub repos)
   * @returns {object[]}  - Array of source config objects ready for SnapshotEngine
   */
  autoSources(env = {}) {
    const sources = [];
    for (const provider of this.#providers.values()) {
      if (typeof provider.defaultSources === 'function') {
        sources.push(...provider.defaultSources(env));
      }
    }
    // Deduplicate by provider+refs signature — multiple registry aliases can point to same instance
    const seen = new Set();
    return sources.filter((s) => {
      const key = `${s.provider}:${(s.refs ?? []).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * List all registered provider names.
   */
  names() {
    return [...this.#providers.keys()];
  }

  /**
   * Manifest-declared data-source providers this registry knows about but
   * did not register — each entry names why, so status surfaces render
   * "configured but unavailable" instead of the provider vanishing.
   * @returns {{ id: string, displayName: string, reason: string }[]}
   */
  unavailable() {
    return this.#unavailable;
  }

  /**
   * Build a registry pre-populated with every unified-registry data-source
   * manifest (lib/extensions/*) that declares the `read` capability
   * and has a registered embed adapter, gated on that adapter's credential
   * predicate. Providers whose required credentials are absent are not
   * registered but are recorded in `unavailable()` with a reason — callers
   * get an explicit "configured but unavailable" signal rather than a
   * provider that silently doesn't exist.
   *
   * @param {object} env  - Merged environment (loadConstructEnv output)
   * @param {object} [opts]
   * @param {string} [opts.rootDir] - Project root for project-tier manifests
   * @returns {Promise<ProviderRegistry>}
   */
  static async fromEnv(env = process.env, { rootDir = process.cwd() } = {}) {
    const registry = new ProviderRegistry();

    for (const manifest of candidateManifests(rootDir)) {
      const adapter = ADAPTERS[manifest.id];
      const { ok, missing } = credentialStatus(adapter.credentials, env);

      if (!ok) {
        registry.#unavailable.push({
          id: manifest.id,
          displayName: manifest.id,
          reason: `missing credentials: ${missing.join(', ')}`,
        });
        continue;
      }

      try {
        const mod = await adapter.load();
        const instance = adapter.build(mod, env);
        registry.register(adapter.aliases, instance);
      } catch (err) {
        registry.#unavailable.push({
          id: manifest.id,
          displayName: manifest.id,
          reason: `adapter failed to load: ${err.message}`,
        });
      }
    }

    return registry;
  }
}
