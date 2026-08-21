/**
 * hosts/tracker.ts — how an approved change reaches the two trackers a
 * workspace can declare as sources: which official MCP server carries it,
 * which action on that server does it, and which actions the change never
 * licenses however reasonable they look from inside the task.
 *
 * This is host-tier on purpose. The kernel knows a source is a `jira` or a
 * `github` one, and knows which fields the domain may assert; it does not know
 * that Jira calls a title a summary, that GitHub calls a description a body, or
 * that either vendor publishes an MCP server at all. Vendor vocabulary is the
 * knowledge a host adapter holds, the same way tuning.ts holds what a model
 * family's output shapes look like.
 *
 * The forbidden half is the point of this module, not a footnote. Every field
 * the tracker owns under kernel/tracker/authority.ts has an action on these
 * servers that would set it — `transitionJiraIssue` moves a status,
 * `update_issue` takes `state`, `labels`, and `assignees` — and a model
 * carrying out "move PROJ-14 to Q4" reaches for one of them the moment the edit
 * looks incomplete without it. The rule is that a tracker-owned field is never
 * overwritten by the domain; on this side of the seam that rule has to be said
 * in the vendor's own words, naming the action, or it has not been said at all.
 * Both field lists are read off the authority map rather than kept here, so a
 * field that changes sides changes in one place.
 *
 * Nothing here opens a connection or ships a vendor client. A recipe is words a
 * host reads; whether the server is actually present is the host's own answer,
 * and a host without it says so plainly and the change stays with the person
 * who approved it.
 */

import { escapeForPrompt } from '../kernel/run/sourcereads.ts';

/** One action on a tracker's official MCP server, named as that server names it. */
export interface TrackerAction {
  /** The tool name the official server publishes. */
  readonly tool: string;
  /** What it does, in one line a person could check afterwards. */
  readonly does: string;
}

/**
 * An action on the same server that this change never licenses. Named
 * explicitly rather than left to "don't touch anything else", because the
 * model has the tool in front of it and a general caution loses to a specific
 * one.
 */
export interface ForbiddenAction {
  readonly action: string;
  readonly because: string;
}

export interface TrackerRecipe {
  /** The source kind this recipe answers for. */
  readonly kind: string;
  /** The official MCP server, named as its vendor publishes it. */
  readonly server: string;
  /** What the source's locator points at on that server, as a bare noun phrase. */
  readonly locatorIs: string;
  /** What one work item is called there. */
  readonly item: string;
  readonly read: TrackerAction;
  readonly create: TrackerAction;
  readonly update: TrackerAction;
  readonly comment: TrackerAction;
  readonly forbidden: readonly ForbiddenAction[];
  /**
   * What a field of the work model is called on this server. A field with no
   * entry renders under its own name — the vendor either calls it the same
   * thing or has no field for it, and inventing a translation would be worse
   * than saying the plain name.
   */
  readonly fieldNames: Readonly<Record<string, string>>;
}

const JIRA: TrackerRecipe = Object.freeze({
  kind: 'jira',
  server: "Atlassian's official MCP server for Jira and Confluence",
  locatorIs: 'Jira project key',
  item: 'issue',
  read: {
    tool: 'getJiraIssue',
    does: 'read the issue as it stands now, before changing any part of it',
  },
  create: { tool: 'createJiraIssue', does: 'file a new issue in that project' },
  update: { tool: 'editJiraIssue', does: 'edit the fields of an issue that already exists' },
  comment: {
    tool: 'addCommentToJiraIssue',
    does: 'add a comment, when the approved change is a remark rather than a field edit',
  },
  forbidden: [
    {
      action: 'transitionJiraIssue',
      because: "an issue's status is the tracker's to move and its people's to decide, never this change's",
    },
    {
      action: 'editJiraIssue with status, assignee, priority, or labels among the fields set',
      because: 'the same edit that carries the approved words would quietly take over four fields nobody approved',
    },
  ],
  fieldNames: {
    title: 'summary',
    description: 'description',
    status: 'status',
    assignee: 'assignee',
    priority: 'priority',
    labels: 'labels',
  },
});

const GITHUB: TrackerRecipe = Object.freeze({
  kind: 'github',
  server: "GitHub's official MCP server",
  locatorIs: 'owner/repository',
  item: 'issue',
  read: {
    tool: 'get_issue',
    does: 'read the issue as it stands now, before changing any part of it',
  },
  create: { tool: 'create_issue', does: 'open a new issue on that repository' },
  update: { tool: 'update_issue', does: 'edit an issue that already exists' },
  comment: {
    tool: 'add_issue_comment',
    does: 'add a comment, when the approved change is a remark rather than a field edit',
  },
  forbidden: [
    {
      action: 'update_issue with state, state_reason, labels, assignees, or milestone among the fields set',
      because:
        'closing, reopening, labelling, and assigning are the repository\'s to decide — the same call that ' +
        'carries the approved words would take all five over',
    },
  ],
  fieldNames: {
    title: 'title',
    description: 'body',
    status: 'state',
    assignee: 'assignees',
    // Named apart from the repository owner in the locator above, which is a
    // different thing with the same word.
    owner: 'the issue owner',
    labels: 'labels',
  },
});

const RECIPES: readonly TrackerRecipe[] = Object.freeze([JIRA, GITHUB]);

/**
 * The recipe for a source kind, or null when the kind is not a tracker this
 * module knows how to reach. Null is the ordinary answer: a directory, a git
 * repo, a docs system, and a source nobody declared all take the plain apply
 * instruction, unchanged by anything here.
 */
export function trackerRecipeFor(kind: string | null | undefined): TrackerRecipe | null {
  if (!kind) return null;
  return RECIPES.find((recipe) => recipe.kind === kind) ?? null;
}

/** What this server calls a field of the work model. */
export function vendorFieldName(recipe: TrackerRecipe, field: string): string {
  return recipe.fieldNames[field] ?? field;
}

function nameList(recipe: TrackerRecipe, fields: readonly string[]): string {
  return fields.map((field) => vendorFieldName(recipe, field)).join(', ');
}

/**
 * The tracker-specific half of an apply instruction: the server, the actions
 * that carry the change, the actions that do not, and the two field lists —
 * what this crossing may assert, and what belongs to the tracker.
 *
 * Both lists arrive from the caller because both are read off the authority
 * map, which is kernel-side. What this function owns is saying them in the
 * vendor's words.
 */
export function trackerApplySection(input: {
  readonly recipe: TrackerRecipe;
  readonly locator: string;
  /** The domain-owned fields this crossing carries. */
  readonly projects: readonly string[];
  /** Every field the tracker owns. */
  readonly neverTouches: readonly string[];
}): string[] {
  const { recipe, projects, neverTouches } = input;
  const lines = [
    `That system is reached through ${recipe.server}.`,
    `Its ${recipe.locatorIs} is ${escapeForPrompt(input.locator)}.`,
    `Use these actions on it and no others, and say in your reply which one you used:`,
    `  ${recipe.read.tool} — ${recipe.read.does}`,
    `  ${recipe.update.tool} — ${recipe.update.does}`,
    `  ${recipe.create.tool} — ${recipe.create.does}`,
    `  ${recipe.comment.tool} — ${recipe.comment.does}`,
    `Read the ${recipe.item} before you change it, so you are editing what is there`,
    'rather than what the words above led you to picture.',
    '',
  ];

  if (projects.length > 0) {
    lines.push(
      `Fields this change may set on that ${recipe.item}, and no others: ` +
        `${nameList(recipe, projects)}.`,
    );
  }
  lines.push(
    // One line, however long it runs: the list is the rule, and a rule broken
    // across lines is one a reader can quote half of.
    'Fields the tracker owns, and this change may never set, clear, or move one of ' +
      `them, on an edit or on a create: ${nameList(recipe, neverTouches)}.`,
    ...recipe.forbidden.map((entry) => `Never ${entry.action}: ${entry.because}.`),
    `If carrying out the change would need one of those fields moved, that is a`,
    `different change and nobody approved it: set applied to false and say which`,
    `field it would have needed. That is the right answer, not a failure.`,
  );
  return lines;
}
