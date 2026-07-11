/**
 * lib/orchestration/delegation-flow.mjs — flow-engine delegation chain for
 * orchestration-policy routes (ADR-0067, construct-rf26.9).
 *
 * Converts a resolved orchestration-policy route (lib/orchestration-policy.mjs's
 * routeRequest()) into a deterministic, checkpointable flow: one step per
 * specialist in route.specialists' (or route.displaySpecialists') order, each
 * step's run() producing exactly the delegation spec — role, reason,
 * handoffContract — that lib/orchestration/runtime.mjs's buildTasks() already
 * computes per task. This mirrors the one-task-at-a-time granularity that path
 * already gets right rather than inventing a new delegation shape; it is the
 * sequencing itself (which specialist is current, and when the chain ends)
 * that moves from freeform dispatchPlan/dispatchSummary prose into a real
 * engine-held state machine.
 *
 * advanceDelegation() is the caller-facing entry point: it rebuilds the flow
 * fresh from the route on every call — routeRequest is a pure function of its
 * inputs, so the flow it implies is fully reproducible — and checkpoints
 * progress under runId via lib/flows/checkpoint.mjs. A caller (an MCP tool, a
 * CLI, a persona driving its own dispatch loop) receives exactly the current
 * step's delegation, never the whole chain, and can resume across separate
 * process/turn boundaries by calling again with the same runId.
 *
 * A route with no specialists (the immediate track, or a focused/orchestrated
 * route that happened to resolve to none) still yields a load-valid flow: a
 * single terminal step whose delegation is null, so building the flow never
 * throws on an empty chain.
 *
 * Retained as engine-internal machinery with no live production caller. The MCP
 * tool that once drove it (orchestration_delegation_next) was removed under the
 * tool-surface budget (commit db90bbf2); ADR-0074 / construct-1in3v chose to
 * keep the flow here rather than re-expose a dispatch surface or delete the
 * port. tests/orchestration-delegation-flow.test.mjs and
 * tests/orchestration-route-path.test.mjs pin specialist-ordering and routePath
 * parity against routeRequest(), guarding the port so a future surface can
 * adopt it without regressing. Carried under 02-deadcode:module-test-only in
 * scripts/audit/baseline.json for that reason.
 */

import { defineFlow } from '../flows/define.mjs';
import { TERMINAL, RUN_STATUS } from '../flows/constants.mjs';
import { tickCheckpointed } from '../flows/checkpoint.mjs';

const STATE_SCHEMA = {
  type: 'object',
  properties: {
    currentDelegation: { type: ['object', 'null'] },
  },
};

// Mirrors lib/orchestration/runtime.mjs's buildTasks(): the actual dispatch
// order is route.specialists, not route.displaySpecialists (the latter is a
// display-only fallback for an immediate-track route's contractChain/
// teamRouting computation — it is never what gets dispatched).

function resolveSpecialists(route) {
  return route.specialists || [];
}

// Mirrors lib/orchestration/runtime.mjs's buildTasks(): the first contract
// chain edge for a given producer is the handoff contract that specialist
// hands off under. Recomputed here rather than imported so this module has
// no runtime dependency beyond the route object itself.

function handoffContractsByProducer(route) {
  const byProducer = new Map();
  for (const edge of route.contractChain || []) {
    const producer = edge.contract?.producer;
    if (producer && !byProducer.has(producer)) byProducer.set(producer, edge.contract.id);
  }
  return byProducer;
}

/**
 * Build (not run) the flow definition implied by a route. Pure function of
 * `route` — same route in, same flow shape out — so a caller never needs to
 * persist the flow itself, only the runId tracking progress through it.
 */
export function buildDelegationFlow(route, { id } = {}) {
  const specialists = resolveSpecialists(route);
  const reasons = route.dispatchReasons || {};
  const handoffByProducer = handoffContractsByProducer(route);
  const flowId = id ?? `delegation-${route.intent ?? 'unknown'}-${route.track ?? 'unknown'}`;

  if (specialists.length === 0) {
    return defineFlow({
      id: flowId,
      stateSchema: STATE_SCHEMA,
      startStep: 'none',
      steps: {
        none: { workerBackend: 'inline', run: () => ({ state: { currentDelegation: null } }), router: () => TERMINAL },
      },
    });
  }

  const names = specialists.map((_, i) => `step_${i}`);
  const steps = {};
  specialists.forEach((role, i) => {
    const nextName = names[i + 1] ?? null;
    steps[names[i]] = {
      workerBackend: 'host',
      run: () => ({
        state: {
          currentDelegation: {
            role,
            reason: reasons[role] || null,
            handoffContract: handoffByProducer.get(role.replace(/^cx-/, '')) || null,
            index: i,
            total: specialists.length,
          },
        },
      }),
      router: () => nextName ?? TERMINAL,
    };
  });

  return defineFlow({ id: flowId, stateSchema: STATE_SCHEMA, startStep: names[0], steps });
}

/**
 * Advance a route's implied delegation chain by exactly one step, checkpointed
 * under runId. First call (no checkpoint yet) starts the run and executes its
 * first step in the same tick, so the caller always gets a real delegation
 * back rather than an empty "not started" state. Every subsequent call with
 * the same runId advances to the next specialist. `done: true` once the chain
 * is exhausted; `currentDelegation` is null only for an immediate-track route
 * that resolved to no specialists at all.
 */
export async function advanceDelegation(cwd, runId, route) {
  const flow = buildDelegationFlow(route);
  const run = await tickCheckpointed(cwd, runId, flow, {});
  const specialists = resolveSpecialists(route);
  return {
    runId,
    flowId: flow.id,
    status: run.status,
    done: run.status !== RUN_STATUS.RUNNING,
    currentDelegation: run.state?.currentDelegation ?? null,
    stepsCompleted: run.completed.size,
    totalSteps: specialists.length,
    // Carried at the advanceDelegation level (not inside currentDelegation)
    // so it survives every tick of the chain, including the terminal tick
    // where currentDelegation is null — a specialist mid-handoff can read why
    // the whole chain was routed, not just its own step.
    routePath: route.routePath || null,
  };
}
