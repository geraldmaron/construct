/**
 * lib/providers/contract/adapters/jira/governed-write.mjs — envelope-shaped
 * Jira write adapter.
 *
 * Wraps a Jira REST transport in the provider shape lib/writes/envelope.mjs
 * expects: write(config, payload), meta.id, search(). This is the only
 * exposed entry point for Jira writes — specialists and CLI callers route
 * through writeWithEnvelope(), never through a raw Jira client, so dedup,
 * retry, dry-run, approval, and audit stay centralized in the envelope
 * (LMCP-J2) rather than being reimplemented per-adapter.
 *
 * Adds the two behaviors createmeta + ADF require that a generic envelope
 * cannot provide:
 *
 *   - createmeta validation before submit: fetches per-issue-type field
 *     metadata via the injected `jiraTransport.fetchCreatemeta` (which
 *     sources it from the `issue/createmeta/{projectIdOrKey}/issuetypes[/
 *     {issueTypeId}]` endpoint pair — see transport.mjs) and checks required
 *     fields and ADF-vs-plain field shape before making the create/comment
 *     call, so a bad project key, unknown issue type, missing required
 *     field, or wrong field shape surfaces as an actionable client-side
 *     error rather than a raw Jira 400.
 *   - ADF body construction: `description` (issue create) and `body`
 *     (comment) are converted from plain text to Atlassian Document Format
 *     via lib/providers/contract/adapters/jira/adf.mjs before submit.
 *
 * Only `type: 'issue'` and `type: 'comment'` writes get createmeta + ADF
 * treatment; other write types are rejected — this adapter does not
 * support transitions or field updates (non-goal per LMCP-J3).
 */

import { AuthError } from '../../errors.mjs';
import { buildAdfDocument, renderAdfPreview } from './adf.mjs';
import { validateAgainstCreatemeta } from './createmeta.mjs';

/**
 * @param {object} opts
 * @param {object} opts.jiraTransport - underlying Jira REST transport; must implement
 *   `fetchCreatemeta(projectKey, issueTypeName)`, `createIssue(fields)`,
 *   `createComment(issueKey, adfBody)`, and `searchIssues(jql)`.
 */
export function createGovernedJiraProvider({ jiraTransport } = {}) {
  if (!jiraTransport) throw new Error('createGovernedJiraProvider: jiraTransport is required');

  async function writeIssue(payload) {
    const { project, issueType = 'Task', summary, description, labels, assignee } = payload;
    if (!project) throw new Error('jira governed write: payload.project is required for type "issue"');
    if (!summary) throw new Error('jira governed write: payload.summary is required for type "issue"');

    const descriptionAdf = description !== undefined ? buildAdfDocument(description) : undefined;

    const validation = await validateAgainstCreatemeta({
      fetchCreatemeta: jiraTransport.fetchCreatemeta.bind(jiraTransport),
      projectKey: project,
      issueTypeName: issueType,
      fieldValues: {
        summary,
        description: descriptionAdf,
        labels,
        assignee,
      },
    });

    if (!validation.ok) {
      const err = new Error(validation.errors.join(' '));
      err.code = validation.reason;
      err.jiraValidation = validation;
      throw err;
    }

    try {
      const result = await jiraTransport.createIssue({
        project,
        issueType,
        summary,
        description: descriptionAdf,
        labels,
        assignee,
      });
      return { type: 'issue-created', id: result.id, key: result.key, url: result.url };
    } catch (err) {
      throw mapWriteTransportError(err, { project });
    }
  }

  async function writeComment(payload) {
    const { issueKey, body } = payload;
    if (!issueKey) throw new Error('jira governed write: payload.issueKey is required for type "comment"');
    if (!body) throw new Error('jira governed write: payload.body is required for type "comment"');

    const bodyAdf = buildAdfDocument(body);

    try {
      const result = await jiraTransport.createComment(issueKey, bodyAdf);
      return { type: 'comment-created', id: result.id, issueKey, url: result.url };
    } catch (err) {
      throw mapWriteTransportError(err, { issueKey });
    }
  }

  return {
    meta: {
      id: 'jira',
      displayName: 'Jira (governed)',
      capabilities: ['write', 'search'],
      description: 'Envelope-routed Jira writes with createmeta pre-validation and ADF body construction.',
    },

    async write(config, payload) {
      if (payload?.type === 'issue') return writeIssue(payload);
      if (payload?.type === 'comment') return writeComment(payload);
      throw new Error(`jira governed write: unsupported type "${payload?.type}" (only 'issue' and 'comment' are supported)`);
    },

    async search(config, query) {
      return jiraTransport.searchIssues(query);
    },

    /**
     * Render the ADF-shaped payload the envelope would submit, without
     * calling createmeta or the transport. Feeds the envelope's dry-run
     * path (lib/writes/envelope.mjs `dryRun: true`), giving a human
     * reviewing a pending write both the raw ADF tree and a flattened
     * preview string, not just the plain-text input.
     *
     * @param {object} payload
     * @returns {{ type: string, fields: object, adfPreview: Record<string,string> }}
     */
    renderDryRun(payload) {
      if (payload?.type === 'issue') {
        const descriptionAdf = payload.description !== undefined ? buildAdfDocument(payload.description) : undefined;
        return {
          type: 'issue',
          fields: {
            project: { key: payload.project },
            issuetype: { name: payload.issueType ?? 'Task' },
            summary: payload.summary,
            ...(descriptionAdf ? { description: descriptionAdf } : {}),
            ...(payload.labels ? { labels: payload.labels } : {}),
            ...(payload.assignee ? { assignee: payload.assignee } : {}),
          },
          adfPreview: descriptionAdf ? { description: renderAdfPreview(descriptionAdf) } : {},
        };
      }
      if (payload?.type === 'comment') {
        const bodyAdf = buildAdfDocument(payload.body);
        return {
          type: 'comment',
          fields: { issueKey: payload.issueKey, body: bodyAdf },
          adfPreview: { body: renderAdfPreview(bodyAdf) },
        };
      }
      throw new Error(`jira governed write: cannot render dry-run for unsupported type "${payload?.type}"`);
    },
  };
}

/**
 * Map a create/comment transport failure (401/403/404) to an actionable
 * message. Distinct from mapCreatemetaTransportError since it covers the
 * write call itself, not the pre-flight createmeta fetch.
 *
 * @param {Error & {status?: number}} err
 * @param {{ project?: string, issueKey?: string }} ctx
 * @returns {Error}
 */
function mapWriteTransportError(err, ctx) {
  const status = err?.status;
  if (status === 401) {
    return new AuthError(
      'Jira authentication failed. Check JIRA_EMAIL / JIRA_TOKEN — or the token may have expired (Jira API tokens expire after a maximum of 1 year).',
      { provider: 'jira' },
    );
  }
  if (status === 403) {
    const target = ctx.project ? `project "${ctx.project}"` : `issue "${ctx.issueKey}"`;
    return new Error(`Forbidden: the authenticated account lacks permission to write to ${target}, or the API token has expired (Jira API tokens expire after a maximum of 1 year).`);
  }
  if (status === 404) {
    const target = ctx.project ? `Project "${ctx.project}"` : `Issue "${ctx.issueKey}"`;
    return new Error(`${target} was not found, or the authenticated account cannot access it.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export default createGovernedJiraProvider;
