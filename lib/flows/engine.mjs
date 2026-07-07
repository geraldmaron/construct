/**
 * lib/flows/engine.mjs — deterministic step executor and run driver.
 *
 * runStep() executes exactly one named step: it enforces the step's effort
 * budget before calling the step's own logic, merges the returned state delta
 * back through state.mjs's schema-validated transition, and always returns a
 * structured StepResult (status/timing/usage/error) — never a bare value and
 * never a silent truncation on budget exhaustion.
 *
 * createRun()/advanceRun() drive a whole flow one ready step at a time. A run
 * is plain, cloned-not-mutated data (state, frontier, completed set, join
 * progress, usage, history), inspectable and persistable between ticks —
 * checkpoint/resume is a later increment, addable on top of that shape
 * without an engine rewrite.
 *
 * Deterministic ordering: when more than one step is ready in the same tick,
 * the engine always runs the one that appears first in the flow definition's
 * `steps` object (declaration order), regardless of the order routers added
 * them to the frontier or which fan-out branch finished first. And-joins
 * (waitFor: { mode: 'all' }) hold a step out of the frontier until every
 * listed predecessor has completed and routed into it; the default (or an
 * explicit `mode: 'any'`) admits a step to the frontier the first time any
 * predecessor routes into it, which is how branch reconvergence works.
 */

import { TERMINAL, STEP_STATUS, RUN_STATUS } from './constants.mjs';
import { transition, createInitialState } from './state.mjs';

function pickInputs(state, keys) {
  const input = {};
  for (const key of keys) input[key] = state[key];
  return input;
}

export async function runStep(flow, stepName, state, { consumedSoFar = 0 } = {}) {
  const step = flow.steps[stepName];
  const startedAt = Date.now();
  const input = pickInputs(state, step.inputs);

  if (step.budget !== null && consumedSoFar >= step.budget) {
    const finishedAt = Date.now();
    return {
      step: stepName,
      status: STEP_STATUS.BUDGET_EXHAUSTED,
      workerBackend: step.workerBackend,
      input,
      stateDelta: null,
      usage: { consumed: 0, total: consumedSoFar, budget: step.budget },
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      error: { code: 'BUDGET_EXHAUSTED', message: `step "${stepName}" exhausted its effort budget (${step.budget})` },
    };
  }

  let result;
  try {
    result = await step.run(input, { state, stepName, workerBackend: step.workerBackend });
  } catch (err) {
    const finishedAt = Date.now();
    return {
      step: stepName,
      status: STEP_STATUS.ERROR,
      workerBackend: step.workerBackend,
      input,
      stateDelta: null,
      usage: null,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      error: { code: 'STEP_THREW', message: err.message },
    };
  }

  const delta = result?.state ?? {};
  const consumed = result?.usage?.consumed ?? 0;
  const total = consumedSoFar + consumed;
  const usage = step.budget !== null || consumed > 0 ? { consumed, total, budget: step.budget } : null;

  const transitioned = transition(flow.stateSchema, state, delta);
  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;

  if (!transitioned.ok) {
    return {
      step: stepName,
      status: STEP_STATUS.INVALID_STATE,
      workerBackend: step.workerBackend,
      input,
      stateDelta: delta,
      usage,
      startedAt,
      finishedAt,
      durationMs,
      error: transitioned.error,
    };
  }

  return {
    step: stepName,
    status: STEP_STATUS.DONE,
    workerBackend: step.workerBackend,
    input,
    stateDelta: delta,
    usage,
    startedAt,
    finishedAt,
    durationMs,
    error: null,
    state: transitioned.state,
  };
}

export function createRun(flow, initialState = {}) {
  const seeded = createInitialState(flow.stateSchema, initialState);
  if (!seeded.ok) {
    return {
      flow,
      state: initialState,
      frontier: [],
      completed: new Set(),
      joinProgress: new Map(),
      usage: new Map(),
      history: [],
      status: RUN_STATUS.ERROR,
      error: seeded.error,
    };
  }
  return {
    flow,
    state: seeded.state,
    frontier: [flow.startStep],
    completed: new Set(),
    joinProgress: new Map(),
    usage: new Map(),
    history: [],
    status: RUN_STATUS.RUNNING,
    error: null,
  };
}

function pickReadyStep(run) {
  const order = run.flow.stepOrder;
  let best = null;
  for (const stepName of run.frontier) {
    if (best === null || order.indexOf(stepName) < order.indexOf(best)) best = stepName;
  }
  return best;
}

function normalizeRouterResult(nextTargets) {
  if (nextTargets === TERMINAL) return { targets: [], invalid: false };
  if (typeof nextTargets === 'string') return { targets: [nextTargets], invalid: false };
  if (Array.isArray(nextTargets)) return { targets: nextTargets.filter((t) => t !== TERMINAL), invalid: false };
  return { targets: [], invalid: true };
}

export async function advanceRun(run) {
  if (run.status !== RUN_STATUS.RUNNING) return run;
  if (run.frontier.length === 0) return { ...run, status: RUN_STATUS.COMPLETED };

  const stepName = pickReadyStep(run);
  const frontier = run.frontier.filter((s) => s !== stepName);
  const consumedSoFar = run.usage.get(stepName) || 0;

  const result = await runStep(run.flow, stepName, run.state, { consumedSoFar });
  const usage = new Map(run.usage);
  if (result.usage) usage.set(stepName, result.usage.total);
  const history = [...run.history, result];

  if (result.status !== STEP_STATUS.DONE) {
    const status = result.status === STEP_STATUS.BUDGET_EXHAUSTED ? RUN_STATUS.BUDGET_EXHAUSTED : RUN_STATUS.ERROR;
    return { ...run, usage, history, frontier: [], status, error: result.error };
  }

  const completed = new Set(run.completed);
  completed.add(stepName);

  const step = run.flow.steps[stepName];
  const routerResult = step.router(result.state);
  const { targets, invalid } = normalizeRouterResult(routerResult);

  if (invalid) {
    return {
      ...run,
      state: result.state,
      usage,
      history,
      completed,
      frontier: [],
      status: RUN_STATUS.ERROR,
      error: { code: 'ROUTER_INVALID_RESULT', message: `step "${stepName}" router returned an unsupported value` },
    };
  }

  const joinProgress = new Map(run.joinProgress);
  const nextFrontier = [...frontier];

  for (const target of targets) {
    const targetStep = run.flow.steps[target];
    if (!targetStep) {
      return {
        ...run,
        state: result.state,
        usage,
        history,
        completed,
        frontier: [],
        status: RUN_STATUS.ERROR,
        error: { code: 'ROUTER_UNKNOWN_STEP', message: `step "${stepName}" router named unknown step "${target}"` },
      };
    }

    if (targetStep.waitFor && targetStep.waitFor.mode === 'all') {
      const satisfied = new Set(joinProgress.get(target) || []);
      satisfied.add(stepName);
      joinProgress.set(target, satisfied);
      const ready = targetStep.waitFor.steps.every((predecessor) => satisfied.has(predecessor));
      if (ready && !nextFrontier.includes(target)) nextFrontier.push(target);
    } else if (!nextFrontier.includes(target)) {
      nextFrontier.push(target);
    }
  }

  return {
    ...run,
    state: result.state,
    usage,
    history,
    completed,
    joinProgress,
    frontier: nextFrontier,
    status: nextFrontier.length === 0 ? RUN_STATUS.COMPLETED : RUN_STATUS.RUNNING,
    error: null,
  };
}

export async function runFlow(flow, initialState = {}, { maxSteps = 10000 } = {}) {
  let run = createRun(flow, initialState);
  let steps = 0;
  while (run.status === RUN_STATUS.RUNNING && steps < maxSteps) {
    run = await advanceRun(run);
    steps += 1;
  }
  if (run.status === RUN_STATUS.RUNNING && steps >= maxSteps) {
    return { ...run, status: RUN_STATUS.ERROR, error: { code: 'MAX_STEPS_EXCEEDED', message: `flow exceeded ${maxSteps} steps without reaching a terminal state` } };
  }
  return run;
}
