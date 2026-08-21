/**
 * cli/index.ts — the one CLI. Phase 0 surface: doctor, version. Phase 1 adds
 * cleanup. Commands stay few; capability grows in packs and kernel libraries,
 * not in CLI surface.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { resolvePaths, resolveSkillsDir } from '../kernel/paths.ts';
import { buildCleanupCatalog, projectTreeLitter } from '../kernel/cleanup/catalog.ts';
import type { SpawnFn } from '../kernel/cleanup/catalog.ts';
import { detectedItems, selectedItems, applyCleanup } from '../kernel/cleanup/run.ts';
import type { CleanupOptions } from '../kernel/cleanup/run.ts';
import { writeFileSync } from 'node:fs';
import { openStore, storePath, storeWriteProblem, StoreUnavailableError } from '../kernel/store/open.ts';
import type { Store } from '../kernel/store/open.ts';
import {
  backupDisclosure,
  backupLedgerPath,
  BackupRefusedError,
  checksumSidecar,
  takeBackup,
  verifyBackup,
} from '../kernel/store/backup.ts';
import { appendWorkLog, readWorkLog } from '../kernel/store/worklog.ts';
import {
  CAPABILITY_DENIED_ACTION,
  revocationOf,
  revokeRoleCapability,
} from '../kernel/run/rolewrite.ts';
import { readRunDispatch, recordRunDispatch } from '../kernel/store/dispatch.ts';
import {
  addSource,
  decideProposal,
  DOC_EDIT_KINDS,
  docsLocatorProblem,
  ENGAGEMENT_MODES,
  getProposal,
  pendingProposalCount,
  pendingProposals,
  proposeDocEdit,
  proposeWrite,
  setSourceShape,
  setWriteConsent,
  sourceShape,
  SURVEY_EMPHASES,
  engagementMode,
  getSource,
  retireSource,
  setEngagementMode,
  SOURCE_KINDS,
  sourceReadsFor,
  sourcesFor,
  writeConsentAllowsLowRisk,
} from '../kernel/store/sources.ts';
import {
  claimsDeliverable,
  docEditProposal,
  proposalsFrom,
  resolveFindingCitation,
} from '../kernel/run/proposals.ts';
import type { Deliverable } from '../kernel/run/proposals.ts';
import { auditProposals, evaluateGates, renderAuditDeliverable } from '../kernel/run/repoaudit.ts';
import { gatherRepoFacts } from '../hosts/repo/audit.ts';
import { compareAndRecordSourceReads, groundRootsFor, recordRunSourceReads } from '../kernel/run/sourcereads.ts';
import { groundReach, unreachableGroundMessage } from '../kernel/run/reachability.ts';
import type { SourceReadComparison, SourceSurvey } from '../kernel/run/sourcereads.ts';
import { DOCUMENT_CAP, documentWords, listDocuments, surveySource } from '../hosts/sources.ts';
import type {
  DocEditKind,
  EngagementMode,
  Source,
  SourceKind,
  SurveyEmphasis,
  WriteProposal,
} from '../kernel/store/sources.ts';
import { createHostDensifier } from '../hosts/densifier.ts';
import type { DensifiedIntake } from '../kernel/intake/densify.ts';
import type { DensifiedReply } from '../hosts/densifier.ts';
import { recordNote, resolveNoteCitation } from '../kernel/store/notes.ts';
import { externalReadsFor } from '../kernel/store/externalreads.ts';
import {
  addRecord,
  currentFields,
  fieldHistory,
  findRecord,
  getRecord,
  recordsFor,
} from '../kernel/store/records.ts';
import { applyContextLoop } from '../kernel/context/loop.ts';
import type { MemoryDelta, PropagationProposal, RecordUpdate } from '../kernel/context/loop.ts';
import { toProducedLoop } from '../kernel/context/produce.ts';
import { groundReadEvidence, toReviewedDrift } from '../kernel/context/review.ts';
import type { GroundReadEvidence } from '../kernel/context/review.ts';
import { subjectsOf } from '../kernel/context/subjects.ts';
import {
  claimsFrom,
  composeReadiness,
  screenComposition,
  standingLine,
  toComposition,
  unclearedSources,
} from '../kernel/run/compose.ts';
import type { ComposedClaim, SourceDeliverable, SourceStanding } from '../kernel/run/compose.ts';
import {
  createHostComposer,
  createHostGapCloser,
  createHostObjectionChecker,
  createHostPositionRepairer,
  createHostPositioner,
  createHostShapeChooser,
  createHostSupportChecker,
} from '../hosts/compose.ts';
import { closeGaps } from '../kernel/run/closing.ts';
import {
  COMPOSITION_SHAPES,
  shapeByName,
  shapeForOutcome,
  shapeMatchForOutcome,
  shapeNames,
} from '../kernel/run/shapes.ts';
import type { CompositionShape } from '../kernel/run/shapes.ts';
import {
  deliverableBody,
  renderAttribution,
  renderClaim,
  renderComposedClaim,
  renderDocument,
  renderHeading,
} from '../kernel/run/publish.ts';
import { attributionLine } from '../kernel/voice/voice.ts';
import { contestedFacts, contestedLine } from '../kernel/run/contested.ts';
import {
  collapseObjections,
  positionRepairIsAnImprovement,
  positionShortfalls,
  screenPosition,
  toPosition,
} from '../kernel/run/position.ts';
import type { PositionObjection, ScreenedPosition } from '../kernel/run/position.ts';
import type { ClosingReply, ClosingRound } from '../kernel/run/closing.ts';
import type { Brief } from '../kernel/brief/schema.ts';
import { eraseNote, eraseRecord } from '../kernel/store/erasure.ts';
import { applyProposal } from '../kernel/run/apply.ts';
import type { DeltaChallenge, ProducedLoop, ProducerSource } from '../kernel/context/produce.ts';
import { screenObservations } from '../kernel/context/observations.ts';
import type { DocumentWords, DriftCitation, ScreenResult } from '../kernel/context/observations.ts';
import {
  admissionDomainFor,
  decideAdmission,
  admissionOf,
  riskTierFor,
} from '../kernel/lessons/admission.ts';
import { distillDecisionLesson } from '../kernel/lessons/fromDecisions.ts';
import { recordLesson, getLesson, lessonsFor, type Lesson } from '../kernel/store/lessons.ts';
import {
  createHostApplier,
  createHostChallenger,
  createHostProducer,
  createHostReviewer,
} from '../hosts/contextloop.ts';
import { openDecisions, resolveDecision, getDecision, raiseDecision } from '../kernel/store/decisions.ts';
import { evaluateProfile, proposeStaffing, NOT_STAFFED } from '../kernel/staffing/profile.ts';
import type { StaffingProposal } from '../kernel/staffing/profile.ts';
import { countTasksByState, getTask, listTasks } from '../kernel/store/tasks.ts';
import { readFeedback } from '../kernel/store/feedback.ts';
import { harvestCorpus } from '../kernel/implication/harvest.ts';
import {
  recordVerdict,
  runOutcomeText,
  surfacedDomains,
  UnsurfacedVerdictError,
} from '../kernel/implication/verdict.ts';
import type { RecordedVerdict } from '../kernel/implication/verdict.ts';
import { startAskNamed, startRun, startRunNamed, startRunSelected } from '../kernel/run/outcome.ts';
import type { StartedRun } from '../kernel/run/outcome.ts';
import { highRiskNotice, primaryImplication } from '../kernel/run/ask.ts';
import type { Implication } from '../kernel/implication/map.ts';
import { storeNamingCache } from '../kernel/store/namings.ts';
import { DOMAINS } from '../kernel/implication/domains.ts';
import {
  declareStanding,
  dueStanding,
  firingsFor,
  lastFiredAt,
  listStanding,
  recordFiring,
  retireStanding,
} from '../kernel/store/standing.ts';
import { createHostNamer } from '../hosts/namer.ts';
import { DEFAULT_CONCURRENCY, frameConflicts, workRun } from '../kernel/run/coordinator.ts';
import { deliverableConcerns, licensedReviewFor, limitsFor } from '../kernel/run/accountability.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { hasCapability } from '../kernel/hosts/interface.ts';
import { dispatchFloorFor } from '../hosts/floors.ts';
import { architectureNoteFor } from '../hosts/architecture.ts';
import { loadOrCreateSecret, loadSecret } from '../kernel/capabilities/secretfile.ts';
import { readRoleEnv } from '../kernel/run/roleenv.ts';
import { serveRole } from './roleserve.ts';
import { serveProjection } from '../hosts/mcp/projection.ts';
import { gatherRepoEvidence, isFailure } from '../hosts/repo/evidence.ts';
import { readRepoManifest } from '../hosts/repo/gates.ts';
import { reconcileSession } from '../kernel/tracker/session-drift.ts';
import { listProjections } from '../kernel/store/projections.ts';
import { reconcileAll } from '../kernel/tracker/reconcile.ts';
import { driftDecisions } from '../kernel/tracker/reconcileDecisions.ts';
import { constructFindings, CONSTRUCT_GROUND } from '../kernel/watch/construct-ground.ts';
import { startWatch, sweepWatch, watchRun } from '../kernel/watch/watch.ts';
import { snapshotFromSurvey, sourceGroundLine, sourceWatchFindings } from '../kernel/watch/source-ground.ts';
import type { SourceSnapshot } from '../kernel/watch/source-ground.ts';
import {
  declareSourceWatch,
  dueSourceWatches,
  latestSourceWatchFiring,
  listSourceWatches,
  recordSourceWatchFiring,
  retireSourceWatch,
} from '../kernel/store/source-watches.ts';
import {
  DEFAULT_STALE_DRAFT_THRESHOLD_MS,
  latestDraft,
  promotionOf,
  staleUnreviewedDrafts,
  waiveChallenge,
} from '../kernel/run/promotion.ts';
import { buildPlan } from '../kernel/plan/planner.ts';
import { LENSES } from '../kernel/plan/lenses.ts';
import { allPlaybooks, playbookFor } from '../kernel/plan/playbooks.ts';
import { unheadedSlots } from '../kernel/plan/ladder.ts';
import { LENS_STANDARDS } from '../kernel/plan/standards.ts';
import {
  planSkillsUninstall,
  projectSkillsPack,
  skillPackSkew,
  SKILL_FILENAME,
  wrap as wrapSkillText,
  type SkillFolder,
} from '../kernel/skills/projection.ts';
import {
  foreignFolders,
  planSkillRemoval,
  sameSkillBytes,
  selectSkills,
  skillDescription,
  skillStatuses,
  skillVersion,
  type InstalledFolder,
  type SkillSource,
} from '../kernel/skills/library.ts';
import { synthesizeIssues } from '../kernel/run/synthesis.ts';
import { planFor, recordPlan } from '../kernel/store/plans.ts';
import type { Watch } from '../kernel/watch/watch.ts';
import { join } from 'node:path';
import { tuningStamp } from '../hosts/tuning.ts';
import { presenceLines, surveyHosts } from '../hosts/presence.ts';
import { probeDocling, readSource } from '../hosts/extract.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import {
  adapterForHost,
  HOST_NAMES,
  now,
  packageVersion,
  secretFile,
  terminalReport,
  withStore,
  withStoreAsync,
} from './runtime.ts';
import { driftGround, surveyDeclared } from './survey.ts';
import { groundingSummary, groundRun } from '../kernel/run/groundpass.ts';
import type { SourceSurveyor } from '../kernel/run/groundpass.ts';
import { runNoteLoop } from '../kernel/context/note-loop.ts';
import type { HostName } from './runtime.ts';
import {
  parseFlags,
  parseHostFlags,
  splitFlags,
  splitList,
  timeoutFlag,
  workspaceFlag,
} from './flags.ts';
import type { HostFlags } from './flags.ts';
import {
  citationList,
  failureLine,
  money,
  writeDrift,
  writeProposalRow,
  writeTotalFailureRecourse,
} from './present.ts';
import { backup, cleanup, doctor, parseCleanupArgs } from './maintenance.ts';
import { roleServe, serve } from './serve.ts';
import { skills } from './skills.ts';
import { parseCadence, renderCadence } from './cadence.ts';
import { outcome, planRun, reportRun } from './outcome.ts';
import { ask } from './ask.ts';
import { notes } from './notes.ts';
import { review } from './review.ts';
import { work } from './work.ts';

export { HOST_NAMES } from './runtime.ts';
export type { HostName } from './runtime.ts';
export { backup, cleanup, doctor, parseCleanupArgs } from './maintenance.ts';
export { skills } from './skills.ts';
export { outcome, parseOutcomeArgs } from './outcome.ts';
export type { OutcomeArgs } from './outcome.ts';
export { ask, parseAskArgs } from './ask.ts';
export type { AskArgs } from './ask.ts';
export { DEFAULT_MAX_NOTES, notes, parseNotesArgs } from './notes.ts';
export type { NotesArgs } from './notes.ts';
export { parseReviewArgs, review } from './review.ts';
export type { ReviewArgs } from './review.ts';
export { DEFAULT_SPEND_CEILING, parseWorkArgs, work } from './work.ts';
export type { WorkArgs } from './work.ts';












/**
 * How an entry's inference was reached, when that is not the free default
 *. Keyword inferences stay unannotated so the log does not grow
 * a column that says "normal" on almost every line; an entry that cost a model
 * call says so, because reading the log is how a user audits what was spent and
 * what an inference actually rests on.
 */
function howInferred(detail: unknown): string {
  const inferredBy = (detail as { inferredBy?: unknown } | null)?.inferredBy;
  if (inferredBy === 'namer') return '  (inferred by: namer — a model read the outcome)';
  if (inferredBy === 'cache') return '  (inferred by: cache — an earlier consultation for this outcome)';
  if (inferredBy === 'user') return '  (named by: the user — not inferred)';
  return '';
}

/**
 * The recorded reason on entries that carry one. The store holds the whole
 * detail; a failure or degradation line that reads as a bare action name
 * defeats the append-only record — the reason survived only in the terminal
 * that produced it. This stays a clause on the known reason-bearing kinds,
 * not a general detail dump: the log keeps one line per entry.
 */
export function reasonClause(action: string, detail: unknown): string {
  const d = detail as Record<string, unknown> | null;
  const s = (key: string): string | undefined =>
    typeof d?.[key] === 'string' && (d[key] as string).trim() !== '' ? (d[key] as string) : undefined;
  switch (action) {
    case 'namer-failed': {
      const failure = s('failure') ?? 'reason not recorded';
      const fellBackTo = s('fellBackTo');
      return `  — ${failure}${fellBackTo ? `; fell back to ${fellBackTo}` : ''}`;
    }
    case 'concern-unmet': {
      // The proposal's own words, not a paraphrase: the value of this line is
      // that a reader can see what the catalog was asked for and judge whether
      // it should carry it.
      const proposed = s('proposed') ?? 'unnamed';
      const reason = s('reason') ?? 'reason not recorded';
      const why = s('why');
      return `  — "${proposed}" (${reason})${why ? `: ${why}` : ''}`;
    }
    case 'namer-retried':
      return `  — first reply failed (${s('firstFailure') ?? 'unparseable'}); a corrective retry answered`;
    case 'model-untuned-best-effort':
      return `  — ${s('model') ?? 'model unknown'}: no tuning evidence for this family; output is best-effort`;
    case 'model-floor-degraded':
      return `  — ${s('why') ?? 'reason not recorded'}`;
    case 'extraction-refused':
      return `  — ${s('reason') ?? 'reason not recorded'}`;
    case 'role-failed':
      return `  — ${s('error') ?? s('status') ?? 'reason not recorded'}`;
    case 'dispatch-halted':
      return `  — ${s('reason') ?? 'reason not recorded'}`;
    case 'voice-overridden':
      return `  — ${s('instruction') ?? 'instruction not recorded'}`;
    default:
      return '';
  }
}

/**
 * The deliverable is the product, and until this command existed no surface
 * showed it: `work` reported "done" with the cost, `log` reported action
 * names, and the text a user paid for sat in the store readable only by hand.
 * A spine that ends at "done" without showing the work is missing its last
 * step.
 *
 * What it shows is the reader's view, the same one compose hands back. The
 * stored deliverable keeps every marker the gates read and this command
 * printed them verbatim, so the one surface a person reads a deliverable on
 * was the one place the record form reached them — "[unverified]" three times
 * down a page reads as evasion, and the sentence underneath is not evasive.
 * `--record` asks for the stored form, for anything checking the text rather
 * than reading it.
 */
export function show(argv: string[]): number {
  const runIndex = argv.indexOf('--run');
  const run = argv.find((a) => a.startsWith('--run='))?.slice('--run='.length)
    ?? (runIndex >= 0 ? argv[runIndex + 1] : undefined);
  const asRecord = argv.includes('--record');
  if (!run) {
    process.stderr.write('usage: construct show --run <id> [--record]\n');
    return 2;
  }

  return withStore((store) => {
    const tasks = listTasks(store, run);
    if (tasks.length === 0) {
      process.stdout.write(`no tasks for ${run}. Record an outcome first: construct outcome "<what you want>"\n`);
      return 0;
    }
    for (const task of tasks) {
      const draft = latestDraft(store, task.id);
      const promotion = promotionOf(store, task.id);
      const template = playbookFor(task.role).template;
      process.stdout.write(
        `\nConstruct · ${template.deliverable}, framed through ${renderAttribution(task.role)} — ${task.state}`,
      );
      if (promotion) process.stdout.write(` · ${promotion.state}`);
      const review = licensedReviewFor(task.role);
      if (review) {
        process.stdout.write(
          `\n  issue-spotting only: needs review by a licensed ${review} before you rely on it`,
        );
      }
      // What produced this, stated with it. A role with no lens has no
      // labeling rule of its own, so without this the untuned fact reached
      // nobody reading the deliverable — which is everybody who reads it.
      for (const limit of limitsFor(store, task.run, task.id)) {
        process.stdout.write(`\n  ${escapeForTerminal(limit.label)}`);
      }
      process.stdout.write('\n');
      // A draft submitted through the write surface is the deliverable of
      // record; a role whose host has no write-through leaves its reply in the
      // task result, and showing nothing there would hide real work.
      const deliverable = draft?.deliverable ?? task.result;
      if (deliverable === null || deliverable === undefined) {
        process.stdout.write('  (no deliverable was produced for this task)\n');
        continue;
      }
      if (!draft) process.stdout.write('  (from the role\'s reply; no draft was submitted)\n');
      const text = deliverableBody(deliverable);
      const body = escapeForTerminal(asRecord ? text : renderDocument(text))
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      process.stdout.write(`${body}\n`);
      const missing = unheadedSlots(template, text);
      if (missing.length > 0) {
        process.stdout.write(
          `  (${template.deliverable} asks for ${missing.map((g) => g.slot.name).join(', ')} ` +
            'and no section was headed there — a fact about this deliverable, not a reason it was withheld)\n',
        );
      }
    }

    // Two kinds of ground, named apart. What the survey walked is a document
    // this run can point at; what a role read through its host's own tools is
    // testimony Construct never saw and cannot check. Folding them into one
    // "grounded in" line would let the second borrow the first's standing.
    const external = externalReadsFor(store, run);
    if (external.length > 0) {
      process.stdout.write(
        `\nread outside the declared ground (${String(external.length)}), reported by the role ` +
          'and not verified by Construct:\n',
      );
      for (const read of external) {
        process.stdout.write(
          `  ${read.role}: ${escapeForTerminal(read.locator)}\n    took: ${escapeForTerminal(read.took)}\n`,
        );
      }
    }
    return 0;
  });
}

export function log(argv: string[]): number {
  const runIndex = argv.indexOf('--run');
  const run = runIndex >= 0 ? argv[runIndex + 1] : undefined;

  return withStore((store) => {
    const entries = readWorkLog(store, run);
    if (entries.length === 0) {
      process.stdout.write(run ? `no work log entries for ${run}\n` : 'work log is empty\n');
      return 0;
    }
    for (const entry of entries) {
      process.stdout.write(
        `${String(entry.seq).padStart(4)}  ${entry.at}  ${entry.role}  ${entry.action}` +
          `${howInferred(entry.detail)}${escapeForTerminal(reasonClause(entry.action, entry.detail))}\n`,
      );
    }
    process.stdout.write(`\n${entries.length} entries (append-only).\n`);
    writeRunState(store, run);
    return 0;
  });
}

/**
 * Where a run currently stands, under the event stream.
 *
 * The defect this closes: a run in flight and a run that died end at the SAME
 * log line. A failed task writes no event past `capability-issued`, and neither
 * does a task that is still executing — so the two are indistinguishable from
 * the stream alone. Found on a live, healthy run that was reasonably read as
 * hung, where telling them apart meant opening construct.db by hand.
 *
 * Why this lives on `log` rather than a new `construct status` verb. The user
 * whose confusion produced the bead reached for `construct log`, so answering
 * anywhere else costs a discovery step at exactly the moment someone is unsure
 * whether their run is broken. It also honours the project's preference for
 * extending an existing surface over adding one.
 *
 * The stream itself is untouched and stays append-only: this is a footer that
 * reads current task state, clearly separated from the events above it. Nothing
 * here mutates, and nothing polls — it is one read of what the store already
 * holds, which is the whole reason the CLI could have said it all along.
 */
/**
 * Denials of one grant by one role above which the count is worth a line.
 *
 * Three rather than one, because a single denial is a role discovering its
 * grants and a second is it confirming; a third is a loop. Set here rather
 * than tuned per surface, so the log and any later surface agree on what a
 * flood is.
 */
const DENIAL_FLOOD = 3;

function writeRunState(store: Store, run?: string): void {
  const tasks = listTasks(store, run);
  if (tasks.length === 0) return;

  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.state, (counts.get(task.state) ?? 0) + 1);

  const parts = [...counts.entries()].map(([state, n]) => `${String(n)} ${state}`);
  process.stdout.write(`${tasks.length} task(s): ${parts.join(', ')}.\n`);

  // A denial is the write surface working: a role reached for a grant it does
  // not hold and was told no. A *flood* of them is different information — it
  // is the run's own evidence that a role is fighting its grants, usually
  // retrying one call in a loop, and it was visible only to somebody who opened
  // the raw log already knowing to count. Counted here rather than reported per
  // event, because the individual denial is noise and the rate is the finding.
  const denials = new Map<string, number>();
  for (const entry of readWorkLog(store, run)) {
    if (entry.action !== CAPABILITY_DENIED_ACTION) continue;
    const detail = entry.detail as { grant?: unknown } | null;
    const grant = typeof detail?.grant === 'string' ? detail.grant : 'a grant it does not hold';
    denials.set(`${entry.role}:${grant}`, (denials.get(`${entry.role}:${grant}`) ?? 0) + 1);
  }
  const flooding = [...denials.entries()].filter(([, n]) => n >= DENIAL_FLOOD);
  if (flooding.length > 0) {
    for (const [who, n] of flooding) {
      const [role, grant] = who.split(':');
      process.stdout.write(
        `${role} was denied ${escapeForTerminal(grant)} ${String(n)} times — the surface held, and a role ` +
          'retrying one call that many times is reading the refusal as a transient error ' +
          'rather than as an answer.\n',
      );
    }
  }

  // A lease with time left is the one fact that separates "still working" from
  // "stopped", and it is the fact nobody could see. Report the deadline rather
  // than a remaining-time countdown, so the line does not imply it is watching.
  const leased = tasks.filter((t) => t.state === 'leased' && t.leaseUntil);
  const asOf = new Date().toISOString();
  const running = leased.filter((t) => (t.leaseUntil as string) > asOf);
  const expired = leased.filter((t) => (t.leaseUntil as string) <= asOf);
  if (running.length > 0) {
    const latest = running
      .map((t) => t.leaseUntil as string)
      .reduce((a, b) => (a > b ? a : b));
    process.stdout.write(
      `Still running — ${String(running.length)} task(s) hold a lease until ${latest}. ` +
        'Re-read this log rather than re-running work; work will not take a live lease.\n',
    );
  }
  // A lease is only evidence of work in flight while it has time left. A
  // coordinator that died after claiming leaves the row exactly as a healthy
  // one looks, and reporting the two the same way asked the reader to compare
  // a timestamp against the clock and do the arithmetic before they could tell
  // whether anything was happening.
  if (expired.length > 0) {
    const stalest = expired
      .map((t) => t.leaseUntil as string)
      .reduce((a, b) => (a < b ? a : b));
    process.stdout.write(
      `Stopped — ${String(expired.length)} task(s) hold a lease that expired at ${stalest}, ` +
        'so no coordinator is working them. Run `construct work` to take them back over; ' +
        'the fencing token makes a re-dispatch safe.\n',
    );
  }
  if (running.length > 0 || expired.length > 0) return;

  const failed = tasks.filter((t) => t.state === 'failed');
  if (failed.length > 0 && failed.length === tasks.length) {
    writeTotalFailureRecourse(failed.length);
  } else if (failed.length > 0) {
    process.stdout.write(
      `${String(failed.length)} task(s) failed and produced no deliverable; their errors are above.\n`,
    );
  }
}

export function inbox(): number {
  return withStore((store) => {
    const open = openDecisions(store);
    // Waiting outward changes are calls on the user exactly as decisions are,
    // and an inbox that says "nothing needs you" while proposals wait is
    // wrong. A pointer, not a second rendering: the queue has one listing.
    const waiting = pendingProposalCount(store);
    const waitingLine =
      waiting > 0
        ? `${String(waiting)} outward change${waiting === 1 ? '' : 's'} waiting — see: construct decide --pending\n`
        : '';
    if (open.length === 0) {
      process.stdout.write(
        waiting > 0
          ? `decision inbox: no open decisions.\n${waitingLine}`
          : 'decision inbox: empty. Nothing needs you right now.\n',
      );
      return 0;
    }
    process.stdout.write(`decision inbox (${open.length}):\n\n`);
    for (const decision of open) {
      process.stdout.write(`  ${decision.id}  ${escapeForTerminal(decision.question)}\n`);
      for (const position of decision.positions) {
        const cited = position.citation ? ` [${escapeForTerminal(position.citation)}]` : ' [unverified]';
        process.stdout.write(`      ${position.role}: ${escapeForTerminal(position.stance)}${cited}\n`);
      }
      process.stdout.write('\n');
    }
    process.stdout.write(`Resolve with: construct decide <id> "<your call>"\n${waitingLine}`);
    return 0;
  });
}

const LESSONS_USAGE =
  'usage: construct lessons [--workspace=<name>]\n' +
  '       construct lessons --admit=<lesson-id> --by=<approver> [--detail="<why>"] [--workspace=<name>]\n';

/**
 * The held-lessons queue, made visible, and the one write a human makes on it.
 *
 * The admission gate holds every run-derived or externally-sourced lesson
 * unconditionally — that is the gate doing its job — but a held lesson was
 * invisible once its decide-time line scrolled away: the readers were kernel
 * functions with no command in front of them, reachable only by opening the
 * database by hand. Listing shows the standing verdict for every lesson in
 * the workspace, and a lesson with no verdict at all lists as held, because
 * absence of a verdict is a hold nobody wrote down. Admitting re-runs the
 * same gate with a human-approval basis naming its approver — the gate, not
 * this command, is what turns that into an admission, so the rule that only
 * an explicit human admits high-risk, external, or run-derived lessons lives
 * in exactly one place.
 */
export function lessons(argv: string[]): number {
  const { flags, rest } = parseFlags(argv);
  if (rest.length > 0) {
    process.stderr.write(LESSONS_USAGE);
    return 2;
  }
  const workspace = workspaceFlag(flags);

  if (flags.admit !== undefined) {
    const id = flags.admit.trim();
    // A bare `--by` parses as the flag-present sentinel 'true', and a bare
    // `--admit` the same way. The point of the flag is a named human, so a
    // sentinel is a missing name, not an approver called "true" — and an
    // admission recorded against it would forge the exact audit line the
    // gate exists to keep.
    const approver = flags.by === 'true' ? '' : (flags.by?.trim() ?? '');
    if (!id || id === 'true' || !approver) {
      process.stderr.write('lessons: admitting needs the lesson and its human.\n' + LESSONS_USAGE);
      return 2;
    }
    return withStore((store) => {
      const lesson = getLesson(store, id);
      if (!lesson) {
        process.stderr.write(`lessons: no lesson ${id}\n`);
        return 1;
      }
      const decision = decideAdmission(store, {
        lessonId: id,
        domain: admissionDomainFor(store, lesson),
        basis: {
          kind: 'human-approval',
          approver,
          detail: flags.detail?.trim() || 'approved from the held-lessons queue',
        },
        decidedAt: now(),
      });
      process.stdout.write(`${decision.verdict} ${id}: ${escapeForTerminal(decision.reason)}\n`);
      return 0;
    });
  }

  return withStore((store) => {
    const recorded = lessonsFor(store, workspace);
    if (recorded.length === 0) {
      process.stdout.write(`lessons: none recorded for workspace "${workspace}".\n`);
      return 0;
    }
    const standing = recorded.map((lesson) => ({ lesson, verdict: admissionOf(store, lesson.id) }));
    const held = standing.filter((s) => s.verdict?.verdict !== 'admitted');
    const admitted = standing.filter((s) => s.verdict?.verdict === 'admitted');
    process.stdout.write(
      `lessons for workspace "${workspace}": ${held.length} held, ${admitted.length} admitted.\n`,
    );
    const print = (entries: typeof standing, title: string): void => {
      if (entries.length === 0) return;
      process.stdout.write(`\n  ${title}:\n`);
      for (const { lesson, verdict } of entries) {
        process.stdout.write(`    ${lesson.id}  [${lesson.kind}]\n`);
        process.stdout.write(`      ${escapeForTerminal(lesson.body)}\n`);
        process.stdout.write(
          `      ${verdict ? `${verdict.verdict}: ${escapeForTerminal(verdict.reason)}` : 'held: no verdict recorded — absence of a verdict is a hold nobody wrote down'}\n`,
        );
        process.stdout.write(`      cites ${escapeForTerminal(lesson.citation)}\n`);
      }
    };
    print(held, 'held');
    print(admitted, 'admitted');
    if (held.length > 0) {
      process.stdout.write('\nAdmit one with: construct lessons --admit=<id> --by=<your name>\n');
    }
    return 0;
  });
}

const DECIDE_USAGE =
  'usage: construct decide <id> "<your call>"\n' +
  '       construct decide --pending [--workspace=<name>]\n' +
  '       construct decide --approve=<proposal-id> "<why>"\n' +
  '       construct decide --reject=<proposal-id> "<why>"\n' +
  '       construct decide --apply=<proposal-id> --host=<opencode|claude> ' +
  '[--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>]\n' +
  '         (codex and cursor dispatch read-only and cannot carry a change out)\n';


/**
 * The outward-write queue, made visible.
 *
 * A proposal announces itself once, in the run that filed it, and then waits.
 * Once that line scrolled away the queue was reachable only by opening the
 * database, so a change nobody could name was a change nobody could decide —
 * the same invisibility the held-lessons queue had. Listing it is what makes
 * the two decisions under it something a person can actually make.
 */
function pendingQueue(workspace: string): number {
  return withStore((store) => {
    const waiting = pendingProposals(store, workspace);
    if (waiting.length === 0) {
      process.stdout.write(`no outward changes are waiting in workspace ${workspace}\n`);
      return 0;
    }
    const standing = writeConsentAllowsLowRisk(store, workspace);
    process.stdout.write(
      `outward changes waiting in workspace ${workspace} (${String(waiting.length)}):\n\n`,
    );
    for (const proposal of waiting) writeProposalRow(store, proposal, standing);
    process.stdout.write(
      '\nApprove one with: construct decide --approve=<id> "<why>"\n' +
        'Reject one with:  construct decide --reject=<id> "<why>"\n',
    );
    return 0;
  });
}

/**
 * Approve or reject one waiting outward change.
 *
 * The only path to approved, and it records a human approval every time: a
 * workspace's standing consent covers the low-risk class and nothing else, so
 * a high-risk change becomes appliable through this command or not at all.
 * Approving carries nothing out — the change is still handed to a host by a
 * separate, named act, because a decision and a write on someone else's
 * system are two different things to be able to take back.
 */
function decideWrite(proposal: string, verdict: 'approved' | 'rejected', reason: string): number {
  return withStore((store) => {
    const record = getProposal(store, proposal);
    if (!record) {
      process.stderr.write(`decide: no outward change ${proposal} is waiting\n`);
      return 1;
    }
    try {
      decideProposal(store, proposal, verdict, reason, now());
    } catch (error) {
      process.stderr.write(`decide: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(`${verdict} ${proposal}: ${reason}\n`);
    if (verdict === 'approved') {
      process.stdout.write(
        'Nothing has been written outward yet — carry it out with:\n' +
          `  construct decide --apply=${proposal} --host=<opencode|claude>\n`,
      );
    }
    return 0;
  });
}

/**
 * Carry out one approved outward change through a host.
 *
 * An approved proposal used to terminate as a row: the user had said yes, the
 * queue said approved, and the ticket never moved. Construct still builds no
 * connectors — it hands the approved words to the host the run dispatches
 * through and records only what that host reported succeeding. A host with no
 * way to reach the system says so, and the proposal stays approved and
 * unapplied, which is the honest state and the one that leaves the change
 * with the person who approved it.
 */
async function applyApproved(
  proposal: string,
  host: HostFlags,
  hostOverride?: HostAdapter,
): Promise<number> {
  if (host.host === undefined && hostOverride === undefined) {
    process.stderr.write(
      'decide: carrying out a change needs a host — Construct builds no connectors and ' +
        "reaches nothing itself.\n  construct decide --apply=" + proposal +
        ' --host=<opencode|claude>\n',
    );
    return 2;
  }
  return withStoreAsync(async (store) => {
    const adapter =
      hostOverride ??
      adapterForHost(host.host, {
        binary: host.binary,
        model: host.model,
        dir: host.dir,
        timeoutMs: host.timeoutMs,
      });
    // Asked before a model call is spent, not after one comes back saying it
    // could not. The cursor and codex dispatch postures are probed read-only,
    // so a model under either cannot carry out any change however it is asked
    // — offering those hosts here and letting them fail would be selling a
    // capability that never existed.
    if (!hasCapability(adapter, 'outward-write')) {
      process.stderr.write(
        `decide: host "${adapter.name}" dispatches read-only, so it cannot carry out a change.\n` +
          `  ${HOST_NAMES.filter((h) => h === 'claude' || h === 'opencode').join(' or ')} can, ` +
          'because neither confines what the dispatched model may touch.\n' +
          '  That is also what it means: an apply there runs with whatever reach your own ' +
          'install of that host grants it.\n',
      );
      return 2;
    }
    try {
      await adapter.init();
    } catch (error) {
      process.stderr.write(`decide: host "${adapter.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`);
      return 1;
    }
    process.stdout.write(
      `applying ${proposal} through ${adapter.name}, which dispatches unconfined — ` +
        'the model acts with whatever reach your install grants it.\n',
    );
    const result = await applyProposal(
      store,
      createHostApplier(adapter, (id) => {
        const declared = getSource(store, id);
        return {
          kind: declared?.kind ?? '',
          locator: declared?.locator ?? 'an undeclared source',
        };
      }),
      proposal,
      now(),
    );
    if (result.outcome === 'applied') {
      if (result.projected) {
        process.stdout.write(`mirrored as ${result.projected} before it crossed\n`);
      }
      process.stdout.write(`applied ${proposal}: ${escapeForTerminal(result.detail)}\n`);
      return 0;
    }
    if (result.outcome === 'unappliable') {
      if (result.projected) {
        process.stdout.write(
          `mirrored as ${result.projected} before the attempt; the mirror records what was proposed, not a landing\n`,
        );
      }
      process.stderr.write(`decide: ${proposal} was not applied — ${escapeForTerminal(result.reason)}\n`);
      return 1;
    }
    process.stderr.write(`decide: ${proposal} cannot be applied — ${escapeForTerminal(result.reason)}\n`);
    return 1;
  });
}

export async function decide(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);
  if (flags.pending !== undefined) return pendingQueue(workspaceFlag(flags));

  const verdict =
    flags.approve !== undefined ? 'approved' : flags.reject !== undefined ? 'rejected' : null;
  if (verdict !== null) {
    const proposal = (flags.approve ?? flags.reject ?? '').trim();
    const why = words.join(' ').trim();
    // A bare --approve leaves nothing to decide about, and a decision with no
    // reason is the audit line this queue exists to keep. Both are usage
    // errors rather than defaults, because guessing either one writes a
    // record about someone else's system that nobody wrote.
    if (!proposal || !why) {
      process.stderr.write(
        'decide: deciding an outward change needs the change and your reason.\n' + DECIDE_USAGE,
      );
      return 2;
    }
    return decideWrite(proposal, verdict, why);
  }

  if (flags.apply !== undefined) {
    let host: HostFlags;
    try {
      host = parseHostFlags(flags);
    } catch (error) {
      process.stderr.write(`decide: ${(error as Error).message}\n${DECIDE_USAGE}`);
      return 2;
    }
    return applyApproved(flags.apply, host, hostOverride);
  }

  const [id, ...rest] = words;
  const resolution = rest.join(' ').trim();
  if (!id || !resolution) {
    process.stderr.write(DECIDE_USAGE);
    return 2;
  }
  return withStore((store) => {
    const at = now();
    try {
      resolveDecision(store, id, resolution, at);
    } catch (error) {
      process.stderr.write(`decide: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(`decided ${id}: ${resolution}\n`);

    // The first place a run's own operation becomes a candidate lesson rather
    // than only a document someone hands in. Distillation is mechanical (no
    // model reads the decision) and fail-soft on top of an already-succeeded
    // resolution: losing the lesson is not losing the decision, so a failure
    // here is reported, not thrown.
    const resolved = getDecision(store, id);
    const distilled = resolved && distillDecisionLesson(resolved);
    if (resolved && distilled) {
      try {
        recordLesson(store, {
          id: distilled.id,
          workspace: planFor(store, resolved.run)?.workspace ?? resolved.run,
          kind: 'process',
          body: distilled.body,
          citation: distilled.citation,
          external: false,
          supersedes: null,
          createdAt: at,
        });
        const worst =
          distilled.domains.find((d) => riskTierFor(d) === 'high') ?? distilled.domains[0] ?? resolved.run;
        // The gate holds every run-derived lesson unconditionally (see
        // runDerived() in lessons/admission.ts), so this basis is never read
        // into a reason on this path — it exists only because DecideAdmission
        // requires one. Admitting this lesson for real is a later, separate
        // call with basis: {kind: 'human-approval', ...}, made by whoever
        // reviews the held queue, not by this command.
        const admitted = decideAdmission(store, {
          lessonId: distilled.id,
          domain: worst,
          basis: { kind: 'adversarial-pass', detail: 'not applicable: no adversarial pass runs on a run-derived lesson' },
          decidedAt: at,
        });
        process.stdout.write(
          `distilled ${distilled.id} (${admitted.verdict}): ${escapeForTerminal(admitted.reason)}\n`,
        );
      } catch (error) {
        process.stdout.write(
          `the decision was resolved but the lesson could not be recorded (${escapeForTerminal((error as Error).message)})\n`,
        );
      }
    }
    return 0;
  });
}

export interface VerdictArgs {
  readonly run?: string;
  readonly confirm: readonly string[];
  readonly dismiss: readonly string[];
  readonly missed: readonly string[];
  readonly source: string;
}

export function parseVerdictArgs(argv: string[]): VerdictArgs {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  // `--run <id>` as well as `--run=<id>`, because `log` and `work` both take
  // the spaced form and a user who learned it there types it here. This
  // surface refusing it sent people to a usage error at the one step the
  // routing corpus depends on.
  const runIndex = argv.indexOf('--run');
  return {
    run: args.run ?? (runIndex >= 0 ? argv[runIndex + 1] : undefined),
    confirm: args.confirm ? splitList(args.confirm) : [],
    dismiss: args.dismiss ? splitList(args.dismiss) : [],
    missed: args.missed ? splitList(args.missed) : [],
    source: args.source ?? 'user',
  };
}

/**
 * The CLI verdict surface: what confirms, dismisses, or
 * names a felt absence for the domains one run surfaced. Named `verdict`
 * rather than reusing `work` — that name already belongs to dispatching tasks
 * to a host — but it is exactly the surface the bead describes: list what
 * surfaced, let the user confirm or dismiss it, and give the ambush (a domain
 * that never surfaced but should have) a way to be recorded too.
 */
export function verdict(argv: string[]): number {
  let args: VerdictArgs;
  try {
    args = parseVerdictArgs(argv);
  } catch (error) {
    process.stderr.write(`verdict: ${(error as Error).message}\n`);
    return 2;
  }
  if (!args.run) {
    process.stderr.write('usage: construct verdict --run=<id> [--confirm=d1,d2] [--dismiss=d3] [--missed=d4] [--source=<name>]\n');
    return 2;
  }
  const run = args.run;

  return withStore((store) => {
    const surfaced = surfacedDomains(store, run);
    const outcomeText = runOutcomeText(store, run);
    if (outcomeText === null) {
      process.stderr.write(`verdict: no recorded outcome for run ${run}\n`);
      return 1;
    }

    if (args.confirm.length === 0 && args.dismiss.length === 0 && args.missed.length === 0) {
      // Nothing to record: show what there is to render a verdict on.
      process.stdout.write(`run ${run}\n  outcome: ${outcomeText}\n\n`);
      if (surfaced.length === 0) {
        process.stdout.write('no domains surfaced for this run.\n');
      } else {
        process.stdout.write(`surfaced domains (${surfaced.length}):\n`);
        for (const domain of surfaced) process.stdout.write(`  ${domain}\n`);
      }
      process.stdout.write(
        '\nRecord a verdict:\n' +
          `  construct verdict --run=${run} --confirm=<domain,...>   it was right to surface these\n` +
          `  construct verdict --run=${run} --dismiss=<domain,...>   it was wrong to surface these\n` +
          `  construct verdict --run=${run} --missed=<domain,...>    these should have surfaced and did not\n`,
      );
      return 0;
    }

    let recorded: RecordedVerdict;
    try {
      recorded = recordVerdict(store, {
        run,
        confirm: args.confirm,
        dismiss: args.dismiss,
        missed: args.missed,
        source: args.source,
        at: now(),
      });
    } catch (error) {
      const hint =
        error instanceof UnsurfacedVerdictError
          ? ` Use --missed=${error.domains.join(',')} for a felt absence.`
          : '';
      process.stderr.write(`verdict: ${(error as Error).message}${hint}\n`);
      return 2;
    }

    process.stdout.write(
      `recorded verdict #${String(recorded.seq)} for ${run}: ` +
        `${String(recorded.confirmed)} confirmed, ${String(recorded.dismissed)} dismissed, ` +
        `${String(recorded.missed)} missed.\n`,
    );
    return 0;
  });
}

/**
 * Write the harvested corpus (every recorded verdict, folded through
 * `harvestCorpus`) to `path`, fixture-shaped exactly as map.test.ts consumes
 * it. This is the export path corpus expansion reads from.
 */
export function corpusExport(argv: string[]): number {
  const path = argv[0];
  if (!path) {
    process.stderr.write('usage: construct corpus export <path>\n');
    return 2;
  }
  return withStore((store) => {
    const history = readFeedback(store);
    const corpus = harvestCorpus(history);
    writeFileSync(path, `${JSON.stringify(corpus, null, 2)}\n`);
    process.stdout.write(
      `wrote ${String(corpus.outcomes.length)} outcome(s) to ${path} ` +
        `(${String(corpus.skipped)} verdict-free record(s) skipped).\n`,
    );
    return 0;
  });
}

export function corpus(argv: string[]): number {
  const [sub, ...rest] = argv;
  if (sub === 'export') return corpusExport(rest);
  process.stderr.write('usage: construct corpus export <path>\n');
  return 2;
}


const WATCH_USAGE =
  'usage: construct watch [--root=<repo>]\n' +
  '       construct watch add --source=<source-id> --every=<N>m|<N>h|<N>d ' +
  '[--host=<opencode|claude|codex|cursor>]\n' +
  '       construct watch list [--all]\n' +
  '       construct watch retire <id>\n' +
  '       construct watch --due\n' +
  '         (schedule `construct watch --due` with cron or launchd; nothing here waits or wakes)\n';

/**
 * Whether a root is a checkout of Construct itself, decided from the package
 * identity rather than from the presence of a tracker: any repository can carry
 * beads, and only this one is what the watch's findings are about.
 */
function isConstructCheckout(root: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return (
      typeof manifest === 'object' &&
      manifest !== null &&
      (manifest as { name?: unknown }).name === '@geraldmaron/construct'
    );
  } catch {
    return false;
  }
}

/**
 * Declare a watch over an already-declared source. Cadence and an optional
 * host are recorded exactly as a standing outcome records them, but nothing
 * here spends anything: the declaration is a setting, and the first survey
 * waits for `--due` the same way a standing outcome's first run does.
 */
function watchAdd(flags: Record<string, string>): number {
  const sourceId = (flags.source ?? '').trim();
  if (sourceId === '' || flags.every === undefined) {
    process.stderr.write(WATCH_USAGE);
    return 2;
  }
  let everyMinutes: number;
  try {
    everyMinutes = parseCadence(flags.every);
  } catch (error) {
    process.stderr.write(`watch: ${(error as Error).message}\n`);
    return 2;
  }
  const host = flags.host;
  if (host !== undefined && !(HOST_NAMES as readonly string[]).includes(host)) {
    process.stderr.write(`watch: unknown host "${host}" (expected ${HOST_NAMES.join(', ')})\n`);
    return 2;
  }
  return withStore((store) => {
    const source = getSource(store, sourceId);
    if (!source) {
      process.stderr.write(`watch: no source ${sourceId} — declare it first: construct source add\n`);
      return 1;
    }
    const at = now();
    const id = `srcwatch-${at.replace(/[-:.TZ]/g, '')}`;
    try {
      declareSourceWatch(store, {
        id,
        workspace: source.workspace,
        source: sourceId,
        host: host ?? null,
        everyMinutes,
        declaredAt: at,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE/i.test(message)) {
        process.stderr.write(
          `watch: ${sourceId} already has an active watch — retire it first to redeclare\n`,
        );
        return 1;
      }
      process.stderr.write(`watch: ${message}\n`);
      return 1;
    }
    process.stdout.write(
      `declared ${id}: watching ${sourceGroundLine(source)} every ${renderCadence(everyMinutes)}` +
        (host ? ` (host ${host} named; structural comparison still runs every sweep)` : '') +
        '\n' +
        '  nothing runs until `construct watch --due` fires — schedule that with cron or launchd.\n',
    );
    return 0;
  });
}

function watchList(flags: Record<string, string>): number {
  return withStore((store) => {
    const rows = listSourceWatches(store, { includeRetired: flags.all !== undefined });
    if (rows.length === 0) {
      process.stdout.write('no source watches declared.\n');
      return 0;
    }
    for (const row of rows) {
      const source = getSource(store, row.source);
      const last = latestSourceWatchFiring(store, row.id);
      process.stdout.write(
        `${row.id}  every ${renderCadence(row.everyMinutes)}  (workspace ${row.workspace})` +
          (row.host ? `  host: ${row.host}` : '') +
          (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
          '\n' +
          `  source: ${row.source}${source ? ` — ${sourceGroundLine(source)}` : ' (no longer declared)'}\n` +
          `  ${last ? `last fired ${last.firedAt}` : 'never fired'}\n`,
      );
    }
    return 0;
  });
}

function watchRetire(id: string | undefined): number {
  if (!id || id.trim() === '') {
    process.stderr.write(WATCH_USAGE);
    return 2;
  }
  return withStore((store) => {
    try {
      retireSourceWatch(store, id, now());
    } catch (error) {
      process.stderr.write(`watch: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(`retired ${id}; its firings stay on the record\n`);
    return 0;
  });
}

/**
 * Fire what has come due: survey each elapsed watch's source structurally,
 * compare the survey to what the last firing recorded, and raise whatever
 * changed. No host is consulted here regardless of what a declaration names —
 * a watch always compares structurally, never spending on a model; naming a
 * host only records intent for whatever reviews the finding next.
 *
 * A firing is recorded whether or not anything changed, exactly as a
 * self-watch sweep always records itself: a watch that stopped running must
 * not be mistaken for a watch with nothing to report.
 */
function watchDue(): number {
  return withStore((store) => {
    const due = dueSourceWatches(store, now());
    if (due.length === 0) {
      process.stdout.write('nothing is due.\n');
      return 0;
    }
    for (const declared of due) {
      const source = getSource(store, declared.source);
      if (!source) {
        // Sources are retired, never deleted, so this names a stale
        // reference rather than a source that vanished out from under it.
        process.stderr.write(`watch: ${declared.id} names no source ${declared.source} — skipped\n`);
        continue;
      }
      const at = now();
      const target: Watch = { id: declared.id, ground: sourceGroundLine(source) };
      const run = watchRun(target);
      if (readWorkLog(store, run).length === 0) startWatch(store, target, at);

      const shape = sourceShape(store, source.id);
      const survey = surveySource(source, shape ? { emphasis: shape.emphasis, cap: shape.cap } : undefined);
      const current = snapshotFromSurvey(survey);
      const priorFiring = latestSourceWatchFiring(store, declared.id);
      const prior = priorFiring ? (priorFiring.snapshot as SourceSnapshot) : null;

      const findings = sourceWatchFindings({ source, prior, current, firedAt: at });
      // Raised before recorded: a crash between the two leaves the next sweep
      // comparing against the same prior state and re-detecting the change,
      // which a duplicate decision survives; the other order could record a
      // snapshot whose finding never made it to the inbox.
      const result = sweepWatch(store, { watch: target, findings, at });
      recordSourceWatchFiring(store, { watch: declared.id, run, firedAt: at, snapshot: current });

      process.stdout.write(
        `watch ${declared.id} (every ${renderCadence(declared.everyMinutes)}):\n  ground: ${target.ground}\n`,
      );
      process.stdout.write(
        findings.length === 0
          ? `  ${prior ? 'no change since the last sweep.' : 'first sweep; recorded a baseline.'}\n`
          : `  ${String(result.raised.length)} raised as new decision(s).\n`,
      );
    }
    process.stdout.write('\nRead decisions with: construct inbox\n');
    return 0;
  });
}

/**
 * The standing watch, swept once when the bare form runs; `add`/`list`/
 * `retire`/`--due` manage watches pointed at declared external sources.
 *
 * A watch is an outcome that never closes, so there is no "start" to run and
 * nothing to schedule: something outside decides when to look, exactly as
 * something outside decides when to `work`. The bare form's only ground is
 * Construct itself (commitment 16 made operational), which is why it takes a
 * repo root and nothing else — external ground is declared with `source add`
 * and followed with `watch add`, never with `--root`.
 *
 * `--root` therefore selects WHICH CHECKOUT of Construct to inspect, and never
 * which project to watch. The findings are drift between this project's
 * strategy, tracker, and repo; pointed at an unrelated repository they would be
 * meaningless, and reporting them under Construct's own watch identity — which
 * is what happened while the flag was half-wired — is worse than meaningless,
 * because the record would name a ground the evidence did not come from. A root
 * that is not a Construct checkout is refused by name rather than swept.
 */
export function watch(argv: string[]): number {
  const { flags, words } = splitFlags(argv);
  if (flags.help !== undefined) {
    process.stdout.write(WATCH_USAGE);
    return 0;
  }

  const sub = words[0];
  if (sub === 'add') return watchAdd(flags);
  if (sub === 'list') return watchList(flags);
  if (sub === 'retire') return watchRetire(words[1]);
  if (flags.due !== undefined) return watchDue();

  const root = flags.root || process.cwd();
  if (!isConstructCheckout(root)) {
    process.stderr.write(
      `watch: ${root} is not a Construct checkout.\n` +
        'The bare form reports drift between this project\'s strategy, tracker, and\n' +
        'repo, so --root selects which checkout of Construct to inspect, not which\n' +
        'project to watch. To watch other ground, declare it first:\n' +
        '  construct source add --kind=directory --locator=<path>\n' +
        '  construct watch add --source=<source-id> --every=<N>m|<N>h|<N>d\n',
    );
    return 1;
  }

  const gathered = gatherRepoEvidence({ root });
  if (isFailure(gathered)) {
    // Nothing to watch is not a failure of the watch; it is a fact about the
    // ground, and saying which is the difference between a broken tool and an
    // unwatched repository.
    process.stderr.write(`watch: ${gathered.problem}\n`);
    return 1;
  }

  const at = now();
  const report = reconcileSession(gathered.issues, gathered.evidence, at);
  const findings = constructFindings(report);
  const target: Watch = { id: 'construct', ground: CONSTRUCT_GROUND };

  return withStore((store) => {
    if (readWorkLog(store, watchRun(target)).length === 0) startWatch(store, target, at);
    const result = sweepWatch(store, { watch: target, findings, at });

    process.stdout.write(`watch ${target.id}\n  ground: ${target.ground}\n\n`);
    if (findings.length === 0) {
      process.stdout.write('nothing diverged. The tracker and the repo agree.\n');
      return 0;
    }
    process.stdout.write(
      `${String(findings.length)} finding(s): ` +
        `${String(result.raised.length)} raised as new decisions, ` +
        `${String(result.standing.length)} already standing.\n`,
    );
    for (const key of result.raised) process.stdout.write(`  new       ${key}\n`);
    for (const key of result.standing) process.stdout.write(`  standing  ${key}\n`);
    if (result.raised.length > 0) {
      process.stdout.write('\nRead them:  construct inbox\n');
    } else {
      // A sweep that raises nothing new is the common case, and it must not
      // read as a sweep that found nothing.
      process.stdout.write(
        '\nEverything found is already in the inbox, unresolved. A standing finding is\n' +
          'not raised twice; resolve it with: construct decide --id=<id> --resolution="..."\n',
      );
    }
    return 0;
  });
}


const RECONCILE_USAGE =
  'usage: construct reconcile [--tracker=<name>]\n' +
  '       construct reconcile --tracker=<name> --live=<file>\n';

/**
 * Whether a projected proposal (kernel/store/projections.ts) still agrees
 * with the tracker it was mirrored into.
 *
 * Comparison model, stated plainly because the substrate alone does not say
 * how a CLI should use it: the kernel holds no tracker connectors, this
 * command imports no host adapter, and it never fetches a live issue on its
 * own. Freshness has to arrive from outside. `--tracker=<name>
 * --live=<file>` names a JSON array of the issues the caller can currently
 * see in that one tracker — gathered however the caller likes, a `bd`
 * export, a Jira API call, a copy out of a UI — and this command's only job
 * is the honest, mechanical diff: kernel/tracker/reconcile.ts's existing
 * `reconcileAll` against the recorded projections for that tracker.
 * `in_sync`, `reconciling` (a tracker-owned field moved; absorbed, not a
 * conflict), `drifted` (a domain-owned field disagrees), and `missing` (the
 * read no longer contains the issue) are exactly `reconcileAll`'s own
 * vocabulary — nothing here invents a second one. `--tracker` is required
 * together with `--live` because a bare external id is unique only within
 * one tracker; reconciling several at once would let one tracker's issue
 * silently stand in for another's.
 *
 * Without `--live`, there is no live state to compare against, and this
 * command declines to guess at one — it reports the state each projection
 * already carries (`projected` for a mirror nobody has ever reconciled,
 * whatever a prior sync last recorded otherwise), plainly labeled as what
 * the store recorded rather than a live answer.
 *
 * Every projection `reconcileAll` finds drifted or missing is framed as a
 * decision (kernel/tracker/reconcileDecisions.ts) and raised into the inbox
 * unless the same disagreement is already waiting there — the decision id is
 * derived from the projection and which fields disagree, so a second run
 * over an unchanged disagreement raises nothing new. Nothing here resolves a
 * decision, absorbs a tracker-owned change back into the stored projection,
 * or writes anywhere outside this store: deciding which side is right, and
 * syncing the mirror once it is decided, both stay outside this command.
 */
export function reconcile(argv: string[]): number {
  const { flags } = parseFlags(argv);
  if (flags.help !== undefined) {
    process.stdout.write(RECONCILE_USAGE);
    return 0;
  }
  const trackerFlag = flags.tracker?.trim();
  const tracker = trackerFlag && trackerFlag !== 'true' ? trackerFlag : undefined;
  const liveFlag = flags.live?.trim();
  const liveFile = liveFlag && liveFlag !== 'true' ? liveFlag : undefined;

  if (liveFile !== undefined && tracker === undefined) {
    process.stderr.write(
      "reconcile: --live compares one tracker's projections against its live read; " +
        `name it with --tracker=<name>.\n${RECONCILE_USAGE}`,
    );
    return 2;
  }

  let liveIssues: Record<string, unknown>[] | null = null;
  if (liveFile !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(liveFile, 'utf8'));
    } catch (error) {
      process.stderr.write(
        `reconcile: cannot read a live tracker read from ${liveFile}: ${(error as Error).message}\n`,
      );
      return 1;
    }
    if (!Array.isArray(parsed)) {
      process.stderr.write(`reconcile: ${liveFile} must hold a JSON array of tracker issues.\n`);
      return 1;
    }
    liveIssues = parsed as Record<string, unknown>[];
  }

  return withStore((store) => {
    const projections = listProjections(store, tracker);
    if (projections.length === 0) {
      process.stdout.write(`no projected proposals recorded${tracker ? ` for tracker ${tracker}` : ''}.\n`);
      return 0;
    }

    if (liveIssues === null) {
      process.stdout.write(
        `${String(projections.length)} projected proposal(s)${tracker ? ` for ${tracker}` : ''}, ` +
          'reported from the store — no --live read was supplied, so none of this is verified this run:\n\n',
      );
      for (const projection of projections) {
        const recordedAt = projection.reconciledAt ?? projection.importedAt ?? 'an unrecorded time';
        process.stdout.write(`  ${projection.state.padEnd(11)} ${projection.id}  (recorded ${recordedAt})\n`);
      }
      process.stdout.write(
        '\nConstruct holds no tracker connectors, so it cannot read live state on its own.\n' +
          "Supply one: construct reconcile --tracker=<name> --live=<file of that tracker's current issues>\n",
      );
      return 0;
    }
    if (!tracker) {
      // Unreachable: validated before the store opened. Kept so nothing below
      // this line ever needs to assert the type away.
      process.stderr.write('reconcile: --live requires --tracker=<name>.\n');
      return 1;
    }

    const at = now();
    const report = reconcileAll(projections, liveIssues, at);
    process.stdout.write(
      `${String(report.counts.total)} projected proposal(s) against the supplied live ${tracker} read:\n\n`,
    );
    for (const result of report.inSync) process.stdout.write(`  in_sync     ${result.external_id}\n`);
    for (const result of report.absorbed) {
      const fields = [...result.absorbed].map((a) => a.field).sort().join(', ');
      process.stdout.write(`  reconciling ${result.external_id}  (tracker-owned: ${fields})\n`);
    }
    for (const result of report.drifted) {
      const fields = [...result.conflicts].map((c) => c.field).sort().join(', ');
      process.stdout.write(`  drifted     ${result.external_id}  (${fields})\n`);
    }
    for (const entry of report.missing) {
      process.stdout.write(`  missing     ${entry.external_id}  (absent from the live read)\n`);
    }
    process.stdout.write(
      `\n${String(report.counts.inSync)} in_sync, ${String(report.counts.absorbed)} reconciling, ` +
        `${String(report.counts.drifted)} drifted, ${String(report.counts.missing)} missing.\n`,
    );

    const decisions = driftDecisions(report, projections);
    if (decisions.length === 0) {
      process.stdout.write('\nnothing drifted. Nothing was raised.\n');
      return 0;
    }

    const run = `reconcile:${tracker}`;
    let raised = 0;
    let standing = 0;
    process.stdout.write('\n');
    for (const decision of decisions) {
      if (getDecision(store, decision.id)) {
        standing += 1;
        process.stdout.write(`  standing  ${decision.id}\n`);
        continue;
      }
      raiseDecision(store, {
        id: decision.id,
        run,
        question: decision.question,
        positions: decision.positions,
        raisedAt: at,
      });
      raised += 1;
      process.stdout.write(`  raised    ${decision.id}\n`);
    }
    process.stdout.write(
      `\n${String(raised)} new decision(s) raised, ${String(standing)} already standing. ` +
        'Nothing here resolves a decision or writes to the tracker.\n' +
        (raised > 0 ? '  construct inbox\n' : ''),
    );
    return 0;
  });
}


const WAIVE_USAGE =
  'usage: construct waive --task=<id> --challenge=<id> --reason="<why>"\n';

/**
 * Set one challenge aside, on one deliverable.
 *
 * There is deliberately no --all, no config key, and no way to waive a
 * challenge for future work: commitment 13 puts waivers with the user alone,
 * per deliverable and per challenge, and a waiver that outlives the deliverable
 * it was granted for is the global off-switch that commitment forbids.
 */
export function waive(argv: string[]): number {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) flags[match[1]] = match[2];
  }
  const task = flags.task;
  const challenge = flags.challenge;
  const reason = flags.reason ?? '';
  if (!task || !challenge) {
    process.stderr.write(WAIVE_USAGE);
    return 2;
  }

  return withStore((store) => {
    const record = waiveChallenge(store, {
      task,
      challenge,
      // The waiver is the user's, and the record says so rather than letting it
      // read as something the system decided.
      by: 'user',
      reason,
      at: now(),
    });
    if (!record.recorded) {
      process.stderr.write(`waive: ${record.reason ?? 'refused'}\n`);
      return record.refusal === 'unknown-task' ? 1 : 2;
    }
    const promotion = promotionOf(store, task);
    process.stdout.write(`waived ${challenge} on ${task}: ${reason}\n`);
    if (promotion) {
      process.stdout.write(
        `  ${task} is now ${promotion.state}` +
          (promotion.waived.length > 0 ? ` (waived: ${promotion.waived.join(', ')})` : '') +
          '\n',
      );
    }
    return 0;
  });
}

const SOURCE_USAGE =
  'usage: construct source add --kind=<directory|git|github|jira|docs> --locator=<where> ' +
  '[--workspace=<name>] [--emphasis=<prose|code|all>] [--cap=<documents>]\n' +
  '       construct source list [--workspace=<name>] [--all]\n' +
  '       construct source retire --id=<source-id>\n';

const RECORD_USAGE =
  'usage: construct record add --kind=<customer|vendor|…> --name=<what it is called> [--workspace=<name>]\n' +
  '       construct record list [--workspace=<name>]\n' +
  '       construct record show <record-id> [--field=<name>]\n' +
  '       construct record erase <record-id> --reason=<why>\n' +
  '       construct record erase-note <note-id> --reason=<why>\n';

/**
 * Declare and read the subjects a workspace keeps facts about.
 *
 * Declaring creates nothing but identity. Fields arrive through the context
 * loop, each carrying the note line that taught it, because a record whose
 * fields could be set by hand with no evidence is a place for unsourced facts
 * to accumulate and later be quoted as though someone had established them.
 * Reading is where the value and its history are both visible, since "what
 * does it say" and "what changed it" are the same question asked twice.
 */
export function record(argv: string[]): number {
  const sub = argv[0];
  const { flags, rest } = parseFlags(argv.slice(1));
  const workspace = workspaceFlag(flags);

  if (sub === 'add') {
    const kind = (flags.kind ?? '').trim();
    const name = (flags.name ?? '').trim();
    if (kind === '' || name === '') {
      process.stderr.write(RECORD_USAGE);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      const existing = findRecord(store, workspace, kind, name);
      if (existing) {
        // Not an error worth failing on, but not a silent second record
        // either: two records for one subject split its history in half, and
        // half a history reads exactly like a whole one.
        process.stderr.write(
          `record: ${workspace} already keeps ${kind} "${name}" as ${existing.id}\n`,
        );
        return 1;
      }
      const id = `rec-${at.replace(/[-:.TZ]/g, '')}`;
      addRecord(store, { id, workspace, kind, name, createdAt: at });
      process.stdout.write(
        `keeping ${id}: ${kind} "${name}" (workspace ${workspace}).\n` +
          '  Its fields fill in from notes — each one citing the line that taught it:\n' +
          '  construct notes <file|directory> --host=<opencode|claude|codex|cursor>\n',
      );
      return 0;
    });
  }

  if (sub === 'list') {
    return withStore((store) => {
      const rows = recordsFor(store, workspace);
      if (rows.length === 0) {
        process.stdout.write(`no records kept for workspace ${workspace}\n`);
        return 0;
      }
      for (const row of rows) {
        const fields = currentFields(store, row.id);
        process.stdout.write(
          `${row.id}  ${row.kind}  ${row.name}  (${String(fields.length)} field${fields.length === 1 ? '' : 's'})\n`,
        );
      }
      return 0;
    });
  }

  if (sub === 'show') {
    const id = rest[0];
    if (!id) {
      process.stderr.write(RECORD_USAGE);
      return 2;
    }
    return withStore((store) => {
      const subject = getRecord(store, id);
      if (!subject) {
        process.stderr.write(`record: no record ${id}\n`);
        return 1;
      }
      process.stdout.write(`${subject.id}: ${subject.kind} "${subject.name}" (since ${subject.createdAt})\n`);
      if (flags.field) {
        const history = fieldHistory(store, id, flags.field);
        if (history.length === 0) {
          process.stdout.write(`  ${flags.field}: never recorded\n`);
          return 0;
        }
        process.stdout.write(`\n${flags.field}, oldest first:\n`);
        for (const entry of history) {
          process.stdout.write(`  ${entry.recordedAt}  ${escapeForTerminal(entry.value)}\n    cites ${escapeForTerminal(entry.citation)}\n`);
        }
        return 0;
      }
      const fields = currentFields(store, id);
      if (fields.length === 0) {
        process.stdout.write('  no fields recorded yet\n');
        return 0;
      }
      for (const field of fields) {
        process.stdout.write(`  ${escapeForTerminal(field.field)}: ${escapeForTerminal(field.value)}\n    cites ${escapeForTerminal(field.citation)}\n`);
      }
      process.stdout.write('\n  How a field got here:  construct record show <id> --field=<name>\n');
      return 0;
    });
  }

  if (sub === 'erase' || sub === 'erase-note') {
    const id = rest[0];
    const reason = (flags.reason ?? '').trim();
    if (!id || reason === '') {
      process.stderr.write(RECORD_USAGE);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      try {
        if (sub === 'erase-note') {
          const erased = eraseNote(store, id, reason, at);
          process.stdout.write(`erased note ${erased.subject}: its words are gone.\n`);
          process.stdout.write(
            '  Anything that cited a line of it no longer resolves, which is correct — a fact\n' +
              '  justified by words that no longer exist should not go on presenting itself as justified.\n',
          );
          return 0;
        }
        const { erased, notesStillNaming } = eraseRecord(store, id, reason, at);
        process.stdout.write(
          `erased record ${erased.subject}: the subject and ${String(erased.removed - 1)} field ` +
            `value${erased.removed - 1 === 1 ? '' : 's'}, including every earlier value.\n`,
        );
        // Never presented as complete when it is not. A note naming two
        // subjects is evidence about both, so taking it for one of them would
        // destroy the other's record with nobody having asked.
        if (notesStillNaming.length === 0) {
          process.stdout.write('  No note in this workspace still says that name.\n');
          return 0;
        }
        process.stdout.write(
          `\n${String(notesStillNaming.length)} note${notesStillNaming.length === 1 ? '' : 's'} ` +
            `still say${notesStillNaming.length === 1 ? 's' : ''} that name. The record is gone; ` +
            `${notesStillNaming.length === 1 ? 'this is' : 'these are'} not:\n`,
        );
        for (const note of notesStillNaming) {
          process.stdout.write(`  ${note.id}  (${note.recordedAt})\n`);
        }
        process.stdout.write(
          '\n  Read one before erasing it — a note naming someone else too is their evidence,\n' +
            '  and taking it for this subject removes theirs with nobody having asked:\n' +
            '  construct record erase-note <note-id> --reason=<why>\n',
        );
        return 0;
      } catch (error) {
        process.stderr.write(`record: ${(error as Error).message}\n`);
        return 1;
      }
    });
  }

  process.stderr.write(RECORD_USAGE);
  return 2;
}

const REVOKE_USAGE =
  'usage: construct revoke --task=<id> --reason="<why>"\n';

/**
 * Take one dispatched role's write surface away before its lease expires.
 *
 * Per task, and reasoned. The lever that existed before this was rotating the
 * install-wide signing secret, which kills every outstanding token for every
 * run at once — so an operator watching one role loop past its caps had to
 * choose between waiting out the lease and taking down everything in flight.
 *
 * A reason is required rather than optional for the same reason a waiver
 * requires one: the record of a control being used is the only thing that
 * distinguishes an operator stopping a runaway from work quietly disappearing,
 * and the role is told what the reason was when its next write is refused.
 */
export function revoke(argv: string[]): number {
  const { flags } = splitFlags(argv);
  const task = flags.task;
  const reason = flags.reason?.trim();
  if (task === undefined || reason === undefined || reason === '') {
    process.stderr.write(REVOKE_USAGE);
    return 2;
  }
  return withStore((store) => {
    const row = getTask(store, task);
    if (!row) {
      process.stderr.write(`revoke: no task ${task}\n`);
      return 1;
    }
    const already = revocationOf(store, row.run, task);
    if (already !== null) {
      process.stdout.write(`${task} was already revoked: ${already}\n`);
      return 0;
    }
    revokeRoleCapability(store, {
      run: row.run,
      task,
      reason,
      at: new Date().toISOString(),
    });
    process.stdout.write(
      `revoked ${task} (${row.role}): ${reason}\n` +
        'Its next write is refused and says so. Every other role in the run keeps writing, ' +
        'and the deliverable it already submitted stays on the record.\n',
    );
    return 0;
  });
}

const COMPOSE_USAGE =
  'usage: construct compose --run=<id> --host=<opencode|claude|codex|cursor> ' +
  '[--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>] [--no-close] ' +
  `[--shape=<${shapeNames().join('|')}>] [--record]\n`;

/**
 * Write one document from the several a run produced.
 *
 * The roles each answered their own concern and each was right to decline the
 * whole, which left composing to the reader — silently, which reads as the
 * system having answered when it has not. This composes, and holds the result
 * to the one discipline that makes composing safe: it may arrange what the
 * roles established and may not add to it. Every claim names the deliverable
 * it came from, an attribution to a role that produced none is refused here,
 * and each role is then shown its own work beside the claims drawn from it and
 * asked which it does not support.
 */
export async function compose(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);
  const run = flags.run ?? words[0];
  if (!run) {
    process.stderr.write(COMPOSE_USAGE);
    return 2;
  }
  let hostFlags: HostFlags;
  try {
    hostFlags = parseHostFlags(flags);
  } catch (error) {
    process.stderr.write(`compose: ${(error as Error).message}\n${COMPOSE_USAGE}`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const plan = planFor(store, run);
    if (!plan) {
      process.stderr.write(`compose: no plan recorded for ${run}\n`);
      return 1;
    }
    // What shape of document this ask wants back, decided before any model sees
    // the deliverables and overridable outright — an explicit --shape never
    // costs a call, the same rule --domains already gets against the namer.
    // Left unresolved here when no name was given: which document shape an
    // outcome wants is not a fact the wording alone settles reliably, and a
    // model is one call away the moment a host is named for this run, so it
    // is asked rather than guessed once that host exists (below). The keyword
    // guess in run/shapes.ts survives as what a host-less run still has and
    // as the disclosed fallback if the model call itself fails.
    let shape: CompositionShape | undefined;
    if (flags.shape !== undefined) {
      shape = shapeByName(flags.shape);
      if (shape === undefined) {
        process.stderr.write(
          `compose: no shape named "${String(flags.shape)}" — known shapes are ${shapeNames().join(', ')}\n`,
        );
        return 2;
      }
    }

    const done = listTasks(store, run).filter((task) => task.state === 'done');
    const sources: SourceDeliverable[] = done
      .map((task) => ({
        role: task.role,
        text: deliverableBody(latestDraft(store, task.id)?.deliverable ?? task.result),
      }))
      .filter((source) => source.text.trim() !== '');
    // Each role's own brief, so a closing answer can be held to the challenges
    // that role already owed rather than to a set invented for the round.
    const briefs = new Map<string, Brief>(
      done
        .map((task) => [task.role, task.brief as Brief] as const)
        .filter(([, brief]) => brief !== null && typeof brief === 'object'),
    );
    // What each source's own challenges came to. Read here rather than assumed:
    // the states are recorded on every run and were simply never carried to the
    // person reading the document built out of them.
    const standings: SourceStanding[] = done.map((task) => {
      const promotion = promotionOf(store, task.id);
      return {
        role: task.role,
        state: promotion?.state ?? 'unrecorded',
        failing: promotion?.failing ?? [],
        outstanding: promotion?.outstanding ?? [],
        repaired: promotion?.repaired ?? [],
      };
    });

    const readiness = composeReadiness(sources);
    if (!readiness.ready) {
      process.stderr.write(`compose: ${readiness.reason}\n`);
      return 1;
    }

    if (hostFlags.host === undefined && hostOverride === undefined) {
      // No host named: this run stays free, and shape falls to the keyword
      // guess run/shapes.ts already has for exactly this path — the same
      // duality domain inference uses (kernel/implication/map.ts) rather than
      // an exception invented for this one decision.
      shape ??= shapeForOutcome(plan.outcome);
      process.stdout.write(
        `${String(sources.length)} deliverables are ready to compose (${sources.map((s) => s.role).join(', ')}).\n` +
          'Composing them is model work, at cost — one call to arrange, one per role to check\n' +
          'that nothing was added, and one to choose the document shape unless --shape names it:\n' +
          `  construct compose --run=${run} --host=<opencode|claude|codex|cursor>\n`,
      );
      return 0;
    }

    const host =
      hostOverride ??
      adapterForHost(hostFlags.host, {
        binary: hostFlags.binary,
        model: hostFlags.model,
        dir: hostFlags.dir,
        timeoutMs: hostFlags.timeoutMs,
      });
    try {
      await host.init();
    } catch (error) {
      process.stderr.write(`compose: host "${host.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`);
      return 1;
    }

    // A host exists and is already being paid for, so which document shape
    // this ask wants is asked rather than guessed. Only the keyword-matched
    // failure path — the host call itself failing, or naming something that
    // is not a real shape — falls back to the guess, and either way the
    // reader is told which one decided, the same disclosure the densifier's
    // "as understood" already gives.
    if (shape === undefined) {
      const chosen = await createHostShapeChooser(host)(plan.outcome, COMPOSITION_SHAPES);
      // chosen is already validated against COMPOSITION_SHAPES by the chooser,
      // so shapeByName cannot actually fail here — the fallback is defensive,
      // not expected to fire.
      const resolved = chosen === null ? undefined : shapeByName(chosen);
      if (resolved !== undefined) {
        shape = resolved;
        process.stdout.write(`shape: ${chosen} (chosen by the model)\n`);
      } else {
        // Which of the two fallbacks this is matters to the reader. A phrase
        // that matched is a guess with something behind it; the default shape
        // is what comes back when nothing matched at all, and it is a real
        // shape name, so printing it alone would read as a choice. Measured on
        // wording the phrase lists were not written against, nothing matches
        // far more often than something does.
        const guess = shapeMatchForOutcome(plan.outcome);
        shape = guess.shape;
        process.stdout.write(
          guess.matched
            ? `shape: ${shape.name} (the model could not be asked; falling back to the keyword guess)\n`
            : `shape: ${shape.name} (the model could not be asked, and no keyword matched either — this is the default, not a reading of your ask; pass --shape to choose)\n`,
        );
      }
    }

    let screened;
    try {
      const reply = await createHostComposer(host)({ outcome: plan.outcome, sources, shape });
      screened = screenComposition(
        toComposition(reply),
        sources,
        shape.sections.map((s) => s.name),
      );
    } catch (error) {
      process.stderr.write(`compose: the deliverables could not be composed (${escapeForTerminal((error as Error).message)}).\n`);
      return 1;
    }
    for (const drop of screened.discarded) {
      process.stdout.write(`  discarded: "${escapeForTerminal(drop.claim.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
    }

    // Construct's own read, taken before the roles are asked anything, so the
    // same call they get to object to is the one that was formed from their
    // finished work rather than from what survived their objections to it.
    //
    // Fail-soft: a position that could not be produced leaves the arranged
    // document, which is what this command produced before there was one. It
    // must never be able to cost the work it is a judgment about.
    let position: ScreenedPosition | null = null;
    try {
      const read = toPosition(await createHostPositioner(host)({ outcome: plan.outcome, sources }));
      position = read === null ? null : screenPosition(read, sources.map((s) => s.role));
    } catch (error) {
      process.stdout.write(
        `  no position taken (${escapeForTerminal((error as Error).message)}); the arranged document stands alone\n`,
      );
    }
    for (const drop of position?.refused ?? []) {
      process.stdout.write(`  refused from the position: "${escapeForTerminal(drop.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
    }

    // Each role shown its own deliverable beside the claims drawn from it.
    // Per role rather than per claim: identical coverage, and the cost is
    // bounded by how many concerns the run had rather than by how much the
    // composer wrote.
    const check = createHostSupportChecker(host);
    const unsupported = new Set<ComposedClaim>();
    for (const source of sources) {
      const mine = claimsFrom(screened.claims, source.role);
      if (mine.length === 0) continue;
      let verdict;
      try {
        verdict = await check(source, mine);
      } catch (error) {
        process.stderr.write(
          `compose: ${source.role}'s claims could not be checked (${escapeForTerminal((error as Error).message)}); ` +
            'an unverified composition is not promoted.\n',
        );
        return 1;
      }
      for (const index of verdict.unsupported) {
        const claim = mine[index];
        if (claim) unsupported.add(claim);
      }
      if (verdict.unsupported.length > 0) {
        process.stdout.write(
          `  ${source.role}: ${String(verdict.unsupported.length)} of ${String(mine.length)} claims not supported — ${escapeForTerminal(verdict.detail)}\n`,
        );
      } else if (verdict.detail.length > 0) {
        // A clean verdict still carries something to say when the check ran
        // same-family: the detail field is where createHostSupportChecker
        // puts the correlated-error caveat, and a check nobody printed a
        // qualification for reads as a stronger verdict than it earned.
        process.stdout.write(`  ${source.role}: all claims supported — ${escapeForTerminal(verdict.detail)}\n`);
      }
    }

    // The call put to each role that contributed, in its own call rather than
    // riding the claims check. The claims screen is what lets this document say
    // every line in it was checked, so it is asked with nothing else in the
    // frame; the veto is worth its own call rather than a cheaper coupled one.
    //
    // Fail-soft, unlike the claims check: a role that cannot be reached costs
    // the position its objection, not the run its document.
    const askObjection = createHostObjectionChecker(host);
    let objections: PositionObjection[] = [];
    if (position !== null) {
      for (const source of sources) {
        try {
          const quote = await askObjection(source, position.position.approach);
          if (quote.length > 0) objections.push({ role: source.role, quote });
        } catch (error) {
          process.stdout.write(
            `  ${source.role} could not be asked about the call (${escapeForTerminal((error as Error).message)}); ` +
              'it stands unobjected-to by that role\n',
          );
        }
      }
    }

    // The call goes back to itself once, with what the roles said about it.
    // A deliverable that fails its checks is sent back to its author, and an
    // objection of this kind is more specific than any of those checks: a role
    // has quoted the sentence and said it states work that role did not do.
    // Reporting that leaves the reader holding a call plus a correction to
    // apply themselves.
    //
    // One round, and only taken if it is an improvement — the repair round's
    // rule, because an instruction not to lose ground is not a mechanism.
    let callWasRepaired = false;
    let callWentBack = false;
    if (position !== null && objections.length > 0) {
      const before = position;
      try {
        const second = toPosition(
          await createHostPositionRepairer(host)({
            outcome: plan.outcome,
            sources,
            position: before.position,
            objections: collapseObjections(objections),
          }),
        );
        if (second !== null) {
          const rescreened = screenPosition(second, sources.map((s) => s.role));
          // Only the roles that objected are asked again. A role that had
          // nothing to say about the first call is not owed a second reading of
          // a document edited to answer somebody else, and the claims drawn
          // from it did not change.
          const recheck = createHostObjectionChecker(host);
          const remaining: PositionObjection[] = [];
          for (const role of new Set(objections.map((o) => o.role))) {
            const source = sources.find((s) => s.role === role);
            if (source === undefined) continue;
            const quote = await recheck(source, rescreened.position.approach, true);
            if (quote.length > 0) remaining.push({ role, quote });
          }
          callWentBack = true;
          const better = positionRepairIsAnImprovement(
            { objections, refused: before.refused },
            { objections: remaining, refused: rescreened.refused },
          );
          if (better) {
            position = rescreened;
            objections = remaining;
            callWasRepaired = true;
            for (const drop of rescreened.refused) {
              process.stdout.write(
                `  refused from the repaired position: "${escapeForTerminal(drop.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`,
              );
            }
          } else {
            process.stdout.write(
              '  the repaired call was refused: it did not drop an objection without ' +
                'introducing another or losing an attribution; the first call stands\n',
            );
          }
        }
      } catch (error) {
        process.stdout.write(
          `  the call could not be sent back (${escapeForTerminal((error as Error).message)}); it stands with its objections\n`,
        );
      }
    }

    const kept = screened.claims.filter((claim) => !unsupported.has(claim));
    // The record keeps the markers and the slugs the gates read; a reader gets
    // sentences. --record asks for the stored form, for anything downstream
    // that needs to check the text rather than read it.
    const asRecord = flags.record !== undefined;
    process.stdout.write(`\n# ${plan.outcome}\n`);
    // Who framed this, in whose name, before anything they framed. A document
    // that names its concerns only claim by claim leaves the reader to work out
    // at the end who was in the room, and a reader who does not know that
    // cannot weigh what is missing from it.
    process.stdout.write(
      `\n${attributionLine(sources.map((s) => (asRecord ? s.role : renderAttribution(s.role))))}\n`,
    );

    // Before the claims, not after them. A reader who reaches the end of a
    // document and only then learns that none of its sources passed their own
    // gates has already believed it.
    const uncleared = unclearedSources(standings);
    if (uncleared.length > 0) {
      process.stdout.write(
        `\n> **What the sources of this document did not pass.** ${String(uncleared.length)} of ` +
          `${String(standings.length)} deliverables composed here did not come through their own\n` +
          '> challenges clean. The claims below are still each a role\'s own, checked against that\n' +
          "> role — that screen is real and it is not this one.\n>\n" +
          uncleared.map((s) => `> - ${standingLine(s)}\n`).join('') +
          '>\n> They are composed rather than withheld because the run recorded these verdicts and\n' +
          '> can show them, and a reader told which sources were challenged can weigh the document.\n',
      );
    }
    // Before the sections, beside the standing block, for the same reason it
    // sits there: a reader who meets the contradiction after reading the
    // recommendation built on one side of it has already believed the
    // recommendation.
    const contested = contestedFacts(kept.map((c) => ({ text: c.text, from: c.from })));
    if (contested.length > 0) {
      process.stdout.write(
        `\n> **Two roles do not agree about ${contested.length === 1 ? 'a fact' : 'some facts'} in this document.** ` +
          'Each read the same ground and reached\n' +
          '> a different state for the same thing. Nothing here picks a side — the run has no\n' +
          '> standing to decide which role read correctly, and choosing by order of arrival would\n' +
          '> put one half of a live disagreement in the document under a single name.\n>\n' +
          contested.map((fact) => `> - ${escapeForTerminal(contestedLine(fact))}\n`).join(''),
      );
    }

    // Construct's own call, first, because it is the answer to what was asked.
    // Everything below it is the evidence it rests on, each concern named —
    // a reader can always tell which is which, because they are in different
    // parts of the document under different names, which is what lets the
    // judgment be made at all.
    if (position !== null) {
      const p = position.position;
      const say = (text: string) => escapeForTerminal(asRecord ? text : renderClaim(text));
      process.stdout.write(`\n## What Construct makes of this\n\n${say(p.approach)}\n`);
      process.stdout.write(
        '\n*This is a judgment across every concern, not any one concern\'s finding. ' +
          'Nobody was dispatched to make it; the roles below were each asked about their own ' +
          'concern and each was right to answer only that.*\n',
      );
      const listing = (title: string, claims: readonly { text: string; restsOn: readonly string[] }[]) => {
        if (claims.length === 0) return;
        process.stdout.write(`\n**${title}**\n\n`);
        for (const claim of claims) {
          const on = claim.restsOn.map((r) => (asRecord ? r : renderAttribution(r))).join(', ');
          process.stdout.write(`- ${say(claim.text)} [${on}]\n`);
        }
      };
      listing('Why', p.because);
      listing('What it costs', p.costs);
      listing('What happens first', p.first);

      if (p.resolved.length > 0) {
        process.stdout.write('\n**Where the concerns could not both be acted on**\n\n');
        const side = (roles: readonly string[]) =>
          roles.map((role) => (asRecord ? role : renderAttribution(role))).join(', ');
        for (const r of p.resolved) {
          process.stdout.write(
            `- ${say(r.question)} — went with ${side(r.took)} over ` +
              `${side(r.over)}: ${say(r.because)}\n`,
          );
        }
      }
      if (p.strongestObjection.length > 0) {
        process.stdout.write(`\n**The strongest objection to this**\n\n${say(p.strongestObjection)}\n`);
      }
      if (p.preMortem.length > 0) {
        process.stdout.write(`\n**Assume it was taken and it failed**\n\n${say(p.preMortem)}\n`);
      }
      if (p.undecided.length > 0) {
        process.stdout.write('\n**What this could not decide, and what would decide it**\n\n');
        for (const u of p.undecided) {
          process.stdout.write(`- ${say(u.question)} — settled by: ${say(u.settledBy)}\n`);
        }
      }
      // A recommendation with no case against it is an advertisement, and this
      // system holds every role to exactly that standard. Reporting the
      // shortfall rather than withholding the call: the reader can weigh a call
      // they are told arrived without its objection.
      const short = positionShortfalls(p);
      if (short.length > 0) {
        process.stdout.write(
          `\n> **This call did not come with everything it owes.** ${short.join('; ')}. ` +
            'The same checks apply to it as to any deliverable here.\n',
        );
      }
      // What the roles said, after the call had its one chance to answer them.
      // Several roles quoting the same sentence is one contested sentence and
      // prints as one line naming all of them: three lines would read as three
      // problems and bury which sentence is actually in dispute.
      if (objections.length > 0) {
        process.stdout.write(
          '\n> **A concern says the call states its work as something else.** ' +
            (callWasRepaired
              ? 'The call went\n> back once with these objections, and this is what it left standing.'
              : callWentBack
                ? 'The call went\n> back once and what came back did not answer this without costing something else,\n> so the first call stands.'
                : 'It was not sent back.') +
            ' Reported rather than resolved from here: the\n' +
            '> judgment is Construct\'s to make and the objection is theirs to make, and a reader\n' +
            '> is owed both.\n>\n' +
            collapseObjections(objections)
              .map((o) => `> - ${o.roles.join(', ')}: "${escapeForTerminal(o.quote)}"\n`)
              .join(''),
        );
      }
      // A repair the reader cannot see is a fragile path reading as a solid
      // one. The call they are holding is a second attempt, and that is a fact
      // about it.
      if (callWasRepaired) {
        process.stdout.write(
          '\n*This call is a second attempt. A concern objected that the first stated its\n' +
            'work as something it had not established, it was sent back once with those\n' +
            'objections, and what came back dropped objections without introducing new ones.*\n',
        );
      }
      process.stdout.write('\n---\n\n*What each concern established, in its name:*\n');
    }

    const empty: string[] = [];
    for (const section of shape.sections) {
      const inSection = kept.filter((claim) => claim.section === section.name);
      if (inSection.length === 0) {
        empty.push(section.name);
        continue;
      }
      process.stdout.write(`\n## ${asRecord ? section.name : renderHeading(section.name)}\n\n`);
      // Consecutive bullets read as one list; anything else is a block with
      // its own attribution line, so it gets the blank-line spacing a
      // paragraph, table, or diagram actually needs to render correctly.
      let previousKind: string | null = null;
      for (const claim of inSection) {
        if (previousKind !== null && !(previousKind === 'bullet' && claim.kind === 'bullet')) {
          process.stdout.write('\n');
        }
        process.stdout.write(`${escapeForTerminal(renderComposedClaim(claim, asRecord))}\n`);
        previousKind = claim.kind;
      }
    }
    // A section that came back empty is dropped from the document but not from
    // the report. Silently omitting it lets a composition that never stated an
    // answer read like one that had nothing more to add, and the reader cannot
    // tell the difference from the page alone — and once the section set follows
    // the ask, an unfillable section is also the reader's evidence that the ask
    // wanted something these deliverables do not carry.
    if (empty.length > 0) {
      process.stdout.write(
        `\n(the ${shape.name} shape asks for ${empty.join(', ')} and no claim was placed there — ` +
          'a fact about this composition and about what these deliverables hold, ' +
          'not about the roles who wrote them)\n',
      );
    }

    // Naming a gap is where this used to stop, and stopping there hands the
    // reader a question the run was better placed to answer than they are. So
    // the gaps go back to the roles, once: each is shown the list and asked
    // which its own material settles, with the run's ground still licensed to
    // it. Skipped when nothing is open, and skippable on purpose — it is a
    // model call per role, and a reader who only wants the arrangement should
    // not pay for the round that follows it.
    let closing: ClosingRound | null = null;
    if (screened.uncovered.length > 0 && flags['no-close'] === undefined) {
      const groundRoots = groundRootsFor(store, run);
      closing = await closeGaps({
        close: createHostGapCloser(host, plan.outcome, groundRoots),
        groundRoots,
        sources,
        briefs,
        gaps: screened.uncovered,
        report: terminalReport,
      });
    }

    if (closing !== null && closing.closed.length > 0) {
      // A separate section rather than mixed into the composed ones, because
      // the provenance is different and the reader is owed the difference:
      // these carry the role's name from a second dispatch, written in
      // Construct's voice, not the composer's arrangement of a first.
      process.stdout.write('\n## what was open until somebody went and looked\n\n');
      for (const answer of closing.closed) {
        const text = escapeForTerminal(asRecord ? answer.answer : renderClaim(answer.answer));
        const from = asRecord ? answer.role : renderAttribution(answer.role);
        process.stdout.write(`- ${escapeForTerminal(answer.gap)}\n  → ${text} [${from}]\n`);
      }
    }
    if (closing !== null && closing.contested.length > 0) {
      // Two roles answering the same question is a finding, not a tie to break.
      // Printing one of them alone would be the run resolving a disagreement it
      // has no standing to resolve, under a single name.
      process.stdout.write('\n## questions two roles answered differently\n\n');
      for (const item of closing.contested) {
        process.stdout.write(`- ${escapeForTerminal(item.gap)}\n`);
        for (const answer of item.answers) {
          const text = escapeForTerminal(asRecord ? answer.answer : renderClaim(answer.answer));
          const from = asRecord ? answer.role : renderAttribution(answer.role);
          process.stdout.write(`  → ${text} [${from}]\n`);
        }
      }
    }
    for (const drop of closing?.refused ?? []) {
      process.stdout.write(`  discarded: "${escapeForTerminal(drop.gap.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
    }

    // The gap is part of the document, not a footnote under it. A composition
    // that silently answers two thirds of an outcome is the failure composing
    // introduces, and naming it is the whole defence.
    process.stdout.write('\n## what nobody answered\n\n');
    const standing = closing?.standing ?? screened.uncovered.map((gap) => ({ gap, reasons: [] }));
    if (screened.uncovered.length === 0) {
      process.stdout.write('- the roles between them addressed every part of the outcome\n');
    } else if (standing.length === 0) {
      process.stdout.write('- every question the composing left open was closed by the round that followed it\n');
    } else {
      for (const item of standing) {
        process.stdout.write(`- ${escapeForTerminal(item.gap)}\n`);
        // A gap several roles opened their material for and could not settle is
        // a different fact from one nobody looked at, and only the reasons can
        // tell them apart. Without them the second reads as the first.
        for (const reason of item.reasons) {
          process.stdout.write(`  (${reason.role} looked: ${escapeForTerminal(reason.reason)})\n`);
        }
      }
    }

    const removed = screened.discarded.length + unsupported.size;
    process.stdout.write(
      `\ncomposed from ${String(sources.length)} deliverables: ${String(kept.length)} claims kept` +
        (removed > 0 ? `, ${String(removed)} refused as unsupported or unattributable` : '') +
        '.\nNothing here was added by the composing: every claim is one of the roles, checked against it.\n' +
        `Shaped as ${shape.article} ${shape.name} — ${shape.answers}` +
        (flags.shape === undefined
          ? `, read from the outcome. Another shape: --shape=<${shapeNames().join('|')}>.\n`
          : ', as asked.\n'),
    );

    // The step after reading it. A document's numbered issues and its
    // what-follows items are changes somebody is about to retype into whichever
    // system the work lives in, and the retyping is where the citation goes
    // missing. Offered only where the workspace has declared somewhere for a
    // change to go — the alternative is advertising a command that would refuse.
    const declared = sourcesFor(store, plan.workspace);
    if (declared.length > 0) {
      process.stdout.write(
        '\nThe findings in these deliverables can become write proposals, each citing the finding\n' +
          'it came from. No model call, nothing written outward, nothing applied:\n' +
          `  construct propose --run=${run} --source=${declared[0].id}\n`,
      );
    }
    return 0;
  });
}

const MODE_USAGE = 'usage: construct mode [--workspace=<name>] [--set=<team|seat>]\n';

const PLAN_USAGE = 'usage: construct plan <run-id>\n';

/**
 * Render a run's recorded plan: the understanding it worked from, its risk
 * tier, the steps with their playbook routing and deliverable slots, and anything
 * the planner discarded for fabricated provenance. Read-only: the plan is
 * write-once at outcome time, so this command shows, never edits.
 */
export function plan(argv: string[]): number {
  const runId = argv[0];
  if (!runId || runId.startsWith('--')) {
    process.stderr.write(PLAN_USAGE);
    return 2;
  }
  return withStore((store) => {
    const found = planFor(store, runId);
    if (!found) {
      process.stderr.write(`plan: no plan recorded for ${runId}\n`);
      return 1;
    }
    process.stdout.write(`plan ${found.id} (run ${found.run}, ${found.plannedAt})\n`);
    process.stdout.write(`  outcome: ${found.outcome}\n`);
    process.stdout.write(`  understood as: ${escapeForTerminal(found.understanding.restated)}\n`);
    for (const c of found.understanding.constraints) process.stdout.write(`  constraint: ${escapeForTerminal(c)}\n`);
    for (const d of found.understanding.decisions) process.stdout.write(`  decided: ${escapeForTerminal(d)}\n`);
    for (const p of found.understanding.parked) process.stdout.write(`  parked: ${escapeForTerminal(p)}\n`);
    process.stdout.write(`  risk: ${found.riskTier}  mode: ${found.mode}\n`);
    process.stdout.write(
      found.sourcesDeclared.length > 0
        ? `  sources declared: ${found.sourcesDeclared.join(', ')}\n`
        : '  sources declared: none\n',
    );
    if (found.steps.length === 0) {
      process.stdout.write('  steps: none — nothing was implicated\n');
    }
    for (const step of found.steps) {
      const route = found.routing.find((r) => r.step === step.id);
      process.stdout.write(`\n  ${step.id}  ${escapeForTerminal(step.description)}\n`);
      process.stdout.write(
        `    routed to ${step.domain} by ${route?.routedBy ?? 'unknown'}` +
          (route && route.evidence.length > 0 ? ` (${escapeForTerminal(route.evidence.slice(0, 4).join(', '))})` : '') +
          '\n',
      );
      process.stdout.write(`    stage: ${step.stage}  deliverable: ${step.deliverable.deliverable}\n`);
      const required = step.deliverable.slots.filter((s) => s.required).map((s) => s.name);
      process.stdout.write(`    required slots: ${required.join(', ')}\n`);
      if (step.after.length > 0) process.stdout.write(`    after: ${step.after.join(', ')}\n`);
    }
    for (const d of found.discarded) {
      process.stdout.write(`\n  discarded: ${escapeForTerminal(d.description)} — ${escapeForTerminal(d.reason)}\n`);
    }
    return 0;
  });
}

/**
 * Declare, list, and retire the sources a workspace works from. Declaring
 * builds no connector and reads nothing: it names where organizational
 * context lives so a run can be held to what it actually read from there
 * (the provenance rows), and so an outward write can name its target.
 */
export function source(argv: string[]): number {
  const sub = argv[0];
  const { flags } = parseFlags(argv.slice(1));
  const workspace = workspaceFlag(flags);

  if (sub === 'add') {
    const kind = flags.kind ?? '';
    const locator = flags.locator ?? '';
    if (!(SOURCE_KINDS as readonly string[]).includes(kind) || locator.trim() === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    // docs spans three unrelated providers (Google Docs, Confluence, Notion),
    // so unlike jira or github its locator must self-identify both — caught
    // here, before the store, so the refusal is a sentence and not a thrown
    // error the generic catch below would have to decide what to do with.
    if (kind === 'docs') {
      const problem = docsLocatorProblem(locator);
      if (problem) {
        process.stderr.write(`source: ${problem}\n`);
        return 2;
      }
    }
    // How this source is walked, declared with it. Both flags are optional and
    // absent means today's behavior, so nothing about an existing workspace
    // changes by the setting coming into existence.
    const emphasis = flags.emphasis;
    if (emphasis !== undefined && !(SURVEY_EMPHASES as readonly string[]).includes(emphasis)) {
      process.stderr.write(
        `source: unknown emphasis "${emphasis}" (emphases: ${SURVEY_EMPHASES.join(', ')})\n${SOURCE_USAGE}`,
      );
      return 2;
    }
    const cap = flags.cap === undefined ? undefined : Number(flags.cap);
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
      process.stderr.write(`source: --cap must be a positive whole number, got "${flags.cap ?? ''}"\n`);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      const id = `src-${at.replace(/[-:.TZ]/g, '')}`;
      try {
        addSource(store, { id, workspace, kind: kind as SourceKind, locator, addedAt: at });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE/i.test(message)) {
          process.stderr.write(
            `source: ${workspace} already declares ${kind} ${locator} — retire the old declaration first if it moved\n`,
          );
          return 1;
        }
        throw error;
      }
      if (emphasis !== undefined || cap !== undefined) {
        const shape = { emphasis: (emphasis ?? 'prose') as SurveyEmphasis, cap: cap ?? DOCUMENT_CAP };
        setSourceShape(store, id, shape, at);
        process.stdout.write(
          `declared ${id}: ${kind} ${locator} (workspace ${workspace}), ` +
            `surveyed ${shape.emphasis}-first, up to ${String(shape.cap)} documents\n`,
        );
        return 0;
      }
      process.stdout.write(`declared ${id}: ${kind} ${locator} (workspace ${workspace})\n`);
      return 0;
    });
  }

  if (sub === 'list') {
    return withStore((store) => {
      const rows = sourcesFor(store, workspace, { includeRetired: flags.all === 'true' });
      if (rows.length === 0) {
        process.stdout.write(`no sources declared for workspace ${workspace}\n`);
        return 0;
      }
      for (const row of rows) {
        const shape = sourceShape(store, row.id);
        process.stdout.write(
          `${row.id}  ${row.kind}  ${row.locator}` +
            (shape ? `  [${shape.emphasis}-first, cap ${String(shape.cap)}]` : '') +
            (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
            '\n',
        );
      }
      return 0;
    });
  }

  if (sub === 'retire') {
    const id = flags.id ?? '';
    if (id.trim() === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    return withStore((store) => {
      try {
        retireSource(store, id, now());
      } catch (error) {
        process.stderr.write(`source: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
      process.stdout.write(`retired ${id}\n`);
      return 0;
    });
  }

  process.stderr.write(SOURCE_USAGE);
  return 2;
}

const PROPOSE_USAGE =
  'usage: construct propose --run=<id> --source=<source-id> [--task=<id>] [--workspace=<name>] [--dry-run]\n' +
  '       construct propose doc --source=<source-id> --document=<path in that source>\n' +
  '         --kind=redline|insertion|authored --because=<what grounds it>\n' +
  '         [--was=<words it replaces>|--was-file=<path>]   (redline)\n' +
  '         [--at=<where it goes>|--at-file=<path>]         (insertion)\n' +
  '         [--now=<words that stand there>|--now-file=<path>]\n' +
  '         [--run=<id>] [--workspace=<name>] [--dry-run]\n' +
  '         (a flag value is one line; words spanning more than one go in a file)\n' +
  '       construct propose list [--workspace=<name>]\n';

/**
 * The declared, still-active source a change would be made against, or the
 * exit code that says why there is none.
 *
 * Which source is never inferred, even where a workspace declares exactly one:
 * the id is the difference between a proposal a person can decide on and a
 * change aimed at a system nobody named.
 */
function targetSource(store: Store, workspace: string, sourceId: string): Source | number {
  if (sourceId === '' || sourceId === 'true') {
    process.stderr.write('propose: name the source these changes would be made against.\n');
    const declared = sourcesFor(store, workspace);
    for (const source of declared) {
      process.stderr.write(`  --source=${source.id}  (${source.kind} ${source.locator})\n`);
    }
    if (declared.length === 0) {
      process.stderr.write(
        `  workspace ${workspace} has declared none: construct source add --kind=<kind> --locator=<where>\n`,
      );
    }
    return 2;
  }
  const target = getSource(store, sourceId);
  if (!target || target.workspace !== workspace) {
    process.stderr.write(
      `propose: workspace ${workspace} declares no source ${sourceId}.\n` +
        '  construct source list --workspace=' + workspace + '\n',
    );
    return 1;
  }
  if (target.retiredAt) {
    // A retired source stays inspectable because past provenance points at it.
    // Proposing a change into one would aim at a system this workspace has
    // said it no longer works from.
    process.stderr.write(
      `propose: ${sourceId} was retired at ${target.retiredAt}; it is not somewhere to send changes.\n`,
    );
    return 1;
  }
  return target;
}

/** A run's finished deliverables, optionally narrowed to one task. */
function finishedDeliverables(store: Store, run: string, only: string): Deliverable[] {
  return listTasks(store, run)
    .filter((task) => task.state === 'done')
    .filter((task) => only === '' || only === 'true' || task.id === only)
    .map((task) => ({
      task: task.id,
      role: task.role,
      text: deliverableBody(latestDraft(store, task.id)?.deliverable ?? task.result),
    }))
    .filter((deliverable) => deliverable.text.trim() !== '');
}

/**
 * One side of a change, given inline or read from a file.
 *
 * Both ways in exist because a redline's halves are the words of a document
 * and a document's words do not fit on a command line. Naming both at once is
 * a usage error rather than a silent preference for one: a person who wrote
 * the change twice does not know which copy is about to be proposed.
 */
function changeSide(
  flags: Record<string, string>,
  name: string,
): { text: string } | { error: string } {
  const inline = flags[name];
  const file = flags[`${name}-file`];
  if (inline !== undefined && file !== undefined) {
    return { error: `--${name} and --${name}-file both name those words; give one of them` };
  }
  if (file !== undefined) {
    if (file.trim() === '') return { error: `--${name}-file names no file` };
    try {
      return { text: readFileSync(file, 'utf8') };
    } catch (error) {
      return { error: `cannot read --${name}-file ${file}: ${(error as Error).message}` };
    }
  }
  return { text: inline ?? '' };
}

/** Whether either form of a side was given at all, empty or not. */
function gaveSide(flags: Record<string, string>, name: string): boolean {
  return flags[name] !== undefined || flags[`${name}-file`] !== undefined;
}

/**
 * Propose one change to a document: a redline of words already there, an
 * insertion beside them, or a document authored into the source.
 *
 * The same record, the same two tiers and the same gate as a change to a
 * ticket, because it is the same act — words landing in a system this tool
 * does not own. Both document tiers come out high: a redline's struck words
 * are not on the page afterwards for a reader to put back, and a documents
 * source is what runs read as organizational context, so a workspace's
 * standing yes to low-risk changes must never be what publishes prose into
 * one. Nothing here writes outward and nothing here can; carrying the change
 * out is a separate recorded act on the decide surface.
 */
function proposeDoc(flags: Record<string, string>): number {
  const kind = (flags.kind ?? '').trim();
  if (!(DOC_EDIT_KINDS as readonly string[]).includes(kind)) {
    process.stderr.write(
      `propose: --kind must be one of ${DOC_EDIT_KINDS.join(', ')}` +
        (kind === '' ? '' : `, not "${kind}"`) +
        `\n${PROPOSE_USAGE}`,
    );
    return 2;
  }
  // Each kind has its own word for its anchor, because they are not the same
  // thing: --was quotes words that will be gone, --at names a place where
  // nothing is displaced. Accepting either word for either kind would let a
  // redline be filed as an insertion, which is the one distinction the person
  // deciding is reading the row for.
  if (kind === 'redline' && gaveSide(flags, 'at')) {
    process.stderr.write('propose: a redline names the words it replaces with --was, not --at.\n');
    return 2;
  }
  if (kind === 'insertion' && gaveSide(flags, 'was')) {
    process.stderr.write('propose: an insertion names where it goes with --at, not --was.\n');
    return 2;
  }
  const sides = { was: changeSide(flags, 'was'), at: changeSide(flags, 'at'), now: changeSide(flags, 'now') };
  for (const side of Object.values(sides)) {
    if ('error' in side) {
      process.stderr.write(`propose: ${side.error}\n`);
      return 2;
    }
  }
  const anchor = gaveSide(flags, 'was')
    ? (sides.was as { text: string }).text
    : gaveSide(flags, 'at')
      ? (sides.at as { text: string }).text
      : '';

  // The shape refusals are pure, so they run before the store is opened: a
  // change refused for saying too little is refused identically on a machine
  // whose store cannot open at all.
  const shape = docEditProposal({
    kind: kind as DocEditKind,
    source: 'unresolved',
    locator: 'unresolved',
    document: (flags.document ?? '').trim(),
    anchor,
    proposed: (sides.now as { text: string }).text,
    citation: (flags.because ?? '').trim(),
  });
  if (shape.refused !== undefined) {
    process.stderr.write(`propose: nothing was filed — ${shape.refused}\n`);
    return 1;
  }

  return withStore((store) => {
    const asked = (flags.run ?? '').trim();
    const run = asked === '' || asked === 'true' ? '' : asked;
    const recorded = run === '' ? null : planFor(store, run);
    if (run !== '' && !recorded) {
      process.stderr.write(`propose: no plan recorded for ${run}\n`);
      return 1;
    }
    const workspace = flags.workspace?.trim() || recorded?.workspace || workspaceFlag(flags);
    const target = targetSource(store, workspace, (flags.source ?? '').trim());
    if (typeof target === 'number') return target;

    const built = docEditProposal({
      kind: kind as DocEditKind,
      source: target.id,
      locator: target.locator,
      document: (flags.document ?? '').trim(),
      anchor,
      proposed: (sides.now as { text: string }).text,
      citation: (flags.because ?? '').trim(),
    });
    if (built.refused !== undefined) {
      process.stderr.write(`propose: nothing was filed — ${built.refused}\n`);
      return 1;
    }
    const proposal = built.proposal;

    // A citation that claims a line of a deliverable has to resolve to one.
    // The words of a redline are not in the deliverable — a finding says what
    // is wrong, not what the document should say instead — so what is checked
    // is that the cited line exists, which is the same check extraction makes
    // and the reason a proposal can be read back to its origin at all.
    if (claimsDeliverable(proposal.justification)) {
      if (run === '') {
        process.stderr.write(
          `propose: ${proposal.justification} cites a deliverable, so name the run it belongs to:\n` +
            '  --run=<id>\n',
        );
        return 1;
      }
      const grounded = finishedDeliverables(store, run, '').some(
        (deliverable) => resolveFindingCitation(deliverable, proposal.justification) !== null,
      );
      if (!grounded) {
        process.stderr.write(
          `propose: ${proposal.justification} resolves to no line of any finished deliverable in ${run}.\n`,
        );
        return 1;
      }
    }

    const at = now();
    const row: WriteProposal = {
      id: proposal.id,
      workspace,
      run: run === '' ? null : run,
      source: proposal.source,
      change: proposal.change,
      justification: proposal.justification,
      risk: proposal.risk,
      proposedAt: at,
    };
    // Shown through the queue's own renderer before it is filed, so what a
    // person reads here is exactly what they will read when they decide it.
    process.stdout.write(
      `against ${target.kind} ${target.locator}, as the queue will show it:\n\n`,
    );
    writeProposalRow(store, row, writeConsentAllowsLowRisk(store, workspace));

    if (flags['dry-run'] !== undefined) {
      process.stdout.write('\nnothing was filed: --dry-run shows what would be proposed.\n');
      return 0;
    }
    if (getProposal(store, proposal.id) !== null) {
      process.stdout.write('\nalready proposed; the earlier row stands.\n');
      return 0;
    }
    try {
      proposeDocEdit(store, row, {
        kind: proposal.kind,
        document: proposal.document,
        anchor: proposal.anchor,
        proposed: proposal.proposed,
        recordedAt: at,
      });
    } catch (error) {
      process.stderr.write(`propose: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(
      `\nfiled ${proposal.id} at ${proposal.risk} risk.\n` +
        'Nothing was written to that document, and nothing here can be: the change moves only\n' +
        'through a recorded decision, and a high-risk one only through a person.\n' +
        `  construct propose list --workspace=${workspace}\n` +
        `  construct decide --approve=${proposal.id} "<why>"\n`,
    );
    return 0;
  });
}

/**
 * Turn the findings in a run's finished deliverables into write proposals, and
 * show the ones already waiting.
 *
 * The deliverables ended at the reader: a document with numbered issues and a
 * what-follows section is a list of changes somebody now retypes into whatever
 * tracker the work lives in, and the retyping is where the citation is lost —
 * the sentence arrives in the tracker with nobody able to say which finding it
 * came from. Extraction is mechanical, costs no model call, and is re-runnable:
 * ids are derived from the deliverable and the line, so proposing twice
 * proposes the same rows and the second pass says which were already filed.
 *
 * Nothing is written outward here and nothing here can write outward. A
 * proposal is a row to be decided on; carrying one out is a recorded decision
 * on a different surface, and low-risk standing consent is the workspace's own
 * declaration rather than anything this command may assume.
 */
export function propose(argv: string[]): number {
  const { flags, words } = splitFlags(argv);

  if (words[0] === 'list') {
    return withStore((store) => {
      const workspace = workspaceFlag(flags);
      const pending = pendingProposals(store, workspace);
      if (pending.length === 0) {
        process.stdout.write(`no proposals waiting for workspace ${workspace}.\n`);
        return 0;
      }
      const standing = writeConsentAllowsLowRisk(store, workspace);
      process.stdout.write(`proposals waiting in workspace ${workspace} (${String(pending.length)}):\n\n`);
      for (const proposal of pending) writeProposalRow(store, proposal, standing);
      process.stdout.write(
        '\nNothing here has been carried out. A proposal moves only through a recorded decision:\n' +
          '  construct decide --approve=<id> "<why>"   (or --reject)\n',
      );
      return 0;
    });
  }

  if (words[0] === 'doc') return proposeDoc(flags);

  if (words.length > 0) {
    process.stderr.write(`propose: unknown subcommand "${words[0]}"\n${PROPOSE_USAGE}`);
    return 2;
  }

  const run = (flags.run ?? '').trim();
  if (run === '' || run === 'true') {
    process.stderr.write(PROPOSE_USAGE);
    return 2;
  }

  return withStore((store) => {
    const recorded = planFor(store, run);
    if (!recorded) {
      process.stderr.write(`propose: no plan recorded for ${run}\n`);
      return 1;
    }
    const workspace = flags.workspace?.trim() || recorded.workspace;

    const sourceId = (flags.source ?? '').trim();
    const target = targetSource(store, workspace, sourceId);
    if (typeof target === 'number') return target;

    const only = (flags.task ?? '').trim();
    const deliverables: Deliverable[] = finishedDeliverables(store, run, only);

    if (deliverables.length === 0) {
      process.stderr.write(
        `propose: ${run} has no finished deliverable to read` +
          (only === '' || only === 'true' ? '' : ` for task ${only}`) +
          '.\n  construct show --run ' + run + '\n',
      );
      return 1;
    }

    const at = now();
    let filed = 0;
    let already = 0;
    const risks = { low: 0, high: 0 };
    for (const deliverable of deliverables) {
      const extraction = proposalsFrom({ deliverable, source: sourceId, locator: target.locator });
      process.stdout.write(
        `\n${deliverable.role} (${deliverable.task}): ` +
          `${String(extraction.proposals.length)} finding(s) that could be proposed\n`,
      );
      for (const drop of extraction.refused) {
        process.stdout.write(`  refused: "${escapeForTerminal(drop.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
      }
      for (const proposal of extraction.proposals) {
        process.stdout.write(
          `  ${proposal.id}  [${proposal.risk}, ${proposal.action}]  ${escapeForTerminal(proposal.change)}\n` +
            `      because: ${escapeForTerminal(proposal.justification)}\n`,
        );
        if (flags['dry-run'] !== undefined) continue;
        if (getProposal(store, proposal.id) !== null) {
          process.stdout.write('      already proposed; the earlier row stands\n');
          already += 1;
          continue;
        }
        proposeWrite(store, {
          id: proposal.id,
          workspace,
          run,
          source: proposal.source,
          change: proposal.change,
          justification: proposal.justification,
          risk: proposal.risk,
          proposedAt: at,
        });
        filed += 1;
        risks[proposal.risk] += 1;
      }
    }

    if (flags['dry-run'] !== undefined) {
      process.stdout.write('\nnothing was filed: --dry-run shows what extraction would propose.\n');
      return 0;
    }
    process.stdout.write(
      `\nfiled ${String(filed)} proposal(s) against ${target.kind} ${target.locator}` +
        ` (${String(risks.low)} low, ${String(risks.high)} high)` +
        (already > 0 ? `, ${String(already)} already proposed` : '') +
        '.\nNothing was written anywhere outside this system, and nothing here can be: a proposal\n' +
        'moves only through a recorded decision, and a high-risk one only through a human.\n' +
        `  construct propose list --workspace=${workspace}\n`,
    );
    return 0;
  });
}

/**
 * Audit a declared source's own files against the enablement gates
 * (accessibility tests, security tests, CI, lint strictness, typecheck), and
 * file a write proposal for every gate this pass found missing.
 *
 * The judgment is kernel/run/repoaudit.ts's, read from facts
 * hosts/repo/audit.ts gathered off the source's own locator. This function is
 * the store-touching glue construct propose already has a shape for: resolve
 * the declared source, run the pure pass over what it reads, and file what it
 * found through proposeWrite, the one door an outward change has. Nothing
 * here writes to the audited repository, and nothing here can — a proposal is
 * a row to be decided on, and carrying one out is a different, separately
 * recorded act.
 */
function audit(argv: string[]): number {
  const { flags } = parseFlags(argv);
  return withStore((store) => {
    const workspace = workspaceFlag(flags);
    const target = targetSource(store, workspace, (flags.source ?? '').trim());
    if (typeof target === 'number') return target;
    if (target.kind !== 'directory' && target.kind !== 'git') {
      process.stderr.write(
        `audit: ${target.id} is a ${target.kind} source; an enablement audit reads a repository's own ` +
          'files, which only a directory or git source has.\n',
      );
      return 1;
    }

    const facts = gatherRepoFacts(target.locator);
    if (facts.outcome === 'unreachable') {
      process.stderr.write(`audit: ${target.locator} — ${facts.reason}\n`);
      return 1;
    }

    const findings = evaluateGates(facts);
    const proposals = auditProposals({ findings, source: target.id, locator: target.locator });
    process.stdout.write(renderAuditDeliverable({ locator: target.locator, findings, proposals }));
    process.stdout.write('\n');

    if (flags['dry-run'] !== undefined) {
      process.stdout.write('nothing was filed: --dry-run shows what would be proposed.\n');
      return 0;
    }

    const at = now();
    let filed = 0;
    let already = 0;
    const risks = { low: 0, high: 0 };
    for (const proposal of proposals) {
      if (getProposal(store, proposal.id) !== null) {
        already += 1;
        continue;
      }
      proposeWrite(store, {
        id: proposal.id,
        workspace,
        run: null,
        source: proposal.source,
        change: proposal.change,
        justification: proposal.justification,
        risk: proposal.risk,
        proposedAt: at,
      });
      filed += 1;
      risks[proposal.risk] += 1;
    }
    process.stdout.write(
      `filed ${String(filed)} proposal(s) against ${target.kind} ${target.locator}` +
        ` (${String(risks.low)} low, ${String(risks.high)} high)` +
        (already > 0 ? `, ${String(already)} already proposed` : '') +
        '.\nNothing was written to that repository, and nothing here can be: a proposal moves only\n' +
        'through a recorded decision, and a high-risk one only through a human.\n' +
        `  construct propose list --workspace=${workspace}\n`,
    );
    return 0;
  });
}

/**
 * Show or set how a workspace engages: `team` (Construct is the whole team,
 * work tracked its own way) or `seat` (it fills one role on a human team and
 * works inside their tracker). Downstream consent postures read this, so it
 * is a declared setting rather than something inferred from usage.
 */
export function mode(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const workspace = workspaceFlag(flags);
  return withStore((store) => {
    if (flags.set !== undefined) {
      if (!(ENGAGEMENT_MODES as readonly string[]).includes(flags.set)) {
        process.stderr.write(MODE_USAGE);
        return 2;
      }
      setEngagementMode(store, workspace, flags.set as EngagementMode, now());
    }
    const current = engagementMode(store, workspace);
    process.stdout.write(
      `workspace ${workspace}: ${current}` +
        (current === 'team'
          ? ' (Construct is the whole team)\n'
          : ' (Construct fills one role on your team)\n'),
    );
    return 0;
  });
}

const CONSENT_USAGE = 'usage: construct consent [--workspace=<name>] [--set=<on|off>]\n';

/**
 * Show or set a workspace's standing consent for low-risk outward changes.
 *
 * Consent is a setting rather than evidence, so it upserts, and it prints
 * whether or not this call changed it — the value of the command is knowing
 * where a workspace stands, which is not something to have to infer from
 * whether a change went out.
 *
 * It covers exactly one class. A low-risk change under standing consent may
 * be carried out without a decision on that particular change; a high-risk
 * one never may, in any workspace and under any engagement mode, and turning
 * consent on says so out loud rather than leaving the reader to discover the
 * limit from a refusal later. A blanket yes is the wrong shape for the class
 * of change nobody can take back.
 */
export function consent(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const workspace = workspaceFlag(flags);
  if (flags.set !== undefined && flags.set !== 'on' && flags.set !== 'off') {
    process.stderr.write(CONSENT_USAGE);
    return 2;
  }
  return withStore((store) => {
    if (flags.set !== undefined) setWriteConsent(store, workspace, flags.set === 'on', now());
    const allows = writeConsentAllowsLowRisk(store, workspace);
    process.stdout.write(
      `workspace ${workspace}: standing consent ${allows ? 'on' : 'off'}` +
        (allows
          ? ' — a low-risk outward change may be carried out without a decision on each one.\n'
          : ' — every outward change waits for your decision.\n') +
        'High-risk changes are never covered by it: each one waits for ' +
        'construct decide --approve=<id> "<why>".\n',
    );
    return 0;
  });
}

const STANDING_USAGE =
  'usage: construct standing add --every=<N>m|<N>h|<N>d [--workspace=<name>] [--domains=<name,…>] "<what should keep happening>"\n' +
  '       construct standing [list] [--all]\n' +
  '       construct standing retire <id>\n' +
  '       construct standing --due [--host=… --model=… --binary=… --dir=… --ceiling=… ' +
  '--concurrency=… --lease-minutes=… --timeout=…]\n' +
  '         (schedule `construct standing --due` with cron or launchd; nothing here waits or wakes)\n';


/**
 * Fire what has come due: file a fresh, ordinary run per elapsed standing
 * outcome, then work exactly those runs through the normal work path. The
 * spend ceiling, leases, and the decision inbox behave exactly as they do for
 * a typed outcome, because these ARE typed outcomes — the store merely
 * remembered the typing.
 */
async function standingDue(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { filed, unfinished } = withStore((store) => {
    const due = dueStanding(store, now());
    const runs: Array<{ standing: string; run: string }> = [];
    for (const item of due) {
      const firedAt = now();
      const base = `run-${firedAt.replace(/[-:.TZ]/g, '')}`;
      // Two firings inside one clock tick must not share a run id.
      let runId = base;
      for (let n = 2; planFor(store, runId) !== null; n += 1) runId = `${base}-${String(n)}`;
      process.stdout.write(`standing ${item.id} came due (every ${renderCadence(item.everyMinutes)}):\n`);
      const started =
        item.domains !== null
          ? startRunSelected(store, { runId, outcome: item.outcome, at: firedAt, domains: item.domains })
          : startRun(store, { runId, outcome: item.outcome, at: firedAt });
      reportRun(started);
      planRun(store, started, null, item.workspace, firedAt);
      // Recorded after the run exists: a crash between the two re-files on the
      // next firing, which idempotent runs absorb; the other order could mark
      // fired an intention that never ran.
      recordFiring(store, { standing: item.id, run: runId, firedAt });
      runs.push({ standing: item.id, run: runId });
    }

    // A firing recorded is not a firing finished. A --due killed mid-flight
    // leaves pending or leased tasks on a run whose cadence now reads as
    // spent, so every earlier standing-filed run still carrying unsettled
    // tasks is picked up here, cadence or no cadence — the recipe's
    // resumability holds on this surface, not only on a bare `work`. Retired
    // standings included: their runs were filed and stand on the record.
    const filedIds = new Set(runs.map((r) => r.run));
    const unsettled: Array<{ standing: string; run: string }> = [];
    for (const item of listStanding(store, { includeRetired: true })) {
      for (const firing of firingsFor(store, item.id)) {
        if (filedIds.has(firing.run)) continue;
        if (unsettled.some((u) => u.run === firing.run)) continue;
        const counts = countTasksByState(store, firing.run);
        if ((counts.pending ?? 0) > 0 || (counts.leased ?? 0) > 0) {
          unsettled.push({ standing: item.id, run: firing.run });
        }
      }
    }
    return { filed: runs, unfinished: unsettled };
  });

  if (filed.length === 0 && unfinished.length === 0) {
    process.stdout.write('nothing is due.\n');
    return 0;
  }

  const passthrough = argv.filter((arg) => arg !== '--due');
  let worst = 0;
  for (const firing of unfinished) {
    process.stdout.write(
      `\nresuming ${firing.run} (standing ${firing.standing} — unfinished from an earlier firing):\n`,
    );
    const code = await work([`--run=${firing.run}`, ...passthrough], hostOverride);
    if (code > worst) worst = code;
  }
  for (const firing of filed) {
    process.stdout.write(`\nworking ${firing.run} (standing ${firing.standing}):\n`);
    const code = await work([`--run=${firing.run}`, ...passthrough], hostOverride);
    if (code > worst) worst = code;
  }
  return worst;
}

/**
 * Standing outcomes: a recurring intention the spine re-files on its own
 * cadence. Declaring stores the intention and runs nothing; `--due` files and
 * works what has elapsed. There is deliberately no daemon and no waiting
 * here — cron or launchd owns the clock, exactly as docs/scheduled-operation.md
 * always had it, and the store only knows what is due.
 */
export async function standing(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);

  if (flags.due !== undefined) return standingDue(argv, hostOverride);

  const sub = words[0];

  if (sub === 'add') {
    const text = words.slice(1).join(' ').trim();
    if (!text || flags.every === undefined) {
      process.stderr.write(STANDING_USAGE);
      return 2;
    }
    let everyMinutes: number;
    try {
      everyMinutes = parseCadence(flags.every);
    } catch (error) {
      process.stderr.write(`standing: ${(error as Error).message}\n`);
      return 2;
    }
    const domains =
      flags.domains === undefined
        ? null
        : flags.domains
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
    // A staff typo caught here costs one retype; caught at 3 a.m. by cron it
    // costs every firing until somebody reads the log.
    const unknown = (domains ?? []).filter((name) => !DOMAINS.some((d) => d.domain === name));
    if (unknown.length > 0) {
      process.stderr.write(
        `standing: no catalog domain named ${unknown.map((u) => JSON.stringify(u)).join(', ')}\n`,
      );
      return 2;
    }
    return withStore((store) => {
      const at = now();
      const id = `standing-${at.replace(/[-:.TZ]/g, '')}`;
      try {
        declareStanding(store, {
          id,
          workspace: workspaceFlag(flags),
          outcome: text,
          domains,
          everyMinutes,
          declaredAt: at,
        });
      } catch (error) {
        process.stderr.write(`standing: ${(error as Error).message}\n`);
        return 1;
      }
      process.stdout.write(
        `declared ${id}: every ${renderCadence(everyMinutes)} (workspace ${workspaceFlag(flags)})\n` +
          `  outcome: ${text}\n` +
          '  nothing runs until `construct standing --due` fires — schedule that with cron or launchd.\n',
      );
      return 0;
    });
  }

  if (sub === 'retire') {
    const id = (words[1] ?? '').trim();
    if (!id) {
      process.stderr.write(STANDING_USAGE);
      return 2;
    }
    return withStore((store) => {
      try {
        retireStanding(store, id, now());
      } catch (error) {
        process.stderr.write(`standing: ${(error as Error).message}\n`);
        return 1;
      }
      process.stdout.write(`retired ${id}; its firings stay on the record\n`);
      return 0;
    });
  }

  if (sub === undefined || sub === 'list') {
    return withStore((store) => {
      const rows = listStanding(store, { includeRetired: flags.all !== undefined });
      if (rows.length === 0) {
        process.stdout.write('no standing outcomes declared.\n');
        return 0;
      }
      for (const row of rows) {
        const last = lastFiredAt(store, row.id);
        process.stdout.write(
          `${row.id}  every ${renderCadence(row.everyMinutes)}  (workspace ${row.workspace})` +
            (row.domains ? `  staff: ${row.domains.join(', ')}` : '') +
            (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
            '\n' +
            `  outcome: ${row.outcome}\n` +
            `  ${last ? `last fired ${last}` : 'never fired'}\n`,
        );
      }
      return 0;
    });
  }

  process.stderr.write(STANDING_USAGE);
  return 2;
}

const STAFF_USAGE =
  'usage: construct staff list [--run=<id>]\n' +
  '       construct staff propose --run=<id> --file=<profile.json>\n';

/**
 * The surface on the staffing gate.
 *
 * A run that meets a concern the catalog cannot carry records it and moves on,
 * which is the right behavior — routing must not widen itself as a side effect
 * of one outcome. What was missing is the other half: the record sat in the work
 * log with no way to act on it, so staffing the concern meant writing code. This
 * lists what a run could not carry, and puts a drafted profile through the gate
 * that already exists.
 *
 * No judgement lives here. `evaluateProfile` decides, its refusal is printed in
 * its own words rather than summarized, and an admitted profile becomes an inbox
 * decision whose default position is NOT STAFFED. Nothing on this path admits a
 * domain; a person does, by resolving that decision.
 */
export function staff(argv: string[]): number {
  const sub = argv[0];
  const { flags } = parseFlags(argv.slice(1));
  const run = (flags.run ?? '').trim();

  if (sub === 'list') {
    return withStore((store) => {
      const unmet = readWorkLog(store, run || undefined).filter((e) => e.action === 'concern-unmet');
      if (unmet.length === 0) {
        process.stdout.write(
          run
            ? `no unmet concerns recorded for ${run} — every concern the run named is in the catalog.\n`
            : 'no unmet concerns recorded — every concern named so far is in the catalog.\n',
        );
        return 0;
      }
      for (const entry of unmet) {
        const d = (entry.detail ?? {}) as Record<string, unknown>;
        process.stdout.write(
          `${String(entry.seq).padStart(4)}  ${entry.run}  proposed "${escapeForTerminal(String(d.proposed ?? ''))}"` +
            `  [${escapeForTerminal(String(d.reason ?? 'reason not recorded'))}]\n` +
            `      because: ${escapeForTerminal(String(d.why || '(the namer gave no reason, which is what refused it)'))}\n`,
        );
      }
      process.stdout.write(
        `\n${String(unmet.length)} unmet concern(s). A concern is staffed by drafting a profile and\n` +
          'putting it through the gate:  construct staff propose --run=<id> --file=<profile.json>\n' +
          'The profile must name its slots, rebut every domain that claims its words, and cite the\n' +
          'practice its method descends from (or say why none could be named).\n',
      );
      return 0;
    });
  }

  if (sub === 'propose') {
    const file = (flags.file ?? '').trim();
    if (run === '' || file === '') {
      process.stderr.write(STAFF_USAGE);
      return 2;
    }
    let proposal: StaffingProposal;
    try {
      proposal = JSON.parse(readFileSync(file, 'utf8')) as StaffingProposal;
    } catch (error) {
      process.stderr.write(`staff: cannot read a profile from ${file}: ${(error as Error).message}\n`);
      return 1;
    }
    // A hand-written profile that omits a list would crash the gate on a
    // property access, and a stack trace is a worse answer than the refusal the
    // gate was going to give anyway.
    const outcome = evaluateProfile({
      ...proposal,
      rebuttals: proposal.rebuttals ?? [],
      standards: proposal.standards ?? [],
      slots: proposal.slots ?? [],
    });

    if (outcome.refused) {
      process.stderr.write(`refused (${outcome.refused.kind}): ${outcome.refused.reason}\n`);
      if (outcome.refused.domain) {
        process.stderr.write(`  the domain that already carries it: ${outcome.refused.domain}\n`);
      }
      return 1;
    }

    return withStore((store) => {
      const at = now();
      const id = `staffing:${run}:${outcome.admitted.proposed}`;
      if (openDecisions(store).some((d) => d.id === id)) {
        process.stderr.write(
          `staff: "${outcome.admitted.proposed}" is already waiting on a decision for ${run}.\n` +
            '  Read it:  construct inbox\n',
        );
        return 1;
      }
      proposeStaffing(store, { id, run, profile: outcome.admitted, at });
      process.stdout.write(
        `admitted to the gate as "${outcome.admitted.proposed}" (${outcome.admitted.evidenceTier}).\n` +
          `  ${outcome.admitted.tierReason}\n\n` +
          'This staffs nothing yet. The catalog changes only when you resolve the decision, and\n' +
          `its default position is: ${NOT_STAFFED}.\n` +
          `  construct inbox\n  construct decide --id=${id} --resolution="..."\n`,
      );
      return 0;
    });
  }

  process.stderr.write(STAFF_USAGE);
  return 2;
}


const USAGE =
  'usage: construct <outcome|ask|work|notes|review|show|compose|plan|source|propose|audit|standing|record|mode|consent|staff|skills|watch|reconcile|waive|revoke|verdict|corpus|log|inbox|decide|lessons|serve|doctor|backup|cleanup|version>\n';

/**
 * Async because `work` dispatches to a host, and `outcome --host=…` may
 * consult one. The other commands stay synchronous — awaiting a number costs
 * nothing and keeps one entry point.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  // `construct outcome … | head -1` closes the pipe while the command is still
  // writing, and an unhandled write to a closed stdout throws an 'error' event
  // that Node reports as a crash with a full stack. Piping into head, less, or
  // grep -m1 is ordinary use, and a stack trace on it reads as a broken tool.
  // A reader that has gone away is a normal end for a CLI, not a failure, so
  // the process stops quietly at that point rather than reporting one.
  const quitOnClosedOutput = (error: NodeJS.ErrnoException): void => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  };
  process.stdout.on('error', quitOnClosedOutput);
  process.stderr.on('error', quitOnClosedOutput);

  try {
    return await run(argv);
  } catch (error) {
    // Only this class. Every other throw keeps its stack, because a defect that
    // reads as a tidy one-liner is a defect nobody reports.
    if (!(error instanceof StoreUnavailableError)) throw error;
    process.stderr.write(`construct: ${error.message}\n`);
    return 1;
  }
}

async function run(argv: string[]): Promise<number> {
  const command = argv[0] ?? 'help';
  switch (command) {
    case 'review':
      return review(argv.slice(1));
    case 'record':
      return record(argv.slice(1));
    case 'compose':
      return compose(argv.slice(1));
    case 'notes':
      return notes(argv.slice(1));
    case 'outcome':
      return outcome(argv.slice(1));
    case 'ask':
      return ask(argv.slice(1));
    case 'work':
      return work(argv.slice(1));
    case 'watch':
      return watch(argv.slice(1));
    case 'reconcile':
      return reconcile(argv.slice(1));
    case 'waive':
      return waive(argv.slice(1));
    case 'verdict':
      return verdict(argv.slice(1));
    case 'corpus':
      return corpus(argv.slice(1));
    case 'log':
      return log(argv.slice(1));
    case 'show':
      return show(argv.slice(1));
    case 'plan':
      return plan(argv.slice(1));
    case 'source':
      return source(argv.slice(1));
    case 'propose':
      return propose(argv.slice(1));
    case 'audit':
      return audit(argv.slice(1));
    case 'standing':
      return standing(argv.slice(1));
    case 'mode':
      return mode(argv.slice(1));
    case 'consent':
      return consent(argv.slice(1));
    case 'staff':
      return staff(argv.slice(1));
    case 'skills':
      return skills(argv.slice(1));
    case 'inbox':
      return inbox();
    case 'decide':
      return decide(argv.slice(1));
    case 'lessons':
      return lessons(argv.slice(1));
    case 'serve':
      return serve();
    case 'role-serve':
      return roleServe();
    case 'revoke':
      return revoke(argv.slice(1));
    case 'doctor':
      return doctor();
    case 'backup':
      return backup(argv.slice(1));
    case 'cleanup':
      return cleanup(argv.slice(1));
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${packageVersion()}\n`);
      process.stdout.write(`${tuningStamp()}\n`);
      return 0;
    default:
      process.stdout.write(USAGE);
      return command === 'help' ? 0 : 1;
  }
}
