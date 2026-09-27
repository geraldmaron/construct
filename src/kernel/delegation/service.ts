import { createHash, randomUUID } from 'node:crypto';
import type { StateStore } from '../state/open.ts';
import { appendActivity } from '../state/activity.ts';
import { endSession, getSession, registerSession } from '../state/sessions.ts';
import { associateRun, claimWork, createWork, getWork, releaseWork } from '../work/service.ts';
import { normalizeLeasePath, pathsOverlap } from '../work/leases.ts';
import { redact } from '../render/redact.ts';
import { EXECUTORS, type Assignment, type DelegationDriver, type DelegationService, type Disposition, type Execution } from './types.ts';

const ACTIVE = new Set(['queued', 'running', 'orphaned', 'integrating']);
const EVENT = 'delegation.state.v1';

export function executions(store: StateStore): Execution[] {
  const rows = store.db.prepare(`SELECT payload_json FROM work_events WHERE id IN
    (SELECT MAX(id) FROM work_events WHERE kind = ? GROUP BY work_id) ORDER BY id`).all(EVENT) as Array<{ payload_json: string }>;
  return rows.map(row => JSON.parse(row.payload_json) as Execution);
}

export function safeText(value: string, limit = 8000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`text must contain 1 to ${limit} characters`);
  if (redact(value) !== value) throw new Error('credential-shaped content is not admitted to delegation');
  return value;
}

export function normalizeAssignment(input: Assignment): Assignment {
  if (!EXECUTORS.includes(input.executor) || !['implement', 'review'].includes(input.role)) throw new Error('unknown executor or role');
  const paths = [...new Set(input.paths.map(path => normalizeLeasePath(path)))].sort();
  if (!paths.length || paths.length > 64 || paths.includes('/')) throw new Error('name bounded paths, not the entire repository');
  if (!input.acceptance.length || input.acceptance.length > 20) throw new Error('acceptance requires 1 to 20 checks');
  if (input.couplingKeys.length > 64) throw new Error('at most 64 coupling keys may be supplied');
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1000) throw new Error('timeoutMs must be an integer of at least 1000');
  if ((input.role === 'review') !== Boolean(input.subject) || (input.subject && input.repairOf)) throw new Error('a review needs one fixed subject; a repair names repairOf instead');
  return { ...input, workId: safeText(input.workId, 160), requestKey: safeText(input.requestKey, 160), instructions: safeText(input.instructions), paths,
    acceptance: input.acceptance.map(check => safeText(check, 2000)), couplingKeys: [...new Set(input.couplingKeys.map(key => safeText(key, 100)))].sort() };
}

export function createDelegationService(options: {
  readonly store: StateStore;
  readonly sessionId: string;
  readonly target: string;
  readonly now: () => string;
  readonly driver: DelegationDriver;
}): DelegationService {
  const { store, sessionId, target, now, driver } = options;
  const pending = new Map<string, Promise<void>>();
  const tokens = new Map<string, string>();
  let closed = false;

  function all(): Execution[] { return executions(store); }
  function read(id: string): Execution {
    const found = all().find(execution => execution.id === id);
    if (!found || found.leadSession !== sessionId) throw new Error('no execution owned by this lead session');
    return found;
  }
  function write(execution: Execution): Execution {
    const updated = { ...execution, updatedAt: now() };
    store.db.prepare('INSERT INTO work_events (work_id, at, kind, actor, payload_json) VALUES (?, ?, ?, ?, ?)')
      .run(updated.childWorkId, updated.updatedAt, EVENT, sessionId, JSON.stringify(updated));
    appendActivity(store, { at: updated.updatedAt, kind: `delegation.${updated.state}`, actor: sessionId, payload: { executionId: updated.id, workId: updated.childWorkId } });
    return updated;
  }
  function change(id: string, patch: Partial<Execution>): Execution {
    return store.transaction(() => write({ ...read(id), ...patch }));
  }
  function release(execution: Execution): void {
    const token = tokens.get(execution.id);
    if (token) {
      const work = getWork(store, execution.childWorkId);
      if (work?.claimOwner === execution.workerSession) releaseWork(store, { id: execution.childWorkId, owner: execution.workerSession, token, at: now() });
      tokens.delete(execution.id);
    }
    endSession(store, { id: execution.workerSession, at: now(), reason: 'bounded attempt ended; acceptance stays with the lead' });
  }
  function claimValid(execution: Execution): boolean {
    const item = getWork(store, execution.childWorkId);
    return item?.claimOwner === execution.workerSession && item.claimUntil !== null && item.claimUntil > now();
  }
  function reconcile(): void {
    store.transaction(() => {
      for (const execution of all().filter(item => ACTIVE.has(item.state))) {
        if (pending.has(execution.id)) continue;
        const owner = getSession(store, execution.leadSession);
        const alive = driver.alive(execution);
        if (owner && !owner.endedAt && execution.leadSession !== sessionId && alive !== false) continue;
        if (alive !== false || execution.state === 'integrating' || execution.integrationStarted) {
          if (execution.state !== 'orphaned') write({ ...execution, state: 'orphaned', reason: 'supervision lost; process or integration state needs operator reconciliation' });
        } else {
          write({ ...execution, state: 'blocked', reason: 'supervision lost; process absence verified; partial artifacts retained' });
        }
      }
    });
  }
  async function execute(id: string): Promise<void> {
    try {
      let execution = read(id);
      if (execution.state !== 'queued') return;
      const subjectId = execution.assignment.subject ?? execution.assignment.repairOf;
      const snapshot = await driver.prepare(execution, subjectId ? read(subjectId) : null);
      execution = change(id, { snapshot });
      if (closed || execution.state === 'cancelled') return;
      if (!claimValid(execution)) throw new Error('worker claim expired before launch');
      execution = change(id, { state: 'running' });
      const result = await driver.launch(execution, (supervisorPid, groupPid) => { change(id, { supervisorPid, groupPid }); });
      execution = read(id);
      if (execution.state === 'cancelled') return;
      if (!claimValid(execution)) throw new Error('worker claim expired; output is not accepted');
      const summary = redact(result.summary).slice(0, 8000);
      for (const finding of result.findings) {
        safeText(finding.id, 100);
        safeText(finding.requirement, 2000);
        safeText(finding.evidence, 4000);
        if (!execution.assignment.paths.some(path => pathsOverlap(path, normalizeLeasePath(finding.path)))) throw new Error('review finding is outside the assignment');
      }
      const artifact = await driver.collect(execution);
      const validation = result.state === 'succeeded' && execution.assignment.role === 'implement' ? await driver.validate(execution, 'worker', (supervisorPid, groupPid) => { change(id, { supervisorPid, groupPid }); }) : [];
      execution = read(id);
      if (execution.state === 'cancelled') return;
      if (!claimValid(execution)) throw new Error('worker claim expired during validation');
      if (result.state === 'succeeded' && execution.assignment.role === 'implement') {
        const afterValidation = await driver.collect(execution);
        if (artifact.digest !== afterValidation.digest) throw new Error('validation changed the artifact; a fresh attempt is required');
      }
      const validationFailed = execution.assignment.role === 'implement' && result.state === 'succeeded' && (!validation.length || validation.some(check => !check.passed));
      const subject = execution.assignment.subject ? read(execution.assignment.subject) : null;
      const independence = subject && (subject.assignment.executor === execution.assignment.executor || subject.model === execution.model)
        ? 'review independence is limited: executor or configured model matches the implementation' : null;
      change(id, { artifact, validation, result: { ...result, summary }, state: validationFailed ? 'blocked' : result.state,
        reason: validationFailed ? 'worker validation failed; review and integration remain blocked' : result.state === 'succeeded' ? independence : summary });
      if (execution.assignment.role === 'review' && result.state === 'succeeded') {
        store.db.prepare(`INSERT INTO reviews (id, subject_kind, subject_id, subject_revision, method, reviewer, evidence_json, objections_json, dispositions_json, unresolved_json, status, created_at, updated_at)
          VALUES (?, 'work_item', ?, ?, 'bounded-local-review', ?, ?, ?, '[]', ?, 'open', ?, ?)`)
          .run(execution.id, subject!.childWorkId, subject!.artifact!.digest, execution.workerSession, JSON.stringify({ executionId: execution.id }), JSON.stringify(result.findings), JSON.stringify(result.findings.map(finding => finding.id)), now(), now());
      }
    } catch (error) {
      await driver.cancel(id);
      if (read(id).state !== 'cancelled') change(id, { state: 'blocked', reason: redact(error instanceof Error ? error.message : 'execution failed').slice(0, 2000) });
    } finally {
      release(read(id));
    }
  }

  return {
    async start(raw) {
      if (closed) throw new Error('delegation session closed');
      const assignment = normalizeAssignment(raw);
      const signature = createHash('sha256').update(JSON.stringify({ assignment, target })).digest('hex');
      const duplicate = () => {
        const found = all().find(item => item.assignment.workId === assignment.workId && item.assignment.requestKey === assignment.requestKey);
        if (found && (found.signature !== signature || found.leadSession !== sessionId)) throw new Error('requestKey already belongs to another assignment or lead session');
        return found;
      };
      const previous = duplicate();
      if (previous) return previous;
      const status = await driver.status(assignment.executor, assignment.role);
      if (!status.installed || !status.configured || status.authenticated !== 'subscription' || !status.liveVerified || !status.model) throw new Error(`executor disabled: ${status.reason}`);
      if (assignment.timeoutMs > driver.maxTimeoutMs) throw new Error('timeout exceeds configured bound');
      reconcile();
      const execution = store.transaction(() => {
        const retried = duplicate();
        if (retried) return retried;
        const parent = getWork(store, assignment.workId);
        if (!parent || ['completed', 'cancelled', 'superseded', 'historical'].includes(parent.status)) throw new Error('assignment needs existing nonterminal native work');
        if (parent.claimSession !== sessionId || !parent.claimUntil || parent.claimUntil <= now()) throw new Error('lead must hold an unexpired claim on the parent work');
        const active = all().filter(item => ACTIVE.has(item.state));
        if (active.some(item => item.state === 'orphaned')) throw new Error('reconcile orphaned executions before dispatch');
        if (active.length >= driver.maxWorkers) throw new Error('concurrency limit reached');
        if (active.some(item => item.assignment.couplingKeys.some(key => assignment.couplingKeys.includes(key)))) throw new Error('coupled interface work must run serially');
        if (assignment.role === 'implement' && !assignment.repairOf && all().some(item => item.state === 'succeeded' && item.assignment.role === 'implement' && item.assignment.couplingKeys.some(key => assignment.couplingKeys.includes(key)))) throw new Error('coupled predecessor must be reviewed and integrated before another snapshot');
        const subjectId = assignment.subject ?? assignment.repairOf;
        const subject = subjectId ? read(subjectId) : null;
        if (subject && (subject.assignment.role !== 'implement' || subject.state !== 'succeeded' || !subject.artifact || subject.assignment.workId !== assignment.workId || subject.target !== target)) throw new Error('subject must be a successful implementation of the same work and checkout');
        if (subject && JSON.stringify(assignment.paths) !== JSON.stringify(subject.assignment.paths)) throw new Error('review or repair must retain the exact subject scope');
        const repairRoot = assignment.repairOf ? subject!.repairRoot ?? subject!.id : null;
        const repairCycle = repairRoot ? all().filter(item => item.assignment.repairOf && item.repairRoot === repairRoot).length + 1 : 0;
        if (repairCycle > driver.maxRepairCycles) throw new Error('repair limit reached; unresolved findings remain blocked');
        const id = `delegation-${randomUUID()}`;
        const childWorkId = `work-${randomUUID()}`;
        const workerSession = `worker-${randomUUID()}`;
        const at = now();
        registerSession(store, { id: workerSession, host: assignment.executor, surface: 'headless', machine: driver.machine, at });
        createWork(store, { id: childWorkId, kind: 'task', title: `Bounded ${assignment.role}`, description: assignment.instructions, parentId: assignment.workId, scope: { paths: assignment.paths }, acceptance: assignment.acceptance, at, actor: sessionId });
        const claim = claimWork(store, { id: childWorkId, owner: workerSession, session: workerSession, agent: assignment.executor, lane: id,
          paths: assignment.paths, mode: assignment.role === 'review' ? 'shared' : 'exclusive', crossLane: 'refuse', now: at,
          until: new Date(Date.parse(at) + assignment.timeoutMs + 120_000).toISOString() });
        tokens.set(id, claim.claimToken);
        if (assignment.runId) associateRun(store, { workId: childWorkId, runId: assignment.runId, role: assignment.role === 'review' ? 'reviews' : 'implements', at });
        return write({ version: 1, id, repairRoot: repairRoot ?? id, childWorkId, leadSession: sessionId, workerSession, target, machine: driver.machine, model: status.model!, signature,
          assignment, repairCycle, createdAt: at, updatedAt: at, state: 'queued', supervisorPid: null, groupPid: null, snapshot: null, artifact: null,
          result: null, dispositions: [], reason: null, validation: [] });
      });
      if (!pending.has(execution.id) && execution.state === 'queued') {
        const task = Promise.resolve().then(() => execute(execution.id)).catch(async () => {
          closed = true;
          try { await driver.cancel(execution.id); } catch {}
          try { change(execution.id, { state: 'orphaned', reason: 'supervisor persistence failed; dispatch disabled pending reconciliation' }); } catch {}
        }).finally(() => { pending.delete(execution.id); });
        pending.set(execution.id, task);
      }
      return execution;
    },
    async status(id) {
      reconcile();
      if (id) {
        const execution = read(id);
        return { id, state: execution.state, workId: execution.childWorkId, updatedAt: execution.updatedAt, reason: execution.reason };
      }
      return { limits: { concurrentWorkers: driver.maxWorkers, repairCycles: driver.maxRepairCycles, timeoutMs: driver.maxTimeoutMs },
        executors: await Promise.all(EXECUTORS.map(executor => driver.status(executor, 'implement'))),
        executions: all().filter(item => item.leadSession === sessionId).map(item => ({ id: item.id, state: item.state })) };
    },
    result: read,
    async cancel(id) {
      const execution = read(id);
      if (!['queued', 'running'].includes(execution.state)) return execution;
      change(id, { state: 'cancelled', reason: 'cancelled by lead' });
      await driver.cancel(id);
      await pending.get(id);
      return read(id);
    },
    triage(id, dispositions) {
      return store.transaction(() => {
        const execution = read(id);
        if (execution.assignment.role !== 'review' || execution.state !== 'succeeded' || !execution.result) throw new Error('triage requires a completed independent review');
        if (dispositions.length !== execution.result.findings.length || new Set(dispositions.map(item => item.findingId)).size !== dispositions.length) throw new Error('triage each finding exactly once');
        for (const item of dispositions) {
          if (!execution.result.findings.some(finding => finding.id === item.findingId) || !['accepted', 'rejected', 'deferred'].includes(item.decision)) throw new Error('invalid finding disposition');
          safeText(item.rationale, 2000);
        }
        store.db.prepare('UPDATE reviews SET dispositions_json = ?, unresolved_json = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(dispositions), JSON.stringify(dispositions.filter(item => item.decision !== 'rejected').map(item => item.findingId)), dispositions.every(item => item.decision === 'rejected') ? 'resolved' : 'open', now(), id);
        return write({ ...execution, dispositions });
      });
    },
    async integrate(id) {
      let integrationToken: string | null = null;
      const execution = store.transaction(() => {
        const item = read(id);
        if (item.assignment.role !== 'implement' || item.state !== 'succeeded' || !item.artifact) throw new Error('integration requires successful implementation');
        const parent = getWork(store, item.assignment.workId);
        if (parent?.claimSession !== sessionId || !parent.claimUntil || parent.claimUntil <= now()) throw new Error('lead parent claim expired before integration');
        if (all().some(other => ACTIVE.has(other.state))) throw new Error('integration is serial and waits for every active attempt');
        const reviews = all().filter(review => review.assignment.subject === id && review.state === 'succeeded' && review.workerSession !== item.workerSession);
        if (!reviews.length) throw new Error('independent review is required');
        for (const review of reviews) {
          for (const finding of review.result?.findings ?? []) {
            const disposition = review.dispositions.find(entry => entry.findingId === finding.id);
            if (!disposition || disposition.decision === 'accepted' || (finding.blocking && disposition.decision === 'deferred')) throw new Error('unresolved findings block integration; repair and review the new snapshot');
          }
        }
        const at = now();
        const claim = claimWork(store, { id: item.childWorkId, owner: sessionId, session: sessionId, agent: 'integration', lane: target,
          paths: item.assignment.paths, mode: 'exclusive', crossLane: 'refuse', now: at,
          until: new Date(Date.parse(at) + item.assignment.timeoutMs + 120_000).toISOString() });
        integrationToken = claim.claimToken;
        return write({ ...item, state: 'integrating', integrationStarted: true });
      });
      const task = (async () => {
        try {
          await driver.integrate(execution);
          const validation = await driver.validate(execution, 'integrated', (supervisorPid, groupPid) => { change(id, { supervisorPid, groupPid }); });
          if (closed || !validation.length || validation.some(check => !check.passed)) change(id, { state: 'integration_failed', validation, reason: 'combined-result validation interrupted or failed; edits retained for reconciliation, not accepted' });
          else change(id, { state: 'integrated', validation, reason: 'locally integrated and validated; no commit, publication, or deliverable acceptance' });
        } catch (error) {
          change(id, { state: 'integration_failed', reason: redact(error instanceof Error ? error.message : 'integration failed').slice(0, 2000) });
        } finally {
          if (integrationToken) releaseWork(store, { id: execution.childWorkId, owner: sessionId, token: integrationToken, at: now() });
        }
      })().finally(() => { pending.delete(id); });
      pending.set(id, task);
      await task;
      return read(id);
    },
    async close() {
      closed = true;
      const running = [...pending.keys()];
      for (const id of running) change(id, { state: read(id).integrationStarted ? 'integration_failed' : 'cancelled', reason: 'lead session ended' });
      await Promise.all(running.map(id => driver.cancel(id)));
      await Promise.all([...pending.values()]);
    },
  };
}
