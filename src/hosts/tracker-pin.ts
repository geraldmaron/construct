/**
 * hosts/tracker-pin.ts — every MCP tool name hosts/tracker.ts writes into an
 * applier recipe, each one a named expectation the probe
 * (`npm run probe:tracker`) checks against a live, credentialed MCP server.
 * Same discipline as hosts/opencode/pin.ts: a vendor rename must fail loudly
 * at a probe, not silently at an apply. tracker.ts is host-agnostic
 * vocabulary rather than a host adapter, so this sits beside it as a flat
 * file rather than inside a `hosts/<name>/` directory tracker.ts does not
 * have.
 *
 * No tool name is duplicated here — `currentTool` reads it live off
 * tracker.ts's own recipe, the same "a field that changes sides changes in
 * one place" rule tracker.ts states for its field-name maps.
 *
 * The two servers reach differently. GitHub's official MCP server takes a
 * plain bearer token over Streamable HTTP, so `gh auth token` reaches it
 * directly — no host CLI and no OAuth dance required. Atlassian's takes
 * either OAuth or, since mid-2026, HTTP Basic auth of a scoped API token
 * (`Basic base64(email:api_token)`) at https://mcp.atlassian.com/v1/mcp —
 * but that capability is off by default per organisation, and this project
 * holds no such token on any machine it has run the probe from yet. Where a
 * credential exists the probe dials the real server; where it does not, the
 * expectation is tagged unverified below rather than guessed at.
 */

import { trackerRecipeFor } from './tracker.ts';

type ActionName = 'read' | 'create' | 'update' | 'comment';

export interface ToolExpectation {
  readonly id: string;
  readonly kind: 'jira' | 'github';
  /** Which action on the recipe this names — see TrackerRecipe in tracker.ts. */
  readonly action: ActionName;
  readonly claim: string;
}

export const TOOL_EXPECTATIONS: readonly ToolExpectation[] = [
  {
    id: 'jira-read',
    kind: 'jira',
    action: 'read',
    claim: "Atlassian's official MCP server publishes a tool that reads one Jira issue by key.",
  },
  {
    id: 'jira-create',
    kind: 'jira',
    action: 'create',
    claim: "Atlassian's official MCP server publishes a tool that files a new Jira issue.",
  },
  {
    id: 'jira-update',
    kind: 'jira',
    action: 'update',
    claim: "Atlassian's official MCP server publishes a tool that edits fields on an existing Jira issue.",
  },
  {
    id: 'jira-comment',
    kind: 'jira',
    action: 'comment',
    claim: "Atlassian's official MCP server publishes a tool that adds a comment to a Jira issue.",
  },
  {
    id: 'github-read',
    kind: 'github',
    action: 'read',
    claim: "GitHub's official MCP server publishes a tool that reads one issue.",
  },
  {
    id: 'github-create',
    kind: 'github',
    action: 'create',
    claim: "GitHub's official MCP server publishes a tool that files a new issue.",
  },
  {
    id: 'github-update',
    kind: 'github',
    action: 'update',
    claim: "GitHub's official MCP server publishes a tool that edits fields on an existing issue.",
  },
  {
    id: 'github-comment',
    kind: 'github',
    action: 'comment',
    claim: "GitHub's official MCP server publishes a tool that adds a comment to an issue.",
  },
];

/** The tool name hosts/tracker.ts's recipe carries today for one expectation. */
export function currentTool(expectation: ToolExpectation): string {
  const recipe = trackerRecipeFor(expectation.kind);
  if (!recipe) throw new Error(`hosts/tracker.ts carries no recipe for kind "${expectation.kind}"`);
  return recipe[expectation.action].tool;
}

/**
 * Live-verified 2026-08-21 against the real remote server
 * (https://api.githubcopilot.com/mcp/, tools/list), reached with a `gh auth
 * token` bearer — see scripts/probe-tracker-conformance.mjs. That run is what
 * caught this: get_issue, create_issue and update_issue had already been
 * renamed to issue_read and issue_write (a "method" input parameter now
 * carries what the tool name used to), while add_issue_comment came back
 * unchanged. hosts/tracker.ts's GITHUB recipe was corrected to match that
 * live record, not the other way round.
 */
export const VERIFIED: readonly string[] = ['github-read', 'github-create', 'github-update', 'github-comment'];

/**
 * No credentialed Atlassian MCP server is reachable from this project as of
 * 2026-08-21: nothing registers one (`claude mcp list` names no Atlassian
 * entry here), and the org-level API-token grant the vendor's own server
 * needs (see module header) has never been issued for this project. An
 * unauthenticated `initialize` against https://mcp.atlassian.com/v1/mcp does
 * succeed and even answers `tools/list`, but with a reduced, generic
 * three-tool set that says nothing about the four Jira tool names below —
 * treating that response as a check would be worse than skipping, since it
 * would look like a probe and mean nothing.
 *
 * Atlassian's own current reference (support.atlassian.com/
 * atlassian-rovo-mcp-server/docs/supported-tools, read 2026-08-21) still
 * lists all four names below verbatim, which is worth recording — but a docs
 * page is exactly the kind of pinned prose this file exists to stop relying
 * on, so these stay unverified rather than promoted on that evidence alone.
 * Re-run `npm run probe:tracker` with ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN
 * set once a token exists; until then these four are unchecked.
 */
export const UNVERIFIED: readonly string[] = ['jira-read', 'jira-create', 'jira-update', 'jira-comment'];
