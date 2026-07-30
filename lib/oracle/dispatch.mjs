/**
 * lib/oracle/dispatch.mjs — fleet-health routing artifacts for orchestrator's
 * absorbed cx-oracle duty (deterministic, LLM-free).
 *
 * Writes audit markdown under .construct/oracle/routing/ for approve-gated dispatch.
 * Optional high-severity auto-artifact on tick when gaps are load-bearing.
 */

import fs from 'node:fs';
import path from 'node:path';

import { routeGap, routeAction } from './routing.mjs';
import { resolveRemediationDispatch } from './remediation-dispatch.mjs';
import { configPath } from '../config-dir.mjs';

export function routingDir(projectDir) {
  return configPath(projectDir, 'oracle', 'routing');
}

/**
 * Build deterministic routing markdown from synthesis packet.
 */
export function buildRoutingArtifact({ synthesis, readModel, tickId, route }) {
  const lines = [
    `# ORACLE ROUTING — ${tickId}`,
    '',
    `VERDICT: ${synthesis.verdict ?? 'unknown'}`,
    '',
    'GAPS:',
  ];

  for (const gap of synthesis.gaps ?? []) {
    const r = routeGap(gap);
    const dispatch = gap.remediationRoute?.mode
      ? gap.remediationRoute
      : resolveRemediationDispatch(gap);
    lines.push(`  [${gap.severity}] ${gap.id} — ${gap.detail}`);
    lines.push(`    signal: ${gap.signal ?? 'unknown'}`);
    lines.push(`    Worker Profile: ${r.workerProfileId}${r.fallbackWorkerProfileId ? ` (fallback: ${r.fallbackWorkerProfileId})` : ''}`);
    lines.push(`    Policy: ${r.policyId}`);
    lines.push(`    Assignment mode: ${dispatch.mode}`);
    if (dispatch.assignments?.length) {
      lines.push(`    Assignments: ${dispatch.assignments.map((assignment) => `${assignment.id}=${assignment.workerProfileId}`).join(', ')}`);
    }
  }

  if (!synthesis.gaps?.length) lines.push('  (none)');

  lines.push('', 'RECOMMENDED ACTIONS:');
  for (const action of synthesis.recommendedActions ?? []) {
    const r = routeAction(action.kind);
    lines.push(`  ${action.kind}: ${action.summary}`);
    lines.push(`    Worker Profile: ${r.workerProfileId} · Policy: ${r.policyId}`);
  }
  if (!synthesis.recommendedActions?.length) lines.push('  (none)');

  if (readModel?.collectedAt) {
    lines.push('', `Read model collected: ${readModel.collectedAt}`);
  }
  if (route?.workerProfileId) {
    lines.push('', `WORKER PROFILE: ${route.workerProfileId}`);
  }
  if (route?.policyId) lines.push(`POLICY: ${route.policyId}`);
  if (route?.mode) {
    lines.push(`ASSIGNMENT MODE: ${route.mode}`);
    if (route.assignments?.length) {
      lines.push(`ASSIGNMENTS: ${route.assignments.map((assignment) => `${assignment.id}=${assignment.workerProfileId}`).join(', ')}`);
    }
  }

  lines.push('', 'BLOCKED:', '  none (deterministic routing artifact — LLM dispatch is approve-gated)');
  return lines.join('\n');
}

/**
 * @returns {string} artifact path relative to project root
 */
export function writeRoutingArtifact({ projectDir, tickId, synthesis, readModel, route }) {
  const dir = routingDir(projectDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = `${tickId.replace(/[^a-zA-Z0-9._-]/g, '_')}.md`;
  const file = path.join(dir, fileName);
  const content = buildRoutingArtifact({ synthesis, readModel, tickId, route });
  fs.writeFileSync(file, content, 'utf8');
  return path.relative(projectDir, file);
}

/**
 * Write routing artifact for high-severity tick when any HIGH gap exists.
 */
export function maybeWriteHighSeverityRouting({ projectDir, tick, synthesis, readModel }) {
  const hasHigh = (synthesis.gaps ?? []).some((g) => g.severity === 'high');
  if (!hasHigh) return null;
  const tickId = tick.at ?? new Date().toISOString();
  const primaryGap = synthesis.gaps.find((g) => g.severity === 'high');
  const route = primaryGap?.remediationRoute ?? routeGap(primaryGap);
  return writeRoutingArtifact({ projectDir, tickId, synthesis, readModel, route });
}
