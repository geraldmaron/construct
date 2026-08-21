/**
 * tests/connectors/jira/fixtures.ts — recorded Jira responses, and a
 * transport that serves them.
 *
 * Every body here is transcribed from Atlassian's published OpenAPI
 * description of the v3 API, at the build recorded in the connector's pin.
 * None was captured from a live site, and that limit belongs on the record:
 * a suite that passes against these proves the connector reads the shape it
 * pinned, and proves nothing at all about what Atlassian sends today.
 */

import type { JiraCall, JiraResult, JiraTransport } from '../../../src/connectors/jira/api.ts';
import { COUNT_PATH, MYSELF_PATH, SEARCH_PATH } from '../../../src/connectors/jira/pin.ts';

export const SITE = 'https://acme.atlassian.net';
export const PROJECT = 'PROJ';

export function adf(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

export function issue(key: string, summary: string, description?: string): unknown {
  return {
    id: key.split('-')[1],
    key,
    self: `${SITE}/rest/api/3/issue/${key}`,
    fields: { summary, ...(description === undefined ? {} : { description: adf(description) }) },
  };
}

/** A page of search results, shaped as the enhanced search returns them. */
export function searchPage(issues: readonly unknown[], nextPageToken?: string): JiraResult {
  return {
    status: 200,
    body: {
      isLast: nextPageToken === undefined,
      issues,
      ...(nextPageToken === undefined ? {} : { nextPageToken }),
    },
  };
}

export const UNBOUNDED_REFUSAL: JiraResult = {
  status: 400,
  body: {
    errorMessages: ["The 'jql' query parameter must be bounded. Add a search restriction."],
    errors: {},
  },
};

export const UNAUTHORIZED: JiraResult = {
  status: 401,
  body: { errorMessages: ['Client must be authenticated to access this resource.'], errors: {} },
};

export interface Recording {
  readonly transport: JiraTransport;
  readonly calls: JiraCall[];
}

/** A transport that records every call and answers from the handler given. */
export function recordingTransport(
  handler: (call: JiraCall) => JiraResult | Promise<JiraResult>,
): Recording {
  const calls: JiraCall[] = [];
  return {
    calls,
    transport: async (call) => {
      calls.push(call);
      return handler(call);
    },
  };
}

function jqlOf(call: JiraCall): string {
  return String(((call.body ?? {}) as { jql?: unknown }).jql ?? '');
}

function fieldsNamed(call: JiraCall): boolean {
  return Array.isArray(((call.body ?? {}) as { fields?: unknown }).fields);
}

/**
 * The whole read-side surface the probe asks about, answering the way the
 * published description says Jira answers.
 */
export function probeTransport(): Recording {
  const issues = [
    issue('PROJ-1', 'Order entry fails when selecting supplier', 'Occurs on all orders.'),
    issue('PROJ-2', 'Deploy step times out', 'Only on the release runner.'),
  ];
  return recordingTransport((call) => {
    if (call.method === 'GET' && call.path === MYSELF_PATH) {
      return {
        status: 200,
        body: { accountId: '5b10a2844c20165700ede21g', emailAddress: 'fred@example.com' },
      };
    }
    if (call.method === 'POST' && call.path === COUNT_PATH) {
      return { status: 200, body: { count: issues.length } };
    }
    if (call.method === 'POST' && call.path === SEARCH_PATH) {
      if (!/project\s*=/.test(jqlOf(call))) return UNBOUNDED_REFUSAL;
      // Ids only unless the caller names the fields it wants.
      return fieldsNamed(call)
        ? searchPage(issues)
        : searchPage(issues.map((i) => ({ id: (i as { id: string }).id, key: (i as { key: string }).key })));
    }
    return { status: 404, body: { errorMessages: [`no fixture for ${call.method} ${call.path}`], errors: {} } };
  });
}
