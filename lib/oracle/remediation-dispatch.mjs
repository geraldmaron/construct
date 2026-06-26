/**
 * lib/oracle/remediation-dispatch.mjs — static vs swarm dispatch for Oracle remediation.
 *
 * Seeds orchestration-policy teamRouting with gap/action remediation specialists.
 * Swarm when involvedTeams.length > 1; static when a single team owns the work.
 */

import { classifyIntent, teamRoutingForSpecialists } from '../orchestration-policy.mjs';
import { routeGap, routeAction } from './routing.mjs';

function remediationText(item) {
  return String(item.detail ?? item.summary ?? item.id ?? 'Oracle remediation');
}

function seededSpecialists(item) {
  const route = item.remediationRoute ?? (item.kind ? routeAction(item.kind) : routeGap(item));
  return [route.primary, route.secondary].filter(Boolean);
}

/**
 * @param {object} item — gap or recommended action with optional remediationRoute
 * @param {{ projectDir?: string, cwd?: string }} [opts]
 * @returns {{ mode: 'static'|'swarm', primary: string, specialists: string[], teamRouting: object }}
 */
export function resolveRemediationDispatch(item, { projectDir, cwd } = {}) {
  const route = item.remediationRoute ?? (item.kind ? routeAction(item.kind) : routeGap(item));
  const primary = route.primary;
  const specialists = seededSpecialists(item);
  const request = remediationText(item);
  const intent = classifyIntent(request);
  const teamRouting = teamRoutingForSpecialists(specialists, {
    intent,
    request,
    cwd: cwd ?? projectDir ?? null,
  });

  const involvedTeams = teamRouting.involvedTeams ?? [];
  if (involvedTeams.length <= 1) {
    return {
      mode: 'static',
      primary,
      specialists: [primary],
      teamRouting,
    };
  }

  return {
    mode: 'swarm',
    primary,
    specialists: Array.from(new Set(specialists)),
    teamRouting,
  };
}
