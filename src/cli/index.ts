/**
 * cli/index.ts — the one CLI. Phase 0 surface: doctor, version. Phase 1 adds
 * cleanup. Commands stay few; capability grows in packs and kernel libraries,
 * not in CLI surface.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolvePaths } from '../kernel/paths.ts';
import { buildCleanupCatalog, projectTreeLitter } from '../kernel/cleanup/catalog.ts';
import type { SpawnFn } from '../kernel/cleanup/catalog.ts';
import { detectedItems, selectedItems, applyCleanup } from '../kernel/cleanup/run.ts';
import type { CleanupOptions } from '../kernel/cleanup/run.ts';
import { writeFileSync } from 'node:fs';
import { openStore, storePath, storeWriteProblem, StoreUnavailableError } from '../kernel/store/open.ts';
import type { Store } from '../kernel/store/open.ts';
import { appendWorkLog, readWorkLog } from '../kernel/store/worklog.ts';
import {
  CAPABILITY_DENIED_ACTION,
  revocationOf,
  revokeRoleCapability,
} from '../kernel/run/rolewrite.ts';
import { readRunDispatch, recordRunDispatch } from '../kernel/store/dispatch.ts';
import {
  addSource,
  ENGAGEMENT_MODES,
  setSourceShape,
  sourceShape,
  SURVEY_EMPHASES,
  engagementMode,
  getSource,
  retireSource,
  setEngagementMode,
  SOURCE_KINDS,
  sourcesFor,
} from '../kernel/store/sources.ts';
import { groundRootsFor, recordRunSourceReads } from '../kernel/run/sourcereads.ts';
import { groundReach, unreachableGroundMessage } from '../kernel/run/reachability.ts';
import type { SourceSurvey } from '../kernel/run/sourcereads.ts';
import { DOCUMENT_CAP, listDocuments, surveySource } from '../hosts/sources.ts';
import type { EngagementMode, Source, SourceKind, SurveyEmphasis } from '../kernel/store/sources.ts';
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
import { toReviewedDrift } from '../kernel/context/review.ts';
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
import { foldClosingRound, screenClosedAnswers } from '../kernel/run/closing.ts';
import { COMPOSITION_SHAPES, shapeByName, shapeForOutcome, shapeNames } from '../kernel/run/shapes.ts';
import type { CompositionShape } from '../kernel/run/shapes.ts';
import { renderAttribution, renderClaim, renderComposedClaim, renderHeading } from '../kernel/run/publish.ts';
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
import type { ScreenResult } from '../kernel/context/observations.ts';
import {
  operationalLessonsFor,
  decideAdmission,
  admissionOf,
  riskTierFor,
  runDerived,
} from '../kernel/lessons/admission.ts';
import { distillDecisionLesson, DECISION_CITATION_PREFIX } from '../kernel/lessons/fromDecisions.ts';
import { recordLesson, getLesson, lessonsFor, type Lesson } from '../kernel/store/lessons.ts';
import {
  createHostApplier,
  createHostChallenger,
  createHostProducer,
  createHostReviewer,
} from '../hosts/contextloop.ts';
import { openDecisions, resolveDecision, getDecision } from '../kernel/store/decisions.ts';
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
import { recordCatalogSighting } from '../kernel/store/catalog.ts';
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
import { createOpenCodeAdapter } from '../hosts/opencode/adapter.ts';
import { createClaudeAdapter } from '../hosts/claude/adapter.ts';
import { createCodexAdapter } from '../hosts/codex/adapter.ts';
import { createCursorAdapter } from '../hosts/cursor/adapter.ts';
import { dispatchFloorFor } from '../hosts/floors.ts';
import { loadOrCreateSecret, loadSecret } from '../kernel/capabilities/secretfile.ts';
import { readRoleEnv } from '../kernel/run/roleenv.ts';
import { serveRole } from './roleserve.ts';
import { serveProjection } from '../hosts/mcp/projection.ts';
import { gatherRepoEvidence, isFailure } from '../hosts/repo/evidence.ts';
import { reconcileSession } from '../kernel/tracker/session-drift.ts';
import { constructFindings, CONSTRUCT_GROUND } from '../kernel/watch/construct-ground.ts';
import { startWatch, sweepWatch, watchRun } from '../kernel/watch/watch.ts';
import { latestDraft, promotionOf, waiveChallenge } from '../kernel/run/promotion.ts';
import { buildPlan } from '../kernel/plan/planner.ts';
import { LENSES } from '../kernel/plan/lenses.ts';
import { allPlaybooks } from '../kernel/plan/playbooks.ts';
import { LENS_STANDARDS } from '../kernel/plan/standards.ts';
import {
  planSkillsUninstall,
  projectSkillsPack,
  SKILL_FILENAME,
} from '../kernel/skills/projection.ts';
import { synthesizeIssues } from '../kernel/run/synthesis.ts';
import { planFor, recordPlan } from '../kernel/store/plans.ts';
import type { Watch } from '../kernel/watch/watch.ts';
import { join } from 'node:path';
import { tuningStamp } from '../hosts/tuning.ts';
import { presenceLines, surveyHosts } from '../hosts/presence.ts';
import { probeDocling, readSource } from '../hosts/extract.ts';

const MIN_NODE = { major: 22, minor: 18 };

/**
 * One host name to one adapter, everywhere a --host flag is honored. The
 * default stays opencode; unknown names are the callers' to refuse (work()
 * validates; outcome/ask/notes accept only what their usage line names).
 */
/**
 * The hosts this CLI can dispatch through. One list, so the flag validator,
 * the error text, and the adapter switch can never disagree about what is
 * dispatchable.
 */
export const HOST_NAMES = ['opencode', 'claude', 'codex', 'cursor'] as const;

export type HostName = (typeof HOST_NAMES)[number];

function adapterForHost(
  host: string | undefined,
  opts: { readonly binary?: string; readonly model?: string; readonly dir?: string; readonly timeoutMs?: number },
): HostAdapter {
  if (host === 'claude') return createClaudeAdapter(opts);
  if (host === 'codex') return createCodexAdapter(opts);
  if (host === 'cursor') return createCursorAdapter(opts);
  return createOpenCodeAdapter(opts);
}

function packageVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return (parsed as { version: string }).version;
}

function nodeFloorOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major !== MIN_NODE.major) return major > MIN_NODE.major;
  return minor >= MIN_NODE.minor;
}

export function doctor(cwd: string = process.cwd()): number {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: 'node',
    ok: nodeFloorOk(process.versions.node),
    detail: `v${process.versions.node} (floor: ${MIN_NODE.major}.${MIN_NODE.minor})`,
  });

  const paths = resolvePaths();
  checks.push({ name: 'paths', ok: true, detail: `state: ${paths.stateDir}` });

  // Stale-loudly: the stamp carries the dates the tuning evidence was
  // recorded, so an aging matrix reads as aged instead of current.
  checks.push({ name: 'matrix', ok: true, detail: tuningStamp() });

  // Resolving a path proves nothing about being able to use it. Before this
  // check, doctor reported "healthy" against a data dir it could not write,
  // and the user found out from a stack trace on their next command.
  const store = storePath(paths);
  const problem = storeWriteProblem(store);
  checks.push({
    name: 'store',
    ok: problem === null,
    detail: problem === null ? store : `${store} — ${problem}`,
  });

  // Hosts are reported, never gated: a missing host is information, because
  // serve-only use is legitimate. Before this, a user without a host met the
  // absence as mid-run errors instead of one line here.
  for (const line of presenceLines(surveyHosts())) {
    checks.push({ name: 'host', ok: true, detail: line });
  }

  // Predecessor markers in the project tree: reported like host presence,
  // not gated — finding one says nothing about whether this install is
  // healthy, only that `construct cleanup` has something to look at. Doctor
  // only names it; it never removes anything itself.
  for (const finding of projectTreeLitter(cwd)) {
    checks.push({ name: 'litter', ok: true, detail: finding.detail });
  }

  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}  ${check.detail}\n`);
  }
  process.stdout.write(failed === 0 ? 'doctor: healthy\n' : `doctor: ${failed} check(s) failed\n`);
  return failed === 0 ? 0 : 1;
}

interface CleanupArgs extends CleanupOptions {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly withImages: boolean;
  readonly cwd: string;
  readonly home: string;
}

export function parseCleanupArgs(argv: string[]): CleanupArgs {
  let scope: CleanupOptions['scope'] = 'all';
  let dryRun = false;
  let yes = false;
  let all = false;
  let keepState = false;
  let withImages = false;
  let cwd = process.cwd();
  let home = homedir();
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--all') all = true;
    else if (arg === '--keep-state') keepState = true;
    else if (arg === '--with-images') withImages = true;
    else if (arg.startsWith('--scope=')) scope = arg.slice('--scope='.length) as CleanupOptions['scope'];
    else if (arg.startsWith('--cwd=')) cwd = arg.slice('--cwd='.length);
    else if (arg.startsWith('--home=')) home = arg.slice('--home='.length);
  }
  if (!['project', 'machine', 'all'].includes(scope)) {
    throw new Error(`Invalid --scope=${scope}; expected project|machine|all`);
  }
  return { scope, dryRun, yes, all, keepState, withImages, cwd, home };
}

// `spawnOverride` exists only so tests can fake out docker/launchctl instead
// of depending on the real machine's ambient state; production callers never
// pass it.
export function cleanup(argv: string[], spawnOverride?: SpawnFn): number {
  const args = parseCleanupArgs(argv);
  const paths = resolvePaths(process.env, args.home);
  const catalog = buildCleanupCatalog({
    cwd: args.cwd,
    home: args.home,
    paths,
    withImages: args.withImages,
    spawn: spawnOverride,
  });
  const detected = detectedItems(catalog, args);

  if (detected.length === 0) {
    process.stdout.write('cleanup: no predecessor state detected in the selected scope.\n');
    return 0;
  }

  if (args.dryRun) {
    process.stdout.write(`cleanup: dry-run plan (scope=${args.scope}${args.keepState ? ', keep-state' : ''}):\n`);
    let removable = 0;
    for (const item of detected) {
      // A kept item must not wear the mark that means "this will be removed".
      // Saying KEPT beside a ✓ under "pass --yes to remove ✓ items" is a
      // contradiction, and the mark is what gets read.
      const keeping = item.keeps?.() ?? false;
      if (!keeping) removable += 1;
      const mark = keeping ? '•' : item.risk === 'auto' ? '✓' : '◐';
      process.stdout.write(`  ${mark} ${item.label}\n      ${item.describe()}\n`);
    }
    process.stdout.write(
      removable === 0
        ? '\nNothing to remove: every detected item belongs to the Construct that is running.\n'
        : '\nPass --yes to remove ✓ items, --yes --all to also remove ◐ items. • items are kept either way.\n',
    );
    return 0;
  }

  if (!args.yes) {
    process.stderr.write('cleanup: pass --dry-run to preview, or --yes (optionally --all) to apply.\n');
    return 2;
  }

  const toRemove = selectedItems(detected, args.all);
  const result = applyCleanup(detected, new Set(toRemove.map((item) => item.id)));
  // An item that reports "kept" ran and deliberately removed nothing — the
  // successor owns that directory. Counting it as removed would
  // make the summary say a thing was deleted that is still there, which is the
  // class of claim this project exists to not make.
  const kept = result.removed.filter((o) => o.detail.startsWith('kept'));
  const actuallyRemoved = result.removed.filter((o) => !o.detail.startsWith('kept'));
  for (const outcome of actuallyRemoved) {
    process.stdout.write(`  ✓ ${outcome.label} — ${outcome.detail}\n`);
  }
  for (const outcome of kept) {
    process.stdout.write(`  • ${outcome.label} — ${outcome.detail}\n`);
  }
  process.stdout.write(
    `\ncleanup: removed ${String(actuallyRemoved.length)}, ` +
      `kept ${String(kept.length)}, skipped ${String(result.skipped.length)}.\n`,
  );
  return actuallyRemoved.some((o) => o.detail.startsWith('error:')) ? 1 : 0;
}

/**
 * The spine commands. The CLI is the host here, so it is the CLI that supplies
 * the clock and the run id — the kernel does neither.
 */
function withStore<T>(fn: (store: Store) => T): T {
  const store = openStore(storePath(resolvePaths()));
  try {
    leaveCatalogMark(store);
    return fn(store);
  } finally {
    store.close();
  }
}

/**
 * Every open leaves word of the catalog this build carries. The store is the
 * one place every Construct on the machine visits — the released binary a host
 * launches and the newer tree the user runs — so it is where an older build's
 * catalog reads learn they are behind. Advance-only in the store; recording
 * the same or an older catalog writes nothing.
 */
function leaveCatalogMark(store: Store): void {
  recordCatalogSighting(store, {
    version: packageVersion(),
    domains: DOMAINS.length,
    at: now(),
  });
}

/**
 * The async twin. Separate rather than generic over both, because a `finally`
 * that closes the store around a function returning a promise closes it while
 * the work is still running — the failure mode is a coordinator writing to a
 * closed database, and it only shows up under load.
 */
async function withStoreAsync<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const store = openStore(storePath(resolvePaths()));
  try {
    leaveCatalogMark(store);
    return await fn(store);
  } finally {
    store.close();
  }
}

function now(): string {
  return new Date().toISOString();
}

/** Where the token-signing secret lives: next to the store it guards. */
function secretFile(): string {
  return join(resolvePaths().dataDir, 'capability-secret');
}

/**
 * Serve one role's write surface over MCP stdio. Not in USAGE on purpose:
 * a host's MCP configuration launches this with the role environment set by
 * the dispatcher (see kernel/run/roleenv.ts); it is plumbing a person never
 * types. The secret is load-only here — a serving process that invented a
 * fresh secret would deny every honestly-minted token as a forgery, and that
 * misconfiguration should read as this one line instead.
 */
async function roleServe(): Promise<number> {
  const scope = readRoleEnv(process.env);
  if (!scope) {
    process.stderr.write(
      'role-serve: missing CONSTRUCT_ROLE_TOKEN / CONSTRUCT_ROLE_RUN / CONSTRUCT_ROLE_TASK — ' +
        'this command is launched by a host with the dispatcher-set role environment.\n',
    );
    return 2;
  }
  const secret = loadSecret(secretFile());
  if (secret === null) {
    process.stderr.write(
      'role-serve: no capability secret exists yet — it is established the first time "construct work" dispatches.\n',
    );
    return 1;
  }
  const store = openStore(storePath(resolvePaths()));
  try {
    await serveRole(
      {
        store,
        secret,
        token: scope.token,
        run: scope.run,
        task: scope.task,
        clock: now,
        serverVersion: packageVersion(),
      },
      process.stdin,
      process.stdout,
    );
  } finally {
    store.close();
  }
  return 0;
}

/**
 * Serve the spine's projection over MCP stdio: presence inside whatever MCP
 * host the user already works in (one server, every host — commitment 1's
 * amendment). An MCP configuration launches this ({"command": "construct",
 * "args": ["serve"]}); it holds no capability secret and exposes no dispatch
 * and no completion writes — those stay on `work` and the role server.
 */
async function serve(): Promise<number> {
  return withStoreAsync(async (store) => {
    await serveProjection(
      { store, clock: now, serverVersion: packageVersion() },
      process.stdin,
      process.stdout,
    );
    return 0;
  });
}

const OUTCOME_USAGE =
  'usage: construct outcome [--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…]] ' +
  '[--domains=<name,…>] [--workspace=<name>] [--timeout=<minutes>] "<what you want to happen>"\n';

export interface OutcomeArgs {
  readonly text: string;
  /**
   * Naming a host is the opt-in to spend (the original opt-in rule, carried into
   * the inversion): recording an outcome without one is free and deterministic,
   * and a model charge at the moment a user writes down an intention is the
   * least expected charge in the product. With a host named, its model is the
   * primary namer on every outcome (adopted 2026-08-05).
   */
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /**
   * Domains the user named outright. Inference is the door for the user who
   * does not know what to ask for; this is the door for the user who does.
   */
  readonly domains?: readonly string[];
  /**
   * Which workspace's declared sources and engagement mode the plan is built
   * from. `source add` and `ask` already take it; a run that could not be
   * pointed at the same ground they were is a flag that means something on one
   * command and nothing on the next.
   */
  readonly workspace: string;
  /** How long one host invocation may run, in milliseconds. Host default when unset. */
  readonly timeoutMs?: number;
}

export function parseOutcomeArgs(argv: string[]): OutcomeArgs {
  const flags: Record<string, string> = {};
  const words: string[] = [];

  for (const arg of argv) {
    if (arg === '--escalate') {
      // Removed with the inversion, loudly: silence here would read as the
      // old behavior still existing.
      throw new Error(
        '--escalate was removed: a named host\'s model is primary on every outcome now; use --host=<opencode|claude|codex|cursor>',
      );
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2];
      continue;
    }
    words.push(arg);
  }

  const host = flags.host;
  if (host !== undefined && host !== 'opencode' && host !== 'claude' && host !== 'codex' && host !== 'cursor') {
    throw new Error(`unknown host "${host}" (expected opencode, claude, codex, or cursor)`);
  }

  // A flag that is quietly ignored is a flag that lies. --model/--binary/--dir
  // only mean something when a model is going to be consulted, so supplying one
  // without --host is a usage error rather than a silent no-op.
  const hostFlags = ['model', 'binary', 'dir', 'timeout'].filter((f) => flags[f] !== undefined);
  if (host === undefined && hostFlags.length > 0) {
    throw new Error(
      `--${hostFlags[0]} only applies when a host is named; add --host=<opencode|claude|codex|cursor>, or drop the flag`,
    );
  }

  const timeoutMs = timeoutFlag(flags);

  const domains =
    flags.domains === undefined
      ? undefined
      : flags.domains
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0);

  // Same rule, other direction: naming the domains skips inference entirely,
  // so a host would be consulted for nothing and charged for it.
  if (domains !== undefined && host !== undefined) {
    throw new Error(
      '--domains names the staff outright, so no model is consulted; drop --host, or drop --domains to let it infer',
    );
  }
  if (domains !== undefined && domains.length === 0) {
    throw new Error('--domains needs at least one domain name');
  }

  return {
    text: words.join(' ').trim(),
    host,
    model: flags.model,
    binary: flags.binary,
    dir: flags.dir,
    domains,
    workspace: workspaceFlag(flags),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/**
 * Where extracted text is materialized. Under the cache root rather than the
 * user's ground: an extraction is a rendering Construct produced, and writing
 * it into the directory the user declared would put Construct's output inside
 * its own evidence.
 */
function extractionCacheRoot(): string {
  return join(resolvePaths().cacheDir, 'extractions');
}

/**
 * Survey a set of declared sources, extracting whatever the walk could not
 * read. The one place a survey is asked for, so every surface that grounds
 * itself — a run's dispatch, a drift pass over a workspace — sees the same
 * documents, extracted the same way, with one Docling probe between them.
 */
function surveyDeclared(store: Store, sources: readonly Source[]): SourceSurvey[] {
  if (sources.length === 0) return [];
  const extract = { cacheRoot: extractionCacheRoot(), docling: probeDocling() };
  return sources.map((source) => {
    // A source nobody shaped is surveyed the way every source was before the
    // setting existed, so declaring nothing keeps today's behavior exactly.
    const shape = sourceShape(store, source.id);
    return surveySource(source, {
      extract,
      ...(shape ? { emphasis: shape.emphasis, cap: shape.cap } : {}),
    });
  });
}

/**
 * The two views a drift pass needs of the same survey: what the producer is
 * shown, and what the screen checks its citations against. Built together so
 * the model can never be shown one set of documents and graded on another.
 */
function driftGround(
  sources: readonly Source[],
  surveys: readonly SourceSurvey[],
): { readonly producerSources: ProducerSource[]; readonly surveyed: Map<string, Set<string>> } {
  const bySource = new Map(surveys.map((s) => [s.source, s]));
  const surveyed = new Map<string, Set<string>>();
  const producerSources = sources.map((source) => {
    const survey = bySource.get(source.id);
    const base = { id: source.id, kind: source.kind, locator: source.locator };
    if (!survey || survey.outcome !== 'listed') {
      return { ...base, documents: [], unreachable: survey?.reason ?? 'no survey was taken' };
    }
    const documents = survey.documents.map((d) => d.path);
    surveyed.set(source.id, new Set(documents));
    return { ...base, documents };
  });
  return { producerSources, surveyed };
}

export interface GroundingPass {
  readonly surveys: readonly SourceSurvey[];
  readonly recorded: number;
  /** True when the run already had reads and this pass wrote nothing. */
  readonly skipped: boolean;
  readonly documents: number;
  readonly unreachable: number;
  readonly extracted: number;
}

/**
 * The producer half of grounding for one run: survey every declared source,
 * put its unreadable documents into words, record what was read, and log it.
 *
 * One function because `outcome --answer` and `work` were doing this
 * identically in two places, and two copies of a grounding pass is two
 * chances for a run to be graded against ground it was never licensed.
 * Recording is once per run — the read record is evidence, not a cache — so a
 * second pass reports skipped and writes nothing.
 */
function groundRun(store: Store, run: string, at: string): GroundingPass | null {
  const plan = planFor(store, run);
  if (!plan || plan.sourcesDeclared.length === 0) return null;

  const declared = plan.sourcesDeclared
    .map((id) => getSource(store, id))
    .filter((s): s is Source => s !== null && s !== undefined);
  const surveys = surveyDeclared(store, declared);

  const { recorded, skipped } = recordRunSourceReads(store, run, surveys, at);
  const listed = surveys.filter((s) => s.outcome === 'listed');
  const documents = listed.reduce((sum, s) => sum + s.documents.length, 0);
  const extracted = listed.reduce(
    (sum, s) => sum + s.documents.filter((d) => d.extraction?.outcome === 'extracted').length,
    0,
  );
  const pass: GroundingPass = {
    surveys,
    recorded,
    skipped,
    documents,
    unreachable: surveys.length - listed.length,
    extracted,
  };
  if (skipped) return pass;

  appendWorkLog(store, {
    run,
    role: 'construct',
    action: 'sources-read',
    detail: {
      sources: surveys.length,
      documents,
      unreachable: pass.unreachable,
      extracted,
      reads: recorded,
      // Licensed vs listed, on the record: the listed documents are the read
      // rows; the roots are what the roles may read past them.
      licensedRoots: listed.map((s) => s.locator).sort(),
    },
    at,
  });
  return pass;
}

/** The one-line grounding summary both survey surfaces print. */
function groundingSummary(pass: GroundingPass): string {
  return (
    `${String(pass.documents)} document${pass.documents === 1 ? '' : 's'} ` +
    `from ${String(pass.surveys.length)} source${pass.surveys.length === 1 ? '' : 's'}` +
    (pass.extracted > 0 ? `, ${String(pass.extracted)} extracted` : '') +
    (pass.unreachable > 0 ? ` (${String(pass.unreachable)} unreachable)` : '')
  );
}

/**
 * Build and record the run's plan from what the run already established: the
 * implicated domains and how they were inferred, the workspace's declared
 * sources, and its engagement mode. Recorded write-once at outcome time so
 * `work` executes against a stated plan rather than an implicit one.
 */
function planRun(
  store: Store,
  started: StartedRun,
  densified: DensifiedIntake | null,
  workspace: string,
  at: string,
  /**
   * The concerns this run will actually dispatch, when that is narrower than
   * what it implicated. A question is answered by one of them, and a plan
   * listing steps nobody will work would be a schedule of work that is not
   * going to happen.
   */
  dispatching?: readonly Implication[],
): void {
  const plan = buildPlan({
    id: `plan-${started.runId}`,
    run: started.runId,
    outcome: started.outcome,
    densified,
    implicated: dispatching ?? started.implicated,
    inferredBy: started.inferredBy,
    sources: sourcesFor(store, workspace),
    workspace,
    mode: engagementMode(store, workspace),
    plannedAt: at,
  });
  recordPlan(store, plan);
  process.stdout.write(
    `\nplan ${plan.id}: ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}, ` +
      `risk ${plan.riskTier}` +
      (plan.sourcesDeclared.length > 0
        ? `, over ${plan.sourcesDeclared.length} declared source${plan.sourcesDeclared.length === 1 ? '' : 's'} (read at work time)`
        : ', no sources declared') +
      // Which workspace was consulted, whenever it is not the one a reader
      // would assume. "No sources declared" against a workspace the user did
      // not mean is indistinguishable from having declared none at all.
      (workspace === 'default' ? '' : ` on workspace "${workspace}"`) +
      `\n  construct plan ${started.runId}\n`,
  );
  for (const d of plan.discarded) {
    process.stdout.write(`  discarded: ${d.description} — ${d.reason}\n`);
  }
}

function reportRun(started: StartedRun): void {
  process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
  process.stdout.write(`implicated domains (${started.implicated.length}):\n`);
  for (const implication of started.implicated) {
    process.stdout.write(`  ${implication.domain}  — ${implication.concern}\n`);
    // Named implications carry no keyword score, so reporting one would
    // invite comparison with numbers that mean something else entirely.
    const evidence =
      started.inferredBy === 'keywords'
        ? `signals: ${implication.signals.slice(0, 4).join(', ')} (score ${implication.score})`
        : `reason: ${implication.signals.join(' ')}`;
    process.stdout.write(`      ${evidence}\n`);
  }
  if (started.inferredBy === 'user') {
    process.stdout.write('\nYou named these; nothing was inferred and no model was consulted.\n');
  }
  if (started.inferredBy === 'namer' || started.inferredBy === 'cache') {
    process.stdout.write(
      started.inferredBy === 'cache'
        ? '\nThese came from a model consulted for this outcome earlier, not from keywords.\n'
        : '\nThese came from a model reading the outcome; each reason above is its stated evidence.\n',
    );
  }
  if (started.namerFailure !== undefined) {
    // A keyword answer standing in for a model's is a degradation, and the
    // user hears it here as well as in the log.
    process.stdout.write(
      `\nThe model could not be consulted (${started.namerFailure}); the keyword map answered instead.\n`,
    );
  }
  if (started.namerRetriedAfter !== undefined) {
    // A repaired reply is the model's answer, but it took a second call to
    // get it, and the fragility should not read as a clean first turn.
    process.stdout.write(
      `\nThe model's first reply could not be parsed (${started.namerRetriedAfter}); ` +
        'a corrective retry produced this answer.\n',
    );
  }
  process.stdout.write(
    `\nfiled ${started.logged.length} work log entries and queued ${started.tasks.length} task(s).\n`,
  );
  process.stdout.write(`Run them:  construct work --run ${started.runId}\n`);
  process.stdout.write(`Read back: construct log --run ${started.runId}\n`);
}

/**
 * Record an outcome.
 *
 * Without --host the path is deterministic, does no I/O beyond the store, and
 * costs nothing — the keyword map answers or it does not. With --host, that
 * host's model reads every outcome as the primary namer and the map is only
 * the fallback if the model fails (adopted 2026-08-05 on the
 * RESEARCH-DECISIONS.md §10 figures: on wording the catalog's authors never
 * wrote, the map missed 0.634 where the namer missed 0.301).
 *
 * `hostOverride` exists so the CLI's own wiring is testable without a binary
 * present, exactly as with `work`.
 */
export async function outcome(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: OutcomeArgs;
  try {
    args = parseOutcomeArgs(argv);
  } catch (error) {
    process.stderr.write(`outcome: ${(error as Error).message}\n${OUTCOME_USAGE}`);
    return 2;
  }
  if (!args.text) {
    process.stderr.write(OUTCOME_USAGE);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const at = now();
    const runId = `run-${at.replace(/[-:.TZ]/g, '')}`;

    // Named staff: no map, no model, no cost — but the same catalog gate.
    if (args.domains !== undefined) {
      let started: StartedRun;
      try {
        started = startRunSelected(store, {
          runId,
          outcome: args.text,
          at,
          domains: args.domains,
        });
      } catch (error) {
        process.stderr.write(`outcome: ${(error as Error).message}\n`);
        return 2;
      }
      reportRun(started);
      planRun(store, started, null, args.workspace, at);
      return 0;
    }

    if (args.host === undefined) {
      const started = startRun(store, { runId, outcome: args.text, at });
      if (started.implicated.length === 0) {
        process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
        process.stdout.write(
          'no domains implicated. Nothing was inferred — this is recorded, not silently dropped.\n',
        );
        // The signpost that makes the dead end a choice rather than a wall
        //: the user, not the tool, decides to spend money.
        process.stdout.write(
          '\nA host model can be asked instead, at cost:\n' +
            `  construct outcome --host=<opencode|claude|codex|cursor> ${JSON.stringify(args.text)}\n`,
        );
        planRun(store, started, null, args.workspace, at);
        return 0;
      }
      reportRun(started);
      planRun(store, started, null, args.workspace, at);
      return 0;
    }

    const host =
      hostOverride ??
      adapterForHost(args.host, { binary: args.binary, model: args.model, dir: args.dir, timeoutMs: args.timeoutMs });

    try {
      await host.init();
    } catch (error) {
      process.stderr.write(
        `outcome: host "${host.name}" is not available — ${(error as Error).message}\n`,
      );
      return 1;
    }

    // With a host already being paid for this outcome, the rough framing is
    // optimized here rather than by the user remembering to ask. The original
    // words stay the outcome; the densified form is a recorded companion the
    // namer reads. A densifier failure is a stated fallback to the raw text.
    let densified: DensifiedReply | null = null;
    let densifyFailure: string | undefined;
    try {
      densified = await createHostDensifier(host)(args.text);
    } catch (error) {
      densifyFailure = (error as Error).message;
    }

    const started = await startRunNamed(store, {
      runId,
      outcome: args.text,
      at,
      host: host.name,
      namer: createHostNamer(host),
      cache: storeNamingCache(store, { host: host.name, at }),
      namerText: densified?.outcome,
    });

    if (densified) {
      appendWorkLog(store, {
        run: started.runId,
        task: null,
        role: 'construct',
        action: 'intake-densified',
        detail: densified,
        at,
      });
      if (densified.retriedAfter !== undefined) {
        process.stdout.write(
          `intake's first reply could not be parsed (${densified.retriedAfter}); ` +
            'a corrective retry produced this understanding.\n',
        );
      }
      process.stdout.write(`as understood (your words are the record; correct this if it is wrong):\n`);
      process.stdout.write(`  outcome: ${densified.outcome}\n`);
      for (const c of densified.constraints) process.stdout.write(`  constraint: ${c}\n`);
      for (const d of densified.decisions) process.stdout.write(`  decided: ${d}\n`);
      for (const p of densified.parked) process.stdout.write(`  parked: ${p}\n`);
      // Fail-open, never a gate: staffing proceeds either way. What this buys
      // is the reader seeing, before paying for the run, that the outcome was
      // thin enough to need a guess — rather than finding out only from what
      // the roles guessed.
      if (densified.underspecified.length > 0) {
        process.stdout.write(
          `  this is thin enough that staffing will have to guess: ${densified.underspecified}\n` +
            '  staffing proceeds on that guess; nothing here blocks the run.\n',
        );
      }
      process.stdout.write('\n');
    } else if (densifyFailure !== undefined) {
      process.stdout.write(
        `the outcome could not be optimized at intake (${densifyFailure}); the raw text is used as given.\n\n`,
      );
    }

    // The host and model named here are facts of the run. Without this record,
    // a later `work` with no flags dispatched to whatever model the host last
    // used — observed on a wire capture as an image model answering legal work.
    recordRunDispatch(store, {
      run: started.runId,
      host: args.host ?? host.name,
      model: args.model,
      binary: args.binary,
      dir: args.dir,
      recordedAt: at,
    });

    if (started.implicated.length === 0) {
      process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
      process.stdout.write(
        started.namerFailure !== undefined
          ? `no domains implicated. ${host.name} could not be consulted (${started.namerFailure}) ` +
              'and the keyword map is silent too — this is recorded, not silently dropped.\n'
          : `no domains implicated. ${host.name} considered the catalog and named nothing — ` +
              'this is recorded, not silently dropped.\n',
      );
      planRun(store, started, densified, args.workspace, at);
      return 0;
    }
    reportRun(started);
    planRun(store, started, densified, args.workspace, at);
    return 0;
  });
}

/** The same lease `work` takes by default; a single dispatch needs no other rule. */
const DEFAULT_LEASE_MINUTES_ASK = 15;

const ASK_USAGE =
  'usage: construct ask [--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…] [--dir=…]] ' +
  '[--workspace=<name>] [--ceiling=<amount>] [--timeout=<minutes>] "<your question>"\n';

export interface AskArgs {
  readonly question: string;
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  readonly workspace: string;
  readonly ceiling: number;
  /** How long one host invocation may run, in milliseconds. Host default when unset. */
  readonly timeoutMs?: number;
}

export function parseAskArgs(argv: string[]): AskArgs {
  const { flags, rest } = parseFlags(argv);

  const host = flags.host;
  if (host !== undefined && host !== 'opencode' && host !== 'claude' && host !== 'codex' && host !== 'cursor') {
    throw new Error(`unknown host "${host}" (expected opencode, claude, codex, or cursor)`);
  }
  // Same rule as `outcome`: a flag that only means something with a host, given
  // without one, is a usage error rather than a silent no-op.
  const hostFlags = ['model', 'binary', 'dir', 'timeout'].filter((f) => flags[f] !== undefined);
  if (host === undefined && hostFlags.length > 0) {
    throw new Error(
      `--${hostFlags[0]} only applies when a host is named; add --host=<opencode|claude|codex|cursor>, or drop the flag`,
    );
  }

  const timeoutMs = timeoutFlag(flags);

  const ceiling = flags.ceiling === undefined ? DEFAULT_SPEND_CEILING : Number(flags.ceiling);
  if (!Number.isFinite(ceiling) || ceiling < 0) {
    throw new Error(`--ceiling must be a non-negative number, got "${flags.ceiling}"`);
  }

  return {
    question: rest.join(' ').trim(),
    host,
    model: flags.model,
    binary: flags.binary,
    dir: flags.dir,
    workspace: workspaceFlag(flags),
    ceiling,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/**
 * Ask the staff a question.
 *
 * The spine end to end in one command, which is the point: recording a question
 * and then remembering to work it is the ceremony an outcome earns and a
 * question does not. One concern answers, over whatever sources the workspace
 * declared, and the answer is printed here rather than left for `construct
 * show` — a question the user has to go and collect the answer to has not been
 * answered.
 *
 * Nothing about it is a shortcut around the record. The run, the plan, the
 * source reads, the dispatch, the challenge verdict and the spend all land in
 * the store exactly as `outcome` and `work` leave them, and the same commands
 * read them back.
 */
export async function ask(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: AskArgs;
  try {
    args = parseAskArgs(argv);
  } catch (error) {
    process.stderr.write(`ask: ${(error as Error).message}\n${ASK_USAGE}`);
    return 2;
  }
  if (!args.question) {
    process.stderr.write(ASK_USAGE);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const at = now();
    const runId = `run-${at.replace(/[-:.TZ]/g, '')}`;

    const host =
      args.host === undefined && hostOverride === undefined
        ? null
        : (hostOverride ??
          adapterForHost(args.host, { binary: args.binary, model: args.model, dir: args.dir, timeoutMs: args.timeoutMs }));

    if (host) {
      try {
        await host.init();
      } catch (error) {
        process.stderr.write(
          `ask: host "${host.name}" is not available — ${(error as Error).message}\n`,
        );
        return 1;
      }
    }

    // Who answers is inferred exactly as it is for an outcome: the named host's
    // model reads the question, and the keyword map answers only if it fails or
    // if no host was named. A question with no host is recorded and routed and
    // then has nobody to answer it, which is said rather than pretended past.
    const started = host
      ? await startAskNamed(store, {
          runId,
          outcome: args.question,
          at,
          host: host.name,
          namer: createHostNamer(host),
          cache: storeNamingCache(store, { host: host.name, at }),
        })
      : await startAskNamed(store, { runId, outcome: args.question, at });

    process.stdout.write(`run ${started.runId}\n  question: ${args.question}\n\n`);

    const answering = primaryImplication(started.implicated);
    if (!answering) {
      process.stdout.write(
        host
          ? `no concern in the catalog owns this question — ${host.name} read it and named nothing. ` +
              'That is recorded, not silently dropped.\n'
          : 'no concern in the catalog owns this question, by keyword match. ' +
              'Nothing was inferred and no model was consulted.\n',
      );
      if (!host) {
        process.stdout.write(
          '\nA host model reads the question properly, at cost:\n' +
            `  construct ask --host=<opencode|claude|codex|cursor> ${JSON.stringify(args.question)}\n`,
        );
      }
      planRun(store, started, null, args.workspace, at, []);
      return 0;
    }

    process.stdout.write(`answering: ${answering.domain} — ${answering.concern}\n`);
    process.stdout.write(
      `  ${started.inferredBy === 'keywords' ? 'signals' : 'reason'}: ${answering.signals.join(' ')}\n`,
    );
    const alsoTouched = started.implicated.filter((i) => i !== answering);
    if (alsoTouched.length > 0) {
      // The concerns a question reached and nobody answered are the reason the
      // full run exists. Naming them is what keeps the cheap surface from
      // reading as the complete one.
      process.stdout.write(
        `\nalso implicated, and not asked: ${alsoTouched.map((i) => i.domain).join(', ')}\n` +
          '  A question is answered by one concern. To have them all answered:\n' +
          `  construct outcome ${JSON.stringify(args.question)}\n`,
      );
    }
    if (started.namerFailure !== undefined) {
      process.stdout.write(
        `\nThe model could not be consulted (${started.namerFailure}); the keyword map answered instead.\n`,
      );
    }
    const notice = highRiskNotice(answering.domain, licensedReviewFor(answering.domain));
    if (notice) process.stdout.write(`\n${notice}\n`);

    planRun(store, started, null, args.workspace, at, [answering]);

    if (!host) {
      process.stdout.write(
        '\nNobody was dispatched: answering costs a model call, and no host was named.\n' +
          `  construct ask --host=<opencode|claude|codex|cursor> ${JSON.stringify(args.question)}\n`,
      );
      return 0;
    }

    recordRunDispatch(store, {
      run: started.runId,
      host: args.host ?? host.name,
      model: args.model,
      binary: args.binary,
      dir: args.dir,
      recordedAt: at,
    });

    // The same grounding pass `work` runs, on this one run: what the declared
    // sources actually hold, surveyed and recorded before the dispatch that
    // will cite them.
    const pass = groundRun(store, started.runId, now());
    if (pass) {
      if (!pass.skipped) process.stdout.write(`\ngrounded: ${groundingSummary(pass)}\n`);
    } else {
      // An answer with no declared sources rests on the model's own knowledge,
      // and the reader has to know that before they read it.
      process.stdout.write(
        '\nno sources declared for this workspace, so the answer rests on what the ' +
          'model knows rather than on your material.\n' +
          '  construct source add <path> --kind=<kind>\n',
      );
    }

    const report = await workRun(store, host, {
      owner: `cli-${String(process.pid)}`,
      clock: now,
      spendCeiling: args.ceiling,
      concurrency: 1,
      leaseMs: DEFAULT_LEASE_MINUTES_ASK * 60 * 1000,
      run: started.runId,
      capabilitySecret: loadOrCreateSecret(secretFile()),
    });

    const task = report.settled.map((id) => getTask(store, id)).find((t) => t !== null);
    if (!task || task.state !== 'done') {
      process.stderr.write(
        `\nno answer: ${task ? failureLine(task.error) : 'the dispatch produced nothing'}\n`,
      );
      return 1;
    }

    const draft = latestDraft(store, task.id)?.deliverable ?? task.result;
    const answer = renderDeliverable(draft);
    process.stdout.write(`\n${answer.trimEnd()}\n`);

    const cost = task.spendReported ? `$${money(task.spend)}` : 'cost not reported';
    process.stdout.write(`\n— ${task.role}, ${cost}\n`);
    // The deliverable's own defects, printed with it rather than left in the
    // log: an answer read without them is an answer read as better than it is.
    for (const concern of deliverableConcerns(task.result)) {
      process.stdout.write(`⚑ ${concern.detail}\n`);
    }
    for (const limit of limitsFor(store, started.runId, task.id)) {
      process.stdout.write(`⚑ ${limit.label}\n`);
    }
    if (report.degraded > 0) {
      process.stdout.write(
        '⚑ this ran below the model capability floor its brief declared — see: construct log\n',
      );
    }
    process.stdout.write(`Read back: construct log --run ${started.runId}\n`);
    return 0;
  });
}

const NOTES_USAGE =
  'usage: construct notes <file|directory> [--workspace=<name>] [--run=<id>] [--max-notes=<n>] ' +
  '[--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>]]\n';

/**
 * How many notes one invocation will reason over before stopping.
 *
 * There is no money ceiling here and stating a fake one would be worse than
 * stating none: the spend ceiling `ask` and `work` enforce sums the tasks
 * table, and the context loop creates no tasks, so a `--ceiling` on this
 * command would read a number it never moves. What binds regardless of what
 * any host reports about cost is the count, so the count is what is bounded.
 *
 * Twenty-five because a person dropping a quarter's call notes should not have
 * to think about this, and someone pointing at a documents repository of two
 * thousand files should be stopped before the first dispatch rather than
 * after the six hundredth.
 */
export const DEFAULT_MAX_NOTES = 25;

/**
 * The flag that dispatches anyway when ground sits outside the working
 * directory. Named once so the refusal, the override and the log entry cannot
 * drift into naming three different things.
 */
const UNREACHABLE_GROUND_FLAG = '--allow-distant-ground';

/** Model calls one note costs: densify, produce, and one challenge per delta. */
const CALLS_PER_NOTE = 3;

/**
 * How many of the subjects a note names are shown to the loop. A note that
 * genuinely concerns a dozen clients at once is a note about a portfolio, and
 * the loop is not the surface for it; what the cap drops is stated rather than
 * silently trimmed off the end of a prompt.
 */
const SUBJECTS_PER_NOTE = 10;

export interface NotesArgs {
  readonly file: string;
  readonly workspace: string;
  readonly run?: string;
  /** How many notes this invocation will reason over before stopping. */
  readonly maxNotes: number;
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /** How long one host invocation may run, in milliseconds. Host default when unset. */
  readonly timeoutMs?: number;
}

/** Split `--key=value` flags from positional words, in argv order. */
function splitFlags(argv: string[]): { flags: Record<string, string>; words: string[] } {
  const flags: Record<string, string> = {};
  const words: string[] = [];
  for (const arg of argv) {
    const valued = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (valued) {
      flags[valued[1]] = valued[2];
      continue;
    }
    // A flag carrying no value is present, not absent, and not a positional.
    // Every surface that documents one — --no-close, --record — tests it with
    // `!== undefined`, so the empty string is the right value; the alternative
    // was that a bare flag fell through to `words` and was read as whatever
    // positional came first, which for compose is the run id.
    const bare = /^--([a-z-]+)$/.exec(arg);
    if (bare) flags[bare[1]] = '';
    else words.push(arg);
  }
  return { flags, words };
}

interface HostFlags {
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  readonly timeoutMs?: number;
}

/**
 * The host selection every model-calling surface takes, parsed once. A host
 * tuning flag with no host named is refused rather than ignored: silently
 * dropping `--model` on a surface that was never going to call a model is how
 * a user comes to believe a model ran.
 */
function parseHostFlags(flags: Record<string, string>): HostFlags {
  const host = flags.host;
  if (host !== undefined && !(HOST_NAMES as readonly string[]).includes(host)) {
    throw new Error(`unknown host "${host}" (expected ${HOST_NAMES.join(', ')})`);
  }
  const named = ['model', 'binary', 'dir', 'timeout'].filter((f) => flags[f] !== undefined);
  if (host === undefined && named.length > 0) {
    throw new Error(
      `--${named[0]} only applies when a host is named; add --host=<opencode|claude|codex|cursor>, or drop the flag`,
    );
  }
  return {
    host: host as HostName | undefined,
    model: flags.model,
    binary: flags.binary,
    dir: flags.dir,
    ...(timeoutFlag(flags) === undefined ? {} : { timeoutMs: timeoutFlag(flags) }),
  };
}

export function parseNotesArgs(argv: string[]): NotesArgs {
  const { flags, words } = splitFlags(argv);
  if (words.length !== 1) {
    throw new Error(words.length === 0 ? 'a notes path is required' : 'one notes path at a time');
  }
  const maxNotes = flags['max-notes'] === undefined ? DEFAULT_MAX_NOTES : Number(flags['max-notes']);
  if (!Number.isInteger(maxNotes) || maxNotes < 1) {
    throw new Error(`--max-notes must be a positive whole number, got "${flags['max-notes'] ?? ''}"`);
  }
  return {
    file: words[0] as string,
    workspace: flags.workspace ?? 'default',
    run: flags.run,
    maxNotes,
    ...parseHostFlags(flags),
  };
}

/**
 * Drop after-call notes and, with a host named, run the context loop over
 * each of them.
 *
 * A file is one note. A directory is every document under it, each recorded
 * as its own note and reasoned over separately — a pile of call transcripts
 * is the shape this arrives in, and one shell invocation per file was the
 * shape it was previously ingested in.
 *
 * Evidence lands before any model is consulted, and one document that cannot
 * be read never ends the batch: the documents that could be read are evidence
 * whatever happened to the ones that could not. Without --host, recording is
 * all that happens — the loop is model work, and the free path says so
 * instead of guessing.
 */
export async function notes(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: NotesArgs;
  try {
    args = parseNotesArgs(argv);
  } catch (error) {
    process.stderr.write(`notes: ${(error as Error).message}\n${NOTES_USAGE}`);
    return 2;
  }

  // One walk resolves the argument into the documents to ingest. A directory
  // is walked exactly as a declared source is surveyed — same skip rules, same
  // ordering — because ground that can be surveyed and ground that can be
  // ingested must be the same ground.
  let documents: string[];
  try {
    documents = statSync(args.file).isDirectory() ? listDocuments(args.file).map((d) => d.path) : [args.file];
  } catch (error) {
    process.stderr.write(`notes: cannot read ${args.file} — ${(error as Error).message}\n`);
    return 1;
  }
  if (documents.length === 0) {
    process.stderr.write(`notes: ${args.file} holds no documents this install can read.\n`);
    return 1;
  }
  if (documents.length > 1) {
    process.stdout.write(
      `ingesting ${String(documents.length)} documents from ${args.file}, each as its own note.\n`,
    );
  }

  // Probed once for the batch: the probe spawns a process, and one spawn per
  // document is the difference between an ingest and a stall.
  const doclingProbe = probeDocling();

  return withStoreAsync(async (store) => {
    const recorded: Array<{ readonly noteId: string; readonly body: string }> = [];
    let refused = 0;
    for (const document of documents) {
      // Reading goes through the extraction ladder, not a bare byte read: a
      // binary document either extracts through a rung this install can run,
      // or is refused with the ladder's own remediation — garbage bytes
      // recorded as prose is the failure mode this replaces.
      const sourceRead = readSource(document, { docling: doclingProbe });
      if (!sourceRead.ok) {
        refused += 1;
        process.stderr.write(
          `notes: ${sourceRead.reason}\n` +
            (sourceRead.remediation ? `  ${sourceRead.remediation}\n` : '') +
            `  (docling probe: ${doclingProbe.detail})\n`,
        );
        // The refusal and its fallback path reach the record, not just
        // stderr — a run reading its log later must see why this source is
        // absent. One refusal never ends the batch: the documents that could
        // be read are evidence whatever happened to the ones that could not.
        if (args.run) {
          appendWorkLog(store, {
            run: args.run,
            role: 'intake',
            action: 'extraction-refused',
            detail: {
              file: document,
              reason: sourceRead.reason,
              remediation: sourceRead.remediation,
              doclingProbe: doclingProbe.detail,
            },
            at: now(),
          });
        }
        continue;
      }
      const body = sourceRead.text;
      const at = now();
      const noteId = `note-${at.replace(/[-:.TZ]/g, '')}-${String(recorded.length + 1)}`;
      try {
        recordNote(store, {
          id: noteId,
          workspace: args.workspace,
          run: args.run ?? null,
          door: 'file-drop',
          body,
          recordedAt: at,
        });
      } catch (error) {
        refused += 1;
        process.stderr.write(`notes: ${(error as Error).message}\n`);
        continue;
      }
      const lineCount = body.split('\n').length;
      process.stdout.write(
        `note ${noteId}: ${lineCount} line${lineCount === 1 ? '' : 's'} recorded verbatim in workspace "${args.workspace}".\n`,
      );
      recorded.push({ noteId, body });
    }

    if (recorded.length === 0) return 1;
    if (refused > 0) {
      process.stdout.write(
        `\n${String(refused)} document${refused === 1 ? '' : 's'} could not be read and ${refused === 1 ? 'is' : 'are'} not recorded; ` +
          `${String(recorded.length)} landed.\n`,
      );
    }

    if (args.host === undefined && hostOverride === undefined) {
      process.stdout.write(
        `\nThe ${recorded.length === 1 ? 'note is' : 'notes are'} kept; drawing conclusions from ` +
          `${recorded.length === 1 ? 'it' : 'them'} is model work, at cost:\n` +
          `  construct notes --host=<opencode|claude|codex|cursor> ${args.file}\n`,
      );
      return 0;
    }

    // What the loop is about to spend, before it spends it. The count is the
    // only bound that holds: no money ceiling binds here, and one that reads a
    // number this command never moves would be a bound in name only.
    const reasoning = recorded.slice(0, args.maxNotes);
    const deferred = recorded.length - reasoning.length;
    if (recorded.length > 1) {
      process.stdout.write(
        `\nreasoning over ${String(reasoning.length)} note${reasoning.length === 1 ? '' : 's'}: ` +
          `at least ${String(reasoning.length * CALLS_PER_NOTE)} model calls, one host invocation each.\n`,
      );
    }
    if (deferred > 0) {
      process.stdout.write(
        `  ${String(deferred)} more ${deferred === 1 ? 'note is' : 'notes are'} recorded and left unreasoned ` +
          `(--max-notes=${String(args.maxNotes)}). They keep their rows; raise the limit to take them:\n` +
          `  construct notes ${args.file} --max-notes=${String(recorded.length)} --host=${args.host ?? '<host>'}\n`,
      );
    }

    const host =
      hostOverride ??
      adapterForHost(args.host, { binary: args.binary, model: args.model, dir: args.dir, timeoutMs: args.timeoutMs });
    try {
      await host.init();
    } catch (error) {
      process.stderr.write(
        `notes: host "${host.name}" is not available — ${(error as Error).message}. ` +
          `The ${recorded.length === 1 ? 'note is' : 'notes are'} recorded; run the loop again when the host is.\n`,
      );
      return 1;
    }

    // The declared ground, actually walked, before the model is asked what
    // disagrees in it. A producer shown locators alone answers about documents
    // it remembers, and the screen downstream has no listing to catch that
    // with — so the survey is what turns the drift pass into an observation.
    // Surveyed once for the batch: it is the same ground for every note.
    const sources = sourcesFor(store, args.workspace);
    const { producerSources, surveyed } = driftGround(sources, surveyDeclared(store, sources));

    let failed = 0;
    for (const { noteId, body } of reasoning) {
      if (reasoning.length > 1) process.stdout.write(`\n── ${noteId} ──\n`);
      const ok = await contextLoopOverNote(store, host, {
        noteId,
        body,
        workspace: args.workspace,
        run: args.run,
        sources,
        producerSources,
        surveyed,
      });
      if (!ok) failed += 1;
    }
    // Every note that could not be reasoned over is still recorded evidence,
    // so a batch where some loops failed is a partial success, not a failure.
    return failed === reasoning.length ? 1 : 0;
  });
}

interface LoopContext {
  readonly noteId: string;
  readonly body: string;
  readonly workspace: string;
  readonly run?: string;
  readonly sources: readonly Source[];
  readonly producerSources: readonly ProducerSource[];
  readonly surveyed: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Run the context loop over one recorded note: densify, produce, challenge
 * each delta adversarially, then apply — deltas through the admission gate,
 * proposals into the rung 0 queue, observations through the citation screen.
 *
 * Returns whether the loop completed. A note whose loop failed keeps its row:
 * the evidence landed before any model was consulted, and a later pass can
 * always run over it.
 */
async function contextLoopOverNote(
  store: Store,
  host: HostAdapter,
  context: LoopContext,
): Promise<boolean> {
  const { noteId, body, workspace, sources, producerSources, surveyed } = context;
  const at = now();

  // Densify first: the confirm-intent summary is a restatement of this
  // reading, and a loop that cannot state its reading has nothing to
  // confirm. The note is already safe, so failing here loses no evidence.
  let densified: DensifiedIntake;
  try {
    densified = await createHostDensifier(host)(body);
  } catch (error) {
    process.stderr.write(
      `notes: the note could not be densified (${(error as Error).message}). ` +
        `It is recorded as ${noteId}; run the loop again when the host answers.\n`,
    );
    return false;
  }

  const subjects = subjectsOf(body, recordsFor(store, workspace), SUBJECTS_PER_NOTE);
  if (subjects.withheld > 0) {
    process.stdout.write(
      `  ${String(subjects.withheld)} record${subjects.withheld === 1 ? '' : 's'} this note names ` +
        `${subjects.withheld === 1 ? 'was' : 'were'} not shown to the loop (limit ${String(SUBJECTS_PER_NOTE)}); ` +
        'nothing was recorded against them.\n',
    );
  }

  let produced: ProducedLoop;
  try {
    const reply = await createHostProducer(host)({
      noteBody: body,
      noteId,
      lessons: operationalLessonsFor(store, workspace).map((l) => l.body),
      sources: producerSources,
      // Only the subjects this note names, with what each says now. Two
      // reasons, and the first is the serious one: a workspace holding several
      // clients would otherwise put one client's fields into the prompt
      // reasoning over another's call notes. The second is that an update must
      // name the record it changes, so a subject the note never mentions is
      // one the note cannot determine anything about — showing it buys
      // nothing and risks a fact being filed against the wrong client.
      records: subjects.shown.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        fields: currentFields(store, r.id).map((f) => ({ field: f.field, value: f.value })),
      })),
    });
    produced = toProducedLoop(reply, noteId);
  } catch (error) {
    process.stderr.write(
      `notes: the loop could not read the note (${(error as Error).message}). ` +
        `It is recorded as ${noteId}; run the loop again when the host answers.\n`,
    );
    return false;
  }
  for (const reason of produced.discarded) {
    process.stdout.write(`  discarded: ${reason}\n`);
  }

  // The screen before the gate: a citation that does not resolve, or a
  // proposal against an undeclared source, is dropped here with its reason
  // so one bad item does not abort the pass; the loop's hard gate stays the
  // backstop for anything that slips past.
  const sourceIds = new Set(sources.map((s) => s.id));
  const challenger = createHostChallenger(host);
  const deltas: MemoryDelta[] = [];
  for (const [i, delta] of produced.deltas.entries()) {
    const cited = resolveNoteCitation(store, delta.citation);
    if (!cited) {
      process.stdout.write(
        `  discarded: delta "${delta.body.slice(0, 60)}" cites ${delta.citation}, which is not a line of this note\n`,
      );
      continue;
    }
    let challenge: DeltaChallenge;
    try {
      challenge = await challenger(delta, cited.text);
    } catch (error) {
      process.stdout.write(
        `  held back: delta "${delta.body.slice(0, 60)}" could not be challenged (${(error as Error).message}); an unchallenged delta is not recorded\n`,
      );
      continue;
    }
    if (!challenge.upheld) {
      process.stdout.write(
        `  refuted: delta "${delta.body.slice(0, 60)}" — ${challenge.detail}\n`,
      );
      continue;
    }
    deltas.push({
      id: `${noteId}-d${i + 1}`,
      kind: delta.kind,
      domain: delta.domain,
      body: delta.body,
      citation: delta.citation,
      external: delta.external,
      basis: { kind: 'adversarial-pass', detail: challenge.detail },
    });
  }

  const proposals: PropagationProposal[] = [];
  for (const [i, proposal] of produced.proposals.entries()) {
    if (!sourceIds.has(proposal.source)) {
      process.stdout.write(
        `  discarded: proposal "${proposal.change.slice(0, 60)}" targets ${proposal.source}, which is not a declared source\n`,
      );
      continue;
    }
    if (!resolveNoteCitation(store, proposal.justification)) {
      process.stdout.write(
        `  discarded: proposal "${proposal.change.slice(0, 60)}" cites ${proposal.justification}, which is not a line of this note\n`,
      );
      continue;
    }
    proposals.push({
      id: `${noteId}-p${i + 1}`,
      source: proposal.source,
      change: proposal.change,
      justification: proposal.justification,
      risk: proposal.risk,
    });
  }

  // The same screen the proposals get: an update naming a record this
  // workspace does not keep is dropped with its reason rather than aborting
  // the pass, and the loop's hard refusal stays the backstop.
  const records: RecordUpdate[] = [];
  for (const update of produced.records) {
    if (!getRecord(store, update.record)) {
      process.stdout.write(
        `  discarded: record update ${update.record}.${update.field} names a record this workspace does not keep\n`,
      );
      continue;
    }
    records.push(update);
  }

  const result = applyContextLoop(
    store,
    {
      workspace,
      run: context.run ?? noteId,
      noteId,
      densified,
      deltas,
      proposals,
      records,
    },
    at,
  );

  process.stdout.write(`\n${result.summary}\n`);

  if (result.admissions.length > 0) {
    process.stdout.write('\nmemory deltas (through the admission gate):\n');
    for (const admission of result.admissions) {
      process.stdout.write(`  ${admission.verdict}: ${admission.lesson} — ${admission.reason}\n`);
    }
  }
  if (result.updated.length > 0) {
    process.stdout.write(
      `\nrecords updated (${String(result.updated.length)}) — each field cites the note line that moved it:\n`,
    );
    for (const moved of result.updated) process.stdout.write(`  ${moved}\n`);
  }
  if (result.filed.length > 0) {
    process.stdout.write(
      `\nfiled ${result.filed.length} propagation proposal${result.filed.length === 1 ? '' : 's'} — ` +
        'each waits for a decision; nothing was written outward:\n',
    );
    for (const id of result.filed) process.stdout.write(`  ${id}\n`);
  }

  writeDrift(screenObservations(produced.observations, sources, surveyed));

  return true;
}

/**
 * Print what a drift screen kept and what it dropped. One writer because the
 * note loop and the standalone review both end here, and a reader comparing
 * the two surfaces should not have to work out whether they mean the same
 * thing by a flag.
 */
function writeDrift(screened: ScreenResult): void {
  if (screened.flags.length > 0) {
    process.stdout.write('\ncross-source drift:\n');
    for (const flag of screened.flags) {
      process.stdout.write(
        `  ${flag.claim}\n    cites: ${flag.citations.map((c) => `${c.source} ${c.document}`).join('; ')}\n`,
      );
    }
  }
  for (const drop of screened.discarded) {
    process.stdout.write(`  discarded observation: ${drop.observation.claim.slice(0, 60)} — ${drop.reason}\n`);
  }
}

const REVIEW_USAGE =
  'usage: construct review [--workspace=<name>] ' +
  '[--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>]]\n';

export interface ReviewArgs {
  readonly workspace: string;
  readonly host?: string;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  readonly timeoutMs?: number;
}

export function parseReviewArgs(argv: string[]): ReviewArgs {
  const { flags, words } = splitFlags(argv);
  if (words.length > 0) throw new Error(`review takes no positional arguments (got "${words[0]}")`);
  return { workspace: flags.workspace ?? 'default', ...parseHostFlags(flags) };
}

/**
 * Read a workspace's declared ground and report what disagrees inside it.
 *
 * The note loop could already find drift, but only when a note occasioned it.
 * A person acting as program manager over a documents repository needs to ask
 * the question directly, and asking it is the whole command: survey, read,
 * screen the citations, print. Nothing is written to memory and nothing is
 * proposed outward — a review has no note, so it has nothing either could
 * cite, and a conclusion with nothing to cite is the class the gates exist for.
 */
export async function review(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: ReviewArgs;
  try {
    args = parseReviewArgs(argv);
  } catch (error) {
    process.stderr.write(`review: ${(error as Error).message}\n${REVIEW_USAGE}`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const sources = sourcesFor(store, args.workspace);
    if (sources.length === 0) {
      process.stderr.write(
        `review: workspace "${args.workspace}" has declared no sources, so there is no ground to read.\n` +
          '  construct source add --kind=directory --locator=<path>\n',
      );
      return 2;
    }

    const { producerSources, surveyed } = driftGround(sources, surveyDeclared(store, sources));
    const documents = producerSources.reduce((sum, s) => sum + s.documents.length, 0);
    const unsurveyed = producerSources.filter((s) => s.unreachable !== undefined);
    process.stdout.write(
      `surveyed: ${String(documents)} document${documents === 1 ? '' : 's'} ` +
        `across ${String(sources.length)} source${sources.length === 1 ? '' : 's'}\n`,
    );
    for (const source of unsurveyed) {
      process.stdout.write(`  not surveyed: ${source.id} — ${source.unreachable ?? ''}\n`);
    }

    if (args.host === undefined && hostOverride === undefined) {
      process.stdout.write(
        '\nReading them for disagreements is model work, at cost:\n' +
          '  construct review --host=<opencode|claude|codex|cursor>\n',
      );
      return 0;
    }
    if (documents === 0 && unsurveyed.length === sources.length) {
      // Dispatching a reviewer over nothing would spend a model call to be
      // told nothing disagrees, which is true and worthless.
      process.stderr.write('review: no source could be surveyed, so there is nothing to read.\n');
      return 1;
    }

    const host =
      hostOverride ??
      adapterForHost(args.host, { binary: args.binary, model: args.model, dir: args.dir, timeoutMs: args.timeoutMs });
    try {
      await host.init();
    } catch (error) {
      process.stderr.write(`review: host "${host.name}" is not available — ${(error as Error).message}\n`);
      return 1;
    }

    let reviewed;
    try {
      reviewed = toReviewedDrift(await createHostReviewer(host)({ sources: producerSources }));
    } catch (error) {
      process.stderr.write(`review: the ground could not be read (${(error as Error).message}).\n`);
      return 1;
    }
    for (const reason of reviewed.discarded) process.stdout.write(`  discarded: ${reason}\n`);

    const screened = screenObservations(reviewed.observations, sources, surveyed);
    writeDrift(screened);
    if (screened.flags.length === 0) {
      process.stdout.write('\nno drift survived the screen.\n');
    }
    return 0;
  });
}

export interface WorkArgs {
  readonly run?: string;
  readonly concurrency: number;
  readonly ceiling: number;
  readonly leaseMinutes: number;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /**
   * Dispatch even where a licensed ground root sits outside the directory the
   * roles will run in. Off by default: the roles would be graded on material
   * they cannot open. On when the operator knows this host reaches wider than
   * its working directory, which Construct cannot see from here.
   */
  readonly allowDistantGround: boolean;
  /** Which host executes: 'opencode' (default) or 'claude'. */
  readonly host: string;
  /**
   * Whether --host was actually typed. The default and the recorded choice
   * must be distinguishable, or the recorded choice could never win.
   */
  readonly hostExplicit: boolean;
  /**
   * The user asking for a voice other than Construct's, in their own words.
   * Absent is the house voice — the case that needs no flag and no record.
   */
  readonly voice?: string;
  /**
   * How long one host invocation may run, in milliseconds. Host default when
   * unset. A grounded dispatch over a real repository on a small local model
   * was measured producing nothing inside the ten-minute default, so the limit
   * is the caller's to set rather than one constant for every model.
   */
  readonly timeoutMs?: number;
}

/**
 * The ceiling is total spend across every run this machine has recorded, not
 * this invocation's — ten runs of nine dollars is exactly what a per-run cap
 * misses. It is deliberately low enough to be hit, since a ceiling nobody ever
 * reaches has never been tested.
 */
export const DEFAULT_SPEND_CEILING = 10;

export function parseWorkArgs(argv: string[]): WorkArgs {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  const runIndex = argv.indexOf('--run');
  const run = args.run ?? (runIndex >= 0 ? argv[runIndex + 1] : undefined);

  const number = (name: string, fallback: number): number => {
    if (args[name] === undefined) return fallback;
    const value = Number(args[name]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid --${name}=${args[name]}; expected a non-negative number`);
    }
    return value;
  };

  const host = args.host ?? 'opencode';
  if (host !== 'opencode' && host !== 'claude' && host !== 'codex' && host !== 'cursor') {
    throw new Error(`Invalid --host=${host}; expected opencode|claude|codex|cursor`);
  }

  const leaseMinutes = number('lease-minutes', 15);
  const timeoutMs = timeoutFlag(args);
  // The lease exceeds the invocation limit by design: a task whose lease
  // expires while the host is still working it is handed to a second worker,
  // and the same work is then paid for twice. Raising the limit past the lease
  // silently would arrange exactly that, so it is refused with the other flag
  // named rather than accepted and warned about.
  if (timeoutMs !== undefined && timeoutMs >= leaseMinutes * 60 * 1000) {
    throw new Error(
      `--timeout=${args.timeout} exceeds --lease-minutes=${String(leaseMinutes)}; a task still running ` +
        'when its lease expires is dispatched again and paid for twice. Raise --lease-minutes past the timeout.',
    );
  }

  return {
    run,
    concurrency: number('concurrency', DEFAULT_CONCURRENCY),
    ceiling: number('ceiling', DEFAULT_SPEND_CEILING),
    leaseMinutes,
    model: args.model,
    binary: args.binary,
    dir: args.dir,
    allowDistantGround: args['allow-distant-ground'] === 'true' || args['allow-distant-ground'] === '',
    host,
    hostExplicit: args.host !== undefined,
    voice: args.voice?.trim() ? args.voice.trim() : undefined,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function money(amount: number): string {
  return amount === 0 ? '0' : amount.toFixed(amount < 0.01 ? 5 : 2);
}

/**
 * Why a task failed, in one line. A failed task has no cost to report, and
 * saying "cost not reported" there tells the user nothing about the thing that
 * actually went wrong.
 */
function failureLine(error: unknown): string {
  const record = error as { messages?: unknown; message?: unknown } | null;
  const first = Array.isArray(record?.messages) ? record.messages[0] : record?.message;
  const message = typeof first === 'string' && first ? first : 'failed';
  // A wall the user cannot move is a wall; naming the flag that moves it is
  // the difference between a limit and a dead end. Said here rather than in
  // the error itself, which belongs to the kernel and knows no flags.
  return /invocation exceeded \d+ms/.test(message)
    ? `${message} — raise it with --timeout=<minutes> (and --lease-minutes past it), or ground the run in fewer documents`
    : message;
}

/**
 * What to say when an attempt to work produced no deliverable at all.
 *
 * An earlier fix established the substance of this and it is unchanged: a failed
 * task is terminal, the host owns retries (commitment 1), and nothing here is a
 * retry policy. What it got wrong was reachability. The text lived only on the
 * nothing-left-to-work path, so it printed on a SECOND `construct work` against
 * an already-settled run — and the output of the first gave nobody a reason to
 * run a second (found in a live run whose every task failed with
 * "Missing Authentication header" and said nothing further).
 *
 * So it is one writer called from both places rather than two copies that drift.
 */
function writeTotalFailureRecourse(failedCount: number): void {
  process.stdout.write(
    `\nAll ${String(failedCount)} task(s) failed and produced no deliverable.\n` +
      'A failed task is terminal — the host owns retries, so re-running work will not pick these up.\n' +
      'If the cause was the dispatch rather than the work (an unresolvable --model, a host that was ' +
      'not reachable, a missing credential), fix it and file the outcome again:\n' +
      '  construct outcome "<what you want>"\n',
  );
}

/**
 * Dispatch the queued tasks to a host. `hostOverride` exists so the CLI's own
 * wiring can be tested without a binary present; production callers never pass
 * it, exactly as with cleanup's spawn override.
 */
export async function work(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: WorkArgs;
  try {
    args = parseWorkArgs(argv);
  } catch (error) {
    process.stderr.write(`work: ${(error as Error).message}\n`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    // The run remembers the surface it was filed with; a flag typed now still
    // wins, and the divergence goes on the record rather than passing silently.
    const recorded = args.run ? readRunDispatch(store, args.run) : null;
    const hostName = args.hostExplicit ? args.host : (recorded?.host ?? args.host);
    const model = args.model ?? recorded?.model ?? undefined;
    const binary = args.binary ?? recorded?.binary ?? undefined;
    const dir = args.dir ?? recorded?.dir ?? undefined;

    if (recorded && args.run) {
      const overrides: string[] = [];
      if (args.hostExplicit && args.host !== recorded.host) {
        overrides.push(`host ${recorded.host} -> ${args.host}`);
      }
      if (args.model !== undefined && recorded.model !== null && args.model !== recorded.model) {
        overrides.push(`model ${recorded.model} -> ${args.model}`);
      }
      if (overrides.length > 0) {
        appendWorkLog(store, {
          run: args.run,
          task: null,
          role: 'construct',
          action: 'dispatch-overridden',
          detail: { overrides, recordedAt: recorded.recordedAt },
          at: now(),
        });
      }
    }

    const host =
      hostOverride ?? adapterForHost(hostName, { binary, model, dir, timeoutMs: args.timeoutMs });

    const waiting = countTasksByState(store, args.run).pending ?? 0;
    if (waiting === 0) {
      // Nothing to dispatch is not the same as nothing to do. If a previous
      // invocation settled this run's tasks and then died before framing —
      // a SIGTERM, an OOM, a closed laptop, and the window is the whole run —
      // the decision those deliverables imply has never been raised, and this
      // guard used to return before anything could reach it.
      // Framing needs no host and no spend, so it runs before the guard reports.
      const raised = frameConflicts(store, [], { clock: now, run: args.run });

      const counts = countTasksByState(store, args.run);
      const done = counts.done ?? 0;
      const failedTasks = counts.failed ?? 0;

      if (done === 0 && failedTasks === 0) {
        process.stdout.write(
          'nothing to work. Record an outcome first: construct outcome "<what you want>"\n',
        );
        return 0;
      }

      // A run where every task failed is not a run that finished, and saying
      // "already settled" in the same words used for a successful one leaves the
      // user with a dead run id and no stated path. The store is
      // right that a failed task is terminal and that the host owns retries
      // (commitment 1) — nothing here adds a retry policy. What was missing is
      // that two different things were being reported identically: the task a
      // host genuinely could not do, and the task that never reached a working
      // host at all. The recorded error is what tells them apart, so it is shown.
      if (done === 0) {
        const where = args.run ? ` for ${args.run}` : '';
        process.stdout.write(`nothing to work${where}.\n`);
        for (const task of listTasks(store, args.run).filter((t) => t.state === 'failed')) {
          process.stdout.write(`  ✗ ${task.role.padEnd(20)} ${failureLine(task.error)}\n`);
        }
        writeTotalFailureRecourse(failedTasks);
        return 1;
      }

      process.stdout.write(
        args.run
          ? `nothing to work for ${args.run}. Its tasks are already settled.\n`
          : 'nothing to work. Every task in the store is already settled.\n',
      );
      if (failedTasks > 0) {
        process.stdout.write(
          `${String(failedTasks)} of ${String(done + failedTasks)} task(s) failed; ` +
            'their roles produced no deliverable.\n',
        );
      }
      if (raised > 0) {
        process.stdout.write(
          `\n${String(raised)} decision(s) need you — the roles disagree.\n` + 'See: construct inbox\n',
        );
      }
      return 0;
    }

    // The producer half of grounding, run before any dispatch: what each run's
    // declared sources actually hold is surveyed and recorded, so materialFor
    // answers the coordinator from evidence rather than from silence. Once per
    // run — the record is evidence, not a cache — and a run whose plan
    // declared no sources is left exactly as it was.
    const pendingRuns = new Set(
      listTasks(store, args.run)
        .filter((t) => t.state === 'pending')
        .map((t) => t.run),
    );
    // Where the roles will actually run: the host's --dir when given, and
    // otherwise wherever this process was invoked, which is what every adapter
    // inherits when nothing is passed.
    const dispatchDirectory = resolve(args.dir ?? process.cwd());

    for (const runId of pendingRuns) {
      const pass = groundRun(store, runId, now());
      if (!pass || pass.skipped) continue;
      const documents = pass.documents;
      process.stdout.write(`grounded ${runId}: ${groundingSummary(pass)}\n`);

      // Licensing ground the dispatch cannot open is how a run comes back
      // three-tasks-done with every file read failed and every deliverable
      // ungrounded. Knowable here, before a model call is paid for.
      const reach = groundReach(groundRootsFor(store, runId), dispatchDirectory);
      const unreachable = unreachableGroundMessage(reach, dispatchDirectory, UNREACHABLE_GROUND_FLAG);
      if (unreachable && !args.allowDistantGround) {
        process.stderr.write(`work: ${unreachable}`);
        appendWorkLog(store, {
          run: runId,
          role: 'construct',
          action: 'ground-unreachable',
          detail: { from: dispatchDirectory, unreachable: reach.unreachable, reachable: reach.reachable },
          at: now(),
        });
        return 1;
      }
      if (unreachable) {
        // Overridden, not absent: the operator said this host reaches past its
        // working directory, and the record must show that was a choice.
        process.stdout.write(`  ⚑ ${UNREACHABLE_GROUND_FLAG}: ${String(reach.unreachable.length)} root(s) outside ${dispatchDirectory}\n`);
        appendWorkLog(store, {
          run: runId,
          role: 'construct',
          action: 'ground-unreachable-allowed',
          detail: { from: dispatchDirectory, unreachable: reach.unreachable },
          at: now(),
        });
      }

      // Where a measured floor is met before it is paid for, rather than ten
      // minutes per role later. It is stated as the nearest recorded
      // observation and names the model it was measured on, because a
      // measurement on a neighbouring model is not a prediction about this
      // one — and both ways out are named, since a caution with no next move
      // is just a slower failure.
      const floor = dispatchFloorFor(host.model ?? model, documents);
      if (floor) {
        const limit = host.invocationTimeoutMs ?? floor.timeoutMs;
        process.stdout.write(
          `  ⚑ nearest recorded observation (${floor.observedOn}, ${floor.measuredOn}): ${floor.observation}.\n` +
            `    This dispatch has ${String(documents)} document${documents === 1 ? '' : 's'} and ` +
            `${String(Math.round(limit / 60000))} minute(s) per role.\n` +
            '    Give it longer:  construct work --timeout=<minutes> --lease-minutes=<more>\n' +
            '    Or give it less ground:  construct source add --workspace=<name> …  then ' +
            'construct outcome --workspace=<name> …\n' +
            `    Evidence: ${floor.evidence}\n`,
        );
      }
    }

    try {
      await host.init();
    } catch (error) {
      // A host that cannot start must never read as a run with nothing to do.
      process.stderr.write(`work: host "${host.name}" is not available — ${(error as Error).message}\n`);
      return 1;
    }

    if (args.voice) {
      // Said out loud, not only written down: an deliverable that will not sound
      // like Construct is a thing the user should see themselves choosing.
      process.stdout.write(`voice overridden for this run: ${args.voice}\n`);
    }

    const report = await workRun(store, host, {
      owner: `cli-${String(process.pid)}`,
      clock: now,
      spendCeiling: args.ceiling,
      concurrency: args.concurrency,
      leaseMs: args.leaseMinutes * 60 * 1000,
      run: args.run,
      // Establishes the signing secret on first dispatch; every task gets a
      // capability token scoped to its own lease (commitment 14).
      capabilitySecret: loadOrCreateSecret(secretFile()),
      ...(args.voice ? { voice: { instruction: args.voice, source: 'cli --voice' } } : {}),
    });


    process.stdout.write(
      `worked ${String(report.dispatched)} task(s) on ${host.name}: ` +
        `${String(report.completed)} done, ${String(report.failed)} failed.\n`,
    );
    if (report.slotGapsRaised > 0) {
      process.stdout.write(
        `${String(report.slotGapsRaised)} deliverable(s) came back with required sections unfilled; ` +
          'each is one inbox decision carrying the default the draft proceeds on. See: construct inbox\n',
      );
    }
    // Only what this invocation settled. Listing everything settled in the
    // store would report a second run's work as this one's.
    for (const id of report.settled) {
      const task = getTask(store, id);
      if (!task) continue;
      if (task.state === 'failed') {
        process.stdout.write(`  ✗ ${task.role.padEnd(20)} ${failureLine(task.error)}\n`);
        continue;
      }
      const cost = task.spendReported ? `$${money(task.spend)}` : 'cost not reported';
      process.stdout.write(`  ✓ ${task.role.padEnd(20)} ${cost}\n`);

      // The two lines a user has to see: what is wrong with this deliverable,
      // and whether anyone is allowed to rely on it as it stands.
      for (const concern of deliverableConcerns(task.result)) {
        process.stdout.write(`      ⚑ ${concern.detail}\n`);
      }
      const review = licensedReviewFor(task.role);
      if (review) {
        process.stdout.write(
          `      → issue-spotting only: needs review by a licensed ${review} before you rely on it\n`,
        );
      }
    }

    // One merged issue list instead of N overlapping essays. The merge is
    // lexical and labeled; a duplicate it fails to merge shows twice rather
    // than losing anything.
    const settledDeliverables = report.settled
      .map((id) => getTask(store, id))
      .filter((task) => task !== null && task.state === 'done')
      .map((task) => {
        const draft = latestDraft(store, task!.id)?.deliverable ?? task!.result;
        const text =
          typeof draft === 'string'
            ? draft
            : typeof (draft as { text?: unknown } | null)?.text === 'string'
              ? ((draft as { text: string }).text)
              : null;
        return text === null ? null : { role: task!.role, text };
      })
      .filter((d): d is { role: string; text: string } => d !== null);
    const merged = synthesizeIssues(settledDeliverables);
    if (merged.length > 0) {
      process.stdout.write(`\nissues across roles (${String(merged.length)}, merged lexically):\n`);
      for (const [index, issue] of merged.entries()) {
        process.stdout.write(`  ${String(index + 1)}. [${issue.roles.join(', ')}] ${issue.text}\n`);
      }
    }

    // "spend 0 of 10.00 ceiling" after a run where nothing completed reads as
    // "this was cheap" when the true statement is that nothing ran. The
    // costSilent branch below does not cover it: these tasks failed rather than
    // completing without reporting a cost.
    if (report.completed === 0 && report.failed > 0) {
      writeTotalFailureRecourse(report.failed);
    } else {
      // What this invocation spent, against what it was allowed to spend. The
      // lifetime total is a different fact and was being printed under this
      // sentence, so a store with history read as a run that had nearly
      // exhausted its budget before starting.
      process.stdout.write(
        `\nreported cost ${money(report.spendAfter - report.spendBefore)} of ` +
          `${money(report.spendCeiling)} allowed for this run ` +
          `(${money(report.spendAfter)} recorded across every run in this store).\n`,
      );
    }
    if (report.conflicts > 0) {
      // The inbox is the point of the whole run: work happened in the
      // background, and this is the part that is genuinely the user's.
      process.stdout.write(
        `\n${String(report.conflicts)} decision(s) need you — the roles disagree.\n` +
          'See: construct inbox\n',
      );
    }
    if (report.recovered > 0) {
      process.stdout.write(
        `recovered ${String(report.recovered)} task(s) from an earlier run that did not finish.\n`,
      );
    }
    if (report.degraded > 0) {
      // Degrade loudly. The run happened and the deliverables
      // are real; what must not happen is anyone citing them without knowing
      // what produced them.
      process.stdout.write(
        `${String(report.degraded)} task(s) ran below the model capability floor their brief declared. ` +
          'Those deliverables are qualified by the model that produced them — see: construct log\n',
      );
    }
    if (report.costSilent > 0) {
      // Saying "under the ceiling" about spend nobody measured is the same
      // class of claim commitment 15 exists to forbid.
      process.stdout.write(
        `${String(report.costSilent)} task(s) ran on a host that reported no cost. ` +
          'The ceiling did not bind on those.\n',
      );
    }
    if (report.halted === 'spend-ceiling') {
      const left = countTasksByState(store, args.run).pending ?? 0;
      process.stdout.write(
        `\nhalted: this run reached the ${money(report.spendCeiling)} ceiling. ` +
          `${String(left)} task(s) left pending — raise it with --ceiling=<amount> to continue.\n` +
          'The figure is what a host reports each call costs. On a subscription host that is an ' +
          'estimate of work done rather than an amount charged, so the ceiling bounds how much ' +
          'work a run may do and is not a spending limit.\n',
      );
      return 1;
    }
    return report.failed > 0 ? 1 : 0;
  });
}

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
 * Render a submitted deliverable for reading. A string is the text itself; an
 * object with a `text` field was a role wrapping its prose; anything else is
 * shown as formatted JSON rather than hidden.
 */
function renderDeliverable(deliverable: unknown): string {
  if (typeof deliverable === 'string') return deliverable;
  const text = (deliverable as { text?: unknown } | null)?.text;
  if (typeof text === 'string') return text;
  return JSON.stringify(deliverable, null, 2);
}

/**
 * The deliverable is the product, and until this command existed no surface
 * showed it: `work` reported "done" with the cost, `log` reported action
 * names, and the text a user paid for sat in the store readable only by hand.
 * A spine that ends at "done" without showing the work is missing its last
 * step.
 */
export function show(argv: string[]): number {
  const runIndex = argv.indexOf('--run');
  const run = argv.find((a) => a.startsWith('--run='))?.slice('--run='.length)
    ?? (runIndex >= 0 ? argv[runIndex + 1] : undefined);
  if (!run) {
    process.stderr.write('usage: construct show --run <id>\n');
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
      process.stdout.write(`\n${task.role} — ${task.state}`);
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
        process.stdout.write(`\n  ${limit.label}`);
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
      const body = renderDeliverable(deliverable)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      process.stdout.write(`${body}\n`);
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
        process.stdout.write(`  ${read.role}: ${read.locator}\n    took: ${read.took}\n`);
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
          `${howInferred(entry.detail)}${reasonClause(entry.action, entry.detail)}\n`,
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
        `${role} was denied ${grant} ${String(n)} times — the surface held, and a role ` +
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
    if (open.length === 0) {
      process.stdout.write('decision inbox: empty. Nothing needs you right now.\n');
      return 0;
    }
    process.stdout.write(`decision inbox (${open.length}):\n\n`);
    for (const decision of open) {
      process.stdout.write(`  ${decision.id}  ${decision.question}\n`);
      for (const position of decision.positions) {
        const cited = position.citation ? ` [${position.citation}]` : ' [unverified]';
        process.stdout.write(`      ${position.role}: ${position.stance}${cited}\n`);
      }
      process.stdout.write('\n');
    }
    process.stdout.write('Resolve with: construct decide <id> "<your call>"\n');
    return 0;
  });
}

const LESSONS_USAGE =
  'usage: construct lessons [--workspace=<name>]\n' +
  '       construct lessons --admit=<lesson-id> --by=<approver> [--detail="<why>"] [--workspace=<name>]\n';

/**
 * The domain a human review tiers a lesson by, re-derived rather than asked
 * for. A run-derived lesson cites the decision it was distilled from, so the
 * same worst-tier pick the decide command made is recoverable from the store;
 * any other lesson's domain is not recorded, and "unrated" derives high-risk,
 * which is the honest default — under a human-approval basis the tier changes
 * nothing, and no caller gets to declare its own lesson low-risk.
 */
function admissionDomainFor(store: Store, lesson: Lesson): string {
  if (!runDerived(lesson)) return 'unrated';
  const decision = getDecision(store, lesson.citation.slice(DECISION_CITATION_PREFIX.length));
  const domains = decision
    ? [...new Set(decision.positions.filter((p) => p.role !== 'construct').map((p) => p.role))]
    : [];
  return domains.find((d) => riskTierFor(d) === 'high') ?? domains[0] ?? 'unrated';
}

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
      process.stdout.write(`${decision.verdict} ${id}: ${decision.reason}\n`);
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
        process.stdout.write(`      ${lesson.body}\n`);
        process.stdout.write(
          `      ${verdict ? `${verdict.verdict}: ${verdict.reason}` : 'held: no verdict recorded — absence of a verdict is a hold nobody wrote down'}\n`,
        );
        process.stdout.write(`      cites ${lesson.citation}\n`);
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
  '       construct decide --apply=<proposal-id> --host=<opencode|claude> ' +
  '[--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>]\n' +
  '         (codex and cursor dispatch read-only and cannot carry a change out)\n';

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
      process.stderr.write(`decide: host "${adapter.name}" is not available — ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(
      `applying ${proposal} through ${adapter.name}, which dispatches unconfined — ` +
        'the model acts with whatever reach your install grants it.\n',
    );
    const result = await applyProposal(
      store,
      createHostApplier(adapter, (id) => getSource(store, id)?.locator ?? 'an undeclared source'),
      proposal,
      now(),
    );
    if (result.outcome === 'applied') {
      if (result.projected) {
        process.stdout.write(`mirrored as ${result.projected} before it crossed\n`);
      }
      process.stdout.write(`applied ${proposal}: ${result.detail}\n`);
      return 0;
    }
    if (result.outcome === 'unappliable') {
      if (result.projected) {
        process.stdout.write(
          `mirrored as ${result.projected} before the attempt; the mirror records what was proposed, not a landing\n`,
        );
      }
      process.stderr.write(`decide: ${proposal} was not applied — ${result.reason}\n`);
      return 1;
    }
    process.stderr.write(`decide: ${proposal} cannot be applied — ${result.reason}\n`);
    return 1;
  });
}

export async function decide(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);
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
          `distilled ${distilled.id} (${admitted.verdict}): ${admitted.reason}\n`,
        );
      } catch (error) {
        process.stdout.write(
          `the decision was resolved but the lesson could not be recorded (${(error as Error).message})\n`,
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

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
  'usage: construct watch [--root=<repo>] [--sweep]\n';

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
 * The standing watch, swept once.
 *
 * A watch is an outcome that never closes, so there is no "start" to run and
 * nothing to schedule: something outside decides when to look, exactly as
 * something outside decides when to `work`. The only ground is Construct
 * itself (commitment 16 made operational), which is why this takes a repo root
 * and nothing else. External ground waits behind its gates.
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
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? '';
  }
  if (flags.help !== undefined) {
    process.stdout.write(WATCH_USAGE);
    return 0;
  }
  const root = flags.root || process.cwd();
  if (!isConstructCheckout(root)) {
    process.stderr.write(
      `watch: ${root} is not a Construct checkout.\n` +
        'The watch reports drift between this project\'s strategy, tracker, and repo,\n' +
        'so --root selects which checkout of Construct to inspect, not which project\n' +
        'to watch. Watching other ground is not built yet.\n',
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
          process.stdout.write(`  ${entry.recordedAt}  ${entry.value}\n    cites ${entry.citation}\n`);
        }
        return 0;
      }
      const fields = currentFields(store, id);
      if (fields.length === 0) {
        process.stdout.write('  no fields recorded yet\n');
        return 0;
      }
      for (const field of fields) {
        process.stdout.write(`  ${field.field}: ${field.value}\n    cites ${field.citation}\n`);
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
 * Put the composition's gaps back to the roles, once.
 *
 * Fail-soft by construction: a role whose closing call fails leaves its gaps
 * standing, which is exactly the state the document was in before this round
 * existed. A closing round is work the run can do on top of an answer it
 * already has, so it must never be able to cost the answer.
 */
async function closeGaps(input: {
  readonly host: HostAdapter;
  readonly outcome: string;
  readonly groundRoots: readonly string[];
  readonly sources: readonly SourceDeliverable[];
  readonly briefs: ReadonlyMap<string, Brief>;
  readonly gaps: readonly string[];
}): Promise<ClosingRound> {
  const close = createHostGapCloser(input.host, input.outcome, input.groundRoots);
  const replies: ClosingReply[] = [];
  process.stdout.write(
    `\nclosing round: ${String(input.gaps.length)} unanswered question(s) back to ` +
      `${String(input.sources.length)} role(s) — one call each\n`,
  );
  for (const source of input.sources) {
    try {
      const reply = await close(source, input.gaps);
      // A role whose brief cannot be read is asked and then not admitted: the
      // checks it owed are the ones its answer must pass, and running a
      // different set against it would be a weaker gate wearing the same name.
      const brief = input.briefs.get(source.role);
      replies.push(
        brief === undefined
          ? {
              closed: [],
              unclosed: reply.unclosed,
              refused: reply.closed.map((answer) => ({
                gap: answer.gap,
                reason: `${source.role}'s brief could not be read, so its answer could not be held to the checks it owed`,
              })),
            }
          : screenClosedAnswers(reply, brief, input.groundRoots),
      );
    } catch (error) {
      process.stdout.write(
        `  ${source.role} could not be asked (${(error as Error).message}); its gaps stand\n`,
      );
    }
  }
  return foldClosingRound(input.gaps, replies);
}

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
        text: renderDeliverable(latestDraft(store, task.id)?.deliverable ?? task.result),
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
      process.stderr.write(`compose: host "${host.name}" is not available — ${(error as Error).message}\n`);
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
        shape = shapeForOutcome(plan.outcome);
        process.stdout.write(
          `shape: ${shape.name} (the model could not be asked; falling back to the keyword guess)\n`,
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
      process.stderr.write(`compose: the deliverables could not be composed (${(error as Error).message}).\n`);
      return 1;
    }
    for (const drop of screened.discarded) {
      process.stdout.write(`  discarded: "${drop.claim.text.slice(0, 60)}" — ${drop.reason}\n`);
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
        `  no position taken (${(error as Error).message}); the arranged document stands alone\n`,
      );
    }
    for (const drop of position?.refused ?? []) {
      process.stdout.write(`  refused from the position: "${drop.text.slice(0, 60)}" — ${drop.reason}\n`);
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
          `compose: ${source.role}'s claims could not be checked (${(error as Error).message}); ` +
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
          `  ${source.role}: ${String(verdict.unsupported.length)} of ${String(mine.length)} claims not supported — ${verdict.detail}\n`,
        );
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
            `  ${source.role} could not be asked about the call (${(error as Error).message}); ` +
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
                `  refused from the repaired position: "${drop.text.slice(0, 60)}" — ${drop.reason}\n`,
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
          `  the call could not be sent back (${(error as Error).message}); it stands with its objections\n`,
        );
      }
    }

    const kept = screened.claims.filter((claim) => !unsupported.has(claim));
    process.stdout.write(`\n# ${plan.outcome}\n`);

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
          contested.map((fact) => `> - ${contestedLine(fact)}\n`).join(''),
      );
    }

    // Construct's own call, first, because it is the answer to what was asked.
    // Everything below it is the evidence it rests on and the specialists' own
    // work in their own names — a reader can always tell which is which,
    // because they are in different parts of the document under different
    // names, which is what lets the judgment be made at all.
    if (position !== null) {
      const p = position.position;
      const asRecord = flags.record !== undefined;
      const say = (text: string) => (asRecord ? text : renderClaim(text));
      process.stdout.write(`\n## What Construct makes of this\n\n${say(p.approach)}\n`);
      process.stdout.write(
        '\n*This is a judgment across every concern, not any one specialist\'s finding. ' +
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
        process.stdout.write('\n**Where the specialists could not both be acted on**\n\n');
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
          '\n> **A specialist says the call states its work as something else.** ' +
            (callWasRepaired
              ? 'The call went\n> back once with these objections, and this is what it left standing.'
              : callWentBack
                ? 'The call went\n> back once and what came back did not answer this without costing something else,\n> so the first call stands.'
                : 'It was not sent back.') +
            ' Reported rather than resolved from here: the\n' +
            '> judgment is Construct\'s to make and the objection is theirs to make, and a reader\n' +
            '> is owed both.\n>\n' +
            collapseObjections(objections)
              .map((o) => `> - ${o.roles.join(', ')}: "${o.quote}"\n`)
              .join(''),
        );
      }
      // A repair the reader cannot see is a fragile path reading as a solid
      // one. The call they are holding is a second attempt, and that is a fact
      // about it.
      if (callWasRepaired) {
        process.stdout.write(
          '\n*This call is a second attempt. Specialists objected that the first stated their\n' +
            'work as something they had not established, it was sent back once with their\n' +
            'objections, and what came back dropped objections without introducing new ones.*\n',
        );
      }
      process.stdout.write('\n---\n\n*What each specialist established, in their own names:*\n');
    }

    const empty: string[] = [];
    for (const section of shape.sections) {
      const inSection = kept.filter((claim) => claim.section === section.name);
      if (inSection.length === 0) {
        empty.push(section.name);
        continue;
      }
      // The record keeps the markers the gates read; a reader gets sentences.
      // --record asks for the stored form, for anything downstream that needs
      // to check the text rather than read it.
      const asRecord = flags.record !== undefined;
      process.stdout.write(`\n## ${asRecord ? section.name : renderHeading(section.name)}\n\n`);
      // Consecutive bullets read as one list; anything else is a block with
      // its own attribution line, so it gets the blank-line spacing a
      // paragraph, table, or diagram actually needs to render correctly.
      let previousKind: string | null = null;
      for (const claim of inSection) {
        if (previousKind !== null && !(previousKind === 'bullet' && claim.kind === 'bullet')) {
          process.stdout.write('\n');
        }
        process.stdout.write(`${renderComposedClaim(claim, asRecord)}\n`);
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
    const closing =
      screened.uncovered.length > 0 && flags['no-close'] === undefined
        ? await closeGaps({
            host,
            outcome: plan.outcome,
            groundRoots: groundRootsFor(store, run),
            sources,
            briefs,
            gaps: screened.uncovered,
          })
        : null;

    if (closing !== null && closing.closed.length > 0) {
      // A separate section rather than mixed into the composed ones, because
      // the provenance is different and the reader is owed the difference:
      // these are a role's own words from a second dispatch, not the composer's
      // arrangement of a first. Nothing screened them for addition because
      // nothing arranged them — the screen exists for the composer's step.
      process.stdout.write('\n## what was open until somebody went and looked\n\n');
      for (const answer of closing.closed) {
        process.stdout.write(`- ${answer.gap}\n  → ${answer.answer} [${answer.role}]\n`);
      }
    }
    if (closing !== null && closing.contested.length > 0) {
      // Two roles answering the same question is a finding, not a tie to break.
      // Printing one of them alone would be the run resolving a disagreement it
      // has no standing to resolve, under a single name.
      process.stdout.write('\n## questions two roles answered differently\n\n');
      for (const item of closing.contested) {
        process.stdout.write(`- ${item.gap}\n`);
        for (const answer of item.answers) {
          process.stdout.write(`  → ${answer.answer} [${answer.role}]\n`);
        }
      }
    }
    for (const drop of closing?.refused ?? []) {
      process.stdout.write(`  discarded: "${drop.gap.slice(0, 60)}" — ${drop.reason}\n`);
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
        process.stdout.write(`- ${item.gap}\n`);
        // A gap several roles opened their material for and could not settle is
        // a different fact from one nobody looked at, and only the reasons can
        // tell them apart. Without them the second reads as the first.
        for (const reason of item.reasons) {
          process.stdout.write(`  (${reason.role} looked: ${reason.reason})\n`);
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
    process.stdout.write(`  understood as: ${found.understanding.restated}\n`);
    for (const c of found.understanding.constraints) process.stdout.write(`  constraint: ${c}\n`);
    for (const d of found.understanding.decisions) process.stdout.write(`  decided: ${d}\n`);
    for (const p of found.understanding.parked) process.stdout.write(`  parked: ${p}\n`);
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
      process.stdout.write(`\n  ${step.id}  ${step.description}\n`);
      process.stdout.write(
        `    routed to ${step.domain} by ${route?.routedBy ?? 'unknown'}` +
          (route && route.evidence.length > 0 ? ` (${route.evidence.slice(0, 4).join(', ')})` : '') +
          '\n',
      );
      process.stdout.write(`    stage: ${step.stage}  deliverable: ${step.deliverable.deliverable}\n`);
      const required = step.deliverable.slots.filter((s) => s.required).map((s) => s.name);
      process.stdout.write(`    required slots: ${required.join(', ')}\n`);
      if (step.after.length > 0) process.stdout.write(`    after: ${step.after.join(', ')}\n`);
    }
    for (const d of found.discarded) {
      process.stdout.write(`\n  discarded: ${d.description} — ${d.reason}\n`);
    }
    return 0;
  });
}

/**
 * Sources and mode default to the "default" workspace rather than inferring
 * one from the directory: an inferred workspace that guessed wrong would file
 * one client's sources under another, which is the exact failure the lesson
 * store was rebuilt to make unrepresentable. Naming a workspace is cheap;
 * un-crossing two is not.
 */
function workspaceFlag(flags: Record<string, string>): string {
  return flags.workspace?.trim() || 'default';
}

/**
 * `--timeout=<minutes>`, in milliseconds, or undefined for the host's own
 * declared default.
 *
 * Stated in minutes because the wall a user hits is measured in minutes of
 * their afternoon, and taken as a flag because the alternative — one constant
 * for every model — makes a 4b model and a 120b model wait the same, which is
 * a limit nobody measured either way.
 */
function timeoutFlag(flags: Record<string, string>): number | undefined {
  if (flags.timeout === undefined) return undefined;
  const minutes = Number(flags.timeout);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`--timeout must be a positive number of minutes, got "${flags.timeout}"`);
  }
  return minutes * 60 * 1000;
}

function parseFlags(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? 'true';
    else rest.push(arg);
  }
  return { flags, rest };
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

const STANDING_USAGE =
  'usage: construct standing add --every=<N>m|<N>h|<N>d [--workspace=<name>] [--domains=<name,…>] "<what should keep happening>"\n' +
  '       construct standing [list] [--all]\n' +
  '       construct standing retire <id>\n' +
  '       construct standing --due [--host=… --model=… --binary=… --dir=… --ceiling=… ' +
  '--concurrency=… --lease-minutes=… --timeout=…]\n' +
  '         (schedule `construct standing --due` with cron or launchd; nothing here waits or wakes)\n';

/** `--every` in minutes. Days and hours are sugar; the store keeps minutes. */
function parseCadence(every: string): number {
  const match = /^(\d+)([mhd])$/.exec(every.trim());
  if (!match || Number(match[1]) < 1) {
    throw new Error(`--every takes <N>m, <N>h, or <N>d (minutes, hours, days), got "${every}"`);
  }
  const n = Number(match[1]);
  return match[2] === 'm' ? n : match[2] === 'h' ? n * 60 : n * 1440;
}

/** The largest exact unit, so a listing reads the way it was declared. */
function renderCadence(minutes: number): string {
  if (minutes % 1440 === 0) return `${String(minutes / 1440)}d`;
  if (minutes % 60 === 0) return `${String(minutes / 60)}h`;
  return `${String(minutes)}m`;
}

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
          `${String(entry.seq).padStart(4)}  ${entry.run}  proposed "${String(d.proposed ?? '')}"` +
            `  [${String(d.reason ?? 'reason not recorded')}]\n` +
            `      because: ${String(d.why || '(the namer gave no reason, which is what refused it)')}\n`,
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

const SKILLS_USAGE = 'usage: construct skills [--out=<dir>] [--uninstall]\n';

/**
 * Write the Agent Skills pack, or remove one. The pack is output, not state:
 * every decision about what belongs in it, and which folders removal may
 * touch, is made by the kernel projection; this command only supplies the
 * version, does the reading and writing, and says what happened.
 */
export function skills(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const known = new Set(['out', 'uninstall']);
  const unknown = Object.keys(flags).filter((f) => !known.has(f));
  if (unknown.length > 0 || flags.out === 'true') {
    process.stderr.write(SKILLS_USAGE);
    return 2;
  }
  const out = resolve(flags.out ?? join(process.cwd(), '.claude', 'skills'));

  if (flags.uninstall === 'true') {
    if (!existsSync(out)) {
      process.stdout.write(`skills: nothing to remove — ${out} does not exist\n`);
      return 0;
    }
    const folders = readdirSync(out, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const file = join(out, entry.name, SKILL_FILENAME);
        return {
          directory: entry.name,
          skill: existsSync(file) ? readFileSync(file, 'utf8') : null,
        };
      });
    const verdicts = planSkillsUninstall(folders);
    for (const verdict of verdicts) {
      if (verdict.removed) rmSync(join(out, verdict.directory), { recursive: true, force: true });
      process.stdout.write(
        `  ${verdict.removed ? 'removed' : 'kept   '} ${verdict.directory} — ${verdict.why}\n`,
      );
    }
    const removed = verdicts.filter((v) => v.removed).length;
    process.stdout.write(
      `skills: removed ${String(removed)}, kept ${String(verdicts.length - removed)} in ${out}\n`,
    );
    return 0;
  }

  const files = projectSkillsPack({
    lenses: LENSES,
    playbooks: allPlaybooks(),
    standards: LENS_STANDARDS,
    version: packageVersion(),
  });
  for (const file of files) {
    const target = join(out, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    process.stdout.write(`  wrote ${file.path}\n`);
  }
  process.stdout.write(
    `skills: ${String(files.length)} skill(s) written to ${out}, stamped ${packageVersion()}\n` +
      '  Remove them with: construct skills --uninstall\n',
  );
  return 0;
}

const USAGE =
  'usage: construct <outcome|ask|work|notes|review|show|compose|plan|source|standing|record|mode|staff|skills|watch|waive|revoke|verdict|corpus|log|inbox|decide|lessons|serve|doctor|cleanup|version>\n';

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
    case 'standing':
      return standing(argv.slice(1));
    case 'mode':
      return mode(argv.slice(1));
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
