/**
 * lib/embed/standing-assignments.mjs — Standing Assignment, the canonical
 * durable record for recurring/triggered work (ADR-0085).
 *
 * A Standing Assignment is "a durable, recurring or triggered unit of
 * scheduled work that Construct executes and tracks to completion". Per
 * ADR-0085 it is the single canonical concept superseding the parallel
 * directive/capability/watch-trigger mechanisms: embed capability jobs
 * converge here (capability-jobs.mjs materializes one assignment per
 * enabled capability via `syncCapabilityAssignments`), the directive shape
 * (provider/specialist/trigger/action) carries forward into this schema
 * rather than surviving as its own concept, and the deferred watch trigger
 * returns as the `source-change` trigger kind — a Trigger Policy over
 * lib/sources/watch.mjs's real change detection, not a second disconnected
 * polling concept. `source-change` is model-level only: assignments
 * carrying it are created programmatically (writeAssignment), because the
 * user-authored config surface stays gated on the ADR-0086 vocabulary
 * migration — the `sources.targets[].watch` schema block does not return.
 *
 * Lifecycle invariant (the P0-4 fix, construct-4uxq0.10.2, made structural):
 * due-detection and attempt-recording are separate, and only an execution
 * attempt may advance last-attempt state. `isAssignmentDue` performs no
 * writes — interval evaluation reads nothing at all, and source-change
 * evaluation consults the watch machinery strictly read-only
 * (`detectSourceChanges` reads persisted watch state and probes upstream
 * without advancing the watch cursor). The ONLY function that writes
 * attempt state is `runAssignmentAttempt`, and it stamps `lastAttemptAt`
 * (plus, for source-change triggers, `lastConsumedRevision`) strictly after
 * the injected executor has been invoked — an executor that throws still
 * counts as an attempt (status `error`), but detecting due-ness, listing,
 * or reading status never does. There is deliberately no exported way to
 * write attempt state without invoking an executor.
 *
 * Persistence: one JSON file per assignment definition plus one per attempt
 * state, under `.construct/runtime/standing-assignments/`, written via the
 * ADR-0081 temp-file-then-rename pattern (lib/flows/checkpoint.mjs's
 * atomicWriteJson shape). File basenames are `encodeURIComponent(id)` so
 * ids may contain `:` (e.g. `capability:operations`) without producing
 * Windows-illegal filenames; readers always take the id from the record
 * content, never from the filename.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { configPath } from '../config-dir.mjs';
import { detectSourceChanges } from '../sources/watch.mjs';

export const ASSIGNMENT_LIFECYCLE_STATES = Object.freeze(['active', 'paused', 'retired']);

/** `webhook` stays reserved for a future reconciliation; `interval` and `source-change` are real. */
export const TRIGGER_KINDS = Object.freeze(['interval', 'source-change']);

export const ACTION_KINDS = Object.freeze(['capability-tick']);

export const ATTEMPT_STATUSES = Object.freeze(['ran', 'skipped', 'blocked', 'error']);

export const ASSIGNMENT_ORIGINS = Object.freeze(['embed-capability', 'manual']);

export const CAPABILITY_ASSIGNMENT_PREFIX = 'capability:';

/** Cadence applied when a converged capability declares no `embed.cadence.every` — mirrors capability-jobs.mjs DEFAULT_CADENCE_MS. */
export const DEFAULT_TRIGGER_EVERY = 'PT15M';

const ASSIGNMENT_ID_PATTERN = /^[a-z0-9][a-z0-9:._-]*$/i;

/** Durable Standing Assignment record directory (definition + attempt-state files). */
export function assignmentsDir(rootDir = process.cwd()) {
  return configPath(rootDir, 'runtime', 'standing-assignments');
}

function assignmentPath(id, rootDir) {
  return join(assignmentsDir(rootDir), `${encodeURIComponent(id)}.assignment.json`);
}

function assignmentStatePath(id, rootDir) {
  return join(assignmentsDir(rootDir), `${encodeURIComponent(id)}.state.json`);
}

// ADR-0081 atomic persistence: write to a pid+counter temp file in the same
// directory, then rename onto the real path — same shape as
// lib/flows/checkpoint.mjs atomicWriteJson.

let writeCounter = 0;

function atomicWriteJson(filePath, value) {
  writeCounter = (writeCounter + 1) % 100000;
  const tmp = `${filePath}.${process.pid}.${writeCounter}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, filePath);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Parse the ISO-8601 duration subset a trigger's `every` accepts (P and T
 * with D/H/M components — the same grammar `embed.cadence.every` has always
 * used; capability-jobs.mjs `parseCadenceMs` delegates here). Unparsable
 * values return null so callers can fall back rather than throw at
 * scheduler startup over one malformed record.
 */
export function parseIntervalMs(every) {
  if (typeof every !== 'string' || !every) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(every);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const ms = ((days * 24 + hours) * 60 + minutes) * 60_000;
  return ms > 0 ? ms : null;
}

/**
 * Validate a Standing Assignment record. Returns `{ valid: true }` or
 * `{ valid: false, errors }` where every error is prefixed with its
 * JSON-schema-style field path (the same fail-closed convention
 * capability-loader.mjs uses). Never throws.
 */
export function validateAssignment(record) {
  const errors = [];

  if (record == null || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['assignment: must be an object'] };
  }

  if (typeof record.id !== 'string' || !ASSIGNMENT_ID_PATTERN.test(record.id)) {
    errors.push(`id: must be a non-empty string matching ${ASSIGNMENT_ID_PATTERN}`);
  }
  if (record.title != null && typeof record.title !== 'string') {
    errors.push('title: must be a string when present');
  }
  if (!ASSIGNMENT_ORIGINS.includes(record.origin)) {
    errors.push(`origin: must be one of ${ASSIGNMENT_ORIGINS.join(', ')}`);
  }
  if (!ASSIGNMENT_LIFECYCLE_STATES.includes(record.lifecycle)) {
    errors.push(`lifecycle: must be one of ${ASSIGNMENT_LIFECYCLE_STATES.join(', ')}`);
  }

  if (record.trigger == null || typeof record.trigger !== 'object' || Array.isArray(record.trigger)) {
    errors.push('trigger: must be an object');
  } else if (!TRIGGER_KINDS.includes(record.trigger.kind)) {
    errors.push(`trigger.kind: must be one of ${TRIGGER_KINDS.join(', ')}`);
  } else if (record.trigger.kind === 'interval' && parseIntervalMs(record.trigger.every) == null) {
    errors.push("trigger.every: must be an ISO-8601 duration using D/H/M components (e.g. 'PT15M')");
  } else if (record.trigger.kind === 'source-change'
    && (typeof record.trigger.targetId !== 'string' || !record.trigger.targetId)) {
    errors.push('trigger.targetId: must be a non-empty source-target id for a source-change trigger');
  }

  if (record.action == null || typeof record.action !== 'object' || Array.isArray(record.action)) {
    errors.push('action: must be an object');
  } else if (!ACTION_KINDS.includes(record.action.kind)) {
    errors.push(`action.kind: must be one of ${ACTION_KINDS.join(', ')}`);
  } else if (record.action.kind === 'capability-tick'
    && (typeof record.action.capabilityId !== 'string' || !record.action.capabilityId)) {
    errors.push('action.capabilityId: must be a non-empty string for a capability-tick action');
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

/**
 * Upsert a Standing Assignment definition. Fails closed: an invalid record
 * is never written — the returned result carries the field-path errors
 * instead. Preserves `createdAt` across upserts of an existing id.
 *
 * @returns {{ ok: true, filePath: string, assignment: object } | { ok: false, errors: string[] }}
 */
export function writeAssignment(record, { rootDir = process.cwd(), now = Date.now() } = {}) {
  const check = validateAssignment(record);
  if (!check.valid) return { ok: false, errors: check.errors };

  const existing = readAssignment(record.id, { rootDir });
  const stamp = new Date(now).toISOString();
  const assignment = {
    version: 1,
    ...record,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };

  mkdirSync(assignmentsDir(rootDir), { recursive: true });
  const filePath = assignmentPath(record.id, rootDir);
  atomicWriteJson(filePath, assignment);
  return { ok: true, filePath, assignment };
}

/** Read one assignment definition, or null when it does not exist or fails to parse. */
export function readAssignment(id, { rootDir = process.cwd() } = {}) {
  return readJson(assignmentPath(id, rootDir));
}

/**
 * List every persisted Standing Assignment, sorted by id. Unparsable
 * definition files are reported in `errors` rather than silently dropped.
 */
export function listAssignments({ rootDir = process.cwd() } = {}) {
  const dir = assignmentsDir(rootDir);
  if (!existsSync(dir)) return { assignments: [], errors: [] };

  const assignments = [];
  const errors = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.assignment.json')) continue;
    const record = readJson(join(dir, name));
    if (record == null) {
      errors.push(`unreadable assignment file: ${name}`);
      continue;
    }
    assignments.push(record);
  }
  assignments.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { assignments, errors };
}

/**
 * Read the durable attempt state for an assignment — null when it has never
 * had an execution attempt. This record is only ever written by
 * `runAssignmentAttempt`.
 */
export function readAssignmentState(id, { rootDir = process.cwd() } = {}) {
  return readJson(assignmentStatePath(id, rootDir));
}

/**
 * Read-only upstream probe for a source-change trigger. Returns the
 * detectSourceChanges result, or null when the drift question cannot be
 * answered (no watch context, watch target does not match the trigger's
 * targetId, or the probe itself fails) — callers treat null as "no
 * verifiable drift", never as due. detectSourceChanges reads persisted
 * watch state and asks upstream (git ls-remote / directory hash) without
 * writing anything, so this helper cannot advance the watch cursor.
 *
 * @param {object} assignment
 * @param {{ target: object, projectRoot?: string, git?: Function }|null} watch
 */
function probeSourceChange(assignment, watch) {
  const targetId = assignment?.trigger?.targetId;
  if (typeof targetId !== 'string' || !targetId) return null;
  if (watch?.target?.id !== targetId) return null;
  try {
    return detectSourceChanges(watch.target, {
      projectRoot: watch.projectRoot ?? process.cwd(),
      ...(watch.git ? { git: watch.git } : {}),
    });
  } catch {
    return null;
  }
}

/**
 * Due-ness evaluation — performs no writes, so due-detection can never
 * advance last-attempt state or the watch cursor (the P0-4 invariant).
 * Non-active lifecycles are never due.
 *
 * `interval`: reads nothing at all; an assignment with no recorded attempt
 * is immediately due, then due again each time the interval elapses past
 * `lastAttemptAt`.
 *
 * `source-change`: consults the real watch machinery read-only via
 * `opts.watch` — due when the target's current upstream revision differs
 * from the revision this assignment last consumed
 * (`state.lastConsumedRevision`, stamped only by `runAssignmentAttempt`;
 * before any attempt, the watch state's own baseline stands in). Fails
 * closed to not-due when the watch context is missing or mismatched, the
 * probe errors, or no baseline exists to define drift against — drift is
 * never fabricated.
 *
 * @param {object} assignment
 * @param {object} [opts]
 * @param {object|null} [opts.state]  attempt state (readAssignmentState result)
 * @param {number} [opts.now]
 * @param {{ target: object, projectRoot?: string, git?: Function }|null} [opts.watch]
 *   source-change only: the resolved source target plus the projectRoot that
 *   scopes its watch state; `git` is injectable exactly as in watch.mjs
 */
export function isAssignmentDue(assignment, { state = null, now = Date.now(), watch = null } = {}) {
  if (assignment?.lifecycle !== 'active') return false;

  if (assignment.trigger?.kind === 'interval') {
    const intervalMs = parseIntervalMs(assignment.trigger.every);
    if (intervalMs == null) return false;

    const lastAttempt = state?.lastAttemptAt ? Date.parse(state.lastAttemptAt) : NaN;
    if (Number.isNaN(lastAttempt)) return true;
    return now - lastAttempt >= intervalMs;
  }

  if (assignment.trigger?.kind === 'source-change') {
    const detection = probeSourceChange(assignment, watch);
    if (detection == null || detection.current == null) return false;
    const consumed = state?.lastConsumedRevision ?? detection.previous ?? null;
    return consumed != null && detection.current !== consumed;
  }

  return false;
}

/**
 * Execute an assignment's action and record the attempt — the ONLY code
 * path that advances `lastAttemptAt`. The state write sits strictly after
 * the executor call: an executor that throws still produced an execution
 * attempt (recorded status `error`), but a non-active assignment returns
 * `{ attempted: false }` without invoking anything and without touching
 * state, and no other export writes this record at all.
 *
 * For a source-change trigger the attempt additionally stamps
 * `lastConsumedRevision` — the upstream revision probed via `opts.watch`
 * at attempt START, so a commit landing mid-execution stays unconsumed and
 * the assignment comes due again. Without a watch context the previous
 * consumed revision carries forward unchanged: an attempt that cannot
 * prove which revision it consumed does not silently mark drift consumed.
 *
 * The executor receives the assignment and must resolve to
 * `{ status: 'ran'|'skipped'|'blocked'|'error', detail?: string }`; extra
 * fields are passed back verbatim as `result` for the caller.
 *
 * @returns {Promise<{ attempted: false, reason: string } | { attempted: true, status: string, detail: string|null, state: object, result: object|null }>}
 */
export async function runAssignmentAttempt(assignment, executor, { rootDir = process.cwd(), now = Date.now(), watch = null } = {}) {
  if (typeof executor !== 'function') {
    throw new TypeError('runAssignmentAttempt requires an executor function — attempt state only advances through a real execution attempt');
  }
  if (assignment?.lifecycle !== 'active') {
    return { attempted: false, reason: `lifecycle-${assignment?.lifecycle ?? 'unknown'}` };
  }

  const sourceChange = assignment.trigger?.kind === 'source-change';
  const attemptRevision = sourceChange ? probeSourceChange(assignment, watch)?.current ?? null : null;

  let status;
  let detail = null;
  let result = null;
  try {
    result = await executor(assignment);
    if (ATTEMPT_STATUSES.includes(result?.status)) {
      status = result.status;
      detail = result.detail ?? null;
    } else {
      status = 'error';
      detail = 'executor-returned-unrecognized-status';
    }
  } catch (err) {
    status = 'error';
    detail = err?.message ?? String(err);
  }

  const previous = readAssignmentState(assignment.id, { rootDir });
  const state = {
    assignmentId: assignment.id,
    lastAttemptAt: new Date(now).toISOString(),
    lastAttemptStatus: status,
    lastAttemptDetail: detail,
    attemptCount: (previous?.attemptCount ?? 0) + 1,
    ...(sourceChange ? { lastConsumedRevision: attemptRevision ?? previous?.lastConsumedRevision ?? null } : {}),
  };
  mkdirSync(assignmentsDir(rootDir), { recursive: true });
  atomicWriteJson(assignmentStatePath(assignment.id, rootDir), state);

  return { attempted: true, status, detail, state, result };
}

/**
 * Merged definition + attempt-state view for one assignment (the CLI
 * `assignments status` shape). Pure read.
 */
export function assignmentStatus(id, { rootDir = process.cwd(), now = Date.now() } = {}) {
  const assignment = readAssignment(id, { rootDir });
  if (!assignment) {
    return { ok: false, errors: [`standing assignment '${id}' not found`] };
  }
  const state = readAssignmentState(id, { rootDir });
  return { ok: true, assignment, state, due: isAssignmentDue(assignment, { state, now }) };
}

/** Canonical assignment id for a converged embed capability. */
export function capabilityAssignmentId(capabilityId) {
  return `${CAPABILITY_ASSIGNMENT_PREFIX}${capabilityId}`;
}

/**
 * Map a capability tick's recorded status onto the attempt-status
 * vocabulary: `ran`→`ran`, `skipped-with-reason`→`skipped`,
 * `blocked`→`blocked`, anything else →`error`.
 */
export function attemptStatusFromTick(tickStatus) {
  if (tickStatus === 'ran') return 'ran';
  if (tickStatus === 'skipped-with-reason') return 'skipped';
  if (tickStatus === 'blocked') return 'blocked';
  return 'error';
}

/**
 * Converge the enabled embed-capability set onto Standing Assignment
 * records (ADR-0085 decision 1): upsert one active `capability:<id>`
 * assignment per enabled capability, and retire any on-disk
 * capability-origin assignment whose capability is not in the enabled set.
 * Manual-origin assignments are never touched. Takes the enabled set as
 * data (`[{ id, every }]`) so this module stays a leaf with no dependency
 * on the capability loader.
 *
 * @returns {{ synced: object[], retired: string[], errors: string[] }}
 */
export function syncCapabilityAssignments({ rootDir = process.cwd(), capabilities = [], now = Date.now() } = {}) {
  const synced = [];
  const retired = [];
  const errors = [];
  const enabledIds = new Set();

  for (const cap of capabilities) {
    enabledIds.add(cap.id);
    const id = capabilityAssignmentId(cap.id);
    const existing = readAssignment(id, { rootDir });
    const desired = {
      id,
      title: `Embed capability: ${cap.id}`,
      origin: 'embed-capability',
      lifecycle: 'active',
      trigger: { kind: 'interval', every: cap.every ?? DEFAULT_TRIGGER_EVERY },
      action: { kind: 'capability-tick', capabilityId: cap.id },
    };

    // Skip the write when the durable record already matches — avoids
    // updatedAt churn on every daemon restart.
    const unchanged = existing
      && existing.lifecycle === desired.lifecycle
      && existing.origin === desired.origin
      && JSON.stringify(existing.trigger) === JSON.stringify(desired.trigger)
      && JSON.stringify(existing.action) === JSON.stringify(desired.action);
    if (unchanged) {
      synced.push(existing);
      continue;
    }

    const result = writeAssignment(desired, { rootDir, now });
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `${id}: ${e}`));
      continue;
    }
    synced.push(result.assignment);
  }

  const { assignments, errors: listErrors } = listAssignments({ rootDir });
  errors.push(...listErrors);
  for (const record of assignments) {
    if (record.origin !== 'embed-capability') continue;
    if (record.lifecycle !== 'active') continue;
    if (enabledIds.has(record.action?.capabilityId)) continue;
    const result = writeAssignment({ ...record, lifecycle: 'retired' }, { rootDir, now });
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `${record.id}: ${e}`));
      continue;
    }
    retired.push(record.id);
  }

  return { synced, retired, errors };
}
