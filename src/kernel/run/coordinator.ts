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
import { getSource, sourceDeclaration, sourceReadsFor } from '../store/sources.ts';
import { planFor } from '../store/plans.ts';
import { unheadedSlots } from '../plan/ladder.ts';
import { operationalLessonsFor } from '../lessons/admission.ts';
import { groundRootsFor } from './sourcereads.ts';
import { ANSWER_THE_ASK, ROLE_OWNERSHIP_BOUND, groundedMaterialProtocol } from './grounding.ts';
import type { DeclaredSource, Material } from './grounding.ts';
import type { Store } from '../store/open.ts';
import type { HostAdapter, HostResult } from '../hosts/interface.ts';
import type { Brief } from '../brief/schema.ts';
import { meetsFloor } from '../brief/tiers.ts';
import { DOMAINS, domainsByName } from '../implication/domains.ts';
import type { Domain } from '../implication/domains.ts';
import { deliverableConcerns, licensedReviewFor } from './accountability.ts';
import { STANCE_PROTOCOL, frameConflict, parseStance } from './conflicts.ts';
import { ASK_PROTOCOL, answeredAsksFor, frameAsk, parseAsk } from './asks.ts';
import { answerDirective } from './ask.ts';
import { RESEARCH_PROTOCOL } from './research.ts';
import type { AnsweredAsk } from './asks.ts';
import type { RoleStance } from './conflicts.ts';
import { DRAFT_ACTION, latestDraft, logPromotion, recordVerdict } from './promotion.ts';
import {
  REPAIR_ACTION,
  repairAssignment,
  repairIsAnImprovement,
  repairableFailures,
} from './repair.ts';
import type { DraftAttempt } from './repair.ts';
import { challengeById, runStructuralChallenges } from '../challenge/catalog.ts';
import { getDecision, openDecisions as openDecisionsFor, raiseDecision } from '../store/decisions.ts';
import { ROLE_GRANTS, issueRoleToken } from '../capabilities/tokens.ts';
import { buildRoleEnv } from './roleenv.ts';
import { NO_WRITE_SURFACE_NOTE, WRITE_SURFACE_PROTOCOL } from './rolewrite.ts';
import { playbookFor } from '../plan/playbooks.ts';
import { lensForDomain } from '../plan/lenses.ts';
import { skillsDirective, skillsOffered } from '../skills/reach.ts';
import type { SkillsReachable } from '../skills/reach.ts';
import { standardsFor } from '../plan/standards.ts';
import { gateObligation } from '../plan/gates.ts';
import type { GroundGates, RepoManifest } from '../plan/gates.ts';
import { constructIdentity, contentShapeProtocol } from '../voice/voice.ts';
import type { VoiceOverride } from '../voice/voice.ts';
import { VOICE_OVERRIDE_ACTION } from './voicerecord.ts';

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
   * Total spend allowed for this invocation, in the host's own cost units,
   * measured over what this call dispatches rather than over the store's
   * lifetime. Reaching it halts dispatch; it does not kill work already in
   * flight. A host that reports no cost cannot be bound by it.
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
  /**
   * Whether a deliverable that fails a free structural check goes back to its
   * author once before the run keeps it. Defaults to on: the checks exist to
   * catch work the brief asked for and did not get, and a run that records that
   * finding without acting on it has moved the unfinished work to the reader.
   * Off is for a caller that wants the first attempt exactly as it arrived.
   */
  readonly repair?: boolean;
  /**
   * What a declared ground root says it checks about itself, read by the
   * caller because the kernel reads no filesystem — the same reason the clock
   * is injected. Called once per root of the run being dispatched, and never
   * on a path the workspace did not declare as ground.
   *
   * Absent means no gate is discovered and every lens obligation names its
   * standard instead, which is the honest fallback rather than a silence.
   */
  readonly manifests?: (root: string) => RepoManifest | null;
  /**
   * What the portable method library on this machine can offer a role, read by
   * the caller for the same reason manifests are: the surface that owns paths
   * does the looking. Called once per invocation, not once per dispatch, since
   * every role in one run reaches the same two directories.
   *
   * Absent means nobody looked, and the assignment says nothing about method
   * skills at all. That is different from looking and finding none, which is
   * said plainly, and the difference is why this is not defaulted here.
   */
  readonly skills?: () => SkillsReachable;
}

export interface RunReport {
  readonly dispatched: number;
  readonly completed: number;
  readonly failed: number;
  /** Inbox decisions raised for required slots the deliverables never filled. */
  readonly slotGapsRaised: number;
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
  /** Deliverables in domains naming a licensed profession, so the referral duty stays visible. */
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
 * The deliverable is a work product, not a restated gap. The playbook
 * template's slots make its coverage checkable, and the template's declared
 * form says what shape the content takes. Missing information becomes a
 * labeled assumption the work proceeds on; it is never a reason to withhold
 * the deliverable.
 *
 * The form used to be fixed here at "numbered issues", which is right for an
 * issue-spotting review and wrong for everything else the catalog produces: a
 * PRD, a strategy review, and a sequencing plan were each told to number their
 * issues by a directive that had never read their template. The template
 * declares the form now, and the words for it live with the voice.
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
    `${contentShapeProtocol(template.form)}\n\n`
  );
}

/**
 * What a role is told when no lens equips its domain — spoken plainly instead
 * of the silence this used to be. Silence is not a smaller instruction here,
 * it is the missing one: a role handed nothing has no way to tell "no lens"
 * from "a lens with nothing extra to add", and neither does the reader of
 * what it writes — improvisation reads exactly like a governed method unless
 * something says otherwise.
 *
 * `statesObligation` is false for an ask (see lensDirective below): an ask
 * answers in prose with no template and no section for the method slot to
 * land in, so it hears the absence but not the instruction to write a
 * section about it. It still reaches the reader either way — an ask's
 * limits are shown the same way a work product's are, through
 * run/accountability.ts's limitsFor, which is recorded independently of
 * what either of these two paragraphs asks the role to say.
 */
function noLensDirective(statesObligation: boolean): string {
  const absence =
    'No lens equips this concern: no established question set, no extra ' +
    'deliverable obligations, and no escalation ladder are declared for it. ' +
    'Work it from your own domain knowledge and the material at hand. That ' +
    'is improvisation against the shared default playbook, not a smaller ' +
    'version of a named method, and it is not worse for being that; the ' +
    'reader decides. Do not write as though a lens shaped this work.\n\n';
  const section = statesObligation
    ? 'Say this plainly in the method section your template names below: ' +
      'that this concern has no owning lens, and specifically what a lens ' +
      'would otherwise have supplied (its question set, its extra ' +
      'deliverable obligations, its escalation ladder). State it once, ' +
      'without apology and without claiming the improvised approach is ' +
      'equivalent to a named method.\n\n'
    : '';
  return absence + section;
}

/**
 * The role's lens, spoken before the work: posture, the question set the role
 * works through, when to escalate, the stated depth limit, and any standing
 * label or jurisdiction boundary. Depth a role was never shown is depth it
 * cannot apply, and the same is true of a limit: a ceiling the role never reads
 * is a claim in a data file, not a boundary on the work. The lens is data
 * (plan/lenses.ts) so what a role knows is committed and testable rather than
 * living in whoever last edited a prompt.
 *
 * The lens's obligation is spoken here too, because it is the same kind of
 * fact: what this work has to satisfy before anyone relies on it. Where the
 * declared ground already runs a check for the concern, the obligation names
 * that script; where it does not, it names the standard. It is never silent.
 *
 * `statesObligation` is false for a dispatch that owes an answer rather than a
 * work product. An answer has no section for an obligation and no work for a
 * gate to run against, and telling it to fill one would name a heading its
 * template does not have.
 */
function lensDirective(role: string, ground: GroundGates, statesObligation: boolean): string {
  const lens = lensForDomain(role);
  if (!lens) return noLensDirective(statesObligation);
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
  const ceiling = lens.ceiling ? `The limit of this role, which is the invariant and not a gap: ${lens.ceiling}\n` : '';
  // The lens's standards, spoken so the role can cite the standard where the
  // standard speaks. What a standard currently says is checked against the
  // standard itself, never assumed from its name here.
  const standardsRecord = standardsFor(lens.lens);
  const standards =
    standardsRecord && standardsRecord.refs.length > 0
      ? 'Your method descends from these standards; cite them where they speak, ' +
        'and verify what they currently say before quoting them:\n' +
        standardsRecord.refs
          .map((r) => `- ${r.name} (${r.publisher}): ${r.contributes}`)
          .join('\n') +
        '\n'
      : '';
  // What the declared repository already checks for this lens's concern, or
  // the standard where it checks nothing. Empty for a lens that states no
  // gate concern at all.
  const obligation = statesObligation ? gateObligation(lens.lens, ground) : '';
  return (
    `Your posture: ${lens.posture}\n\n` +
    `${ROLE_OWNERSHIP_BOUND}\n\n` +
    `${ANSWER_THE_ASK}\n\n` +
    'Work through these questions against the material; each finding cites what supports it:\n' +
    `${questions}\n\n` +
    'Escalate rather than push past your remit:\n' +
    `${escalation}\n` +
    standards +
    ceiling +
    labeling +
    jurisdictions +
    (obligation === '' ? '' : `\n${obligation}`) +
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

/**
 * What the user said the sources behind this run are, once each and in the
 * order they were read. Only sources the run actually read appear: a
 * declaration about ground no dispatch touched describes nothing the role is
 * holding. A source nobody described is absent rather than defaulted, because
 * a tier this system picked would read to the role exactly like one the user
 * stated.
 */
export function declaredSourcesFor(store: Store, run: string): DeclaredSource[] {
  const seen = new Set<string>();
  const declared: DeclaredSource[] = [];
  for (const read of sourceReadsFor(store, run)) {
    if (seen.has(read.source)) continue;
    seen.add(read.source);
    const declaration = sourceDeclaration(store, read.source);
    if (!declaration) continue;
    declared.push({
      source: read.source,
      locator: getSource(store, read.source)?.locator ?? read.source,
      ...declaration,
    });
  }
  return declared;
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
    /**
     * What the user declared those sources to be. Absent means nobody has
     * said, and the role is told nothing rather than told a default.
     */
    readonly declarations?: readonly DeclaredSource[];
    /**
     * What the portable method library on this machine can offer this role.
     * Absent means nobody looked and nothing is said about method skills;
     * present with no offers means the machine was read and holds none, which
     * is said plainly so a deliverable cannot cite a method that was never
     * there.
     */
    readonly skills?: SkillsReachable;
    /**
     * What those roots declare they check about themselves, as a host read
     * them. Absent means nothing was read, and every obligation falls back to
     * its standard — the honest state, not a broken one.
     */
    readonly manifests?: readonly RepoManifest[];
    /** Requirements the user already answered for this run. */
    readonly answers?: readonly AnsweredAsk[];
    /**
     * Admitted operational lessons from the run's workspace. Standing team
     * context, spoken so a role builds on what earlier work already settled
     * instead of re-deriving or contradicting it. Never evidence: a lesson is
     * cited [cite:lesson], and a finding still needs material behind it.
     */
    readonly lessons?: readonly string[];
    /**
     * The workspace's engagement mode. 'seat' changes the role's standing:
     * Construct fills one seat on the user's human team, the user's own
     * tracker and documents are the system of record, and every change the
     * deliverable recommends is a proposal addressed to a named human owner —
     * never described as done, applied, or decided. 'team' (or absent) is the
     * whole-team default and adds nothing.
     */
    readonly mode?: 'team' | 'seat';
  } = {},
): string {
  const domain = domainsByName(catalog).get(brief.role);
  // One identity instruction, not two. The role frames the work and the voice
  // writes it, and a dispatch that stated them separately was handing the model
  // two answers to the same question.
  const identity = constructIdentity({
    framedBy: brief.role,
    concern: domain?.concern,
    voice: options.voice,
  });
  // Why this role is here, in the words the record holds. A role that knows
  // which concern fired can open from it; one that does not has to guess at
  // its own remit, and the evidence was sitting in the brief the whole time.
  const engagement = brief.engagement
    ? `You were engaged because: ${brief.engagement.evidence.join(' ')}\n` +
      `(${howEngaged(brief.engagement.inferredBy)})\n` +
      'This is the tool telling you why it involved you — not the user\'s own ' +
      'words, and not the outcome. If you quote it, cite it as ' +
      '[cite:engagement], never as [cite:outcome] or [cite:outcome brief]: the ' +
      "outcome above is the user's material, this is the tool's inference " +
      'about it, and the two are not interchangeable evidence.\n\n'
    : '';
  // Whether the role holds its writes is a fact about THIS dispatch, so the
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
      ? groundedMaterialProtocol(options.material, options.groundRoots ?? [], options.declarations ?? [])
      : MATERIAL_PROTOCOL;
  // The acquisition ladder's second rung, defined where the role can read it.
  // Spoken on every dispatch rather than only when a gap appears, because the
  // role discovers the gap mid-work and there is no second turn in which to
  // tell it the rules for what it is about to do.
  const research = RESEARCH_PROTOCOL;
  // Settled requirements reach every later dispatch of the run: an answer
  // given once is a decision to build on, not a suggestion to reconsider.
  const answered =
    options.answers && options.answers.length > 0
      ? 'The user has already answered these questions for this run. Each ' +
        'answer is a decision — build on it and cite it as [cite:user answer]:\n' +
        options.answers.map((a) => `- ${a.question}\n  answer: ${a.answer}`).join('\n') +
        '\n\n'
      : '';
  // A question and an outcome are answered by the same role reading the same
  // material, and they owe different things. An ask owes an answer with its
  // sources; it does not owe a work product, and it must not be asked for a
  // stance — the stance protocol exists so two roles can disagree in a shape
  // the kernel can frame into a decision, and there is no second role in an
  // ask. Asking anyway would put a position in the record that nothing will
  // ever be weighed against.
  // The workspace's memory, before the material: what the team already
  // learned frames how the material is read, and a role that contradicts a
  // standing lesson without noticing wastes the store that held it.
  const remembered =
    options.lessons && options.lessons.length > 0
      ? 'What this workspace already remembers — operational lessons admitted ' +
        'from earlier work. Build on them; if one shapes a conclusion, cite it ' +
        'as [cite:lesson]. A lesson is standing context, never evidence: a ' +
        'finding still cites the material that supports it, and a lesson the ' +
        'material now contradicts is worth saying so about rather than ' +
        'silently following.\n' +
        options.lessons.map((l) => `- ${l}`).join('\n') +
        '\n\n'
      : '';
  // The seat posture, spoken only when the workspace chose it. In seat mode a
  // deliverable that narrates changes as made is not a smaller error than a
  // wrong finding — it forges a human act into a system of record.
  const seat =
    options.mode === 'seat'
      ? 'Engagement mode: seat. You fill one seat on the user\'s human team; ' +
        'you are not the team. Their tracker and documents are the system of ' +
        'record. Every change you recommend is a proposal addressed to a named ' +
        'human owner — write "propose", never "done", "applied", or "decided". ' +
        'Where the material shows a team convention that differs from your ' +
        'default, the team\'s convention wins.\n\n'
      : '';
  const asking = brief.question !== undefined;
  return (
    `${identity}\n\n` +
    (asking
      ? `The question the user asked: ${brief.question}\n\n`
      : `The outcome the user asked for: ${brief.outcome}\n\n`) +
    engagement +
    seat +
    remembered +
    lensDirective(
      brief.role,
      { roots: options.groundRoots ?? [], manifests: options.manifests ?? [] },
      !asking,
    ) +
    (options.skills ? skillsDirective(options.skills) : '') +
    (asking ? answerDirective() : workProductDirective(brief.role)) +
    material +
    '\n\n' +
    research +
    '\n\n' +
    obligations +
    answered +
    `${surface}\n\n` +
    (asking ? '' : `${STANCE_PROTOCOL}\n\n`) +
    ASK_PROTOCOL
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
      // The deliverable of record, not the reply — the same rule the challenge
      // checks already follow, for the same reason. A role that submits its
      // draft through the write surface and replies with a summary restates its
      // stance word there and drops the BECAUSE and CITE lines with it. Reading
      // the reply then framed that role's position with no reason and no
      // citation while its deliverable carried both, which is the one thing
      // commitment 11 asks of a framed conflict. Observed on a live run: the
      // security role cited three files and reached the inbox uncited.
      const declared = parseStance(deliverableTextOf(store, task.id, task.result));
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
  let slotGapsRaised = 0;
  const settled: string[] = [];

  const inFlight = new Set<Promise<void>>();
  // A dispatch that throws something other than a stale lease means the store
  // itself is unusable. It is captured rather than left to reject on its own,
  // because an unattended rejection would surface as an unhandled promise while
  // the loop was awaiting a different one — the error must arrive after the
  // in-flight work settles, not instead of it.
  let fatal: unknown = null;

  // What the portable method library on this machine can offer the roles this
  // invocation dispatches, read once. Every role in one run reaches the same
  // two directories, so asking again per dispatch buys the same answer at a
  // cost per role. Null means nobody looked, which the assignment and the
  // record both distinguish from looking and finding nothing.
  const reachable = options.skills?.() ?? null;

  async function dispatch(task: LeasedTask): Promise<void> {
    const brief = task.brief as Brief;

    // What the run read and where it may read further, fetched once: the
    // assignment and the citation gate must judge against the same ground, or
    // a role could be licensed one set of roots and graded on another.
    const material = materialFor(store, task.run);
    const groundRoots = material.length > 0 ? groundRootsFor(store, task.run) : [];
    // What the user says that ground is. Read here beside the material so the
    // declaration and the documents it describes reach the role together.
    const declarations = material.length > 0 ? declaredSourcesFor(store, task.run) : [];
    // What those roots declare they already check. Read through the injected
    // reader so the kernel stays off the filesystem, and only over roots the
    // workspace declared — a manifest sitting beside this process says nothing
    // about the user's work.
    const readManifest = options.manifests;
    const manifests: RepoManifest[] = [];
    if (readManifest) {
      for (const root of groundRoots) {
        const manifest = readManifest(root);
        if (manifest) manifests.push(manifest);
      }
    }

    // The workspace's admitted memory, resolved through the run's own plan so
    // the dispatch and the record agree on which workspace was consulted. A
    // run predating recorded workspaces reads the default one, which is where
    // every pre-existing lesson lives.
    const plan = planFor(store, task.run);
    const workspace = plan?.workspace ?? 'default';
    const lessons = operationalLessonsFor(store, workspace);
    if (lessons.length > 0) {
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'lessons-briefed',
        detail: { workspace, lessons: lessons.map((l) => l.id) },
        at: options.clock(),
      });
    }

    // What is about to run this, recorded before it runs. A
    // claim about what a run demonstrated is only as good as the record of what
    // executed it, and a host that will not say is written down as not saying
    // rather than left blank — the cost-0-is-not-free precedent, applied to
    // model identity.
    const model = host.model ?? null;
    const modelTier = host.modelTier?.(model ?? undefined) ?? null;
    // Resolved once and recorded on the dispatch itself, not only on the
    // best-effort note below. A host that names no model can still name the
    // family it belongs to, and a log that records the family only when tuning
    // is absent cannot answer "what ran this?" for the runs that went well —
    // which are exactly the runs a later claim quotes.
    const tuning = host.modelTuning?.(model ?? undefined) ?? null;
    // What method governs this dispatch, resolved once and recorded here on
    // every dispatch — not only when it is absent — for the same reason model
    // family is recorded on every dispatch and not only when untuned: "what
    // ran this?" and "under what method?" both need an answer on the runs
    // that went well, which are exactly the runs a later claim quotes.
    const lens = lensForDomain(task.role);
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
        modelFamily: tuning?.family ?? null,
        modelTuned: tuning?.tuned ?? null,
        lens: lens?.lens ?? null,
        // What the role was told about why it is here. Recorded because a
        // deliverable that opens from a concern can only be read against the
        // evidence the role actually received, not the evidence it might have.
        engagement: brief.engagement ?? null,
        // What the role was told its ground is, in the tiers that were standing
        // when it was told. A declaration can be restated afterwards, and the
        // reader surfaces show what a source is now; this is where what it was
        // at dispatch stays readable, so neither question has to be answered
        // from the other's evidence.
        declared: declarations.map((d) => ({
          source: d.source,
          authority: d.authority,
          sensitive: d.sensitive,
        })),
      },
      at: options.clock(),
    });

    // An deliverable that does not sound like Construct must be traceable to the
    // user who asked for that, at the dispatch it shaped. Voice is bound
    // before the work, so this is the only place the record can be made — and
    // it is the record composing reads back, so the document a run produces is
    // written in the voice its deliverables were.
    if (options.voice) {
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: VOICE_OVERRIDE_ACTION,
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

    // The method half of commitment 15, run at the same seam as the model
    // floor and tuning checks above: a fact about this dispatch that changes
    // what a reader may conclude from its deliverable, recorded whether or
    // not anyone reads the deliverable's own method section. A concern no
    // lens equips gets no question set, no extra deliverable obligations, and
    // no escalation ladder — the dispatch works from the shared default
    // playbook instead, and that is improvisation, not a quieter method.
    // run/accountability.ts's limitsFor reads this action back so the fact
    // reaches the reader beside the deliverable, the same as the two checks
    // above.
    if (!lens) {
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'lens-absent',
        detail: {
          domain: task.role,
          note:
            'no lens equips this concern: no question set, no extra deliverable ' +
            'obligations, and no escalation ladder are declared for it. This ' +
            'dispatch works from the shared default playbook; its approach is ' +
            'improvised against that playbook, not drawn from an established ' +
            'method, and any claim from its deliverable carries that qualification.',
        },
        at: options.clock(),
      });
    }

    // What method the role could actually reach, written whether or not it
    // reaches for any of it. A deliverable naming a skill is checkable against
    // this line, and one produced on a machine holding none cannot read as
    // though the library had been at hand.
    if (reachable) {
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'skills-offered',
        detail: skillsOffered(reachable),
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
            declarations,
            manifests,
            answers: answeredAsksFor(store, task.run),
            lessons: lessons.map((l) => l.body),
            mode: plan?.mode,
            ...(reachable ? { skills: reachable } : {}),
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
          let structural = runStructuralChallenges(brief, deliverableText, { groundRoots });
          let attempt: DraftAttempt = 'first';

          // The repair round. A structural failure is the brief's own
          // obligation coming back unmet, and the run holds the role, the
          // host and the license needed to meet it. Sending it back once costs
          // a call; not sending it back moves the unfinished work to the
          // reader, who has less than the role had.
          const failures = repairableFailures(structural.results);
          if (failures.length > 0 && options.repair !== false) {
            const beforeSeq = latestDraft(store, task.id)?.seq ?? 0;
            appendWorkLog(store, {
              run: task.run,
              task: task.id,
              role: 'construct',
              action: REPAIR_ACTION,
              detail: { failing: failures.map((f) => f.challenge) },
              at: settledAt,
            });
            let repaired: HostResult;
            try {
              repaired = await host.invoke(
                {
                  role: task.role,
                  task: repairAssignment({
                    role: task.role,
                    deliverable: deliverableText,
                    failures,
                    groundRoots,
                  }),
                },
                { invocationId: task.id, roleEnv },
              );
            } catch (error) {
              // Fail-soft, the same shape the closing round takes: a repair
              // that could not run leaves the deliverable exactly as it
              // arrived, which is the state the run was already in. A second
              // attempt must never be able to cost the first.
              repaired = {
                id: task.id,
                status: 'error',
                output: null,
                error: { message: (error as Error).message, name: (error as Error).name },
              };
            }

            // Where the repaired text comes from depends on how the role
            // answered. A role holding a write surface submits a new draft and
            // the log carries it; one without replies in prose. Reading
            // whichever arrived is the difference between checking the second
            // attempt and re-checking the first — and re-checking the first
            // would record a verdict about a document nobody wrote.
            const after = latestDraft(store, task.id);
            const submitted = after !== null && after.seq > beforeSeq ? draftText(after.deliverable) : null;
            const repairedText =
              repaired.status === 'ok' ? (submitted ?? replyTextOf(repaired.output)) : null;

            if (repairedText !== null && repairedText.trim().length > 0) {
              const repairCost = spendOf(repaired);
              appendWorkLog(store, {
                run: task.run,
                task: task.id,
                role: task.role,
                action: 'role-reported',
                detail: {
                  ...summarize(repaired),
                  spend: repairCost.spend,
                  spendReported: repairCost.reported,
                  attempt: 'repaired',
                },
                at: settledAt,
              });

              // A repair that traded one failure for another is not a repair.
              // The first attempt is a known quantity; a swap is not an
              // improvement because it is newer, and the reader gets the better
              // of the two rather than the later of the two.
              const rechecked = runStructuralChallenges(brief, repairedText, { groundRoots });
              const better = repairIsAnImprovement(structural.results, rechecked.results);

              // Whichever draft the run keeps has to be the LATEST one, because
              // that is the only one anything downstream reads. A role holding a
              // write surface has already written its second attempt into the
              // log, so keeping the first means writing the first back — the log
              // is append-only and both attempts stay on it either way.
              const keep = better ? repairedText : deliverableText;
              const latestIsRepaired = submitted !== null;
              if (better !== latestIsRepaired) {
                appendWorkLog(store, {
                  run: task.run,
                  task: task.id,
                  role: task.role,
                  action: DRAFT_ACTION,
                  detail: { deliverable: keep, attempt: better ? 'repaired' : 'first' },
                  at: settledAt,
                });
              }

              if (better) {
                structural = rechecked;
                attempt = 'repaired';
              } else {
                appendWorkLog(store, {
                  run: task.run,
                  task: task.id,
                  role: 'construct',
                  action: 'repair-refused',
                  detail: {
                    kept: 'first',
                    was: repairableFailures(structural.results).map((f) => f.challenge),
                    now: repairableFailures(rechecked.results).map((f) => f.challenge),
                  },
                  at: settledAt,
                });
              }
            }
          }

          for (const check of structural.results) {
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
              // role nothing it can act on when the next one fails. The
              // attempt travels with it because "passed" and "passed once it
              // was sent back" are different facts about the same document.
              detail: { check: check.detail, attempt },
            });
          }
          if (structural.unanswered.length > 0) {
            appendWorkLog(store, {
              run: task.run,
              task: task.id,
              role: 'construct',
              action: 'challenge-unanswered',
              detail: { unanswered: structural.unanswered },
              at: settledAt,
            });
          }
        }

        // The acquisition ladder's last two rungs, run where the gap becomes
        // visible. The role already climbed the first two — it read the
        // declared sources and holds the research protocol — so a required
        // slot still unheaded here goes to the human as a batched decision,
        // and the ladder's rule that asking never blocks a draft is kept by
        // shipping each question with the assumed default the deliverable
        // stands on until the answer arrives.
        if (deliverableText !== null && brief.question === undefined) {
          // An ask owes an answer, not a work product; its prose has no
          // template and owes no sections, so the ladder never fires on it.
          const template = playbookFor(task.role).template;
          const gaps = unheadedSlots(template, deliverableText);
          if (gaps.length > 0) {
            // One decision per deliverable, not per slot. The first wiring
            // raised one per gap and a run of terse deliverables put
            // twenty-four near-identical questions in the inbox — a flood is
            // how an inbox stops being read. The whole set travels in one
            // question, and the ladder's rule holds: the ask ships with the
            // default the draft stands on, so asking never blocks it.
            const names = gaps.map((gap) => gap.slot.name);
            raiseDecision(store, {
              id: `${task.id}:sections`,
              run: task.run,
              question:
                `The ${template.deliverable} from ${task.role} left ` +
                `${String(names.length)} required section${names.length === 1 ? '' : 's'} ` +
                `unfilled: ${names.join(', ')}. Supply them, or accept the draft without?`,
              positions: [
                {
                  role: task.role,
                  stance: `delivered without: ${names.join(', ')}`,
                  citation: null,
                },
                {
                  role: 'assumed-default',
                  stance:
                    'the draft stands as delivered; any conclusion that would rest ' +
                    'on an absent section is treated as unsupported until it is supplied',
                  citation:
                    'the role recorded neither content nor an assumption for these sections',
                },
              ],
              raisedAt: settledAt,
            });
            slotGapsRaised += 1;
            appendWorkLog(store, {
              run: task.run,
              task: task.id,
              role: 'construct',
              action: 'slot-gaps-raised',
              detail: { deliverable: template.deliverable, slots: names },
              at: settledAt,
            });
          }
        }

        // The role's declared requirement, turned into an inbox decision by
        // the kernel (commitment 14) — at most one open ask per run, so a
        // four-role run cannot turn the inbox into a questionnaire. A second
        // role's ask while one is open is recorded in the log and nowhere
        // else; the deliverable already proceeds on its stated assumption.
        const declaredAsk = parseAsk(deliverableText);
        if (declaredAsk) {
          const askId = `${task.id}:ask`;
          const openAsk = openDecisionsFor(store, task.run).some((d) => d.id.endsWith(':ask'));
          if (!getDecision(store, askId) && !openAsk) {
            raiseDecision(store, frameAsk({
              run: task.run,
              task: task.id,
              role: task.role,
              ask: declaredAsk,
              at: settledAt,
            }));
            appendWorkLog(store, {
              run: task.run,
              task: task.id,
              role: task.role,
              action: 'requirements-question-raised',
              detail: { question: declaredAsk.question, default: declaredAsk.assuming },
              at: settledAt,
            });
          } else if (!getDecision(store, askId)) {
            appendWorkLog(store, {
              run: task.run,
              task: task.id,
              role: task.role,
              action: 'ask-suppressed-open-question',
              detail: { question: declaredAsk.question, default: declaredAsk.assuming },
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
              why:
                `${task.role} output is research and issue-spotting, not advice; ` +
                `work that is practice (representation, filings, sign-off where ` +
                `real liability turns on an unsettled question) belongs to a licensed ${review}`,
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

    // What this invocation has spent, not what the store has spent since it
    // was created. The ceiling was applied to the lifetime total, so a store
    // that had ever run past the figure halted every later run at dispatch
    // before doing any work, and the printed line said "this run" about a
    // number covering every run there had ever been. A bound on a piece of
    // work has to be measured over that piece of work.
    if (totalSpend(store) - spendBefore >= options.spendCeiling) {
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
    slotGapsRaised,
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
