/**
 * lib/flows/define.mjs — flow definition loader and load-time validator.
 *
 * defineFlow() is the single gate a flow definition passes through before the
 * engine ever sees it: a bad state schema, a dangling step reference, or a
 * mutating step declaring fanOut all fail here, at load time, rather than as
 * a runtime convention the engine merely documents. loadFlow() adds a file
 * source on top: a JS module (.mjs/.js) is dynamically imported and must
 * export the flow definition, run/router functions included, as its default
 * export. A JSON file holds only data — no function can live in JSON — so its
 * steps carry structure (workerBackend, inputs, budget, fanOut, synthesis,
 * waitFor) and loadFlow's `handlers` option supplies the per-step run/router
 * functions, merged onto the parsed steps before validation. Both paths
 * converge on defineFlow(), so there is exactly one place fan-out/join/schema
 * rules live.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

import { WORKER_BACKENDS, JOIN_MODES, TERMINAL } from './constants.mjs';
import { FlowDefinitionError } from './errors.mjs';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateWaitFor(waitFor, stepName, stepNames, errors) {
  if (waitFor === undefined) return;
  if (!isPlainObject(waitFor) || !JOIN_MODES.includes(waitFor.mode) || !Array.isArray(waitFor.steps) || waitFor.steps.length === 0) {
    errors.push(`step "${stepName}": waitFor must be { mode: 'all' | 'any', steps: string[] } with at least one step`);
    return;
  }
  for (const predecessor of waitFor.steps) {
    if (!stepNames.has(predecessor)) {
      errors.push(`step "${stepName}": waitFor references unknown step "${predecessor}"`);
    }
  }
}

function validateStep(name, step, stepNames, errors) {
  if (!isPlainObject(step)) {
    errors.push(`step "${name}": must be an object`);
    return;
  }
  if (!WORKER_BACKENDS.includes(step.workerBackend)) {
    errors.push(`step "${name}": workerBackend must be one of ${WORKER_BACKENDS.join(', ')}`);
  }
  if (typeof step.run !== 'function') {
    errors.push(`step "${name}": run must be a function`);
  }
  if (step.router !== undefined && typeof step.router !== 'function') {
    errors.push(`step "${name}": router must be a function when provided`);
  }
  if (step.inputs !== undefined && !Array.isArray(step.inputs)) {
    errors.push(`step "${name}": inputs must be an array of state keys when provided`);
  }
  if (step.budget !== undefined && !(typeof step.budget === 'number' && step.budget > 0)) {
    errors.push(`step "${name}": budget must be a positive number when provided`);
  }
  if (step.fanOut) {
    if (step.readOnly !== true) {
      errors.push(`step "${name}": fanOut requires readOnly: true (fan-out is restricted to read-only backends)`);
    }
    if (typeof step.synthesis !== 'string' || !step.synthesis) {
      errors.push(`step "${name}": fanOut requires a synthesis step name`);
    } else if (!stepNames.has(step.synthesis)) {
      errors.push(`step "${name}": synthesis references unknown step "${step.synthesis}"`);
    }
  }
  validateWaitFor(step.waitFor, name, stepNames, errors);
}

export function defineFlow(definition) {
  const errors = [];
  if (!isPlainObject(definition)) {
    throw new FlowDefinitionError('flow definition must be an object', ['flow definition must be an object']);
  }

  const { id = null, stateSchema, startStep, steps } = definition;

  if (!isPlainObject(stateSchema)) errors.push('stateSchema must be an object');
  if (typeof startStep !== 'string' || !startStep) errors.push('startStep must be a non-empty string');
  if (!isPlainObject(steps) || Object.keys(steps).length === 0) errors.push('steps must be a non-empty object');

  if (errors.length > 0) {
    throw new FlowDefinitionError(`flow "${id ?? '(unnamed)'}" is invalid`, errors);
  }

  const stepNames = new Set(Object.keys(steps));
  if (!stepNames.has(startStep)) errors.push(`startStep "${startStep}" is not a declared step`);

  for (const [name, step] of Object.entries(steps)) {
    validateStep(name, step, stepNames, errors);
  }

  if (errors.length > 0) {
    throw new FlowDefinitionError(`flow "${id ?? '(unnamed)'}" is invalid`, errors);
  }

  const normalizedSteps = {};
  for (const [name, step] of Object.entries(steps)) {
    normalizedSteps[name] = {
      workerBackend: step.workerBackend,
      inputs: step.inputs ? [...step.inputs] : [],
      run: step.run,
      router: step.router ?? (() => TERMINAL),
      budget: step.budget ?? null,
      readOnly: Boolean(step.readOnly),
      fanOut: Boolean(step.fanOut),
      synthesis: step.synthesis ?? null,
      waitFor: step.waitFor ? { mode: step.waitFor.mode, steps: [...step.waitFor.steps] } : null,
    };
  }

  return Object.freeze({
    id,
    stateSchema,
    startStep,
    steps: Object.freeze(normalizedSteps),
    stepOrder: Object.freeze(Object.keys(normalizedSteps)),
  });
}

export async function loadFlow(source, { handlers = {} } = {}) {
  const resolved = path.resolve(source);
  const ext = path.extname(resolved);

  if (ext === '.json') {
    const raw = fs.readFileSync(resolved, 'utf8');
    const definition = JSON.parse(raw);
    const steps = {};
    for (const [name, step] of Object.entries(definition.steps || {})) {
      steps[name] = { ...step, ...(handlers[name] || {}) };
    }
    return defineFlow({ ...definition, steps });
  }

  const mod = await import(pathToFileURL(resolved).href);
  const definition = mod.default ?? mod.flowDefinition;
  if (!definition) {
    throw new FlowDefinitionError(`flow module "${source}" has no default export`, [`flow module "${source}" has no default export`]);
  }
  return defineFlow(definition);
}
