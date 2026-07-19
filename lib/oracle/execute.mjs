/**
 * lib/oracle/execute.mjs — post-approve action executors for Oracle pending queue.
 *
 * Runs maintenance and L1 dispatch after human approval. Never performs git
 * push/commit or destructive deletes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { syncProjectAdapters } from '../adapters-sync.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';
import { aggregateOutcomes } from '../outcomes/aggregate.mjs';
import { recordAndMaybeInvoke } from '../roles/gateway.mjs';
import { validateCapabilityRegistry } from '../registry/validate.mjs';
import { writeRoutingArtifact } from './dispatch.mjs';
import { routeAction } from './routing.mjs';
import { resolveRemediationDispatch } from './remediation-dispatch.mjs';
import { doctorRoot } from '../config/xdg.mjs';
import { workplaceLoopExecuteDirectivesEnabled, executeDirective } from '../workplace-loop/directive-executor.mjs';

function rolePendingPath(homeDir = homedir()) {
  const root = process.env.CONSTRUCT_ROLES_ROOT || doctorRoot(homeDir);
  return path.join(root, 'role-pending.jsonl');
}

function appendRolePending(entry, homeDir = homedir()) {
  const file = rolePendingPath(homeDir);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

async function dispatchWorkerProfile({ action, projectDir, homeDir, workerProfileId, eventType, assignment = null, dispatch = null }) {
  const route = routeAction(action.kind);
  const artifactPath = writeRoutingArtifact({
    projectDir,
    tickId: action.id,
    synthesis: { verdict: 'approved', gaps: [], recommendedActions: [action] },
    readModel: null,
    route: dispatch ?? route,
  });

  const prevRolesRoot = process.env.CONSTRUCT_ROLES_ROOT;
  process.env.CONSTRUCT_ROLES_ROOT = doctorRoot(homeDir);

  const event = {
    project: projectDir,
    cwd: projectDir,
    summary: `[oracle] ${action.kind}: ${action.summary}`,
    context: {
      oracleActionId: action.id,
      kind: action.kind,
      artifactPath,
      policyId: route.policyId,
      approverWorkerProfileId: route.workerProfileId,
      assignmentMode: dispatch?.mode ?? 'single',
      assignment,
    },
  };

  let gatewayResult = null;
  try {
    gatewayResult = await recordAndMaybeInvoke(eventType, event);
  } catch {
    gatewayResult = { recorded: false, escalated: false, reason: 'gateway-error' };
  }

  if (!gatewayResult?.escalated) {
    appendRolePending({
      ts: Date.now(),
      workerProfileId,
      bdIssueId: gatewayResult?.bdIssueId ?? null,
      fingerprint: `oracle-${action.id}-${workerProfileId}`,
      eventType,
      summary: action.summary,
      source: 'oracle-execute',
      artifactPath,
      assignmentMode: dispatch?.mode ?? 'single',
      assignmentId: assignment?.id ?? null,
    }, homeDir);
  }

  if (prevRolesRoot === undefined) delete process.env.CONSTRUCT_ROLES_ROOT;
  else process.env.CONSTRUCT_ROLES_ROOT = prevRolesRoot;

  return {
    ok: true,
    artifactPath,
    gateway: gatewayResult,
    workerProfileId,
    assignment,
  };
}

async function dispatchRemediation({ action, projectDir, homeDir, eventType, workerProfileId = null }) {
  const dispatch = resolveRemediationDispatch(action, { projectDir });
  const assignments = workerProfileId
    ? [{ id: 'assignment-1', workerProfileId, primary: true }]
    : dispatch.assignments;
  const effectiveDispatch = {
    mode: assignments.length <= 1 ? 'single' : 'parallel',
    assignments,
  };
  const results = [];
  for (const assignment of assignments) {
    results.push(await dispatchWorkerProfile({
      action,
      projectDir,
      homeDir,
      workerProfileId: assignment.workerProfileId,
      assignment,
      eventType,
      dispatch: effectiveDispatch,
    }));
  }
  return {
    ok: true,
    mode: effectiveDispatch.mode,
    assignments,
    results,
  };
}

/**
 * Execute an approved Oracle pending action.
 *
 * @param {object} action — pending row from pending.jsonl
 * @param {object} opts
 * @param {object} [opts.directiveExecutorOpts] - forwarded to executeDirective
 *   (injectable runTask/approvalQueue/fetchImpl for tests); only consulted
 *   by the 'directive-due' case.
 */
export async function executeApprovedAction(action, { rootDir, projectDir, homeDir, dryRun = false, directiveExecutorOpts = {} } = {}) {
  if (dryRun) return { ok: true, dryRun: true, kind: action.kind };

  const kind = action.kind;
  switch (kind) {
    case 'outcomes-aggregate': {
      aggregateOutcomes(projectDir);
      return { ok: true, kind, result: 'aggregated' };
    }
    case 'registry-validate': {
      const report = validateCapabilityRegistry({ rootDir });
      return { ok: report.valid, kind, errors: report.errors?.length ?? 0, warnings: report.warnings?.length ?? 0 };
    }
    case 'adapters-sync': {
      if (!isConstructPackageRepo(projectDir)) {
        return { ok: true, kind, skipped: true, reason: 'not-tool-repo' };
      }
      const result = syncProjectAdapters({ projectRoot: projectDir, packageRoot: rootDir, log: () => {} });
      return { ok: !!result.synced, kind, hosts: result.hosts ?? [] };
    }
    case 'census-run': {
      const script = path.join(rootDir, 'scripts', 'alignment', 'census.mjs');
      if (!fs.existsSync(script)) return { ok: false, kind, error: 'census script missing' };
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync(process.execPath, [script], { cwd: rootDir, encoding: 'utf8' });
      return { ok: result.status === 0, kind, exitCode: result.status };
    }
    case 'worker-profile-review':
      return dispatchRemediation({
        action, projectDir, homeDir, workerProfileId: 'reviewer', eventType: 'contract.violation',
      });
    case 'trace-review':
      return dispatchRemediation({
        action, projectDir, homeDir, workerProfileId: 'reviewer', eventType: 'outcomes.degraded',
      });
    case 'doctor-followup':
      return dispatchRemediation({
        action, projectDir, homeDir, workerProfileId: 'operations', eventType: 'service.down',
      });
    case 'executive-signoff-required':
    case 'structure-cleanup-proposal':
      return dispatchRemediation({
        action, projectDir, homeDir, workerProfileId: routeAction(kind).workerProfileId, eventType: 'oracle.approval',
      });
    case 'directive-due': {
      // Human approval of the Oracle action ("yes, run this directive") is
      // the first gate; oracle.executeDirectives is a second, separate
      // opt-in for whether approval also means unattended LLM execution
      // versus the default toast-only dispatch every other action uses.
      // Directive execution runs under E5 (lib/workplace-loop/directive-executor.mjs,
      // construct-b0nny.25); the oracle-owned executor is retired as a
      // rollback reference only (construct-b0nny.17).
      if (!workplaceLoopExecuteDirectivesEnabled({ env: directiveExecutorOpts.env ?? process.env, cwd: rootDir })) {
        return dispatchWorkerProfile({
          action,
          projectDir,
          homeDir,
          workerProfileId: action.directiveWorkerProfileId,
          assignment: { id: 'assignment-1', workerProfileId: action.directiveWorkerProfileId, primary: true },
          eventType: 'directive.due',
        });
      }
      const result = await executeDirective(
        { id: action.directiveId, specialist: action.directiveWorkerProfileId, instruction: action.directiveInstruction },
        { projectDir, ...directiveExecutorOpts },
      );
      return { kind, directiveId: action.directiveId, ...result };
    }
    default:
      return { ok: false, kind, error: 'no-executor' };
  }
}
