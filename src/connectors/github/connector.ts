/**
 * connectors/github/connector.ts — GitHub as a connector: reads a
 * repository's issues as a SourceSurvey (kernel/connectors/seam.ts), applies
 * an approved write proposal by filing an issue. Built over `gh api`, so
 * auth is whatever this machine's gh CLI already resolved — the connector
 * holds no token of its own.
 *
 * One file rather than the usual host-adapter split (adapter/pin/events):
 * the connector gate (scripts/lint-connector-gate.mjs) allows
 * `src/connectors/**` to import only `src/kernel/**` and Node builtins, with
 * no carve-out for a sibling file in the same connector's own directory, so
 * the pin, the gh CLI wrapper, and the seam implementation live together
 * rather than importing each other.
 */

import { spawnSync } from 'node:child_process';
import type { ConnectorApply, ConnectorRead } from '../../kernel/connectors/seam.ts';
import type { SourceSurvey, SurveyedDocument } from '../../kernel/run/sourcereads.ts';
import { proposalIssue } from '../../kernel/tracker/crossing.ts';

// ---------------------------------------------------------------------------
// Pin: the gh CLI version this connector is written against, and the
// behaviors it depends on, named as probe-checkable claims the way
// hosts/opencode/pin.ts names them rather than living silently in the
// argument-building code below.
//
// `version-flag-reports-the-version` was checked against a real, local `gh`
// binary while this connector was written — `gh --version` names only its
// own binary, no network and no repository involved. Every other expectation
// here needs a live call to GitHub's API to verify, which this build was
// scoped not to make; UNPROBED_EXPECTATIONS says so rather than letting the
// gap pass as verified. A session with permission to read a scratch
// repository is what should clear it, the same way `npm run probe:opencode`
// clears the opencode pin's.
// ---------------------------------------------------------------------------

export const PINNED_VERSION = 'gh version 2.96.0 (2026-07-02)';

export interface ConformanceExpectation {
  readonly id: string;
  readonly claim: string;
  readonly whyItMatters: string;
}

export const CONFORMANCE_EXPECTATIONS: readonly ConformanceExpectation[] = [
  {
    id: 'version-flag-reports-the-version',
    claim: '`gh --version` prints "gh version X.Y.Z (release-date)" as its first line.',
    whyItMatters:
      'A future gh with a differently-shaped version line has not been verified against ' +
      'the argument and JSON shapes below, whatever it happens to do.',
  },
  {
    id: 'api-get-with-fields-needs-an-explicit-method',
    claim:
      '`gh api <endpoint>` defaults to GET, but adding any -f/-F field switches the ' +
      'request to POST unless --method is passed explicitly.',
    whyItMatters:
      'The read path sends q/per_page/sort/order as query fields against a GET-only ' +
      'search endpoint. Dropping --method GET would silently turn every read into a ' +
      'POST that endpoint refuses, which would read as unreachable for every repository.',
  },
  {
    id: 'search-issues-reports-an-exact-total-but-not-existence',
    claim:
      '`gh api search/issues` returns `{total_count, items}` where total_count is exact ' +
      'and not bounded by per_page — and answers total_count: 0 identically for a ' +
      'repository with no matching issues and one that does not exist or is not visible.',
    whyItMatters:
      'total_count is what lets a read report "listed 40 of 312" instead of silently ' +
      'capping at 40 forever. The false-zero half is why the read path adds a direct ' +
      'repository lookup before believing a zero.',
  },
  {
    id: 'repo-lookup-404s-honestly',
    claim:
      '`gh api repos/{owner}/{repo}` exits non-zero with a 404 for a repository that ' +
      'does not exist or that this token cannot see.',
    whyItMatters: 'This is the call that tells "empty repository" and "no such repository" apart.',
  },
  {
    id: 'create-issue-returns-the-created-record',
    claim:
      '`gh api repos/{owner}/{repo}/issues -f title=... -f body=...` POSTs and prints the ' +
      'created issue object — including number and html_url — to stdout on success.',
    whyItMatters:
      "The apply path's receipt (\"filed as issue #N at <url>\") is only as fetchable as " +
      'this response actually is; if gh ever printed a bare URL here instead of JSON, ' +
      'parsing it as JSON would fail closed rather than mis-record a receipt.',
  },
  {
    id: 'failed-call-exits-nonzero-with-the-reason-on-stderr',
    claim:
      'A gh api call that fails — bad repository, bad auth, a validation error — exits ' +
      'non-zero and writes the failure reason to stderr.',
    whyItMatters:
      'Every unreachable or unappliable reason this connector reports is stderr text ' +
      'handed through verbatim; if gh moved the reason to stdout instead, failures would ' +
      'report with no reason at all rather than a wrong one.',
  },
];

export const UNPROBED_EXPECTATIONS: readonly string[] = [
  'api-get-with-fields-needs-an-explicit-method',
  'search-issues-reports-an-exact-total-but-not-existence',
  'repo-lookup-404s-honestly',
  'create-issue-returns-the-created-record',
  'failed-call-exits-nonzero-with-the-reason-on-stderr',
];

// ---------------------------------------------------------------------------
// Client: running `gh` and turning its answers into typed results. No
// kernel judgment here, mirroring the split hosts/repo/evidence.ts draws
// between spawning-and-reading and deciding what the answer means.
// ---------------------------------------------------------------------------

export interface GhResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** One `gh` invocation. Injectable so a test never spawns a real process. */
export type GhExec = (args: readonly string[]) => GhResult;

export const defaultGhExec: GhExec = (args) => {
  const result = spawnSync('gh', [...args], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout,
    // A spawn that never started (gh missing from PATH) leaves stderr empty;
    // the reason lives on result.error instead.
    stderr: result.error ? result.error.message : result.stderr,
  };
};

/** The reason a failed call gave, preferring what gh itself said over a bare status code. */
export function ghFailureReason(result: GhResult): string {
  const stderr = result.stderr.trim();
  if (stderr !== '') return stderr;
  if (result.status === null) return 'gh could not be started';
  return `gh exited with status ${String(result.status)} and printed nothing to stderr`;
}

const REPO_LOCATOR = /^([\w.-]+)\/([\w.-]+)$/;

export interface RepoLocator {
  readonly owner: string;
  readonly repo: string;
}

/** A github source locator's parts ("<owner>/<repo>"), or null when it does not match. */
export function parseRepoLocator(locator: string): RepoLocator | null {
  const match = REPO_LOCATOR.exec(locator.trim());
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface GhIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly updatedAt: string;
}

export type SearchIssuesResult =
  | { readonly ok: true; readonly totalCount: number; readonly issues: readonly GhIssue[] }
  | { readonly ok: false; readonly reason: string };

/** `gh api search/issues`'s stdout, read for its exact total and each issue's citable fields. */
export function parseSearchIssuesResponse(raw: string): SearchIssuesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `gh printed something that was not JSON: ${raw.trim().slice(0, 200)}` };
  }
  const record = asRecord(parsed);
  const items = record?.items;
  if (!record || typeof record.total_count !== 'number' || !Array.isArray(items)) {
    return { ok: false, reason: 'the search response did not carry total_count and items as expected' };
  }
  const issues: GhIssue[] = [];
  for (const entry of items) {
    const item = asRecord(entry);
    if (!item || typeof item.number !== 'number' || typeof item.html_url !== 'string') continue;
    issues.push({
      number: item.number,
      title: typeof item.title === 'string' ? item.title : '',
      body: typeof item.body === 'string' ? item.body : '',
      url: item.html_url,
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
    });
  }
  return { ok: true, totalCount: record.total_count, issues };
}

export type CreateIssueResult =
  | { readonly ok: true; readonly number: number; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/** `gh api repos/{owner}/{repo}/issues`'s stdout on a successful create, read for its receipt. */
export function parseCreatedIssueResponse(raw: string): CreateIssueResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `gh printed something that was not JSON: ${raw.trim().slice(0, 200)}` };
  }
  const record = asRecord(parsed);
  if (!record || typeof record.number !== 'number' || typeof record.html_url !== 'string') {
    return { ok: false, reason: 'the created-issue response did not carry a number and html_url as expected' };
  }
  return { ok: true, number: record.number, url: record.html_url };
}

// ---------------------------------------------------------------------------
// Connector: the seam implementation itself.
// ---------------------------------------------------------------------------

/** Same cap hosts/sources.ts uses for a document listing, applied to issues instead of files. */
export const ISSUE_CAP = 40;

export interface GitHubConnectorConfig {
  readonly exec?: GhExec;
  /**
   * The seam hands `read` a bare locator but `apply` a whole proposal naming
   * its source only by row id — resolving that id back to "<owner>/<repo>" is
   * the caller's registry to consult, not something this module can look up
   * on its own. Null means this connector is not configured for that source.
   */
  readonly resolveLocator: (source: string) => string | null;
  readonly cap?: number;
}

export interface GitHubConnector {
  readonly read: ConnectorRead;
  readonly apply: ConnectorApply;
}

function issueToDocument(issue: GhIssue): SurveyedDocument {
  return {
    path: issue.url,
    bytes: Buffer.byteLength(`${issue.title}\n\n${issue.body}`, 'utf8'),
  };
}

function malformedLocator(locator: string): SourceSurvey {
  return {
    source: locator,
    locator,
    outcome: 'unreachable',
    reason: `"${locator}" is not a github source locator — expected "<owner>/<repo>"`,
  };
}

export function createGitHubConnector(config: GitHubConnectorConfig): GitHubConnector {
  const exec = config.exec ?? defaultGhExec;
  const cap = config.cap ?? ISSUE_CAP;

  const read: ConnectorRead = async (locator) => {
    const parsed = parseRepoLocator(locator);
    if (!parsed) return malformedLocator(locator);
    const { owner, repo } = parsed;

    const search = exec([
      'api',
      'search/issues',
      '--method',
      'GET',
      '-f',
      `q=repo:${owner}/${repo} is:issue`,
      '-f',
      `per_page=${String(cap)}`,
      '-f',
      'sort=updated',
      '-f',
      'order=desc',
    ]);
    if (search.status !== 0) {
      return { source: locator, locator, outcome: 'unreachable', reason: ghFailureReason(search) };
    }
    const found = parseSearchIssuesResponse(search.stdout);
    if (!found.ok) {
      return { source: locator, locator, outcome: 'unreachable', reason: found.reason };
    }

    if (found.totalCount === 0) {
      // Search answers zero results for a repository that does not exist or
      // is not visible to this token exactly the way it answers zero results
      // for a real, reachable, empty one. Only a direct lookup of the
      // repository itself tells the two apart.
      const exists = exec(['api', `repos/${owner}/${repo}`, '--method', 'GET']);
      if (exists.status !== 0) {
        return { source: locator, locator, outcome: 'unreachable', reason: ghFailureReason(exists) };
      }
    }

    // The seam gives read only a bare locator, never the source's row id, so
    // there is no other candidate for `source` here — a caller that knows
    // the real id overrides this field on the result it gets back.
    return {
      source: locator,
      locator,
      outcome: 'listed',
      documents: found.issues.map(issueToDocument),
      total: found.totalCount,
    };
  };

  const apply: ConnectorApply = async (proposal) => {
    const locator = config.resolveLocator(proposal.source);
    if (locator === null) {
      return { applied: false, detail: `no github repository is configured for source "${proposal.source}"` };
    }
    const parsed = parseRepoLocator(locator);
    if (!parsed) {
      return {
        applied: false,
        detail: `"${locator}" is not a github source locator — expected "<owner>/<repo>"`,
      };
    }
    const issue = proposalIssue(proposal);
    const created = exec([
      'api',
      `repos/${parsed.owner}/${parsed.repo}/issues`,
      '-f',
      `title=${String(issue.title)}`,
      '-f',
      `body=${String(issue.description)}`,
    ]);
    if (created.status !== 0) {
      return { applied: false, detail: ghFailureReason(created) };
    }
    const result = parseCreatedIssueResponse(created.stdout);
    if (!result.ok) {
      return { applied: false, detail: result.reason };
    }
    return { applied: true, detail: `filed as issue #${String(result.number)} at ${result.url}` };
  };

  return { read, apply };
}
