/**
 * lib/embed/providers/jira.mjs — Jira (Atlassian) provider for embed mode.
 *
 * Reads issues from Jira Cloud using the REST API v3.
 * Zero external deps — uses Node's built-in fetch.
 *
 * Supported refs:
 *   issues     Issues matching a JQL query or project filter
 *   sprints    Active sprint issues for a board
 *
 * Source config fields (embed.yaml):
 *   provider: jira
 *   project: PROJ              # project key (used to build default JQL)
 *   projects:                  # OR list of project keys
 *     - PROJ
 *     - INFRA
 *   jql: "project = PROJ AND sprint in openSprints()"   # override JQL
 *   refs: [issues]
 *   limit: 50                  # max issues (default: 50)
 *   fields: [summary,status,assignee,priority]  # optional field subset
 */

export class JiraProvider {
  #baseUrl;
  #auth;
  #fetchFn;

  constructor({ baseUrl, email, token, fetchFn = globalThis.fetch } = {}) {
    if (!baseUrl || !email || !token) {
      throw new Error('JiraProvider requires baseUrl, email, and token');
    }
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.#fetchFn = fetchFn;
  }

  /**
   * @param {string} ref      - 'issues' | 'sprints'
   * @param {object} opts     - source config (project, projects, jql, limit, fields)
   * @returns {Promise<Item[]>}
   */
  async read(ref, opts = {}) {
    switch (ref) {
      case 'issues':  return this.#listIssues(opts);
      case 'sprints': return this.#listSprintIssues(opts);
      default:        throw new Error(`Jira provider: unknown ref "${ref}"`);
    }
  }

  async #listIssues(opts) {
    const limit = Number(opts.limit ?? 50);
    const jql = opts.jql ?? buildDefaultJql(opts);
    const fields = opts.fields ?? ['summary', 'status', 'assignee', 'priority', 'issuetype', 'labels', 'updated', 'created'];

    const data = await this.#post('/rest/api/3/search', {
      jql,
      maxResults: limit,
      fields,
      orderBy: 'updated DESC',
    });

    return (data.issues ?? []).map((issue) => ({
      type: 'issue',
      source: 'jira',
      key: issue.key,
      id: issue.id,
      title: issue.fields?.summary ?? '',
      status: issue.fields?.status?.name ?? null,
      statusCategory: issue.fields?.status?.statusCategory?.name ?? null,
      assignee: issue.fields?.assignee?.displayName ?? null,
      priority: issue.fields?.priority?.name ?? null,
      issueType: issue.fields?.issuetype?.name ?? null,
      labels: issue.fields?.labels ?? [],
      project: issue.key.split('-')[0],
      url: `${this.#baseUrl}/browse/${issue.key}`,
      createdAt: issue.fields?.created,
      updatedAt: issue.fields?.updated,
      summary: `[${issue.key}] ${issue.fields?.summary ?? ''}`,
    }));
  }

  async #listSprintIssues(opts) {
    // Fetch all boards, find ones matching the project, get active sprint
    const projects = resolveProjects(opts);
    if (!projects.length) throw new Error('Jira sprints source requires "project" or "projects"');

    const results = [];
    for (const projectKey of projects) {
      try {
        const boards = await this.#get(`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&type=scrum`);
        const board = boards.values?.[0];
        if (!board) continue;

        const sprints = await this.#get(`/rest/agile/1.0/board/${board.id}/sprint?state=active`);
        const sprint = sprints.values?.[0];
        if (!sprint) continue;

        const sprintIssues = await this.#get(
          `/rest/agile/1.0/sprint/${sprint.id}/issue?maxResults=${opts.limit ?? 50}`,
        );
        const items = (sprintIssues.issues ?? []).map((issue) => ({
          type: 'issue',
          source: 'jira',
          sprint: sprint.name,
          key: issue.key,
          title: issue.fields?.summary ?? '',
          status: issue.fields?.status?.name ?? null,
          assignee: issue.fields?.assignee?.displayName ?? null,
          priority: issue.fields?.priority?.name ?? null,
          project: projectKey,
          url: `${this.#baseUrl}/browse/${issue.key}`,
          updatedAt: issue.fields?.updated,
          summary: `[${issue.key}] ${issue.fields?.summary ?? ''}`,
        }));
        results.push(...items);
      } catch (err) {
        results.push({ type: 'error', source: 'jira', project: projectKey, message: err.message });
      }
    }
    return results;
  }

  async #get(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await this.#fetchFn(`${this.#baseUrl}${path}`, {
        headers: { Authorization: this.#auth, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Jira API ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async #post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await this.#fetchFn(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: this.#auth,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Jira API ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveProjects(opts) {
  if (Array.isArray(opts.projects)) return opts.projects.filter(Boolean);
  if (opts.project) return [opts.project];
  return [];
}

function buildDefaultJql(opts) {
  const projects = resolveProjects(opts);
  const projectClause = projects.length
    ? `project in (${projects.map((p) => `"${p}"`).join(', ')}) AND `
    : '';
  return `${projectClause}statusCategory != Done ORDER BY updated DESC`;
}
