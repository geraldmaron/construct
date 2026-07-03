/**
 * lib/providers/contract/adapters/jira/transport.mjs — real Jira Cloud REST
 * v3 transport for the governed write adapter.
 *
 * Implements the `jiraTransport` shape governed-write.mjs depends on:
 * `fetchCreatemeta`, `createIssue`, `createComment`, `searchIssues`. Kept
 * separate from governed-write.mjs so tests can inject a fake transport
 * (tests/fakes/fake-jira.mjs) without any network dependency, and separate
 * from the read-oriented adapter in ./index.mjs so this write path never
 * shares mutable state with the read path.
 *
 * Auth: API token via JIRA_URL + JIRA_EMAIL + JIRA_TOKEN env vars, or
 * passed directly via config.
 */

import { AuthError, RateLimitError } from '../../errors.mjs';

export function createJiraTransport(config = {}) {
  const baseUrl = (config.baseUrl ?? process.env.JIRA_URL ?? '').replace(/\/$/, '');
  const email = config.email ?? process.env.JIRA_EMAIL;
  const token = config.token ?? process.env.JIRA_TOKEN;

  if (!baseUrl || !email || !token) {
    throw new AuthError(
      'Jira transport requires JIRA_URL, JIRA_EMAIL, and JIRA_TOKEN (or config.baseUrl/email/token)',
      { provider: 'jira' },
    );
  }

  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  async function request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new RateLimitError('Jira rate limit hit', { provider: 'jira', retryAfter });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Jira API ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    async fetchCreatemeta(projectKey, issueTypeName) {
      const params = new URLSearchParams({
        projectKeys: projectKey,
        issuetypeNames: issueTypeName,
        expand: 'projects.issuetypes.fields',
      });
      return request(`/rest/api/3/issue/createmeta?${params.toString()}`);
    },

    async createIssue({ project, issueType, summary, description, labels, assignee }) {
      const body = {
        fields: {
          project: { key: project },
          issuetype: { name: issueType ?? 'Task' },
          summary,
          ...(description !== undefined ? { description } : {}),
          ...(assignee ? { assignee: { accountId: assignee } } : {}),
          ...(labels ? { labels } : {}),
        },
      };
      const data = await request('/rest/api/3/issue', { method: 'POST', body });
      return {
        id: data.id,
        key: data.key,
        url: `${baseUrl}/browse/${data.key}`,
      };
    },

    async createComment(issueKey, adfBody) {
      const data = await request(`/rest/api/3/issue/${issueKey}/comment`, {
        method: 'POST',
        body: { body: adfBody },
      });
      return {
        id: data.id,
        url: `${baseUrl}/browse/${issueKey}?focusedCommentId=${data.id}`,
      };
    },

    async searchIssues(jql) {
      const query = typeof jql === 'string' ? jql : (jql?.jql ?? '');
      const data = await request('/rest/api/3/search', {
        method: 'POST',
        body: { jql: query, maxResults: 50, fields: ['summary', 'status'] },
      });
      return (data.issues ?? []).map((issue) => ({
        id: issue.id,
        key: issue.key,
        summary: issue.fields?.summary,
        url: `${baseUrl}/browse/${issue.key}`,
      }));
    },
  };
}

export default createJiraTransport;
