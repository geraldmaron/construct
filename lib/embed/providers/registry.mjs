/**
 * lib/embed/providers/registry.mjs — ProviderRegistry.
 *
 * Holds named provider instances and exposes an async factory that builds
 * the standard set from environment variables. Each provider implements:
 *
 *   read(ref, opts)  → Promise<Item[]>
 *     ref:  source-type string e.g. 'prs', 'issues', 'commits', 'messages'
 *     opts: source config fields (repo, channel, project, …)
 *
 *   write(action)    → Promise<void>   (optional — only mutation providers)
 *     action: { type, channel?, text?, … }
 *
 * Providers are registered by name and can be swapped for test doubles.
 */

export class ProviderRegistry {
  #providers = new Map();

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
   * List all registered provider names.
   */
  names() {
    return [...this.#providers.keys()];
  }

  /**
   * Build a registry pre-populated with all concrete providers derived
   * from the supplied environment. Providers whose required credentials
   * are absent are silently omitted — callers get a warning at runtime
   * when a source references a missing provider.
   *
   * @param {object} env  - Merged environment (loadConstructEnv output)
   * @returns {Promise<ProviderRegistry>}
   */
  static async fromEnv(env = process.env) {
    const registry = new ProviderRegistry();

    if (env.GITHUB_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      const { GitHubProvider } = await import('./github.mjs');
      registry.register(['github', 'gh'], new GitHubProvider({
        token: env.GITHUB_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN,
      }));
    }

    if (env.SLACK_BOT_TOKEN) {
      const { SlackProvider } = await import('./slack.mjs');
      registry.register(['slack'], new SlackProvider({
        token: env.SLACK_BOT_TOKEN,
        teamId: env.SLACK_TEAM_ID,
      }));
    }

    if (env.LINEAR_API_KEY) {
      const { LinearProvider } = await import('./linear.mjs');
      registry.register(['linear'], new LinearProvider({
        apiKey: env.LINEAR_API_KEY,
      }));
    }

    if (env.JIRA_API_TOKEN && env.JIRA_USER_EMAIL && env.JIRA_BASE_URL) {
      const { JiraProvider } = await import('./jira.mjs');
      registry.register(['jira', 'atlassian'], new JiraProvider({
        baseUrl: env.JIRA_BASE_URL,
        email: env.JIRA_USER_EMAIL,
        token: env.JIRA_API_TOKEN,
      }));
    }

    return registry;
  }
}
