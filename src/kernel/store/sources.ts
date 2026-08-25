/**
 * kernel/store/sources.ts — the grounding surfaces: what a workspace works
 * from, how it engages, what was actually read, and what it wants to change
 * outside itself.
 *
 * Construct builds no connectors. A source row names where organizational
 * context lives (a directory, a git repo, a GitHub or Jira project, a docs
 * system); the reading happens through whatever host the run executes in, and
 * what this module owns is the record: which sources exist, and — per run,
 * per source — what was read and how completely. A deliverable that claims
 * grounding in a source with no matching read row is fabricating provenance,
 * and that is the one quality failure handled by a hard gate rather than by
 * judgment.
 *
 * Outward writes are the mirror discipline. Updating a ticket in someone
 * else's tracker is not reversible by this system, so a write exists first as
 * an immutable proposal carrying its justification, and its fate is an
 * append-only decision row: approved or rejected by a human, or applied under
 * a workspace's standing consent for the low-risk class. Applying is itself a
 * recorded decision that this module refuses without authority — never a side
 * effect of proposing.
 *
 * A change to a document is the same kind of write and takes the same gate. It
 * carries more than a ticket comment does — which document, precisely, and the
 * words on each side of the change — so those parts sit in a row beside the
 * proposal, written in the same transaction, because a proposed document change
 * whose words went missing is not something anyone can decide about.
 *
 * Engagement mode is the one setting here: `team` means Construct is the
 * whole team and tracks work its own way; `seat` means it fills one role on a
 * human team and works inside their tracker and conventions. Settings, unlike
 * evidence, may change, so mode and write consent are upserts.
 */

import type { Store } from './open.ts';
import { transact } from './open.ts';

export const SOURCE_KINDS = ['directory', 'git', 'github', 'jira', 'docs'] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const ENGAGEMENT_MODES = ['team', 'seat'] as const;

export type EngagementMode = (typeof ENGAGEMENT_MODES)[number];

/** With no recorded mode, Construct is the whole team: nobody else's tracker exists to write into. */
export const DEFAULT_MODE: EngagementMode = 'team';

export const READ_COVERAGE = ['complete', 'partial', 'unreachable'] as const;

export type ReadCoverage = (typeof READ_COVERAGE)[number];

export interface Source {
  readonly id: string;
  readonly workspace: string;
  readonly kind: SourceKind;
  readonly locator: string;
  readonly addedAt: string;
  readonly retiredAt: string | null;
}

export interface SourceRead {
  readonly run: string;
  readonly source: string;
  /** What was read, in words a person can audit: "issues in PROJ", "docs/adr/*.md". */
  readonly descriptor: string;
  readonly coverage: ReadCoverage;
  /** The honest quantity: "14 of 14 tickets", "connector returned 401". */
  readonly detail: string;
  readonly recordedAt: string;
}

/**
 * The github source kind's locator convention.
 *
 * `github` is already a provider-specific kind, so unlike `docs` below its
 * locator only has to say which repository:
 *
 *   <owner>/<repo>
 *
 * The same pointer GitHub's own URLs use (github.com/<owner>/<repo>), and the
 * shape `hosts/tracker.ts` already assumes when it calls the locator
 * "owner/repository" in a write proposal's apply instructions.
 *
 * A locator names the repository a run reads and writes issues against, not
 * an issue, branch, or path inside it, so anything past the owner and the
 * repository — "<owner>/<repo>/issues/4" — names more than a repository and
 * is refused the same as a missing owner or repository would be.
 *
 * Example: "anthropics/claude-code".
 */
export function githubLocatorProblem(locator: string): string | null {
  const trimmed = locator.trim();
  if (trimmed === '') {
    return 'a github locator names no repository';
  }
  const parts = trimmed.split('/');
  if (parts.length < 2) {
    return (
      `a github locator names its owner and repository as "<owner>/<repo>" ` +
      `(for example anthropics/claude-code) — "${trimmed}" has no "/" separating them`
    );
  }
  if (parts.length > 2) {
    return `a github locator names one repository, "<owner>/<repo>" — "${trimmed}" names more than that`;
  }
  const [ownerPart, repoPart] = parts;
  const owner = ownerPart.trim();
  const repo = repoPart.trim();
  if (owner === '') {
    return `a github locator names which owner the repository belongs to — "${trimmed}" leaves it empty`;
  }
  if (repo === '') {
    return `a github locator names which repository ${owner} owns — "${trimmed}" leaves the repository empty`;
  }
  return null;
}

/**
 * The docs source kind's locator convention.
 *
 * `jira` and `github` are already provider-specific kinds, so their locators
 * need only name a project or a repository. `docs` is not: it is the one
 * kind that stands for three unrelated providers — Google Docs, Confluence,
 * Notion — each read through whatever host tool holds the credential
 * (commitment 1: no connector). A bare locator like a wiki's name cannot say
 * which provider it even belongs to, which is the gap this convention closes:
 *
 *   <provider>:<container>:<id>
 *
 *   provider   one of DOCS_PROVIDERS.
 *   container  the provider's own noun for what groups pages — "space" for
 *              Confluence, "folder" or "drive" for Google Docs, "workspace"
 *              for Notion. Any non-empty word; not a fixed vendor vocabulary,
 *              because a provider is free to name its own grouping.
 *   id         the key, slug, id, or name of one container of that kind —
 *              "ENG", a Drive folder id, "Product". May itself carry a
 *              "/subpath" to scope narrower than the whole container.
 *
 * Examples: "confluence:space:ENG", "google-docs:folder:1AbC-drive-id",
 * "notion:workspace:Product/Specs".
 *
 * The reason to require this rather than accept any string: a read row's
 * `detail` ("14 of 14 pages") is evidence only if its `descriptor` names the
 * container the declared source actually points at ("pages in space ENG"),
 * the same way a jira read's "issues in PROJ" is checked against a source
 * declared for PROJ. `docsLocatorContainerName` and
 * `docsReadNamesLocatorContainer` below make that check something code runs
 * rather than something a reader has to take on faith.
 */
export const DOCS_PROVIDERS = ['google-docs', 'confluence', 'notion'] as const;

export type DocsProvider = (typeof DOCS_PROVIDERS)[number];

export interface DocsLocator {
  readonly provider: DocsProvider;
  readonly container: string;
  readonly id: string;
}

type DocsLocatorResult =
  | { readonly ok: true; readonly value: DocsLocator }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse and validate in one pass so the two exported entry points —
 * `parseDocsLocator` and `docsLocatorProblem` — can never disagree about
 * what counts as well-formed; they read as two views of the same result
 * rather than two implementations that could drift apart.
 */
function readDocsLocator(locator: string): DocsLocatorResult {
  const trimmed = locator.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'a docs locator names nothing to read' };
  }
  const firstColon = trimmed.indexOf(':');
  if (firstColon < 0) {
    return {
      ok: false,
      reason:
        `a docs locator names its provider and container as "<provider>:<container>:<id>" ` +
        `(for example confluence:space:ENG) — "${trimmed}" names no provider`,
    };
  }
  const provider = trimmed.slice(0, firstColon).trim();
  const afterProvider = trimmed.slice(firstColon + 1);
  const secondColon = afterProvider.indexOf(':');
  if (secondColon < 0) {
    return {
      ok: false,
      reason:
        `a docs locator names its container after the provider, as "<provider>:<container>:<id>" ` +
        `(for example confluence:space:ENG) — "${trimmed}" names no container`,
    };
  }
  if (!(DOCS_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      ok: false,
      reason: `"${provider}" is not a docs provider Construct knows (${DOCS_PROVIDERS.join(', ')}) — got "${trimmed}"`,
    };
  }
  const container = afterProvider.slice(0, secondColon).trim();
  const id = afterProvider.slice(secondColon + 1).trim();
  if (container === '') {
    return {
      ok: false,
      reason:
        `a docs locator names what groups pages inside ${provider} (its "container" — space, ` +
        `folder, workspace) — "${trimmed}" leaves it empty`,
    };
  }
  if (id === '') {
    return {
      ok: false,
      reason: `a docs locator names which ${container} to read — "${trimmed}" leaves the id empty`,
    };
  }
  return { ok: true, value: { provider: provider as DocsProvider, container, id } };
}

/** A docs locator's parts, or null when it does not follow the convention. */
export function parseDocsLocator(locator: string): DocsLocator | null {
  const result = readDocsLocator(locator);
  return result.ok ? result.value : null;
}

/** Why a docs locator is malformed, in plain language — or null when it is fine. */
export function docsLocatorProblem(locator: string): string | null {
  const result = readDocsLocator(locator);
  return result.ok ? null : result.reason;
}

/** The container phrase a docs read's descriptor should name, e.g. "space ENG". */
export function docsLocatorContainerName(locator: DocsLocator): string {
  return `${locator.container} ${locator.id.split('/')[0]}`;
}

/**
 * Whether a read row's descriptor names the same container this locator
 * declares — the check that makes "14 of 14 pages in space ENG" auditable
 * against a source declared "confluence:space:ENG" instead of taken on the
 * read's own say-so. A locator that does not parse names no container to
 * check against, so it never matches: an unauditable locator cannot be used
 * to audit anything read against it.
 */
export function docsReadNamesLocatorContainer(locator: string, descriptor: string): boolean {
  const parsed = parseDocsLocator(locator);
  if (!parsed) return false;
  return descriptor.toLowerCase().includes(docsLocatorContainerName(parsed).toLowerCase());
}

export interface WriteProposal {
  readonly id: string;
  readonly workspace: string;
  readonly run: string | null;
  readonly source: string;
  readonly change: string;
  /** What justifies the change — a note line, a record entry, a source citation. */
  readonly justification: string;
  readonly risk: 'low' | 'high';
  readonly proposedAt: string;
}

/**
 * The three shapes an outward change to a document takes.
 *
 * `redline` replaces words that are already there. `insertion` adds words
 * without displacing any. `authored` writes a document that does not yet
 * exist. They are distinguished because a person deciding needs to know which
 * one they are looking at before they read a line of it: struck words are gone
 * from the document afterwards, added words are not, and a new document is a
 * page nobody has ever read.
 */
export const DOC_EDIT_KINDS = ['redline', 'insertion', 'authored'] as const;

export type DocEditKind = (typeof DOC_EDIT_KINDS)[number];

/**
 * One proposed change to a document, in its parts.
 *
 * The proposal it belongs to holds the same change as the text a person
 * approves and a host is handed; this is that text taken apart, so a surface
 * showing the change reads fields instead of parsing prose back out of it.
 */
export interface DocEdit {
  readonly proposal: string;
  readonly kind: DocEditKind;
  /** Which document, precisely: its path or identifier inside the source. */
  readonly document: string;
  /**
   * Redline: the exact words being replaced. Insertion: where the new words
   * go, in words a reader of the document could follow. Authored: empty,
   * because a document that does not exist yet displaces nothing.
   */
  readonly anchor: string;
  /**
   * The words that would stand there: the replacement, the addition, or the
   * new document's body. Empty only for a redline that strikes words and puts
   * nothing in their place.
   */
  readonly proposed: string;
  readonly recordedAt: string;
}

export type ProposalVerdict = 'approved' | 'rejected' | 'applied';

export interface ProposalDecision {
  readonly proposal: string;
  readonly verdict: ProposalVerdict;
  readonly basis: 'human-approval' | 'standing-consent';
  readonly reason: string;
  readonly decidedAt: string;
  /**
   * Whose hand recorded this decision — `cli:user` for a person at the command
   * line. Null on a store that predates provenance. An approval carried out as
   * authority for an outward write is honored only when this says a person made
   * it: a model that wrote a byte-identical approval row must not be able to
   * pass itself off as the human the outward-write ladder waits for.
   */
  readonly resolvedBy: string | null;
}

/** The provenance of a human-recorded decision. The only value the apply gate reads as a person. */
export const HUMAN_DECISION = 'cli:user';

interface SourceRow {
  readonly id: string;
  readonly workspace: string;
  readonly kind: string;
  readonly locator: string;
  readonly added_at: string;
  readonly retired_at: string | null;
}

function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    workspace: row.workspace,
    kind: row.kind as SourceKind,
    locator: row.locator,
    addedAt: row.added_at,
    retiredAt: row.retired_at,
  };
}

/** Declare a source for a workspace. Duplicate active declarations are refused by the store. */
export function addSource(
  store: Store,
  source: Omit<Source, 'retiredAt'>,
): void {
  if (!(SOURCE_KINDS as readonly string[]).includes(source.kind)) {
    throw new Error(`addSource: unknown kind "${source.kind}" (kinds: ${SOURCE_KINDS.join(', ')})`);
  }
  if (source.workspace.trim() === '') {
    throw new Error(`addSource: ${source.id} has no workspace`);
  }
  if (source.locator.trim() === '') {
    throw new Error(`addSource: ${source.id} has no locator`);
  }
  if (source.kind === 'docs') {
    const problem = docsLocatorProblem(source.locator);
    if (problem) {
      throw new Error(`addSource: ${source.id} has a malformed docs locator — ${problem}`);
    }
  }
  if (source.kind === 'github') {
    const problem = githubLocatorProblem(source.locator);
    if (problem) {
      throw new Error(`addSource: ${source.id} has a malformed github locator — ${problem}`);
    }
  }
  store.db
    .prepare(
      `INSERT INTO sources (id, workspace, kind, locator, added_at, retired_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(source.id, source.workspace, source.kind, source.locator, source.addedAt);
}

/**
 * Retire a source: it stops informing new runs but stays inspectable, because
 * past provenance rows point at it. Retiring twice is an error, not a no-op —
 * the second caller believed something false about the registry.
 */
export function retireSource(store: Store, id: string, retiredAt: string): void {
  const existing = getSource(store, id);
  if (!existing) throw new Error(`retireSource: no source ${id}`);
  if (existing.retiredAt) {
    throw new Error(`retireSource: ${id} was already retired at ${existing.retiredAt}`);
  }
  store.db.prepare('UPDATE sources SET retired_at = ? WHERE id = ?').run(retiredAt, id);
}

export function getSource(store: Store, id: string): Source | null {
  const row = store.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
    | SourceRow
    | undefined;
  return row ? toSource(row) : null;
}

/** A workspace's sources, active only unless asked otherwise, oldest first. */
export function sourcesFor(
  store: Store,
  workspace: string,
  opts?: { includeRetired?: boolean },
): Source[] {
  const rows = (
    opts?.includeRetired
      ? store.db
          .prepare('SELECT * FROM sources WHERE workspace = ? ORDER BY added_at, id')
          .all(workspace)
      : store.db
          .prepare(
            'SELECT * FROM sources WHERE workspace = ? AND retired_at IS NULL ORDER BY added_at, id',
          )
          .all(workspace)
  ) as unknown as SourceRow[];
  return rows.map(toSource);
}

/**
 * How a source should be walked. A repository surveyed prose-first hands a
 * role forty design documents and no code, which is right for understanding
 * the surfaces and wrong for understanding the implementation; `code` inverts
 * the ranking, `all` declines to rank at all. Default `prose`, which is what
 * every survey did before the setting existed.
 */
export const SURVEY_EMPHASES = ['prose', 'code', 'all'] as const;

export type SurveyEmphasis = (typeof SURVEY_EMPHASES)[number];

export interface SourceShape {
  readonly emphasis: SurveyEmphasis;
  /** How many documents the survey lists; the rest are recorded as unread. */
  readonly cap: number;
}

/** Record how a source is surveyed. A setting, not evidence, so an upsert. */
export function setSourceShape(
  store: Store,
  source: string,
  shape: SourceShape,
  at: string,
): void {
  if (!(SURVEY_EMPHASES as readonly string[]).includes(shape.emphasis)) {
    throw new Error(
      `setSourceShape: unknown emphasis "${shape.emphasis}" (emphases: ${SURVEY_EMPHASES.join(', ')})`,
    );
  }
  if (!Number.isInteger(shape.cap) || shape.cap < 1) {
    throw new Error(`setSourceShape: cap must be a positive whole number, got ${String(shape.cap)}`);
  }
  store.db
    .prepare(
      `INSERT INTO source_shapes (source, emphasis, cap, recorded_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (source) DO UPDATE SET emphasis = excluded.emphasis, cap = excluded.cap,
         recorded_at = excluded.recorded_at`,
    )
    .run(source, shape.emphasis, shape.cap, at);
}

/** How this source is surveyed, or null when nobody has said. */
export function sourceShape(store: Store, source: string): SourceShape | null {
  const row = store.db
    .prepare('SELECT emphasis, cap FROM source_shapes WHERE source = ?')
    .get(source) as { emphasis: string; cap: number } | undefined;
  return row ? { emphasis: row.emphasis as SurveyEmphasis, cap: Number(row.cap) } : null;
}

/**
 * How far a source's contents may be trusted, as the user states it.
 *
 * A locator says where context lives and nothing about what it is worth. The
 * same directory can hold the agreement everything else is measured against
 * and a wish list somebody wrote in a planning week, and a dispatch handed both
 * reads them as one kind of thing. These four are the distinctions a reader
 * makes anyway:
 *
 *   source-of-truth  what it says is the record; a disagreement resolves here.
 *   working          in progress, changing, true about where things stand.
 *   aspirational     what someone wants to be true. Never evidence that it is.
 *   archive          kept for history; describes how things were.
 */
export const SOURCE_AUTHORITIES = ['source-of-truth', 'working', 'aspirational', 'archive'] as const;

export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

/**
 * What a user says one of their sources is: its standing, why it is here in
 * their own words, and whether what it holds is sensitive.
 *
 * Every field is a statement its author made. Nothing infers one, and nothing
 * writes one except at a user's word — a tier this system chose for somebody
 * would be Construct's opinion wearing the user's authority, which is exactly
 * what a reader trusting the label would have no way to see.
 */
export interface SourceDeclaration {
  readonly authority: SourceAuthority;
  /** Why this source matters here, in the user's own words. May be empty. */
  readonly relevance: string;
  /**
   * What it holds does not travel: quoted only as far as a finding needs, and
   * never carried into anything addressed outside the workspace. Standing
   * consent for low-risk outward writes does not reach a sensitive source.
   */
  readonly sensitive: boolean;
}

/** An authority tier in the words a reader gets, wherever one is printed or spoken. */
export function authorityLabel(authority: SourceAuthority): string {
  return authority === 'source-of-truth' ? 'source of truth' : authority;
}

/**
 * Record what a user says a source is. A statement its author may restate, so
 * an upsert — and one row, so no surface can show a declaration that another
 * surface has already moved past.
 */
export function setSourceDeclaration(
  store: Store,
  source: string,
  declaration: SourceDeclaration,
  at: string,
): void {
  if (!(SOURCE_AUTHORITIES as readonly string[]).includes(declaration.authority)) {
    throw new Error(
      `setSourceDeclaration: unknown authority "${declaration.authority}" ` +
        `(tiers: ${SOURCE_AUTHORITIES.join(', ')})`,
    );
  }
  const row = getSource(store, source);
  if (!row) {
    throw new Error(`setSourceDeclaration: no source ${source}`);
  }
  if (row.retiredAt !== null) {
    throw new Error(
      `setSourceDeclaration: source ${source} was retired at ${row.retiredAt} — ` +
        'a retired source is done being described',
    );
  }
  store.db
    .prepare(
      `INSERT INTO source_declarations (source, authority, relevance, sensitive, recorded_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (source) DO UPDATE SET authority = excluded.authority,
         relevance = excluded.relevance, sensitive = excluded.sensitive,
         recorded_at = excluded.recorded_at`,
    )
    .run(source, declaration.authority, declaration.relevance.trim(), declaration.sensitive ? 1 : 0, at);
}

/** What the user says this source is, or null when nobody has said. */
export function sourceDeclaration(store: Store, source: string): SourceDeclaration | null {
  const row = store.db
    .prepare('SELECT authority, relevance, sensitive FROM source_declarations WHERE source = ?')
    .get(source) as { authority: string; relevance: string; sensitive: number } | undefined;
  return row
    ? {
        authority: row.authority as SourceAuthority,
        relevance: row.relevance,
        sensitive: row.sensitive === 1,
      }
    : null;
}

/** Record how this workspace engages. A setting, so an upsert. */
export function setEngagementMode(
  store: Store,
  workspace: string,
  mode: EngagementMode,
  recordedAt: string,
): void {
  if (!(ENGAGEMENT_MODES as readonly string[]).includes(mode)) {
    throw new Error(`setEngagementMode: unknown mode "${mode}" (modes: ${ENGAGEMENT_MODES.join(', ')})`);
  }
  store.db
    .prepare(
      `INSERT INTO workspace_mode (workspace, mode, recorded_at)
       VALUES (?, ?, ?)
       ON CONFLICT (workspace) DO UPDATE SET mode = excluded.mode, recorded_at = excluded.recorded_at`,
    )
    .run(workspace, mode, recordedAt);
}

export function engagementMode(store: Store, workspace: string): EngagementMode {
  const row = store.db
    .prepare('SELECT mode FROM workspace_mode WHERE workspace = ?')
    .get(workspace) as { mode: string } | undefined;
  return (row?.mode as EngagementMode | undefined) ?? DEFAULT_MODE;
}

/**
 * Record what a run actually read from a source. Unreachable is a first-class
 * answer: a source that could not be read must appear here saying so, because
 * downstream text will otherwise read its silence as coverage.
 */
export function recordSourceRead(store: Store, read: SourceRead): void {
  if (!getSource(store, read.source)) {
    throw new Error(`recordSourceRead: no source ${read.source}`);
  }
  store.db
    .prepare(
      `INSERT INTO source_reads (run, source, descriptor, coverage, detail, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(read.run, read.source, read.descriptor, read.coverage, read.detail, read.recordedAt);
}

export function sourceReadsFor(store: Store, run: string): SourceRead[] {
  const rows = store.db
    .prepare(
      `SELECT run, source, descriptor, coverage, detail, recorded_at
       FROM source_reads WHERE run = ? ORDER BY seq`,
    )
    .all(run) as unknown as Array<{
    run: string;
    source: string;
    descriptor: string;
    coverage: string;
    detail: string;
    recorded_at: string;
  }>;
  return rows.map((r) => ({
    run: r.run,
    source: r.source,
    descriptor: r.descriptor,
    coverage: r.coverage as ReadCoverage,
    detail: r.detail,
    recordedAt: r.recorded_at,
  }));
}

/**
 * One source's most recently recorded reads, from whichever run last touched
 * it — a prior review's own pass, or a dispatched run's grounding. Empty when
 * nothing has read this source yet: the append-only record is the only place
 * "read before" can be told from "read for the first time", so a caller
 * comparing against a baseline reads this rather than keeping one of its own.
 */
export function latestSourceReads(store: Store, source: string): SourceRead[] {
  const rows = store.db
    .prepare(
      `SELECT run, source, descriptor, coverage, detail, recorded_at
       FROM source_reads WHERE source = ? ORDER BY seq DESC`,
    )
    .all(source) as unknown as Array<{
    run: string;
    source: string;
    descriptor: string;
    coverage: string;
    detail: string;
    recorded_at: string;
  }>;
  if (rows.length === 0) return [];
  const latestRun = rows[0]!.run;
  return rows
    .filter((r) => r.run === latestRun)
    .reverse()
    .map((r) => ({
      run: r.run,
      source: r.source,
      descriptor: r.descriptor,
      coverage: r.coverage as ReadCoverage,
      detail: r.detail,
      recordedAt: r.recorded_at,
    }));
}

/** Propose an outward write. Proposing grants nothing; it creates the thing a decision can be about. */
export function proposeWrite(store: Store, proposal: WriteProposal): void {
  if (proposal.change.trim() === '') {
    throw new Error(`proposeWrite: ${proposal.id} proposes no change`);
  }
  if (proposal.justification.trim() === '') {
    // An unjustified change to someone's tracker is exactly the write this
    // surface exists to make impossible.
    throw new Error(`proposeWrite: ${proposal.id} carries no justification`);
  }
  if (!getSource(store, proposal.source)) {
    throw new Error(`proposeWrite: no source ${proposal.source}`);
  }
  store.db
    .prepare(
      `INSERT INTO write_proposals (id, workspace, run, source, change, justification, risk, proposed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      proposal.id,
      proposal.workspace,
      proposal.run,
      proposal.source,
      proposal.change,
      proposal.justification,
      proposal.risk,
      proposal.proposedAt,
    );
}

/**
 * Propose a change to a document: the row a decision is made about, and the
 * parts of the change beside it, written together so neither can exist without
 * the other.
 *
 * The refusals here are about what a person could act on. A change naming no
 * document names no target. A redline that does not say which words it
 * replaces is a claim that something should differ, not a change anyone can
 * carry out. An insertion that does not say where it goes leaves the placement
 * to whoever applies it, which is the guessing this whole surface exists to
 * remove. And an authored document that quotes words it displaces is a redline
 * filed under the wrong kind, so it is refused rather than silently recorded
 * as the one that destroys nothing.
 */
export function proposeDocEdit(
  store: Store,
  proposal: WriteProposal,
  edit: Omit<DocEdit, 'proposal'>,
): void {
  if (!(DOC_EDIT_KINDS as readonly string[]).includes(edit.kind)) {
    throw new Error(
      `proposeDocEdit: unknown kind "${edit.kind}" (kinds: ${DOC_EDIT_KINDS.join(', ')})`,
    );
  }
  if (edit.document.trim() === '') {
    throw new Error(`proposeDocEdit: ${proposal.id} names no document`);
  }
  if (edit.kind === 'redline' && edit.anchor.trim() === '') {
    throw new Error(
      `proposeDocEdit: ${proposal.id} is a redline that does not say which words it replaces`,
    );
  }
  if (edit.kind === 'insertion' && edit.anchor.trim() === '') {
    throw new Error(`proposeDocEdit: ${proposal.id} is an insertion that does not say where it goes`);
  }
  if (edit.kind === 'authored' && edit.anchor.trim() !== '') {
    throw new Error(
      `proposeDocEdit: ${proposal.id} authors a document and also quotes words it replaces; ` +
        'a change that replaces words is a redline',
    );
  }
  if (edit.kind !== 'redline' && edit.proposed.trim() === '') {
    throw new Error(
      `proposeDocEdit: ${proposal.id} proposes no words to ` +
        (edit.kind === 'authored' ? 'write' : 'add'),
    );
  }
  transact(store, () => {
    proposeWrite(store, proposal);
    store.db
      .prepare(
        `INSERT INTO doc_edits (proposal, kind, document, anchor, proposed, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(proposal.id, edit.kind, edit.document, edit.anchor, edit.proposed, edit.recordedAt);
  });
}

/** The parts of a proposed document change, or null when the proposal is not one. */
export function docEditFor(store: Store, proposal: string): DocEdit | null {
  const row = store.db
    .prepare(
      `SELECT proposal, kind, document, anchor, proposed, recorded_at
       FROM doc_edits WHERE proposal = ?`,
    )
    .get(proposal) as
    | {
        proposal: string;
        kind: string;
        document: string;
        anchor: string;
        proposed: string;
        recorded_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    proposal: row.proposal,
    kind: row.kind as DocEditKind,
    document: row.document,
    anchor: row.anchor,
    proposed: row.proposed,
    recordedAt: row.recorded_at,
  };
}

export function getProposal(store: Store, id: string): WriteProposal | null {
  const row = store.db.prepare('SELECT * FROM write_proposals WHERE id = ?').get(id) as
    | {
        id: string;
        workspace: string;
        run: string | null;
        source: string;
        change: string;
        justification: string;
        risk: string;
        proposed_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    workspace: row.workspace,
    run: row.run,
    source: row.source,
    change: row.change,
    justification: row.justification,
    risk: row.risk as WriteProposal['risk'],
    proposedAt: row.proposed_at,
  };
}

/** The newest decision wins, same shape as lesson admissions. No decision means pending. */
export function decisionOf(store: Store, proposal: string): ProposalDecision | null {
  const row = store.db
    .prepare(
      `SELECT d.proposal, d.verdict, d.basis, d.reason, d.decided_at, v.resolved_by
       FROM proposal_decisions d
       LEFT JOIN proposal_decision_provenance v ON v.decision = d.seq
       WHERE d.proposal = ? ORDER BY d.seq DESC LIMIT 1`,
    )
    .get(proposal) as
    | {
        proposal: string;
        verdict: string;
        basis: string;
        reason: string;
        decided_at: string;
        resolved_by: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    proposal: row.proposal,
    verdict: row.verdict as ProposalVerdict,
    basis: row.basis as ProposalDecision['basis'],
    reason: row.reason,
    decidedAt: row.decided_at,
    resolvedBy: row.resolved_by,
  };
}

/** Record whether this workspace lets low-risk proposals apply without a per-proposal human decision. */
export function setWriteConsent(
  store: Store,
  workspace: string,
  allowsLowRisk: boolean,
  recordedAt: string,
): void {
  store.db
    .prepare(
      `INSERT INTO write_consent (workspace, allows_low_risk, recorded_at)
       VALUES (?, ?, ?)
       ON CONFLICT (workspace) DO UPDATE SET allows_low_risk = excluded.allows_low_risk, recorded_at = excluded.recorded_at`,
    )
    .run(workspace, allowsLowRisk ? 1 : 0, recordedAt);
}

/** Whether standing consent covers low-risk applies. No recorded consent is a no. */
export function writeConsentAllowsLowRisk(store: Store, workspace: string): boolean {
  const row = store.db
    .prepare('SELECT allows_low_risk FROM write_consent WHERE workspace = ?')
    .get(workspace) as { allows_low_risk: number } | undefined;
  return row?.allows_low_risk === 1;
}

/** A human approves or rejects a proposal. The only path to approval. */
export function decideProposal(
  store: Store,
  proposal: string,
  verdict: 'approved' | 'rejected',
  reason: string,
  decidedAt: string,
  resolvedBy: string = HUMAN_DECISION,
): void {
  if (!getProposal(store, proposal)) {
    throw new Error(`decideProposal: no proposal ${proposal}`);
  }
  const prior = decisionOf(store, proposal);
  if (prior?.verdict === 'applied') {
    throw new Error(`decideProposal: ${proposal} was already applied; there is nothing left to decide`);
  }
  // Two sequential writes rather than a nested transaction: this runs inside a
  // caller's transaction as often as not (adopting a source relationship is one
  // such caller), and an inner BEGIN there is an error, not a safeguard. The
  // provenance follows the row it qualifies, so a decision cannot be read back
  // without it.
  const seq = store.db
    .prepare(
      `INSERT INTO proposal_decisions (proposal, verdict, basis, reason, decided_at)
       VALUES (?, ?, 'human-approval', ?, ?)`,
    )
    .run(proposal, verdict, reason, decidedAt).lastInsertRowid;
  recordDecisionProvenance(store, seq, resolvedBy);
}

/** The provenance beside a proposal-decision row, written in the same transaction. */
function recordDecisionProvenance(store: Store, seq: bigint | number, resolvedBy: string): void {
  if (resolvedBy.trim() === '') {
    throw new Error('recordDecisionProvenance: a decision needs a non-empty resolver provenance');
  }
  store.db
    .prepare(
      `INSERT OR REPLACE INTO proposal_decision_provenance (decision, resolved_by) VALUES (?, ?)`,
    )
    .run(seq, resolvedBy);
}

/**
 * Record that a proposal was applied. Refused without authority: either the
 * newest decision is a human approval, or the proposal is low-risk and the
 * workspace holds standing consent. High-risk never applies on consent alone —
 * that is the catastrophe class the hard gate owns.
 *
 * Standing consent is a judgment about a class of change, made before anyone
 * knew which source it would land in. A source its owner declared sensitive is
 * outside that judgment: it takes a decision made about this proposal, by a
 * person, with the target in front of them.
 *
 * An approval only counts as human authority when its provenance says a person
 * recorded it. A model that wrote a byte-identical `approved` row through an
 * MCP surface has forged the very thing this gate waits for, so an approval
 * that is not `cli:user` is refused here rather than laundered into an apply.
 */
export function markApplied(
  store: Store,
  proposal: string,
  reason: string,
  decidedAt: string,
  resolvedBy: string = HUMAN_DECISION,
): void {
  const record = getProposal(store, proposal);
  if (!record) throw new Error(`markApplied: no proposal ${proposal}`);
  const prior = decisionOf(store, proposal);
  if (prior?.verdict === 'applied') {
    throw new Error(`markApplied: ${proposal} was already applied at ${prior.decidedAt}`);
  }
  if (prior?.verdict === 'rejected') {
    throw new Error(`markApplied: ${proposal} was rejected; a rejection is not overridden by applying anyway`);
  }
  if (prior?.verdict === 'approved' && prior.resolvedBy !== HUMAN_DECISION) {
    throw new Error(
      `markApplied: ${proposal} was approved by ${prior.resolvedBy ?? 'an unrecorded hand'}, not a person; ` +
        'an outward write is carried out only on a human approval',
    );
  }
  const sensitive = sourceDeclaration(store, record.source)?.sensitive === true;
  let basis: ProposalDecision['basis'];
  if (prior?.verdict === 'approved') {
    basis = 'human-approval';
  } else if (record.risk === 'low' && !sensitive && writeConsentAllowsLowRisk(store, record.workspace)) {
    basis = 'standing-consent';
  } else {
    throw new Error(
      `markApplied: ${proposal} has no authority to apply — it needs a human approval` +
        (sensitive
          ? ' (its source is declared sensitive, which standing consent does not cover)'
          : record.risk === 'low'
            ? ' or standing workspace consent'
            : ' (high-risk never applies on standing consent)'),
    );
  }
  // Sequential rather than a nested transaction: markApplied runs inside a
  // caller's transaction (adopting a source relationship is one such caller),
  // where an inner BEGIN is an error. The provenance follows the applied row.
  const seq = store.db
    .prepare(
      `INSERT INTO proposal_decisions (proposal, verdict, basis, reason, decided_at)
       VALUES (?, 'applied', ?, ?, ?)`,
    )
    .run(proposal, basis, reason, decidedAt).lastInsertRowid;
  recordDecisionProvenance(store, seq, resolvedBy);
}

/** Proposals in a workspace with no decision yet, oldest first: the human's queue. */
/** How many outward changes wait for a decision, across every workspace. */
export function pendingProposalCount(store: Store): number {
  const row = store.db
    .prepare(
      `SELECT COUNT(*) AS waiting FROM write_proposals p
       WHERE NOT EXISTS (SELECT 1 FROM proposal_decisions d WHERE d.proposal = p.id)`,
    )
    .get() as unknown as { waiting: number };
  return row.waiting;
}

export function pendingProposals(store: Store, workspace: string): WriteProposal[] {
  const rows = store.db
    .prepare(
      `SELECT p.* FROM write_proposals p
       WHERE p.workspace = ?
         AND NOT EXISTS (SELECT 1 FROM proposal_decisions d WHERE d.proposal = p.id)
       ORDER BY p.proposed_at, p.id`,
    )
    .all(workspace) as unknown as Array<Parameters<typeof toProposal>[0]>;
  return rows.map(toProposal);
}

function toProposal(row: {
  id: string;
  workspace: string;
  run: string | null;
  source: string;
  change: string;
  justification: string;
  risk: string;
  proposed_at: string;
}): WriteProposal {
  return {
    id: row.id,
    workspace: row.workspace,
    run: row.run,
    source: row.source,
    change: row.change,
    justification: row.justification,
    risk: row.risk as WriteProposal['risk'],
    proposedAt: row.proposed_at,
  };
}
