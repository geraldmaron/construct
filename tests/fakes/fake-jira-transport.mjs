/**
 * tests/fakes/fake-jira-transport.mjs — in-memory fake Jira REST transport
 * for the governed write adapter (LMCP-J3).
 *
 * Implements the `jiraTransport` shape required by
 * lib/providers/contract/adapters/jira/governed-write.mjs:
 * fetchCreatemeta, createIssue, createComment, searchIssues. Distinct from
 * tests/fakes/fake-jira.mjs (the pre-existing flat write() fake exercised in
 * tests/fakes/fake-providers.test.mjs) — this double models createmeta
 * per-project/issue-type field requirements so tests can exercise
 * createmeta validation and ADF-shape rejection, not just a flat
 * create/reject switch.
 *
 * Usage:
 *   import { createFakeJiraTransport } from './fake-jira-transport.mjs';
 *   const transport = createFakeJiraTransport({
 *     projects: {
 *       PROJ: { issueTypes: { Task: { requiredFields: ['summary'] } } },
 *     },
 *   });
 */

let _seq = 200;

function nextId() {
  return _seq++;
}

const DEFAULT_FIELD_DEFS = {
  summary: { required: true, schema: { type: 'string' } },
  description: { required: false, schema: { type: 'doc' } },
  labels: { required: false, schema: { type: 'array' } },
  assignee: { required: false, schema: { type: 'user' } },
};

/**
 * @param {object} [opts]
 * @param {Record<string, {issueTypes: Record<string, {requiredFields?: string[], fieldOverrides?: object}>}>} [opts.projects]
 *   Project → issue-type → requirement config. Defaults to a "PROJ" project
 *   with a "Task" issue type requiring only "summary".
 */
export function createFakeJiraTransport({ projects } = {}) {
  const projectDefs = projects ?? {
    PROJ: { issueTypes: { Task: {} } },
  };

  const issues = [];
  const comments = [];
  let mode = 'normal'; // 'normal' | 'createmeta-unknown-project' | 'createmeta-missing-field' | 'permission-denied' | 'not-found'
  let createmetaCallCount = 0;
  let createIssueCallCount = 0;
  let updateIssueCallCount = 0;

  function buildCreatemetaResponse(projectKey, issueTypeName) {
    const project = projectDefs[projectKey];
    if (mode === 'createmeta-unknown-project' || !project) {
      return { projects: [] };
    }

    const issueTypeConfig = project.issueTypes?.[issueTypeName];
    if (!issueTypeConfig) {
      return { projects: [{ key: projectKey, issuetypes: [] }] };
    }

    const fields = { ...DEFAULT_FIELD_DEFS };
    for (const key of issueTypeConfig.requiredFields ?? []) {
      fields[key] = { ...(fields[key] ?? { schema: { type: 'string' } }), required: true };
    }
    if (mode === 'createmeta-missing-field') {
      // Simulate a required custom field the caller does not know about.
      fields.customfield_10099 = { required: true, schema: { type: 'string' } };
    }
    for (const [key, override] of Object.entries(issueTypeConfig.fieldOverrides ?? {})) {
      fields[key] = { ...(fields[key] ?? {}), ...override };
    }

    return {
      projects: [
        {
          key: projectKey,
          issuetypes: [
            {
              id: `it-${issueTypeName}`,
              name: issueTypeName,
              fields,
            },
          ],
        },
      ],
    };
  }

  return {
    // ── inspection / control surface ──────────────────────────────────────
    getCreatedIssues: () => issues.map((i) => ({ ...i })),
    getCreatedComments: () => comments.map((c) => ({ ...c })),
    setMode: (next) => { mode = next; },
    reset: () => { issues.length = 0; comments.length = 0; mode = 'normal'; },
    createmetaCallCount: () => createmetaCallCount,
    createIssueCallCount: () => createIssueCallCount,
    updateIssueCallCount: () => updateIssueCallCount,

    // ── jiraTransport contract ────────────────────────────────────────────

    async fetchCreatemeta(projectKey, issueTypeName) {
      createmetaCallCount += 1;
      if (mode === 'createmeta-transport-error') {
        const err = new Error('Service unavailable');
        err.status = 503;
        throw err;
      }
      if (mode === 'createmeta-auth-error') {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }
      return buildCreatemetaResponse(projectKey, issueTypeName);
    },

    async createIssue({ project, issueType, summary, description, labels, assignee }) {
      createIssueCallCount += 1;
      if (mode === 'permission-denied') {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }
      if (mode === 'not-found') {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }

      const id = String(nextId());
      const count = issues.filter((i) => i.project === project).length;
      const key = `${project}-${count + 1}`;
      const url = `https://jira.example.com/browse/${key}`;
      issues.push({ id, key, url, project, issueType, summary, description, labels, assignee });
      return { id, key, url };
    },

    async updateIssue(issueKey, fields) {
      updateIssueCallCount += 1;
      if (mode === 'permission-denied') {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }
      if (mode === 'not-found') {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      const issue = issues.find((i) => i.key === issueKey);
      if (issue) Object.assign(issue, fields);
      return { key: issueKey, url: `https://jira.example.com/browse/${issueKey}` };
    },

    async createComment(issueKey, adfBody) {
      if (mode === 'permission-denied') {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }
      const id = String(nextId());
      const url = `https://jira.example.com/browse/${issueKey}?focusedCommentId=${id}`;
      comments.push({ id, issueKey, body: adfBody, url });
      return { id, url };
    },

    async searchIssues(jql) {
      const query = typeof jql === 'string' ? jql : (jql?.jql ?? '');
      const match = /project\s*=\s*["']?([A-Z]+)["']?/i.exec(query);
      const filtered = match
        ? issues.filter((i) => i.project === match[1].toUpperCase())
        : issues;
      return filtered.map((i) => ({ id: i.id, key: i.key, summary: i.summary, url: i.url }));
    },
  };
}

export default createFakeJiraTransport;
