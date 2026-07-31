/**
 * lib/providers/contract/adapters/jira/transport.mjs — real Jira Cloud REST
 * v3 transport for the governed write adapter.
 *
 * Implements the `jiraTransport` shape governed-write.mjs depends on:
 * `fetchCreatemeta`, `createIssue`, `updateIssue`, `createComment`,
 * `searchIssues`. Kept separate from governed-write.mjs so tests can inject
 * a fake transport (tests/fakes/fake-jira.mjs) without any network
 * dependency, and separate from the read-oriented adapter in ./index.mjs,
 * keeping mutable state isolated per path.
 *
 * `fetchCreatemeta` calls the `issue/createmeta/{projectIdOrKey}
 * /issuetypes[/{issueTypeId}]` pair — the single `GET issue/createmeta` call is
 * deprecated (June 2024, no firm sunset date) — and re-synthesizes the old
 * `{projects:[{key, issuetypes:[{id, name, fields}]}]}` shape so
 * createmeta.mjs's `extractIssueTypeMeta` needs no changes. `searchIssues`
 * calls `search/jql` (the old `POST search` now returns `410 Gone` on Jira
 * Cloud) with an explicit `fields` array; no caller of `searchIssues` reads
 * pagination info today, so the cursor-based `nextPageToken` response is not
 * surfaced — only the first page (maxResults 50) is translated to the same
 * flat array shape callers already expect.
 *
 * Auth: API token via JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN env vars
 * (the same convention lib/embed/providers/registry.mjs and
 * lib/providers/atlassian-jira/index.mjs use for reads), or passed directly
 * via config; JIRA_URL / JIRA_TOKEN are accepted as a fallback. Jira API
 * tokens expire automatically after a maximum of 1 year (Atlassian policy,
 * enforced retroactively since 2025-03-13) and this transport has no
 * rotation or expiry-check logic (out of scope) — a 401/403
 * response gets an actionable hint pointing at token expiry as a possible
 * cause, not just "check your credentials".
 */

import { AuthError, RateLimitError } from '../../errors.mjs';
import { guardedFetch } from '../../../../net-guard.mjs';

export function createJiraTransport(config = {}) {
  const baseUrl = (config.baseUrl ?? process.env.JIRA_BASE_URL ?? process.env.JIRA_URL ?? '').replace(/\/$/, '');
  const email = config.email ?? process.env.JIRA_EMAIL;
  const token = config.token ?? process.env.JIRA_API_TOKEN ?? process.env.JIRA_TOKEN;

  if (!baseUrl || !email || !token) {
    throw new AuthError(
      'Jira transport requires JIRA_BASE_URL (or JIRA_URL), JIRA_EMAIL, and JIRA_API_TOKEN (or JIRA_TOKEN) — or config.baseUrl/email/token',
      { provider: 'jira' },
    );
  }

  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  // Egress runs through the N7 guard (SSRF/rebinding). A self-hosted instance on
  // a private address is the only legitimate private target, so it is an
  // explicit, audited opt-in — never the default.
  const allowPrivate = config.allowPrivateEgress ?? process.env.CONSTRUCT_NET_ALLOW_PRIVATE_EGRESS === '1';

  async function request(path, { method = 'GET', body } = {}) {
    const res = await guardedFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }, { allowPrivate });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new RateLimitError('Jira rate limit hit', { provider: 'jira', retryAfter });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 401/403 from Jira is indistinguishable from a wrong token at the
      // HTTP layer alone; Atlassian's mandatory 1-year API-token expiry
      // (retroactive since 2025-03-13) makes "expired" at least as likely as
      // "wrong" for an operator debugging a live failure, so name it here
      // rather than leaving that hypothesis for the caller to guess at.
      const authHint = (res.status === 401 || res.status === 403)
        ? ' — if JIRA_EMAIL/JIRA_TOKEN look correct, the API token may have expired or been revoked (Jira API tokens expire after a maximum of 1 year)'
        : '';
      const err = new Error(`Jira API ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}${authHint}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    async fetchCreatemeta(projectKey, issueTypeName) {
      const issueTypesPath = `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`;
      const issueTypesPage = await request(issueTypesPath);
      const issueType = (issueTypesPage.values ?? []).find(
        (it) => it.name?.toLowerCase() === issueTypeName?.toLowerCase(),
      );
      if (!issueType) {
        return { projects: [{ key: projectKey, issuetypes: [] }] };
      }

      const fieldsPage = await request(`${issueTypesPath}/${issueType.id}`);
      const fields = {};
      for (const field of fieldsPage.values ?? []) {
        fields[field.fieldId] = { required: !!field.required, schema: field.schema ?? {} };
      }

      return {
        projects: [
          {
            key: projectKey,
            issuetypes: [{ id: issueType.id, name: issueType.name, fields }],
          },
        ],
      };
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

    async updateIssue(issueKey, fields) {
      await request(`/rest/api/3/issue/${issueKey}`, { method: 'PUT', body: { fields } });
      return { key: issueKey, url: `${baseUrl}/browse/${issueKey}` };
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
      // search/jql (lib/embed/providers/jira.mjs carries the in-repo precedent
      // for the verb+body shape) replaces POST /rest/api/3/search, which now
      // returns 410 Gone on Jira Cloud. Unlike the old endpoint, search/jql
      // does not return all fields by default, so an explicit `fields` array
      // is mandatory — already the case here. Pagination is cursor-based
      // (`nextPageToken`) instead of offset-based (`startAt`/`total`); the
      // searchIssues() return contract has always been a flat array of the
      // first page with no pagination info surfaced to callers, so only the
      // first page is fetched and nextPageToken goes untranslated.
      const data = await request('/rest/api/3/search/jql', {
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
