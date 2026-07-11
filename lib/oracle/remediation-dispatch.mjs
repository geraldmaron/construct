/**
 * lib/oracle/remediation-dispatch.mjs — static vs swarm dispatch for Oracle remediation.
 *
 * Seeds the generalized recruiter (lib/orchestration/recruiter.mjs) with
 * gap/action remediation specialists; the recruiter owns the hierarchy-aware
 * participant assembly (construct-pteo2.5). Swarm when involvedTeams.length > 1;
 * static when a single team owns the work.
 */

import { assembleParticipants } from '../orchestration/recruiter.mjs';
import { routeGap, routeAction } from './routing.mjs';

function remediationText(item) {
  return String(item.detail ?? item.summary ?? item.id ?? 'Oracle remediation');
}

/**
 * @param {object} item — gap or recommended action with optional remediationRoute
 * @param {{ projectDir?: string, cwd?: string }} [opts]
 * @returns {{ mode: 'static'|'swarm', primary: string, specialists: string[], teamRouting: object }}
 */
export function resolveRemediationDispatch(item, { projectDir, cwd } = {}) {
  const route = item.remediationRoute ?? (item.kind ? routeAction(item.kind) : routeGap(item));
  const seeds = [route.primary, route.secondary].filter(Boolean);
  return assembleParticipants({
    seeds,
    request: remediationText(item),
    cwd: cwd ?? projectDir ?? null,
  });
}
