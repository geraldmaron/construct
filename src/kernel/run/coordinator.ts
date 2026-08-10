/**
 * kernel/run/coordinator.ts — the bounded run coordinator: it takes leased
 * tasks off the store, dispatches them to a host, and writes down what happened.
 *
 * Bounded, and deliberately not a pool. There is no worker abstraction, no
 * queue service, no supervision tree — STRATEGY calls an agent pool enterprise
 * cosplay at this scale and it is right: the whole thing is a loop that keeps at
 * most N invocations in flight. Everything that would normally justify a pool
 * (durability, recovery, deduplication) lives in the task rows instead, where it
 * survives the process dying. See store/tasks.ts for the lease and its fence.
 *
 * What this module owns:
 *   - the concurrency bound, so a ten-domain outcome does not open ten hosts;
 *   - the global spend ceiling, checked before each dispatch (STRATEGY risk 6:
 *     cost outrunning a solo maintainer);
 *   - a work log entry for every dispatch and every settle, so a run is
 *     accountable in each role's name (commitment 4) whether it succeeded or not.
 *
 * What it does not own: retries, model choice, tool brokering, session state.
 * Those are the host's, and rebuilding any of them here is the homebrew-runtime
 * creep commitment 1 forbids.
 *
 * The clock is injected as a function rather than a value because a coordinator
 * runs across time — leases expire while it works. `clock()` is the only way
 * this module learns what time it is; there is no `new Date()` below.
 */

import { appendWorkLog } from '../store/worklog.ts';
import {
  StaleLeaseError,
  claimTask,
  completeTask,
  failTask,
  getTask,
  listTasks,
  totalSpend,
} from '../store/tasks.ts';
import type { LeasedTask } from '../store/tasks.ts';
import { sourceReadsFor } from '../store/sources.ts';
import { groundRootsFor } from './sourcereads.ts';
import { groundedMaterialProtocol } from './grounding.ts';
import type { Material } from './grounding.ts';
import type { Store } from '../store/open.ts';
import type { HostAdapter, HostResult } from '../hosts/interface.ts';
import type { Brief } from '../brief/schema.ts';
import { meetsFloor } from '../brief/tiers.ts';
import { DOMAINS, domainsByName } from '../implication/domains.ts';
import type { Domain } from '../implication/domains.ts';
import { deliverableConcerns, licensedReviewFor } from './accountability.ts';
import { STANCE_PROTOCOL, frameConflict, parseStance } from './conflicts.ts';
import type { RoleStance } from './conflicts.ts';
import { latestDraft, logPromotion, recordVerdict } from './promotion.ts';
import { challengeById, runStructuralChallenges } from '../challenge/catalog.ts';
import { getDecision, raiseDecision } from '../store/decisions.ts';
import { ROLE_GRANTS, issueRoleToken } from '../capabilities/tokens.ts';
import { buildRoleEnv } from './roleenv.ts';
import { NO_WRITE_SURFACE_NOTE, WRITE_SURFACE_PROTOCOL } from './rolewrite.ts';
import { playbookFor } from '../plan/playbooks.ts';
import { lensForDomain } from '../plan/lenses.ts';
import { voiceProtocol } from '../voice/voice.ts';
import type { VoiceOverride } from '../voice/voice.ts';

export const DEFAULT_CONCURRENCY = 2;

/**
 * A lease must outlive the host's own timeout. If it does not, a slow-but-alive
 * invocation looks crashed, the coordinator re-claims its task and dispatches a
 * second copy — self-inflicted duplicate work. The fencing token still keeps the
 * result correct (the loser's settle is dropped), so the damage is wasted spend
 * rather than corruption, but the default is set above the OpenCode adapter's
 * ten-minute timeout so it does not happen at all.
 */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

/** now + ms, as ISO. Parsing a supplied string reads no clock. */
function deadline(now: string, ms: number): string {
  return new Date(Date.parse(now) + ms).toISOString();
}

/** Why dispatch stopped before the queue was empty. Null means it emptied. */
export type HaltReason = 'spend-ceiling';

export interface CoordinatorOptions {
  /** Identifies this process's leases. Two coordinators must not share one. */
  readonly owner: string;
  /** Injected; the kernel never reads the clock. */
  readonly clock: () => string;
  /**
   * Total spend allowed across every run in this store, in the host's own cost
   * units. Reaching it halts dispatch; it does not kill work already in flight.
   */
  readonly spendCeiling: number;
  readonly concurrency?: number;
  readonly leaseMs?: number;
  /** Work only this run. Omit to work whatever is claimable. */
  readonly run?: string;
  /** Domain catalog the assignment text is built from. */
  readonly catalog?: readonly Domain[];
  /**
   * The kernel's token-signing secret (see capabilities/secretfile.ts). When
   * present, every dispatch mints a capability token scoped to exactly that
   * run and task, expiring with the task's lease — a token that outlives the
   * lease is a write surface still open on work another worker has taken over.
   * Absent means roles get no write surface at all, which is safe, not broken.
   */
  readonly capabilitySecret?: string;
  /**
   * The user's instruction to sound like something other than Construct. Absent
   * means the house voice, which is the case that needs no record; an override
   * in force is written to the work log at every dispatch it shapes.
   */
  readonly voice?: VoiceOverride;
}

export interface RunReport {
  readonly dispatched: number;
  readonly completed: number;
  readonly failed: number;
  /**
   * Ids this invocation settled, in settle order. Reported rather than left to
   * the caller to infer from the store, because "what this run did" and "what
   * the store contains" are different sets the moment a second run exists.
   */
  readonly settled: readonly string[];
  /** Settles dropped because the lease had been taken over. */
  readonly staleSettles: number;
  /** Tasks claimed whose previous lease had expired — recovered crashed work. */
  readonly recovered: number;
  /** Deliverables carrying a host-reported defect. See run/accountability.ts. */
  readonly flagged: number;
  /** Deliverables routed to a licensed professional before anyone relies on them. */
  readonly escalated: number;
  /**
   * Dispatches that ran below the brief's declared model capability floor
   *. Non-zero does not mean the run failed — it means every
   * claim about what these deliverables demonstrate is qualified by the model
   * that produced them.
   */
  readonly degraded: number;
  /** Cross-domain disagreements framed into the decision inbox. */
  readonly conflicts: number;
  readonly spendBefore: number;
  readonly spendAfter: number;
  readonly spendCeiling: number;
  /**
   * Completions where the host reported no cost at all. The ceiling cannot bind
   * on these, and saying so is the difference between a measured bound and an
   * assumed one.
   */
  readonly costSilent: number;
  readonly halted: HaltReason | null;
}

/**
 * How the engagement was reached, said plainly to the role. Provenance matters
 * to the reader: a keyword match and a model's stated reason are not the same
 * quality of evidence, and a role weighing its own remit should know which it
 * was handed.
 */
function howEngaged(inferredBy: string): string {
  switch (inferredBy) {
    case 'keywords':
      return 'those are keyword signals matched in the outcome, not a judgment';
    case 'namer':
      return 'a model read the outcome and gave that as its reason';
    case 'cache':
      return 'a model gave that reason for this same outcome earlier';
    case 'user':
      return 'the user named your domain themselves';
    default:
      return `provenance: ${inferredBy}`;
  }
}

/**
 * What the role is being asked to do, in words.
 *
 * Built here rather than stored on the brief because a brief declares what a
 * task NEEDS — inputs, capabilities, postconditions — and the moment it also
 * carried the prompt it would be orchestrating itself, which is what commitment
 * 10 separates. The domain's own stated concern is what makes the assignment
 * specific, and it comes from the catalog, so a role outside the catalog gets an
 * assignment that says only what is actually known about it.
 */
/**
 * What a role is allowed to treat as evidence, said out loud.
 *
 * A role dispatched into a working directory with ambient filesystem access
 * and no material of its own reaches for the nearest readable thing. On a real
 * run an employment-law question was answered by reading this tool's own
 * package and citing a module of keyword definitions. The deliverable looked
 * cited, which is worse than looking uncited.
 *
 * Saying it is the cheap half and it is not the whole fix, because a statement
 * relies on the model to comply. The citation challenge checks the same rule
 * afterwards, so the two halves fail independently.
 */
const MATERIAL_PROTOCOL = [
  'Your material is the outcome above and what you already know about your',
  'domain. Whatever files happen to be around you are not evidence for it —',
  'you may be running inside this tool\'s own package or inside the user\'s',
  'codebase, and neither one tells you anything about your domain. Never cite a',
  'file path as the source for a claim about your domain. If a claim needs a',
  'source you do not have, mark it [unverified] and say what would settle it.',
].join(' ');

/**
 * The deliverable is a work product, not a restated gap. Issue-spotting has a
 * shape — numbered issues, each with the step that resolves it — and the
 * playbook template's slots make the rest of the shape checkable. Missing
 * information becomes a labeled assumption the work proceeds on; it is never
 * a reason to withhold the deliverable.
 */
function workProductDirective(role: string): string {
  const template = playbookFor(role).template;
  const slots = template.slots
    .map((s) => `- ${s.name}${s.required ? '' : ' (optional)'}: ${s.expects}`)
    .join('\n');
  return (
    `Deliver a ${template.deliverable} the user can act on. Structure it under ` +
    'exactly these headed sections:\n' +
    `${slots}\n\n` +
    'Rules for the work product:\n' +
    '- Number every issue. Each issue states the problem in one sentence, then ' +
    'the concrete step that resolves it.\n' +
    '- Missing information is never an issue. If something cannot be determined ' +
    'from the outcome, state the assumption you proceed on, label it [assumed], ' +
    'and deliver the work that assumption allows.\n' +
    '- Do not assert anything you cannot support.\n' +
    '- Keep it as short as it can be while the reader can still follow how you ' +
    'got there.\n\n'
  );
}

/**
 * The role's lens, spoken before the work: posture, the question set the role
 * works through, when to escalate, and any standing label or jurisdiction
 * boundary. Depth a role was never shown is depth it cannot apply; the lens is
 * data (plan/lenses.ts) so what a role knows is committed and testable rather
 * than living in whoever last edited a prompt.
 */
function lensDirective(role: string): string {
  const lens = lensForDomain(role);
  if (!lens) return '';
  const questions = lens.questions.map((q) => `- ${q}`).join('\n');
  const escalation = lens.escalation.map((e) => `- ${e}`).join('\n');
  const labeling = lens.labeling
    ? `Every deliverable under this lens carries the label: ${lens.labeling}.\n`
    : '';
  const jurisdictions = lens.jurisdictions
    ? lens.jurisdictions.covered.length > 0
      ? `Jurisdictions covered: ${lens.jurisdictions.covered.join(', ')}. ` +
        `Outside them: ${lens.jurisdictions.outside}\n`
      : `${lens.jurisdictions.outside}\n`
    : '';
  return (
    `Your posture: ${lens.posture}\n\n` +
    'Work through these questions against the material; each finding cites what supports it:\n' +
    `${questions}\n\n` +
    'Escalate rather than push past your remit:\n' +
    `${escalation}\n` +
    labeling +
    jurisdictions +
    '\n'
  );
}

/**
 * What a run read, shaped for the assignment. Unreachable reads travel with the
 * rest: a source that failed is material the role must know it does not have.
 */
export function materialFor(store: Store, run: string): Material[] {
  return sourceReadsFor(store, run).map((read) => ({
    source: read.source,
    descriptor: read.descriptor,
    coverage: read.coverage,
    detail: read.detail,
  }));
}

export function assignmentFor(
  brief: Brief,
  catalog: readonly Domain[] = DOMAINS,
  options: {
    readonly writeSurface?: boolean;
    readonly voice?: VoiceOverride;
    /**
     * What this dispatch read, when it read anything. Empty or absent means the
     * role reasons from its domain and cites no paths; present means the
     * documents are the evidence and the grounded protocol replaces the
     * no-material one. The two rules contradict each other, so exactly one is
     * ever spoken.
     */
    readonly material?: readonly Material[];
    /** Local roots the role may read beyond the listed documents. */
    readonly groundRoots?: readonly string[];
  } = {},
): string {
  const domain = domainsByName(catalog).get(brief.role);
  const concern = domain ? `\nYour concern: ${domain.concern}.` : '';
  // Why this role is here, in the words the record holds. A role that knows
  // which concern fired can open from it; one that does not has to guess at
  // its own remit, and the evidence was sitting in the brief the whole time.
  const engagement = brief.engagement
    ? `You were engaged because: ${brief.engagement.evidence.join(' ')}\n` +
      `(${howEngaged(brief.engagement.inferredBy)})\n\n`
    : '';
  // Whether the role holds the two writes is a fact about THIS dispatch, so the
  // assignment says which it is rather than describing tools that may not exist
  //. Silence was the old behavior and it is the worst of the
  // three: a role given tools on one run and none on the next cannot tell.
  // What the deliverable will be held to, stated before the work
  // rather than checked after it. A challenge a role was never shown is a rule
  // enforced against someone who was never told it, and the deterministic
  // checks below run whether or not anyone mentioned them.
  const declared = (brief.challenges ?? [])
    .map((id) => challengeById(id))
    .filter((challenge) => challenge !== undefined);
  const obligations =
    declared.length > 0
      ? 'Before this deliverable can be relied on, it must satisfy the challenges ' +
        'the brief names. Answer each one in the deliverable itself, under a ' +
        'heading a reader can find:\n' +
        declared.map((c) => `- ${c.id}: ${c.question}`).join('\n') +
        '\n\n'
      : '';
  const surface = options.writeSurface ? WRITE_SURFACE_PROTOCOL : NO_WRITE_SURFACE_NOTE;
  const material =
    options.material && options.material.length > 0
      ? groundedMaterialProtocol(options.material, options.groundRoots ?? [])
      : MATERIAL_PROTOCOL;
  return (
    `You are acting as the ${brief.role} role.${concern}\n\n` +
    `The outcome the user asked for: ${brief.outcome}\n\n` +
    engagement +
    lensDirective(brief.role) +
    workProductDirective(brief.role) +
    material +
    '\n\n' +
    obligations +
    `${voiceProtocol(options.voice)}\n\n` +
    `${surface}\n\n` +
    STANCE_PROTOCOL
  );
}

/**
 * Host-reported cost of one invocation, and whether it was reported at all.
 *
 * The shape is the host's, so this reads defensively: an adapter that reports
 * nothing yields 0 with `reported: false`, and the caller can tell a genuinely
 * free local run from an unmeasured one. Treating both as zero is how a spend
 * ceiling turns into an assurance nobody checked.
 *
 * `steps` is the second half of that check, and it was added after a live run
 * rather than in anticipation: OpenCode against a local model returned a
 * complete deliverable with zero step_finish events, so the adapter's summed
 * usage was a well-formed envelope of zeroes. Cost 0 out of 0 measurements is
 * not "this run was free", and reporting it as free is precisely the false
 * assurance this function exists to prevent. A usage envelope that says how many
 * measurements it summed and answers none is unmeasured.
 */
export function spendOf(result: HostResult): { spend: number; reported: boolean } {
  const output = result.output as { usage?: { cost?: unknown; steps?: unknown } } | null;
  const cost = output?.usage?.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return { spend: 0, reported: false };
  const steps = output?.usage?.steps;
  if (typeof steps === 'number' && steps <= 0) return { spend: 0, reported: false };
  return { spend: cost, reported: true };
}

/**
 * The deliverable as text, or null when the host returned none. Null and empty
 * are different answers: a structural check over an absent deliverable would
 * fail every challenge for a reason that has nothing to do with the work.
 */
function replyTextOf(output: unknown): string | null {
  const text = (output as { text?: unknown } | null)?.text;
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/**
 * The text the challenges are run against: the submitted draft when there is
 * one, the reply otherwise.
 *
 * The write-surface protocol tells a role in as many words that "the draft is
 * what lands on the record attributed to you", and roles believe it — on a real
 * run one submitted a full deliverable and replied with a two-line summary, and
 * another submitted a draft and replied with nothing at all. Checking the reply
 * meant the citation check passed a summary while the deliverable of record
 * went unread, which is the failure this whole layer exists to prevent: a
 * verdict about something other than the thing being relied on.
 */
function deliverableTextOf(store: Store, taskId: string, output: unknown): string | null {
  const draft = latestDraft(store, taskId)?.deliverable;
  if (draft !== undefined && draft !== null) {
    const text = draftText(draft);
    // A draft exists and is not readable as text. The reply is NOT a fallback
    // here: the role submitted something it considers its deliverable, and
    // checking the summary instead would report a verdict about the wrong
    // thing in a new way. Unreadable is the honest answer.
    return text;
  }
  return replyTextOf(output);
}

/**
 * A submitted draft as text, or null when it is not text at all.
 *
 * Roles do not always send prose. On a real run one called submit_draft with a
 * JSON object whose keys were the challenge ids from its own assignment — it
 * read the obligations block as a response schema. Coercing it gave the
 * literal string "[object Object]", which the citation check then PASSED,
 * because a string with no amounts or dates has nothing untagged in it. A
 * verdict about a coerced object is the worst thing this layer can produce:
 * it reports success about nothing.
 *
 * One envelope is unwrapped, because it is the same deliverable wearing a
 * wrapper: a JSON string or object whose payload is `deliverable`. Anything
 * else returns null and is reported as unreadable rather than checked.
 */
function draftText(draft: unknown): string | null {
  if (typeof draft === 'string') {
    const trimmed = draft.trim();
    if (trimmed === '') return null;
    if (trimmed.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const inner = (parsed as { deliverable?: unknown } | null)?.deliverable;
        if (typeof inner === 'string' && inner.trim() !== '') return inner;
      } catch {
        // Not JSON. It is prose that happens to open with a brace.
      }
    }
    return draft;
  }
  const inner = (draft as { deliverable?: unknown } | null)?.deliverable;
  if (typeof inner === 'string' && inner.trim() !== '') return inner;
  return null;
}

function summarize(result: HostResult): Record<string, unknown> {
  const output = result.output as
    | { text?: unknown; toolCalls?: unknown[]; failedToolCalls?: unknown[]; usage?: unknown }
    | null;
  const text = typeof output?.text === 'string' ? output.text : '';
  return {
    chars: text.length,
    toolCalls: Array.isArray(output?.toolCalls) ? output.toolCalls.length : 0,
    failedToolCalls: Array.isArray(output?.failedToolCalls) ? output.failedToolCalls.length : 0,
    usage: output?.usage ?? null,
  };
}

/** All framing needs is a clock; it opens no host and spends nothing. */
export interface FramingOptions {
  readonly clock: () => string;
  /** Limit framing to one run, as `construct work --run <id>` does. */
  readonly run?: string;
}

/**
 * Which runs to consider framing.
 *
 * Two sources, because they answer different questions. The ids this invocation
 * settled cover the ordinary case, including a run split across invocations by
 * the spend ceiling — it is framed at the end of the first invocation, against
 * whatever sides exist by then. Every FULLY SETTLED run in the store covers the
 * case a live run found: tasks settled durably, then the process died before
 * framing ran, and no later invocation could ever reach it. `construct work`
 * returns at its nothing-to-work guard, so the decision was unreachable by any
 * command, on evidence sitting complete in the store.
 *
 * Fully settled is the deliberate bound on the second source. Sweeping every run
 * with a done task would frame runs still in flight in another process, turning
 * a partial picture into a decision the user reads as final — and the once-per-
 * run rule means that first framing is the one they keep.
 */
function framingCandidates(store: Store, settled: readonly string[], run?: string): string[] {
  const runs = new Set<string>();
  for (const id of settled) {
    const settledRun = getTask(store, id)?.run;
    if (settledRun) runs.add(settledRun);
  }

  const unsettled = new Set<string>();
  const withDone = new Set<string>();
  for (const task of listTasks(store, run)) {
    if (task.state === 'done') withDone.add(task.run);
    else if (task.state !== 'failed') unsettled.add(task.run);
  }
  for (const candidate of withDone) {
    if (!unsettled.has(candidate)) runs.add(candidate);
  }

  return [...runs].filter((candidate) => run === undefined || candidate === run);
}

/**
 * Frame each candidate run's cross-domain disagreement as one inbox item, and
 * return how many were raised.
 *
 * Runs at the end rather than per settle, because a conflict is a property of a
 * run's deliverables taken together — the first role to report has nothing to
 * disagree with yet. Every done task in the run is considered, not just the ones
 * this invocation settled, so a run split across two invocations by the spend
 * ceiling still gets framed against all of its sides.
 *
 * Framed once per run. A later invocation that adds a position does not rewrite
 * a decision the user may already be reading; the new position is in the work
 * log, and silently editing the question under them would be worse than leaving
 * it as it was raised. That guard is also what makes this operation safe to
 * re-enter, which is what the crash-recovery fix depends on: everything below is
 * derived from the store, so calling it again can only raise a decision that was
 * never raised, never rewrite one that was.
 */
export function frameConflicts(
  store: Store,
  settled: readonly string[],
  options: FramingOptions,
): number {
  const runs = framingCandidates(store, settled, options.run);

  let raised = 0;
  for (const run of runs) {
    if (getDecision(store, `${run}:stance`)) continue;

    const done = listTasks(store, run).filter((task) => task.state === 'done');
    const stances: RoleStance[] = [];
    for (const task of done) {
      const declared = parseStance((task.result as { text?: unknown } | null)?.text);
      if (declared) stances.push({ role: task.role, declared });
    }

    const outcome = (done[0]?.brief as Brief | undefined)?.outcome ?? run;
    const decision = frameConflict({ run, outcome, stances, at: options.clock() });
    if (!decision) continue;

    raiseDecision(store, decision);
    raised += 1;
    appendWorkLog(store, {
      run,
      role: 'construct',
      action: 'decision-raised',
      detail: {
        id: decision.id,
        question: decision.question,
        positions: decision.positions,
        undeclared: done.length - stances.length,
      },
      at: options.clock(),
    });
  }
  return raised;
}

/**
 * Work the claimable tasks until the queue empties or the spend ceiling stops
 * dispatch.
 *
 * The ceiling is checked before each claim, never mid-invocation: money already
 * committed to a running host is spent whether or not the result is collected,
 * so killing in-flight work to enforce a budget wastes exactly what it is
 * protecting. Halting means claiming nothing further; unclaimed tasks stay
 * pending and a later run with a raised ceiling picks them up.
 */
export async function workRun(
  store: Store,
  host: HostAdapter,
  options: CoordinatorOptions,
): Promise<RunReport> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const leaseMs = Math.max(1, options.leaseMs ?? DEFAULT_LEASE_MS);
  const catalog = options.catalog ?? DOMAINS;
  const spendBefore = totalSpend(store);

  let dispatched = 0;
  let completed = 0;
  let failed = 0;
  let staleSettles = 0;
  let recovered = 0;
  let costSilent = 0;
  let flagged = 0;
  let escalated = 0;
  let degraded = 0;
  let halted: HaltReason | null = null;
  const settled: string[] = [];

  const inFlight = new Set<Promise<void>>();
  // A dispatch that throws something other than a stale lease means the store
  // itself is unusable. It is captured rather than left to reject on its own,
  // because an unattended rejection would surface as an unhandled promise while
  // the loop was awaiting a different one — the error must arrive after the
  // in-flight work settles, not instead of it.
  let fatal: unknown = null;

  async function dispatch(task: LeasedTask): Promise<void> {
    const brief = task.brief as Brief;

    // What the run read and where it may read further, fetched once: the
    // assignment and the citation gate must judge against the same ground, or
    // a role could be licensed one set of roots and graded on another.
    const material = materialFor(store, task.run);
    const groundRoots = material.length > 0 ? groundRootsFor(store, task.run) : [];

    // What is about to run this, recorded before it runs. A
    // claim about what a run demonstrated is only as good as the record of what
    // executed it, and a host that will not say is written down as not saying
    // rather than left blank — the cost-0-is-not-free precedent, applied to
    // model identity.
    const model = host.model ?? null;
    const modelTier = host.modelTier?.(model ?? undefined) ?? null;
    appendWorkLog(store, {
      run: task.run,
      task: task.id,
      role: task.role,
      action: 'role-dispatched',
      detail: {
        host: host.name,
        attempt: task.token,
        model,
        modelTier,
        // What the role was told about why it is here. Recorded because a
        // deliverable that opens from a concern can only be read against the
        // evidence the role actually received, not the evidence it might have.
        engagement: brief.engagement ?? null,
      },
      at: options.clock(),
    });

    // An deliverable that does not sound like Construct must be traceable to the
    // user who asked for that, at the dispatch it shaped. Voice is bound
    // before the work, so this is the only place the record can be made.
    if (options.voice) {
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'voice-overridden',
        detail: { instruction: options.voice.instruction, source: options.voice.source },
        at: options.clock(),
      });
    }

    // Commitment 10's flagging half. A floor that is not met never stops the
    // dispatch — refusing would quietly make the free local-model path unusable
    // for the work it was chosen for — but it is recorded loudly, so nothing
    // downstream can cite this deliverable without the qualification travelling
    // with it. STRATEGY's degrade-loudly, at the one seam that can see both the
    // brief's declaration and the host's answer.
    const floor = brief.modelFloor ?? 'any';
    if (!meetsFloor(modelTier, floor)) {
      degraded += 1;
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'model-floor-degraded',
        detail: {
          floor,
          model,
          modelTier,
          why: modelTier
            ? `brief declares a "${floor}" floor; ${model ?? 'the host default'} is tier "${modelTier}"`
            : `brief declares a "${floor}" floor and the host did not say what tier ${model ?? 'its default'} is — silence is not compliance`,
        },
        at: options.clock(),
      });
    }

    // The model matrix's honesty half: a family without tuning evidence runs,
    // but every such dispatch is recorded best-effort so no later claim quotes
    // its deliverable as if the producer prompts were validated for it. A host
    // that stays silent about tuning is recorded the same way — an unmeasured
    // family is best-effort, never assumed tuned.
    const tuning = host.modelTuning?.(model ?? undefined) ?? null;
    if (!tuning?.tuned) {
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'model-untuned-best-effort',
        detail: {
          model,
          family: tuning?.family ?? null,
          note:
            'best-effort: producer prompts are not validated against this model ' +
            'family; output shape and citation habits are unmeasured for it, and ' +
            'any claim about this run carries that qualification',
        },
        at: options.clock(),
      });
    }

    // Commitment 14's second half: the write surface a role reaches back
    // through. The bearer goes to the adapter as env for the role's serving
    // process (see roleenv.ts) — NEVER into the assignment text, which crosses
    // into the host as an argv and lands in its transcript store. The log
    // entry records that a token was issued and its scope; the bearer string
    // itself is a secret and a log is not a vault (same rule as rolewrite.ts).
    let roleEnv: Record<string, string> | undefined;
    if (options.capabilitySecret !== undefined) {
      const capabilityToken = issueRoleToken(
        {
          run: task.run,
          task: task.id,
          role: task.role,
          expiresAt: task.leaseUntil,
          // task.token is the lease fence (attempt number), so a re-dispatch
          // after a crashed lease mints a distinguishable token.
          nonce: String(task.token),
        },
        options.capabilitySecret,
      );
      roleEnv = buildRoleEnv({ token: capabilityToken, run: task.run, task: task.id });
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'capability-issued',
        detail: { grants: ROLE_GRANTS, expiresAt: task.leaseUntil, attempt: task.token },
        at: options.clock(),
      });
    }

    let result: HostResult;
    try {
      result = await host.invoke(
        {
          role: task.role,
          // The assignment must agree with what was actually minted: roleEnv is
          // the same value that decides whether the host registers a surface at
          // all, so the two cannot drift apart.
          task: assignmentFor(brief, catalog, {
            writeSurface: roleEnv !== undefined,
            voice: options.voice,
            // What the run read is a fact the store already holds, so the
            // assignment asks it rather than taking a caller's word. A run
            // that read nothing hands back an empty list and the role is told
            // the no-material rule instead.
            material,
            groundRoots,
          }),
        },
        { invocationId: task.id, roleEnv },
      );
    } catch (error) {
      result = {
        id: task.id,
        status: 'error',
        output: null,
        error: { message: (error as Error).message, name: (error as Error).name },
      };
    }

    const settledAt = options.clock();
    try {
      if (result.status === 'ok') {
        const cost = spendOf(result);
        if (!cost.reported) costSilent += 1;
        completeTask(store, {
          id: task.id,
          owner: task.leaseOwner,
          token: task.token,
          result: result.output,
          spend: cost.spend,
          spendReported: cost.reported,
          at: settledAt,
        });
        completed += 1;
        settled.push(task.id);
        appendWorkLog(store, {
          run: task.run,
          task: task.id,
          role: task.role,
          action: 'role-reported',
          detail: { ...summarize(result), spend: cost.spend, spendReported: cost.reported },
          at: settledAt,
        });

        // Commitment 13's free half, run at the one moment the deliverable and
        // its brief are both in hand. A structural pass says the work was
        // shown, never that it is good, and a challenge with no structural
        // form is left unanswered rather than passed — recorded as such, so a
        // brief's declared control is never satisfied by nobody looking.
        const deliverableText = deliverableTextOf(store, task.id, result.output);
        const declaredChallenges = brief.challenges ?? [];
        if (deliverableText === null && declaredChallenges.length > 0) {
          // Nothing readable to check. Recorded as unanswered — a check that
          // cannot see its subject must never report a pass, whatever the
          // cause, or the promotion state becomes an assurance nobody made.
          appendWorkLog(store, {
            run: task.run,
            task: task.id,
            role: 'construct',
            action: 'challenge-unanswered',
            detail: {
              unanswered: declaredChallenges.map((challenge) => ({
                challenge,
                reason: 'the deliverable is not readable as text, so nothing could be checked',
              })),
            },
            at: settledAt,
          });
        }
        if (deliverableText !== null && declaredChallenges.length > 0) {
          const run = runStructuralChallenges(brief, deliverableText, { groundRoots });
          for (const check of run.results) {
            recordVerdict(store, {
              task: task.id,
              challenge: check.challenge,
              outcome: check.passed ? 'passed' : 'failed',
              // Named for what it is: a free deterministic check, not a role
              // and not a person. A reader must be able to tell at a glance
              // which verdicts cost a judgement and which cost nothing.
              by: 'construct:structural',
              at: settledAt,
              // What was looked for and what was found. A bare pass tells the
              // role nothing it can act on when the next one fails.
              detail: { check: check.detail },
            });
          }
          if (run.unanswered.length > 0) {
            appendWorkLog(store, {
              run: task.run,
              task: task.id,
              role: 'construct',
              action: 'challenge-unanswered',
              detail: { unanswered: run.unanswered },
              at: settledAt,
            });
          }
        }

        // What was flagged, and what needs a licensed human. Separate entries
        // rather than fields on the report above, because these are the two
        // lines of the log a user reads on their own — burying them inside a
        // detail blob would make them technically present and practically not.
        for (const concern of deliverableConcerns(result.output)) {
          flagged += 1;
          appendWorkLog(store, {
            run: task.run,
            task: task.id,
            role: task.role,
            action: 'deliverable-flagged',
            detail: concern,
            at: settledAt,
          });
        }

        // Where this deliverable stands on the reliance axis, written down at
        // the moment it settled. A role that just reported is not thereby
        // finished with anything — commitment 14 — and the only honest place to
        // say so is the log the user actually reads. Derived, never set: see
        // run/promotion.ts.
        logPromotion(store, task.id, settledAt);

        const review = licensedReviewFor(task.role, catalog);
        if (review) {
          escalated += 1;
          appendWorkLog(store, {
            run: task.run,
            task: task.id,
            role: task.role,
            action: 'licensed-review-required',
            detail: {
              profession: review,
              why: `${task.role} output is issue-spotting, not advice — review by a licensed ${review} is required before anyone relies on it`,
            },
            at: settledAt,
          });
        }
        return;
      }

      failTask(store, {
        id: task.id,
        owner: task.leaseOwner,
        token: task.token,
        error: result.error ?? { status: result.status },
        at: settledAt,
      });
      failed += 1;
      settled.push(task.id);
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'role-failed',
        detail: { status: result.status, error: result.error },
        at: settledAt,
      });
    } catch (error) {
      if (!(error instanceof StaleLeaseError)) throw error;
      // Another worker finished this task while this one was still running. Its
      // result is dropped, not merged: the task is done exactly once, and the
      // takeover is recorded so the wasted invocation is visible rather than
      // silently absorbed.
      staleSettles += 1;
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'settle-dropped-stale-lease',
        detail: { attempt: task.token, reason: error.message },
        at: settledAt,
      });
    }
  }

  for (;;) {
    if (fatal !== null) break;

    if (totalSpend(store) >= options.spendCeiling) {
      halted = 'spend-ceiling';
      break;
    }

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
      continue;
    }

    const now = options.clock();
    const task = claimTask(store, {
      owner: options.owner,
      leaseUntil: deadline(now, leaseMs),
      now,
      run: options.run,
    });

    if (!task) {
      if (inFlight.size === 0) break;
      await Promise.race(inFlight);
      continue;
    }

    dispatched += 1;
    // attempts > 1 means this task had been claimed before and its lease ran
    // out — a crashed run, returning to circulation.
    if (task.token > 1) {
      recovered += 1;
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'lease-recovered',
        detail: { attempt: task.token },
        at: now,
      });
    }

    const running = dispatch(task)
      .catch((error: unknown) => {
        fatal ??= error;
      })
      .finally(() => inFlight.delete(running));
    inFlight.add(running);
  }

  await Promise.all(inFlight);
  if (fatal !== null) throw fatal;

  const conflicts = frameConflicts(store, settled, options);

  const spendAfter = totalSpend(store);
  if (halted !== null) {
    appendWorkLog(store, {
      run: options.run ?? 'all',
      role: 'construct',
      action: 'dispatch-halted',
      detail: { reason: halted, spend: spendAfter, ceiling: options.spendCeiling },
      at: options.clock(),
    });
  }

  return {
    dispatched,
    completed,
    failed,
    settled,
    staleSettles,
    recovered,
    flagged,
    escalated,
    degraded,
    conflicts,
    spendBefore,
    spendAfter,
    spendCeiling: options.spendCeiling,
    costSilent,
    halted,
  };
}
