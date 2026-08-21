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
 * Engagement mode is the one setting here: `team` means Construct is the
 * whole team and tracks work its own way; `seat` means it fills one role on a
 * human team and works inside their tracker and conventions. Settings, unlike
 * evidence, may change, so mode and write consent are upserts.
 */

import type { Store } from './open.ts';

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

export type ProposalVerdict = 'approved' | 'rejected' | 'applied';

export interface ProposalDecision {
  readonly proposal: string;
  readonly verdict: ProposalVerdict;
  readonly basis: 'human-approval' | 'standing-consent';
  readonly reason: string;
  readonly decidedAt: string;
}

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
      `SELECT proposal, verdict, basis, reason, decided_at
       FROM proposal_decisions WHERE proposal = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(proposal) as
    | { proposal: string; verdict: string; basis: string; reason: string; decided_at: string }
    | undefined;
  if (!row) return null;
  return {
    proposal: row.proposal,
    verdict: row.verdict as ProposalVerdict,
    basis: row.basis as ProposalDecision['basis'],
    reason: row.reason,
    decidedAt: row.decided_at,
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
): void {
  if (!getProposal(store, proposal)) {
    throw new Error(`decideProposal: no proposal ${proposal}`);
  }
  const prior = decisionOf(store, proposal);
  if (prior?.verdict === 'applied') {
    throw new Error(`decideProposal: ${proposal} was already applied; there is nothing left to decide`);
  }
  store.db
    .prepare(
      `INSERT INTO proposal_decisions (proposal, verdict, basis, reason, decided_at)
       VALUES (?, ?, 'human-approval', ?, ?)`,
    )
    .run(proposal, verdict, reason, decidedAt);
}

/**
 * Record that a proposal was applied. Refused without authority: either the
 * newest decision is a human approval, or the proposal is low-risk and the
 * workspace holds standing consent. High-risk never applies on consent alone —
 * that is the catastrophe class the hard gate owns.
 */
export function markApplied(store: Store, proposal: string, reason: string, decidedAt: string): void {
  const record = getProposal(store, proposal);
  if (!record) throw new Error(`markApplied: no proposal ${proposal}`);
  const prior = decisionOf(store, proposal);
  if (prior?.verdict === 'applied') {
    throw new Error(`markApplied: ${proposal} was already applied at ${prior.decidedAt}`);
  }
  if (prior?.verdict === 'rejected') {
    throw new Error(`markApplied: ${proposal} was rejected; a rejection is not overridden by applying anyway`);
  }
  let basis: ProposalDecision['basis'];
  if (prior?.verdict === 'approved') {
    basis = 'human-approval';
  } else if (record.risk === 'low' && writeConsentAllowsLowRisk(store, record.workspace)) {
    basis = 'standing-consent';
  } else {
    throw new Error(
      `markApplied: ${proposal} has no authority to apply — it needs a human approval` +
        (record.risk === 'low' ? ' or standing workspace consent' : ' (high-risk never applies on standing consent)'),
    );
  }
  store.db
    .prepare(
      `INSERT INTO proposal_decisions (proposal, verdict, basis, reason, decided_at)
       VALUES (?, 'applied', ?, ?, ?)`,
    )
    .run(proposal, basis, reason, decidedAt);
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
