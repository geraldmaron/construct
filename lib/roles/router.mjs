/**
 * lib/roles/router.mjs — compatibility delegator over the consolidated
 * routing table.
 *
 * construct-b0nny.16 merged this module's event → persona resolution logic
 * into lib/orchestration/routing-tables.mjs (resolveEventOwner) so there is
 * one routing-table implementation instead of two. This file now only
 * re-exports that implementation under its original names, preserved for
 * roles/gateway.mjs's remaining external callers (oracle/execute.mjs,
 * lib/doctor/escalate.mjs, lib/hooks/session-start.mjs) until M3b replaces
 * the Oracle daemon and removes the last one. Do not add logic here — extend
 * routing-tables.mjs instead.
 */

import { ownerForEvent, resolveEventOwner } from '../orchestration/routing-tables.mjs';

export function route(event) {
  return resolveEventOwner(event);
}

export function ownerOf(eventType) {
  return ownerForEvent(eventType);
}
