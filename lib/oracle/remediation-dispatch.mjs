/**
 * lib/oracle/remediation-dispatch.mjs — Assignment construction for Oracle remediation.
 *
 * Converts a deterministic Worker Profile route into bounded Assignments.
 * Oracle does not create team/group execution objects; one selected Worker
 * Profile yields a single Assignment and multiple profiles yield parallel
 * Assignments.
 */

import { routeGap, routeAction } from './routing.mjs';

/**
 * @param {object} item — gap or recommended action with optional remediationRoute
 * @returns {{ mode: 'single'|'parallel', assignments: Array<{id:string,workerProfileId:string,primary:boolean}> }}
 */
export function resolveRemediationDispatch(item) {
  const route = item.remediationRoute ?? (item.kind ? routeAction(item.kind) : routeGap(item));
  const workerProfileIds = Array.from(new Set([
    route.workerProfileId,
    route.fallbackWorkerProfileId,
  ].filter(Boolean)));
  return {
    mode: workerProfileIds.length <= 1 ? 'single' : 'parallel',
    assignments: workerProfileIds.map((workerProfileId, index) => ({
      id: `assignment-${index + 1}`,
      workerProfileId,
      primary: index === 0,
    })),
  };
}
