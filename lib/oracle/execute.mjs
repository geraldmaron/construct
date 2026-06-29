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

async function dispatchSpecialist({ action, projectDir, homeDir, personaId, eventType, dispatch = null }) {
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
      gateType: route.gateType,
      requiredApprover: route.primary,
      dispatchMode: dispatch?.mode ?? 'static',
      involvedTeams: dispatch?.teamRouting?.involvedTeams ?? [],
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
      personaId: personaId.replace(/^cx-/, ''),
      cxId: personaId,
      bdIssueId: gatewayResult?.bdIssueId ?? null,
      fingerprint: `oracle-${action.id}-${personaId}`,
      eventType,
      summary: action.summary,
      source: 'oracle-execute',
      artifactPath,
      dispatchMode: dispatch?.mode ?? 'static',
    }, homeDir);
  }

  if (prevRolesRoot === undefined) delete process.env.CONSTRUCT_ROLES_ROOT;
  else process.env.CONSTRUCT_ROLES_ROOT = prevRolesRoot;

  return {
    ok: true,
    artifactPath,
    gateway: gatewayResult,
    personaId,
  };
}

async function dispatchRemediation({ action, projectDir, homeDir, eventType, personaId = null }) {
  const dispatch = resolveRemediationDispatch(action, { projectDir });
  if (dispatch.mode === 'swarm') {
    const results = [];
    for (const specialistId of dispatch.specialists) {
      results.push(await dispatchSpecialist({
        action, projectDir, homeDir, personaId: specialistId, eventType, dispatch,
      }));
    }
    return {
      ok: true,
      mode: 'swarm',
      specialists: dispatch.specialists,
      teamRouting: dispatch.teamRouting,
      results,
    };
  }
  const result = await dispatchSpecialist({
    action,
    projectDir,
    homeDir,
    personaId: personaId ?? dispatch.primary,
    eventType,
    dispatch,
  });
  return { ...result, mode: 'static', teamRouting: dispatch.teamRouting };
}

/**
 * Execute an approved Oracle pending action.
 *
 * @param {object} action — pending row from pending.jsonl
 * @param {object} opts
 */
export async function executeApprovedAction(action, { rootDir, projectDir, homeDir, dryRun = false } = {}) {
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
    case 'specialist-review':
      return dispatchRemediation({
        action, projectDir, homeDir, personaId: 'cx-reviewer', eventType: 'contract.violation',
      });
    case 'trace-review':
      return dispatchRemediation({
        action, projectDir, homeDir, personaId: 'cx-trace-reviewer', eventType: 'outcomes.degraded',
      });
    case 'doctor-followup':
      return dispatchRemediation({
        action, projectDir, homeDir, personaId: 'cx-sre', eventType: 'service.down',
      });
    case 'executive-signoff-required':
    case 'structure-cleanup-proposal':
      return dispatchRemediation({
        action, projectDir, homeDir, personaId: routeAction(kind).primary, eventType: 'oracle.approval',
      });
    default:
      return { ok: false, kind, error: 'no-executor' };
  }
}
