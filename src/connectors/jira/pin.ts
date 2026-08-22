/**
 * connectors/jira/pin.ts — the pinned Jira Cloud REST surface, and every
 * behavior of it this connector depends on, written down as a named,
 * checkable expectation.
 *
 * A connector is adapter-tier for the same reason a host adapter is: the
 * outside system is a dependency Construct rides rather than rebuilds, so
 * a change on Atlassian's side is a supply-chain event. The failure mode
 * this file exists to prevent is discovering that after a user hits it —
 * every assumption the read and the apply make about Jira is stated here
 * rather than living implicitly inside a parser branch.
 *
 * WHERE THESE CAME FROM, AND WHAT THAT IS WORTH. Every expectation below is
 * read from Atlassian's own published OpenAPI description of the v3 API,
 * at the build recorded in `PINNED_SPEC_BUILD`. None of them has been run
 * against a live Jira site: no site, no credential, and no scratch project
 * exists for this connector yet. So the honest status of this pin is
 * "declared from the vendor's published description, unmeasured against a
 * running instance" — `probe.ts` is the instrument that settles the
 * difference, and until it runs against a real site nothing here may be
 * quoted as verified behavior.
 *
 * When a probe fails: re-verify against the live API, fix whatever moved,
 * and update the expectation — do not widen it to silence the failure. The
 * pin is not a minimum; it is a statement about what was checked.
 */

/** The API major version this connector speaks, and nothing else. */
export const PINNED_API_VERSION = '3';

/** Every path below hangs off this. */
export const API_BASE_PATH = `/rest/api/${PINNED_API_VERSION}`;

/**
 * The published OpenAPI build every expectation here was read from. It is
 * the closest thing the vendor offers to a version string: the API itself
 * is continuously deployed and carries none.
 */
export const PINNED_SPEC_BUILD = '1001.0.0-SNAPSHOT-51db16d09affda6811b2365b55ba1c8ab381e058';

/** JQL search. The older `/search` is being removed; see `search-jql-is-the-live-search`. */
export const SEARCH_PATH = `${API_BASE_PATH}/search/jql`;

/** The only count the enhanced search offers, and it is an estimate. */
export const COUNT_PATH = `${API_BASE_PATH}/search/approximate-count`;

/** Create is a POST here; edit is a PUT to `${ISSUE_PATH}/<key>`. */
export const ISSUE_PATH = `${API_BASE_PATH}/issue`;

/** Who the credential belongs to — the cheapest read that proves auth works. */
export const MYSELF_PATH = `${API_BASE_PATH}/myself`;

export interface ConformanceExpectation {
  readonly id: string;
  readonly claim: string;
  readonly whyItMatters: string;
}

/**
 * Behaviors this connector relies on. Wording is the probe's failure
 * message, so each has to say what broke and what depends on it.
 */
export const CONFORMANCE_EXPECTATIONS: readonly ConformanceExpectation[] = [
  {
    id: 'auth-basic-email-and-api-token',
    claim:
      'Basic authentication carries `base64(email:api-token)`, and account passwords are not accepted',
    whyItMatters:
      'It is the only credential shape this connector builds. If it moves, every call answers 401 and a declared project reads as unreachable for a reason that names authentication rather than the project — which is the honest record, but it is a whole workspace of ground gone.',
  },
  {
    id: 'search-jql-is-the-live-search',
    claim:
      '`POST /rest/api/3/search/jql` is the JQL search that is not deprecated; `/rest/api/3/search` is marked as being removed',
    whyItMatters:
      'Reading a project\'s ground goes through it. The removed endpoint is the one nearly every example still shows, and it is the one that carried a `total` — so a connector written from an example rather than from the pin gets both the endpoint and the coverage arithmetic wrong at once.',
  },
  {
    id: 'search-returns-no-total',
    claim:
      'a search response carries `issues`, `isLast` and `nextPageToken`, and no `total` of any kind',
    whyItMatters:
      "Coverage is the difference between what was listed and what exists. A parser that expected `total` would read `undefined` as nothing missing, and every survey of a capped project would record as a complete read of the whole project — the silent-coverage failure the read record exists to make impossible.",
  },
  {
    id: 'next-page-token-absent-on-last-page',
    claim: 'the last page of a search carries no `nextPageToken` at all, and its `isLast` is true',
    whyItMatters:
      'It is the only witness that a listing ran out rather than was cut short. Without it, a listing stopped by this connector\'s own cap and a listing that reached the end of the project are the same answer, and the cap disappears from the record.',
  },
  {
    id: 'search-returns-ids-only-unless-fields-named',
    claim:
      'the `fields` parameter defaults to `id`, so a search that does not name fields returns issues with no summary and no description',
    whyItMatters:
      'A survey that forgot to name them would record every issue at zero bytes of readable text and still call the read complete. The read row would be true about the request and a lie about the ground.',
  },
  {
    id: 'approximate-count-is-the-only-count',
    claim:
      '`POST /rest/api/3/search/approximate-count` answers `{"count": <number>}`, and the number is an estimate rather than a tally',
    whyItMatters:
      'It is what sizes the gap a cap leaves. Because it is an estimate it is never allowed to close a gap the listing itself witnessed: an estimate that lands at or below what is already in hand would erase a partial read that really happened.',
  },
  {
    id: 'jql-must-be-bounded',
    claim:
      'both search and count require a bounded JQL query, and reject an unbounded one such as `order by key desc` with a 400',
    whyItMatters:
      "The query this connector builds is bounded by its project term, which makes that term load-bearing rather than decorative. It is also why the project key is validated before a query is built at all — an unvalidated locator would be interpolated straight into JQL.",
  },
  {
    id: 'errors-carry-errorMessages-and-errors',
    claim: 'a rejected request answers with `{"errorMessages": [...], "errors": {...}}`',
    whyItMatters:
      'It is where the reason a change was not applied comes from. Without it every refusal reads "HTTP 400", and a person holding an approved change learns nothing about why it is still theirs to make.',
  },
  {
    id: 'create-answers-201-with-id-key-and-self',
    claim: '`POST /rest/api/3/issue` answers 201 with `{"id", "key", "self"}` for the created issue',
    whyItMatters:
      'That is the receipt which makes a connector write witnessed rather than reported: a key and a URL a person can open, produced by the call itself. Without a receipt this write would be exactly as unverifiable as a model saying it did it.',
  },
  {
    id: 'edit-answers-204-with-an-empty-body',
    claim:
      '`PUT /rest/api/3/issue/<key>` answers 204 and no body on success; a body comes back only when `returnIssue=true` is asked for',
    whyItMatters:
      'A parser that insisted on JSON would read a successful edit as a failure, and the proposal would stay approved-and-unapplied after the words had already landed in someone else\'s tracker — the one direction of error this whole surface is built to prevent.',
  },
  {
    id: 'an-edit-replaces-a-field-rather-than-appending-to-it',
    claim:
      'setting a field through `fields` replaces its whole value; there is no append operation for a description',
    whyItMatters:
      'It is why an update is high risk here and never travels on a workspace\'s standing consent, and why an update sets the description and never the summary: the summary is what the team finds the issue by in every list and board, and no approved sentence about a change is a new name for their ticket.',
  },
  {
    id: 'description-takes-atlassian-document-format',
    claim:
      'in v3 the `description` field takes an Atlassian Document Format document, not a string',
    whyItMatters:
      'It is the one place a v2-shaped payload turns into a 400 rather than into wrong words, and the reason this connector renders the approved text into a document node before it sends it.',
  },
  {
    id: 'project-keys-are-uppercase-alphanumeric',
    claim:
      "a project key starts with an uppercase letter followed by uppercase alphanumerics — Jira's own rejection says so in those words",
    whyItMatters:
      'A declared locator is user-supplied text that this connector interpolates into a JQL query. Validating it to the vendor\'s own shape first is what keeps a locator from being able to say anything else.',
  },
];

/**
 * Declared above and deliberately not checked by the probe, with the reason.
 * The probe prints these as unchecked rather than letting them read as
 * verified.
 *
 * All four are write-side. Checking them means creating and editing an issue
 * in a real Jira project, and no scratch project exists for this connector to
 * write into; nobody has approved writing into a real one. Declared and
 * unmeasured is the honest state — an expectation nobody has run is not an
 * expectation that holds, and pretending otherwise here would be the exact
 * thing this pin exists to stop.
 *
 * `project-keys-are-uppercase-alphanumeric` is the fifth, for a different
 * reason: it is read off the vendor's rejection message rather than off a
 * response this connector ever wants to receive, and a probe that provoked
 * one would be measuring Jira's error text, not the behavior the connector
 * rides.
 */
export const UNPROBED_EXPECTATIONS: readonly string[] = [
  'create-answers-201-with-id-key-and-self',
  'edit-answers-204-with-an-empty-body',
  'an-edit-replaces-a-field-rather-than-appending-to-it',
  'description-takes-atlassian-document-format',
  'project-keys-are-uppercase-alphanumeric',
];
