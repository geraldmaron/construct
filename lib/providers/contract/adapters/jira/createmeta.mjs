/**
 * lib/providers/contract/adapters/jira/createmeta.mjs — Jira Cloud createmeta
 * validation for write payloads.
 *
 * Jira Cloud's `GET /rest/api/3/issue/createmeta` (expanded with
 * `projects.issuetypes.fields`) reports, per project + issue type, which
 * fields exist, which are required, and which accept a `doc` (ADF) shape
 * versus a plain scalar. `validateAgainstCreatemeta` runs before any issue
 * create/comment submit so a bad project key, unknown issue type, missing
 * required field, or wrong ADF/plain-text shape surfaces as a client-side
 * error with an actionable message instead of a raw 400 from Jira after the
 * request has already gone out.
 *
 * Providers inject a `fetchCreatemeta(projectKey, issueTypeName)` function
 * so this module has no transport dependency and the fake-jira test double
 * can simulate arbitrary createmeta shapes and failure modes.
 */

import { isAdfDocument } from './adf.mjs';

/**
 * Normalize a raw createmeta API response into a lookup map of
 * `{ [fieldKey]: { required, schema } }` for the requested issue type.
 *
 * @param {object} raw - createmeta response body
 * @param {string} projectKey
 * @param {string} issueTypeName
 * @returns {{ issueTypeId: string|null, fields: Record<string, {required: boolean, schema: object}> } | null}
 */
export function extractIssueTypeMeta(raw, projectKey, issueTypeName) {
  const project = (raw?.projects ?? []).find((p) => p.key === projectKey);
  if (!project) return null;

  const issueType = (project.issuetypes ?? []).find(
    (it) => it.name?.toLowerCase() === issueTypeName?.toLowerCase(),
  );
  if (!issueType) return null;

  const fields = {};
  for (const [key, def] of Object.entries(issueType.fields ?? {})) {
    fields[key] = { required: !!def.required, schema: def.schema ?? {} };
  }
  return { issueTypeId: issueType.id ?? null, fields };
}

/**
 * Validate an issue-create payload against createmeta for its project +
 * issue type before submit. Returns a structured result rather than
 * throwing, so callers can map failures to actionable messages themselves.
 *
 * @param {object} opts
 * @param {function(string, string): Promise<object>} opts.fetchCreatemeta
 * @param {string} opts.projectKey
 * @param {string} opts.issueTypeName
 * @param {object} opts.fieldValues - candidate field values keyed by createmeta field key
 *   (e.g. { summary, description, labels }). `description` is checked for
 *   ADF shape when createmeta reports its schema type as `doc`.
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, errors: string[] }>}
 */
export async function validateAgainstCreatemeta({ fetchCreatemeta, projectKey, issueTypeName, fieldValues }) {
  let raw;
  try {
    raw = await fetchCreatemeta(projectKey, issueTypeName);
  } catch (err) {
    return {
      ok: false,
      reason: 'createmeta-fetch-failed',
      errors: [mapCreatemetaTransportError(err, { projectKey })],
    };
  }

  const meta = extractIssueTypeMeta(raw, projectKey, issueTypeName);
  if (!meta) {
    const knownProjects = (raw?.projects ?? []).map((p) => p.key);
    if (!knownProjects.includes(projectKey)) {
      return {
        ok: false,
        reason: 'unknown-project',
        errors: [
          `Project "${projectKey}" was not found or you lack the Browse Projects / Create Issues permission for it.` +
          (knownProjects.length ? ` Accessible projects: ${knownProjects.join(', ')}.` : ''),
        ],
      };
    }
    return {
      ok: false,
      reason: 'unknown-issue-type',
      errors: [`Issue type "${issueTypeName}" is not available in project "${projectKey}".`],
    };
  }

  const errors = [];

  for (const [fieldKey, def] of Object.entries(meta.fields)) {
    if (!def.required) continue;
    const present = fieldValues[fieldKey] !== undefined && fieldValues[fieldKey] !== null && fieldValues[fieldKey] !== '';
    if (!present) {
      errors.push(`Field "${fieldKey}" is required by project "${projectKey}" / issue type "${issueTypeName}" but was not provided.`);
    }
  }

  for (const [fieldKey, value] of Object.entries(fieldValues)) {
    const def = meta.fields[fieldKey];
    if (!def) continue;
    if (def.schema?.type === 'doc' && value !== undefined && value !== null && !isAdfDocument(value)) {
      errors.push(`Field "${fieldKey}" requires an Atlassian Document Format (ADF) body, but a plain value was submitted.`);
    }
  }

  if (errors.length) {
    return { ok: false, reason: 'field-validation-failed', errors };
  }

  return { ok: true, issueTypeId: meta.issueTypeId };
}

/**
 * Map a createmeta transport failure (401/403/404/5xx) to an actionable
 * message. Jira Cloud returns 404 for both "project does not exist" and
 * "no permission to view project" — the same ambiguity the create-issue
 * endpoint itself has — so the message names both possibilities rather
 * than asserting one.
 *
 * @param {Error & {status?: number}} err
 * @param {{ projectKey: string }} ctx
 * @returns {string}
 */
export function mapCreatemetaTransportError(err, { projectKey }) {
  const status = err?.status;
  if (status === 401) {
    return 'Jira authentication failed while fetching createmeta. Check JIRA_EMAIL / JIRA_API_TOKEN.';
  }
  if (status === 403) {
    return `Forbidden: the authenticated account lacks permission to create issues in project "${projectKey}".`;
  }
  if (status === 404) {
    return `Project "${projectKey}" was not found, or the authenticated account cannot browse it.`;
  }
  if (status && status >= 500) {
    return `Jira createmeta endpoint returned a server error (${status}); retry later.`;
  }
  return `Failed to fetch createmeta for project "${projectKey}": ${err?.message ?? String(err)}`;
}
