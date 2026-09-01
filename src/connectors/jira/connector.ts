/**
 * connectors/jira/connector.ts — reading a Jira project as ground, and
 * carrying out one approved change against it.
 *
 * A connector is a "direct" host: it answers the same two questions a host
 * adapter answers — what does this source hold, and can you carry out this
 * approved change — and it produces the same two records, a `SourceSurvey`
 * for the read and an `ApplyReport` for the write. There is no
 * connector-shaped record, because a second kind of evidence is a second
 * thing every reader downstream has to learn to read. What a connector adds
 * is that its record is witnessed rather than reported: the survey was built
 * by this code from a response it received, and the write comes back with a
 * key and a URL a person can open.
 *
 * LIVE PATH DEFERRED. `readJiraCredentials` / `createTransport` in api.ts are
 * the only construction of a real transport; nothing shipped calls them yet.
 * Until a recorded probe against a real site lands, declare-only jira sources
 * stay unreachable from Construct itself (reach via host MCP). Do not delete
 * the transport helpers — they are the only path to a live call.
 *
 * Two structural properties, both load-bearing:
 *
 *   1. NO WRITE WITHOUT A DECISION, BY CONSTRUCTION. The function that puts
 *      words into Jira is a closure inside `apply`, and `apply` reaches it
 *      only through the kernel's own `applyProposal`. There is no exported
 *      way to hand this connector a change and have it write: a caller
 *      holding the connector still needs a store and a proposal id whose row
 *      carries a human approval, or a workspace's standing consent for the
 *      low-risk class, before a request is built at all.
 *   2. NO FIELD THE TRACKER OWNS, BY CONSTRUCTION. Every field sent is
 *      filtered through the kernel's field-authority map. A field the map
 *      does not call domain-owned cannot reach a payload from here, so
 *      status, assignee, priority and labels are not a rule this module
 *      remembers to follow — they are values it has no path to.
 *
 * The vendor vocabulary is restated here rather than shared with the host
 * tier, because a connector may not import a host: the two are separate
 * answers to reaching the outside world. What must not come apart — which
 * side owns which field — is read from the kernel map both sides ask.
 *
 * What this connector will not do, and says so instead: it sets whole
 * fields on an issue, so a proposed edit to words inside a document is not
 * something it can carry out faithfully, and a change naming an issue in
 * some other project is not something it will carry out at all. Both come
 * back as an unapplied change with its reason, which leaves the change with
 * the person who approved it — the honest ending, and the cheap one.
 */

import { applyProposal } from '../../kernel/run/apply.ts';
import type { ApplyOutcome, ApplyReport } from '../../kernel/run/apply.ts';
import type { ConnectorApply, ConnectorRead } from '../../kernel/connectors/seam.ts';
import type { SourceSurvey, SurveyedDocument } from '../../kernel/run/sourcereads.ts';
import type { Store } from '../../kernel/store/open.ts';
import { docEditFor, getSource } from '../../kernel/store/sources.ts';
import { IDENTITY_FIELDS, isDomainOwned } from '../../kernel/tracker/authority.ts';
import { proposalIssue } from '../../kernel/tracker/crossing.ts';
import {
  adfFromText,
  failureText,
  issueBrowseUrl,
  issuePath,
  textFromAdf,
} from './api.ts';
import type { JiraTransport } from './api.ts';
import { COUNT_PATH, ISSUE_PATH, SEARCH_PATH } from './pin.ts';

/** Jira's own shape for a project key, and therefore the only locator this reads. */
const PROJECT_KEY = /^[A-Z][A-Z0-9]+$/;

/** An issue named at the very front of an approved change, and its project. */
const LEADING_ISSUE_KEY = /^\s*([A-Z][A-Z0-9]+)-(\d+)\b/;

/**
 * What the work model's fields are called on this API. A domain-owned field
 * with no entry here is one this connector cannot set: guessing a name would
 * set some other field, which is worse than setting none.
 */
const JIRA_FIELD_NAMES: Readonly<Record<string, string>> = Object.freeze({
  title: 'summary',
  description: 'description',
});

/**
 * How many issues one survey lists. The same reason the directory walk has a
 * cap: an assignment carries every listed document by name, and an unbounded
 * project would bury the prompt under an issue inventory. What the cap drops
 * is recorded as a partial read, never absorbed.
 */
export const ISSUE_CAP = 40;

export interface JiraConnectorConfig {
  readonly transport: JiraTransport;
  /** The declared source id every read row is recorded against. */
  readonly source: string;
  /** The site, for the browse URLs a write hands back as its receipt. */
  readonly site: string;
  /** The type a newly filed issue is created as. */
  readonly issueType?: string;
  readonly cap?: number;
}

export interface JiraConnector {
  readonly read: ConnectorRead;
  /**
   * Carry out one approved change. Takes a store and a proposal id, never a
   * proposal: the authority check is inside this call, so there is no way to
   * reach the write without it.
   */
  apply(store: Store, proposal: string, at: string): Promise<ApplyOutcome>;
}

interface SearchPage {
  readonly issues?: readonly unknown[];
  readonly nextPageToken?: string;
}

function unreachable(source: string, locator: string, reason: string): SourceSurvey {
  return { source, locator, outcome: 'unreachable', reason };
}

/** One issue as a surveyed document: the key a reader cites, and the words it holds. */
function documentFor(issue: unknown): SurveyedDocument | null {
  const record = (issue ?? {}) as { key?: unknown; fields?: unknown };
  if (typeof record.key !== 'string' || record.key === '') return null;
  const fields = (record.fields ?? {}) as { summary?: unknown; description?: unknown };
  const summary = typeof fields.summary === 'string' ? fields.summary : '';
  const description = textFromAdf(fields.description);
  const words = [summary, description].filter((part) => part !== '').join('\n\n');
  return { path: record.key, bytes: Buffer.byteLength(words, 'utf8') };
}

export function createJiraConnector(config: JiraConnectorConfig): JiraConnector {
  const cap = config.cap ?? ISSUE_CAP;
  const issueType = config.issueType ?? 'Task';

  /**
   * What a project holds, as issues. An issue's document here is its summary
   * and its description — the words the issue itself states. Its comments,
   * attachments and history are a separate stream this connector does not
   * read and does not claim: the read row says what was read, and nothing
   * downstream should hear more in it than that.
   */
  const read: ConnectorRead = async (locator) => {
    const project = locator.trim();
    if (!PROJECT_KEY.test(project)) {
      return unreachable(
        config.source,
        locator,
        `"${project}" is not a Jira project key, which starts with an uppercase letter ` +
          'followed by uppercase letters and digits; nothing was asked of Jira',
      );
    }
    const bounded = `project = "${project}"`;
    const documents: SurveyedDocument[] = [];
    let token: string | null = null;
    let dropped = false;
    let unnamed = false;

    try {
      for (;;) {
        const page = await config.transport({
          method: 'POST',
          path: SEARCH_PATH,
          body: {
            jql: `${bounded} ORDER BY key ASC`,
            // Named because the default is ids only: a search that does not
            // ask for them comes back with no words to have read.
            fields: ['summary', 'description'],
            maxResults: cap,
            ...(token === null ? {} : { nextPageToken: token }),
          },
        });
        if (page.status !== 200) {
          return unreachable(config.source, locator, failureText(page));
        }
        const body = (page.body ?? {}) as SearchPage;
        if (!Array.isArray(body.issues)) {
          return unreachable(
            config.source,
            locator,
            'Jira answered 200 with no list of issues, so nothing here can say what the project holds',
          );
        }
        for (const issue of body.issues) {
          if (documents.length >= cap) {
            dropped = true;
            break;
          }
          const document = documentFor(issue);
          // An issue that came back without a key is one no reader could
          // cite and no row could name. Counting it as read would be the
          // silent kind of coverage loss; it goes on the record as part of
          // the remainder instead.
          if (document === null) unnamed = true;
          else documents.push(document);
        }
        token = typeof body.nextPageToken === 'string' ? body.nextPageToken : null;
        if (dropped || token === null) break;
      }
    } catch (error) {
      return unreachable(config.source, locator, `Jira could not be reached — ${(error as Error).message}`);
    }

    const cutShort = dropped || unnamed || token !== null;
    let total = documents.length;
    if (cutShort) {
      // The listing is what witnessed the gap; the count only sizes it. An
      // estimate that lands at or below what is already in hand is not
      // allowed to close a gap that really happened, which is what the floor
      // below is for — including when the count itself could not be had.
      total = Math.max(await approximateCount(bounded), documents.length + 1);
    }
    return { source: config.source, locator, outcome: 'listed', documents, total };
  };

  async function approximateCount(jql: string): Promise<number> {
    try {
      const result = await config.transport({ method: 'POST', path: COUNT_PATH, body: { jql } });
      if (result.status !== 200) return 0;
      const body = (result.body ?? {}) as { count?: unknown };
      return typeof body.count === 'number' ? body.count : 0;
    } catch {
      // A survey that already listed real issues is evidence. Losing all of
      // it because the estimate behind the remainder could not be fetched
      // would trade a known gap for no reading at all.
      return 0;
    }
  }

  /**
   * The fields one change may set, by the map rather than by a list kept
   * here: a field is sent only when the kernel calls it domain-owned and
   * this API has a name for it. `wanted` narrows that further to what the
   * operation itself asserts — a new issue needs a name, and an edit to an
   * issue that already has one does not get to rewrite it.
   */
  function settableFields(
    issue: Record<string, unknown>,
    wanted: readonly string[],
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(issue)) {
      if (IDENTITY_FIELDS.includes(field)) continue;
      if (!isDomainOwned(field)) continue;
      if (!wanted.includes(field)) continue;
      const name = JIRA_FIELD_NAMES[field];
      if (name === undefined) continue;
      fields[name] = name === 'description' ? adfFromText(String(value)) : value;
    }
    return fields;
  }

  function applierFor(store: Store): ConnectorApply {
    return async (proposal): Promise<ApplyReport> => {
      const source = getSource(store, proposal.source);
      if (source === null || source.kind !== 'jira') {
        return {
          applied: false,
          detail:
            `${proposal.source} is ${source === null ? 'not a declared source' : `a ${source.kind} source`}, ` +
            'and this connector reaches Jira only',
        };
      }
      const project = source.locator.trim();
      if (!PROJECT_KEY.test(project)) {
        return {
          applied: false,
          detail: `"${project}" is not a Jira project key, so there is nowhere in Jira this change goes`,
        };
      }
      if (docEditFor(store, proposal.id) !== null) {
        return {
          applied: false,
          detail:
            'it is a proposed edit to the words inside a document, and this connector sets whole ' +
            'fields on an issue; carrying it out would mean guessing which words to leave standing',
        };
      }

      const named = LEADING_ISSUE_KEY.exec(proposal.change);
      if (named !== null && named[1] !== project) {
        return {
          applied: false,
          detail:
            `it names ${named[1]}-${named[2]}, which is not in ${project} — the project this source declares; ` +
            'a change is never carried into a project nobody declared',
        };
      }

      const issue = proposalIssue({
        id: proposal.id,
        change: proposal.change,
        justification: proposal.justification,
      });

      if (named === null) {
        const fields = {
          project: { key: project },
          issuetype: { name: issueType },
          ...settableFields(issue, ['title', 'description']),
        };
        const created = await config.transport({ method: 'POST', path: ISSUE_PATH, body: { fields } });
        if (created.status !== 201) return { applied: false, detail: failureText(created) };
        const body = (created.body ?? {}) as { key?: unknown };
        if (typeof body.key !== 'string' || body.key === '') {
          // A create that answered 201 without a key may well have filed an
          // issue. Nothing here can name it, and an apply recorded without a
          // receipt is the one this surface exists to refuse.
          return {
            applied: false,
            detail:
              'Jira answered 201 without naming the issue it created, so there is no receipt to record; ' +
              'check the project before proposing it again',
          };
        }
        return {
          applied: true,
          detail:
            `filed ${body.key} in ${project} — ${issueBrowseUrl(config.site, body.key)}; it carries the ` +
            'approved words and the reason they were approved, and no field the tracker owns was set',
        };
      }

      const key = `${named[1]}-${named[2]}`;
      const fields = settableFields(issue, ['description']);
      const edited = await config.transport({
        method: 'PUT',
        path: issuePath(key),
        body: { fields },
      });
      if (edited.status !== 204 && edited.status !== 200) {
        return { applied: false, detail: failureText(edited) };
      }
      return {
        applied: true,
        detail:
          `replaced the description of ${key} — ${issueBrowseUrl(config.site, key)}; its summary and ` +
          'every field the tracker owns are untouched',
      };
    };
  }

  return {
    read,
    apply: (store, proposal, at) => applyProposal(store, applierFor(store), proposal, at),
  };
}
