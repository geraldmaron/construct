/**
 * lib/embed/providers/linear.mjs — Linear provider for embed mode.
 *
 * Reads issues from Linear using the GraphQL API.
 * Zero external deps — uses Node's built-in fetch.
 *
 * Supported refs:
 *   issues     Open/in-progress issues
 *   cycles     Active cycle issues
 *
 * Source config fields (embed.yaml):
 *   provider: linear
 *   team: ENG                  # team key or ID (optional — all teams if omitted)
 *   project: My Project        # project name filter (optional)
 *   refs: [issues]
 *   states: [Todo, In Progress] # filter by state names (default: excludes Done/Cancelled)
 *   limit: 50                  # max issues (default: 50)
 */

const LINEAR_API = 'https://api.linear.app/graphql';

export class LinearProvider {
  #apiKey;
  #fetchFn;

  constructor({ apiKey, fetchFn = globalThis.fetch } = {}) {
    if (!apiKey) throw new Error('LinearProvider requires an apiKey');
    this.#apiKey = apiKey;
    this.#fetchFn = fetchFn;
  }

  /**
   * @param {string} ref      - 'issues' | 'cycles'
   * @param {object} opts     - source config (team, project, states, limit)
   * @returns {Promise<Item[]>}
   */
  async read(ref, opts = {}) {
    switch (ref) {
      case 'issues': return this.#listIssues(opts);
      case 'cycles': return this.#listCycleIssues(opts);
      default:       throw new Error(`Linear provider: unknown ref "${ref}"`);
    }
  }

  async #listIssues(opts) {
    const limit = Number(opts.limit ?? 50);
    const stateFilter = Array.isArray(opts.states) ? opts.states : null;

    // Build filter clauses
    const filters = [];
    if (opts.team) filters.push(`team: { key: { eq: "${opts.team}" } }`);
    if (stateFilter) {
      const stateIn = stateFilter.map((s) => `"${s}"`).join(', ');
      filters.push(`state: { name: { in: [${stateIn}] } }`);
    } else {
      // Default: exclude terminal states
      filters.push(`state: { type: { nin: ["completed", "cancelled"] } }`);
    }
    if (opts.project) filters.push(`project: { name: { eq: "${opts.project}" } }`);

    const filterClause = filters.length ? `filter: { ${filters.join(', ')} }` : '';

    const query = `{
      issues(first: ${limit} ${filterClause} orderBy: updatedAt) {
        nodes {
          id
          identifier
          title
          description
          priority
          priorityLabel
          state { name type }
          assignee { name }
          team { name key }
          project { name }
          url
          createdAt
          updatedAt
          labels { nodes { name } }
        }
      }
    }`;

    const data = await this.#graphql(query);
    return (data?.issues?.nodes ?? []).map((issue) => ({
      type: 'issue',
      source: 'linear',
      id: issue.identifier,
      title: issue.title,
      description: issue.description?.slice(0, 200) ?? null,
      state: issue.state?.name,
      stateType: issue.state?.type,
      priority: issue.priorityLabel,
      assignee: issue.assignee?.name ?? null,
      team: issue.team?.key,
      teamName: issue.team?.name,
      project: issue.project?.name ?? null,
      labels: (issue.labels?.nodes ?? []).map((l) => l.name),
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      summary: `[${issue.identifier}] ${issue.title}`,
    }));
  }

  async #listCycleIssues(opts) {
    const limit = Number(opts.limit ?? 50);
    const teamFilter = opts.team ? `filter: { team: { key: { eq: "${opts.team}" } } }` : '';

    const query = `{
      cycles(first: 1 ${teamFilter} filter: { isActive: { eq: true } }) {
        nodes {
          id
          name
          number
          startsAt
          endsAt
          team { name key }
          issues(first: ${limit}) {
            nodes {
              id
              identifier
              title
              state { name type }
              assignee { name }
              priority
              priorityLabel
              url
              updatedAt
            }
          }
        }
      }
    }`;

    const data = await this.#graphql(query);
    const cycle = data?.cycles?.nodes?.[0];
    if (!cycle) return [];

    return (cycle.issues?.nodes ?? []).map((issue) => ({
      type: 'issue',
      source: 'linear',
      cycle: `${cycle.team?.key ?? ''} Cycle ${cycle.number}`,
      id: issue.identifier,
      title: issue.title,
      state: issue.state?.name,
      stateType: issue.state?.type,
      priority: issue.priorityLabel,
      assignee: issue.assignee?.name ?? null,
      url: issue.url,
      updatedAt: issue.updatedAt,
      summary: `[${issue.identifier}] ${issue.title}`,
    }));
  }

  async #graphql(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await this.#fetchFn(LINEAR_API, {
        method: 'POST',
        headers: {
          Authorization: this.#apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Linear API HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(`Linear GraphQL: ${json.errors[0].message}`);
      }
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }
}
