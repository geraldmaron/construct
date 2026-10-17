import { type BrokerContext } from '../context.ts';
import { type EditLane, laneNamed, UnknownWorktreeError, WORKTREE_PATH_MAX, assertLeasePaths } from '../../work/lanes.ts';
import { ToolInputError, str, list, closed, bool, obj } from '../definition.ts';
import {
  type WorkItem,
  queryWork,
  listOffers,
  getWork,
  getWorkByLegacyId,
  listReady,
  prepareAcceptance,
  handoffOf,
  readinessOf,
  updateWork,
  requalifyWork,
  isRunDelivery,
  handoffWork,
  acceptWork,
  claimWork as claimWorkItem,
  completeWork,
  releaseWork,
  takeoverWork,
  reopenWork,
} from '../../work/service.ts';
import { leasesFor, normalizeLeasePath, type Overlap, type LeaseMode, LEASE_MODES, findOverlaps, MAIN_LANE } from '../../work/leases.ts';
import { recordAgent } from '../../state/sessions.ts';
import { type Handoff, type PeerData, asPeerData } from '../../work/handoff.ts';
import { fileWork, workStructure, linkWork, unlinkWork } from '../../work/structure.ts';
import { define } from './shared.ts';

const WORK_ACTIONS = [
  'list',
  'ready',
  'offers',
  'show',
  'add',
  'update',
  'link',
  'unlink',
  'requalify',
  'claim',
  'check',
  'handoff',
  'prepare_accept',
  'accept',
  'complete',
  'release',
  'takeover',
  'reopen',
] as const;

type WorkAction = (typeof WORK_ACTIONS)[number];

const WORK_CLAIM_TERM_MS = 30 * 60_000;

/** The actions whose reservations record a checkout, and so may name the worktree the claimant edits in. */
const LANE_ACTIONS: readonly WorkAction[] = ['claim', 'check', 'accept', 'takeover'];

/**
 * Where a claimant edits: the worktree it names, checked against the
 * project's worktrees, else the checkout this session runs in.
 */
function editLane(ctx: BrokerContext, worktree: string | undefined): EditLane {
  if (worktree === undefined) return { lane: ctx.lane?.root, branch: ctx.lane?.branch ?? null };
  try {
    return laneNamed({ named: worktree, worktrees: ctx.worktrees?.() ?? null, here: ctx.lane });
  } catch (e) {
    if (e instanceof UnknownWorktreeError) throw new ToolInputError(e.message, { field: 'worktree', allowed: e.valid.map((w) => w.root) });
    throw e;
  }
}

/**
 * The checkout a renewal that names no worktree keeps: the one its live claim
 * already records, with the branch its reservations record there. Null when
 * the claimant holds no live claim on the item, or that claim records the
 * checkout this session runs in.
 */
function renewedLane(ctx: BrokerContext, item: WorkItem, owner: string, now: string): EditLane | null {
  if (item.status !== 'claimed' || item.claimOwner !== owner || item.claimUntil === null || item.claimUntil <= now) return null;
  const lane = item.claimLane ?? undefined;
  if (lane === ctx.lane?.root) return null;
  const held = leasesFor(ctx.store, item.id)[0];
  const branch = held ? held.branch : (ctx.worktrees?.().find((w) => (lane === undefined ? w.main : w.root === lane))?.branch ?? null);
  return { lane, branch };
}

/**
 * Who holds a claim: this session and the agent inside it. Two agents of one
 * session are two claimants; an agent the host did not vouch for is recorded
 * as reported. Without a session (a caller with none) the actor stands in.
 */
function claimantFor(
  ctx: BrokerContext,
  agent: string | undefined,
  at: string,
  where: EditLane = editLane(ctx, undefined),
): { owner: string; session?: string; agent?: string; lane?: string; branch: string | null } {
  const who = claimantOf(ctx, agent, where);
  if (who.session && who.agent !== 'main')
    recordAgent(ctx.store, { sessionId: who.session, agent: who.agent!, attestation: 'reported', at, laneRoot: who.lane });
  return who;
}

/** The claimant an agent of this session is, editing in `where`, without recording anything. */
function claimantOf(
  ctx: BrokerContext,
  agent: string | undefined,
  where: EditLane = editLane(ctx, undefined),
): { owner: string; session?: string; agent?: string; lane?: string; branch: string | null } {
  if (!ctx.sessionId) return { owner: ctx.actor, ...where };
  const name = agent ?? 'main';
  return { owner: `${ctx.sessionId}/${name}`, session: ctx.sessionId, agent: name, ...where };
}

/** A worktree as a claim names it: an absolute path, short and plainly spelled. */
function worktreePath(raw: Record<string, unknown>): string | undefined {
  const value = str(raw, 'worktree', { optional: true });
  if (value === undefined) return undefined;
  const path = value.trim();
  if (!path || path.length > WORKTREE_PATH_MAX || /\p{C}/u.test(path))
    throw new ToolInputError(
      `"worktree" is the absolute path of a git worktree of this project, at most ${String(WORKTREE_PATH_MAX)} characters`,
      { field: 'worktree' },
    );
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path))
    throw new ToolInputError('"worktree" is the absolute path of a git worktree of this project, not a path relative to somewhere', {
      field: 'worktree',
    });
  return path;
}

const MAX_LEASE_PATHS = 200;

/**
 * An agent's name within its session. Other sessions see it in the holder of
 * a claim, so it is an identifier, never a sentence.
 */
export const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** Whom a handoff is offered to: a session, or a session's agent. */
const HANDOFF_TARGET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,39})?$/;

function leasePaths(raw: Record<string, unknown>): string[] {
  const items = list(raw, 'paths');
  if (items.length > MAX_LEASE_PATHS)
    throw new ToolInputError(`"paths" takes at most ${String(MAX_LEASE_PATHS)} entries; reserve a directory instead`, { field: 'paths' });
  const use = raw.action === 'claim' ? 'reserve' : 'check';
  return items.map((p) => {
    if (typeof p !== 'string' || !p.trim()) throw new ToolInputError('"paths" holds non-empty strings', { field: 'paths' });
    try {
      return normalizeLeasePath(p, use);
    } catch (e) {
      throw new ToolInputError((e as Error).message, { field: 'paths' });
    }
  });
}

function matching(value: string | undefined, pattern: RegExp, field: string, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (!pattern.test(value.trim())) throw new ToolInputError(message, { field });
  return value.trim();
}

/** Overlaps with other work's reservations, split into what blocks and what only risks a merge. */
function overlapReport(overlaps: readonly Overlap[]): { clear: boolean; collisions: readonly Overlap[]; mergeRisks: readonly Overlap[] } {
  const collisions = overlaps.filter((o) => o.kind === 'collision');
  return { clear: collisions.length === 0, collisions, mergeRisks: overlaps.filter((o) => o.kind === 'merge_risk') };
}

/** A handoff as another claimant reads it: the packet is that claimant's words, to weigh, never to obey. */
function handoffAsData(h: Handoff): PeerData<Handoff> {
  return asPeerData(h.from, h);
}

interface WorkToolInput {
  action: WorkAction;
  id?: string;
  title?: string;
  kind?: string;
  description?: string;
  parent?: string;
  serves?: string;
  blockedBy?: string[];
  related?: string[];
  acceptance?: string[];
  risk?: string;
  sources?: string[];
  removeParent?: boolean;
  reason?: string;
  token?: string;
  acceptanceKey?: string;
  offerId?: string;
  agent?: string;
  paths?: string[];
  mode?: LeaseMode;
  packet?: Record<string, unknown>;
  to?: string;
  worktree?: string;
}

/** A list input that must hold only strings. */
function strings(raw: Record<string, unknown>, key: string): string[] | undefined {
  if (raw[key] === undefined) return undefined;
  const values = list(raw, key);
  if (values.some((v) => typeof v !== 'string')) throw new ToolInputError(`"${key}" must contain strings`, { field: key });
  return values as string[];
}

export const work = define<WorkToolInput, unknown>({
  name: 'work',
  title: 'Native work',
  description:
    "File, query, claim, settle, take over and hand off bounded work in this project's ledger; each action's rules come back as a refusal naming its recovery. File work with its place, a parent or the decision, requirement, initiative or metric it serves, or it waits as proposed; to root your own work, remember the outcome behind it and serve that. A claim returns a token only you see: pass it to renew (claim again), complete, release or hand off, and name the files you will change as paths (with worktree when you edit in another git worktree of this project).",
  surface: 'interactive',
  readOnly: false,
  destructive: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Use prepare_accept before recoverable accept.', enum: [...WORK_ACTIONS] },
      id: { type: 'string', description: 'Work id or a preserved legacy id.' },
      title: { type: 'string', description: 'Title, for add and update.' },
      kind: { type: 'string', description: 'outcome, task, defect, or plan.', enum: ['outcome', 'task', 'defect', 'plan'] },
      description: { type: 'string', description: 'For add and update: what the work is, in enough detail to pick it up cold.' },
      parent: { type: 'string', description: 'For add and link: the work item this one is part of.' },
      serves: {
        type: 'string',
        description:
          'For add and link: the decision, requirement, initiative, or metric this work serves, by entity id or governing statement id.',
      },
      blockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'For add, link, and unlink: work that must finish before this is ready.',
      },
      related: {
        type: 'array',
        items: { type: 'string' },
        description: 'For add, link, and unlink: work that gives context without blocking.',
      },
      acceptance: {
        type: 'array',
        items: { type: 'string' },
        description: 'For add and update: observable criteria a finished item meets, one each. update replaces the list.',
      },
      risk: { type: 'string', description: 'For add and update: what could go wrong.' },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'For add and update: source ids whose refresh sends this work back for requalification.',
      },
      removeParent: { type: 'boolean', description: 'For unlink: remove the parent.' },
      reason: {
        type: 'string',
        description:
          'Required for reopen, takeover, and requalify; for complete, required when the work has acceptance criteria, saying how they were met.',
      },
      token: {
        type: 'string',
        description:
          'Ledger claimToken for renewal, handoff or settlement; not a workflow-step token. Accept rotates it. Never relay the offerer’s token.',
      },
      acceptanceKey: {
        type: 'string',
        description:
          'Accept: private key from prepare_accept. Retain with offerId before dispatch; retry both unchanged to recover the same live claim without renewal. Never publish or invent a key.',
      },
      offerId: {
        type: 'string',
        description:
          'Accept: public immutable handoff.offerId from offers/show or prepare_accept. Pair with acceptanceKey to fence stale requests.',
      },
      agent: {
        type: 'string',
        description:
          'Which agent in this session is acting, when the host runs several (for example a subagent’s name). Claims are held per agent.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Files or directories (ending in /) relative to the repository root, for claim and check. A claim reserves them while it is held.',
      },
      mode: {
        type: 'string',
        description:
          'exclusive (the default) keeps other claims in this checkout off the paths; shared lets other shared claims read alongside.',
        enum: [...LEASE_MODES],
      },
      packet: {
        type: 'object',
        description: 'Handoff notes; descriptive paths do not reserve files. Only actual claim reservations transfer.',
        properties: {
          state: { type: 'string', description: 'Where the work stands.' },
          next: { type: 'string', description: 'The next concrete step.' },
          watchOut: { type: 'array', items: { type: 'string' }, description: 'Known hazards.' },
          openQuestions: { type: 'array', items: { type: 'string' }, description: 'Unresolved questions.' },
          where: {
            type: 'object',
            description: 'Descriptive location; never authority or reservations.',
            properties: {
              branch: { type: 'string', description: 'Branch name, when known.' },
              commit: { type: 'string', description: 'Git commit id, when known.' },
              paths: { type: 'array', items: { type: 'string' }, description: 'Repository-relative paths for context.' },
            },
          },
        },
        required: ['state', 'next'],
      },
      to: {
        type: 'string',
        description: 'For handoff: the claimant (session/agent) or session to offer it to. Without it anyone here may accept.',
      },
      worktree: {
        type: 'string',
        description:
          'For claim/check/accept/takeover in another managed worktree: its absolute path. Reservations bind that root and branch; renewal without it keeps that binding. Unknown worktrees refuse.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    if (raw.acceptanceKey !== undefined && raw.action !== 'accept')
      throw new ToolInputError('"acceptanceKey" is only for accept; prepare_accept generates one before dispatch', {
        field: 'acceptanceKey',
      });
    if (raw.offerId !== undefined && raw.action !== 'accept')
      throw new ToolInputError('"offerId" is only for accept', { field: 'offerId' });
    if (raw.acceptanceKey !== undefined && raw.offerId === undefined)
      throw new ToolInputError('"offerId" from the observed handoff is required with acceptanceKey', { field: 'offerId' });
    return {
      action: str(raw, 'action', { oneOf: [...WORK_ACTIONS] }) as WorkAction,
      id: str(raw, 'id', { optional: true }),
      title: str(raw, 'title', { optional: true }),
      kind: str(raw, 'kind', { optional: true, oneOf: ['outcome', 'task', 'defect', 'plan'] }),
      description: str(raw, 'description', { optional: true }),
      parent: str(raw, 'parent', { optional: true }),
      serves: str(raw, 'serves', { optional: true }),
      blockedBy: strings(raw, 'blockedBy'),
      related: strings(raw, 'related'),
      acceptance: strings(raw, 'acceptance'),
      risk: str(raw, 'risk', { optional: true }),
      sources: strings(raw, 'sources'),
      removeParent: bool(raw, 'removeParent', false),
      reason: str(raw, 'reason', { optional: true }),
      token: str(raw, 'token', { optional: true }),
      acceptanceKey: matching(
        str(raw, 'acceptanceKey', { optional: true }),
        /^[a-f0-9]{64}$/i,
        'acceptanceKey',
        '"acceptanceKey" is 32 cryptographically random bytes encoded as 64 hex characters and retained privately before accepting',
      ),
      offerId: matching(
        str(raw, 'offerId', { optional: true }),
        /^[A-Za-z0-9:_-]{1,160}$/,
        'offerId',
        '"offerId" is the public immutable generation from the observed handoff',
      ),
      agent: matching(
        str(raw, 'agent', { optional: true }),
        AGENT_NAME,
        'agent',
        '"agent" is a name of letters, digits, dot, dash, or underscore, at most 40 characters',
      ),
      paths: raw.paths === undefined ? undefined : leasePaths(raw),
      mode: str(raw, 'mode', { optional: true, oneOf: [...LEASE_MODES] }) as LeaseMode | undefined,
      packet: obj(raw, 'packet', { optional: true }),
      to: matching(
        str(raw, 'to', { optional: true }),
        HANDOFF_TARGET,
        'to',
        '"to" names a session or a session’s agent, such as ses_ab12/reviewer',
      ),
      worktree: worktreePath(raw),
    };
  },
  run(
    ctx,
    {
      action,
      id,
      title,
      kind,
      description,
      parent,
      serves,
      blockedBy,
      related,
      acceptance,
      risk,
      sources,
      removeParent,
      reason,
      token,
      acceptanceKey,
      offerId,
      agent,
      paths,
      mode,
      packet,
      to,
      worktree,
    },
  ) {
    const at = ctx.now();
    const where = editLane(ctx, LANE_ACTIONS.includes(action) ? worktree : undefined);
    if (action === 'list') return queryWork(ctx.store, { query: title, parentId: parent, limit: 50 });
    if (action === 'offers')
      return listOffers(ctx.store, at, claimantOf(ctx, agent)).map((o) => ({ work: o.work, handoff: handoffAsData(o.handoff) }));
    if (action === 'check') {
      if (!paths || paths.length === 0) throw new ToolInputError('"paths" is required for check', { field: 'paths' });
      assertLeasePaths({ root: ctx.root, lane: where.lane, paths, store: ctx.store, now: at });
      const named = id ? (getWork(ctx.store, id) ?? getWorkByLegacyId(ctx.store, id)) : null;
      const exclude =
        named?.status === 'claimed' && named.claimOwner === claimantOf(ctx, agent).owner && named.claimUntil && named.claimUntil > at
          ? named.id
          : undefined;
      return overlapReport(findOverlaps(ctx.store, { paths, laneRoot: where.lane ?? MAIN_LANE, now: at, mode, excludeWorkId: exclude }));
    }
    if (action === 'ready') return listReady(ctx.store, at);
    if (action === 'add') {
      if (!title) throw new ToolInputError('"title" is required for add', { field: 'title' });
      const filed = fileWork(ctx.store, {
        id: ctx.nextId('work'),
        kind: (kind as 'outcome' | 'task' | 'defect' | 'plan' | undefined) ?? 'task',
        title,
        description,
        parentId: parent,
        serves,
        blockedBy,
        related,
        acceptance,
        risk,
        sources,
        byPerson: false,
        at,
        actor: ctx.actor,
        nextId: ctx.nextId,
      });
      return { ...filed.work, admitted: filed.admitted, admittedBy: filed.admittedBy, next: filed.next };
    }
    if (!id) throw new ToolInputError(`"id" is required for ${action}`, { field: 'id' });
    const item = getWork(ctx.store, id) ?? getWorkByLegacyId(ctx.store, id);
    if (!item) throw new Error(`no work ${id}`);
    const until = new Date(Date.parse(at) + WORK_CLAIM_TERM_MS).toISOString();
    if (action === 'prepare_accept')
      return {
        ...prepareAcceptance(ctx.store, { id: item.id, ...claimantOf(ctx, agent), now: at }),
        next: 'Retain acceptanceKey privately with offerId, then call work accept with both, the same id, agent and intended worktree. Repeat that identical accept after a lost response; never publish this capability.',
      };
    if (action === 'show') {
      const handoff = handoffOf(ctx.store, item.id);
      return {
        ...item,
        readiness: readinessOf(ctx.store, item, at),
        structure: workStructure(ctx.store, item),
        leases: leasesFor(ctx.store, item.id),
        handoff: handoff ? handoffAsData(handoff) : null,
      };
    }
    if (action === 'update') {
      return updateWork(ctx.store, {
        id: item.id,
        expectedRevision: item.revision,
        at,
        actor: ctx.actor,
        title,
        description,
        acceptance,
        risk,
        premises: sources ? { sources } : undefined,
      });
    }
    if (action === 'requalify') {
      if (!reason) throw new ToolInputError('requalify needs a reason: what was checked against the changed source', { field: 'reason' });
      return requalifyWork(ctx.store, { id: item.id, reason, at, actor: ctx.actor });
    }
    if (action === 'link')
      return linkWork(ctx.store, { id: item.id, parentId: parent, serves, blockedBy, related, at, actor: ctx.actor, nextId: ctx.nextId });
    if (action === 'unlink') return unlinkWork(ctx.store, { id: item.id, parent: removeParent, blockedBy, related, at, actor: ctx.actor });
    if (isRunDelivery(item) && ['claim', 'takeover', 'handoff', 'accept', 'complete', 'release'].includes(action)) {
      const runId = (item.scope as { runId?: string }).runId ?? 'its run';
      throw new ToolInputError(
        `${item.id} is the reservation run ${runId} holds for its requested file; the run settles it, so claim_work with that runId instead`,
        {
          field: 'id',
        },
      );
    }
    const renewing =
      action === 'claim' && token !== undefined && worktree === undefined ? renewedLane(ctx, item, claimantOf(ctx, agent).owner, at) : null;
    const who = claimantFor(ctx, agent, at, renewing ?? where);
    if (['claim', 'takeover'].includes(action))
      assertLeasePaths({
        root: ctx.root,
        lane: who.lane,
        paths: paths?.length ? paths : leasesFor(ctx.store, item.id).map((l) => l.path),
        store: ctx.store,
        now: at,
      });
    if (action === 'handoff') {
      if (!token) throw new ToolInputError('"token" is required for handoff: the one your claim returned', { field: 'token' });
      if (!packet) throw new ToolInputError('"packet" is required for handoff: at least state and next', { field: 'packet' });
      return handoffWork(ctx.store, { id: item.id, owner: who.owner, token, packet, to, now: at });
    }
    if (action === 'accept') {
      const taken = acceptWork(ctx.store, { id: item.id, ...who, until, now: at, acceptanceKey, offerId }, () =>
        assertLeasePaths({
          root: ctx.root,
          lane: who.lane,
          paths: leasesFor(ctx.store, item.id).map((l) => l.path),
          store: ctx.store,
          now: at,
        }),
      );
      return { ...taken, handoff: handoffAsData(taken.handoff) };
    }
    if (action === 'claim') return claimWorkItem(ctx.store, { id: item.id, ...who, until, now: at, token, paths, mode });
    if (action === 'complete') return completeWork(ctx.store, { id: item.id, owner: who.owner, token, at, reason });
    if (action === 'release') {
      if (!token) throw new ToolInputError('"token" is required for release: the one your claim returned', { field: 'token' });
      return releaseWork(ctx.store, { id: item.id, owner: who.owner, token, at });
    }
    if (action === 'takeover') {
      if (!reason) throw new ToolInputError('takeover needs a reason', { field: 'reason' });
      return takeoverWork(ctx.store, { id: item.id, ...who, until, now: at, reason, processAlive: ctx.processAlive });
    }
    if (!reason) throw new ToolInputError('reopen needs a reason', { field: 'reason' });
    return reopenWork(ctx.store, { id: item.id, actor: ctx.actor, at, reason });
  },
});
