/**
 * connectors/jira/probe.ts — check the pinned expectations against whatever
 * is answering.
 *
 * The unit suite proves this connector reads a response correctly. It cannot
 * prove Jira still sends that response; only Jira can. So the checks live
 * here, in one function over a transport, rather than inside the suite:
 * handed a transport built on the global fetch and a real credential, it
 * asks a live site; handed the recorded responses the tests carry, it asks
 * those. Same assertions, two sources, and the difference between them is
 * exactly the difference between a shape that was measured and a shape that
 * was read off the vendor's published description.
 *
 * As of this writing only the second has happened. Nothing here has run
 * against a live Jira site, so a green result over recorded responses says
 * this connector reads the shape it pinned — not that Atlassian still serves
 * it.
 *
 * Every check is read-only. The write-side expectations are listed in
 * `UNPROBED_EXPECTATIONS`: checking them means creating and editing an issue
 * in a real project, which is a different kind of permission from reading
 * one.
 */

import { failureText } from './api.ts';
import type { JiraTransport } from './api.ts';
import { CONFORMANCE_EXPECTATIONS, COUNT_PATH, MYSELF_PATH, SEARCH_PATH, UNPROBED_EXPECTATIONS } from './pin.ts';

/**
 * Whether one expectation still holds. `unknown` is its own answer and never
 * counts as a pass: a check that could not be run has measured nothing, and
 * reporting that as "held" is how a pin rots without anything breaking
 * loudly.
 */
export type ProbeOutcome = 'held' | 'broken' | 'unknown';

export interface ProbeResult {
  readonly id: string;
  readonly outcome: ProbeOutcome;
  /** What was actually observed, in words a person can check the claim against. */
  readonly detail: string;
}

/** Expectations declared in the pin that no check here covers. */
export function uncheckedExpectations(results: readonly ProbeResult[]): readonly string[] {
  return CONFORMANCE_EXPECTATIONS.filter((e) => !results.some((r) => r.id === e.id)).map((e) => e.id);
}

/** Expectations left unchecked without being declared unprobed — a gap, not a decision. */
export function undeclaredGaps(results: readonly ProbeResult[]): readonly string[] {
  return uncheckedExpectations(results).filter((id) => !UNPROBED_EXPECTATIONS.includes(id));
}

export async function probeJiraConformance(
  transport: JiraTransport,
  options: { readonly project: string },
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const record = (id: string, outcome: ProbeOutcome, detail: string): void => {
    results.push({ id, outcome, detail });
  };
  const bounded = `project = "${options.project}"`;

  try {
    const me = await transport({ method: 'GET', path: MYSELF_PATH });
    const body = (me.body ?? {}) as { accountId?: unknown };
    record(
      'auth-basic-email-and-api-token',
      me.status === 200 && typeof body.accountId === 'string' ? 'held' : 'broken',
      me.status === 200
        ? `answered 200${typeof body.accountId === 'string' ? ' and named the account' : ' without naming an account'}`
        : failureText(me),
    );
  } catch (error) {
    record('auth-basic-email-and-api-token', 'unknown', `nothing answered — ${(error as Error).message}`);
  }

  let listed: { readonly status: number; readonly body: Record<string, unknown> } | null = null;
  try {
    const search = await transport({
      method: 'POST',
      path: SEARCH_PATH,
      body: { jql: `${bounded} ORDER BY key ASC`, fields: ['summary', 'description'], maxResults: 5 },
    });
    listed = { status: search.status, body: (search.body ?? {}) as Record<string, unknown> };
    record(
      'search-jql-is-the-live-search',
      search.status === 200 ? 'held' : 'broken',
      search.status === 200 ? 'answered 200 to a bounded JQL search' : failureText(search),
    );
  } catch (error) {
    record('search-jql-is-the-live-search', 'unknown', `nothing answered — ${(error as Error).message}`);
  }

  if (listed === null || listed.status !== 200) {
    record('search-returns-no-total', 'unknown', 'no search response to read');
    record('next-page-token-absent-on-last-page', 'unknown', 'no search response to read');
  } else {
    const hasTotal = 'total' in listed.body;
    record(
      'search-returns-no-total',
      hasTotal ? 'broken' : 'held',
      hasTotal
        ? `the response carried a "total" of ${String(listed.body.total)} — coverage arithmetic here assumes there is none`
        : `the response carried ${Object.keys(listed.body).sort().join(', ')} and no "total"`,
    );
    const isLast = listed.body.isLast === true;
    const hasToken = 'nextPageToken' in listed.body && listed.body.nextPageToken !== null;
    record(
      'next-page-token-absent-on-last-page',
      isLast ? (hasToken ? 'broken' : 'held') : 'unknown',
      isLast
        ? hasToken
          ? 'the last page still carried a nextPageToken, so the token no longer says the listing ran out'
          : 'the last page carried isLast true and no nextPageToken'
        : 'more pages remained, so this run saw no last page to check',
    );
  }

  try {
    const bare = await transport({
      method: 'POST',
      path: SEARCH_PATH,
      body: { jql: `${bounded} ORDER BY key ASC`, maxResults: 5 },
    });
    const issues = ((bare.body ?? {}) as { issues?: unknown }).issues;
    const first = Array.isArray(issues) ? (issues[0] as { fields?: Record<string, unknown> } | undefined) : undefined;
    if (bare.status !== 200) {
      record('search-returns-ids-only-unless-fields-named', 'unknown', failureText(bare));
    } else if (first === undefined) {
      record(
        'search-returns-ids-only-unless-fields-named',
        'unknown',
        `${options.project} answered with no issues, so there was nothing to ask for fields on`,
      );
    } else {
      const carried = first.fields?.summary !== undefined;
      record(
        'search-returns-ids-only-unless-fields-named',
        carried ? 'broken' : 'held',
        carried
          ? 'a search naming no fields came back with a summary anyway — the default is no longer ids only'
          : 'a search naming no fields came back without a summary',
      );
    }
  } catch (error) {
    record('search-returns-ids-only-unless-fields-named', 'unknown', `nothing answered — ${(error as Error).message}`);
  }

  try {
    const counted = await transport({ method: 'POST', path: COUNT_PATH, body: { jql: bounded } });
    const count = ((counted.body ?? {}) as { count?: unknown }).count;
    record(
      'approximate-count-is-the-only-count',
      counted.status === 200 && typeof count === 'number' ? 'held' : 'broken',
      counted.status === 200
        ? `answered ${typeof count === 'number' ? `a count of ${String(count)}` : 'without a numeric count'}`
        : failureText(counted),
    );
  } catch (error) {
    record('approximate-count-is-the-only-count', 'unknown', `nothing answered — ${(error as Error).message}`);
  }

  try {
    const unbounded = await transport({
      method: 'POST',
      path: SEARCH_PATH,
      body: { jql: 'order by key desc', maxResults: 5 },
    });
    record(
      'jql-must-be-bounded',
      unbounded.status === 400 ? 'held' : 'broken',
      unbounded.status === 400
        ? 'an unbounded query was refused with 400'
        : `an unbounded query answered ${String(unbounded.status)} — the project term in every query here is what bounds it`,
    );
    const said = ((unbounded.body ?? {}) as { errorMessages?: unknown }).errorMessages;
    const shaped = Array.isArray(said) && said.length > 0;
    record(
      'errors-carry-errorMessages-and-errors',
      unbounded.status === 400 ? (shaped ? 'held' : 'broken') : 'unknown',
      unbounded.status !== 400
        ? 'nothing was refused, so no refusal shape was seen'
        : shaped
          ? `the refusal said: ${(said as string[]).join('; ')}`
          : 'the refusal carried no errorMessages, so a reported reason would be a bare status code',
    );
  } catch (error) {
    record('jql-must-be-bounded', 'unknown', `nothing answered — ${(error as Error).message}`);
    record('errors-carry-errorMessages-and-errors', 'unknown', `nothing answered — ${(error as Error).message}`);
  }

  return results;
}
