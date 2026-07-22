/**
 * lib/demo-state.mjs — demo run state machine and durable outcome vocabulary.
 *
 * Replaces ad hoc ok/surface/sourceOnly flags with persisted states:
 * declared → ready → served → executed → recorded → verified → certified,
 * plus terminal non-success states (script-only, degraded, failed, unavailable).
 */

import fs from 'node:fs';
import path from 'node:path';
import { configPath } from './config-dir.mjs';

export const DEMO_STATE_SCHEMA = 'construct/demo-state/1';

export const DEMO_STATES = Object.freeze([
  'declared',
  'ready',
  'served',
  'executed',
  'recorded',
  'verified',
  'certified',
  'script-only',
  'degraded',
  'failed',
  'unavailable',
]);

export const DEMO_RECORDING_SUCCESS_STATES = Object.freeze([
  'recorded',
  'verified',
  'certified',
]);

const TRANSITIONS = Object.freeze({
  declared: ['ready', 'unavailable', 'failed'],
  ready: ['served', 'unavailable', 'failed'],
  served: ['executed', 'script-only', 'unavailable', 'failed'],
  executed: ['recorded', 'degraded', 'script-only', 'failed'],
  recorded: ['verified', 'degraded', 'failed'],
  verified: ['certified', 'failed'],
  certified: [],
  'script-only': [],
  degraded: [],
  failed: [],
  unavailable: [],
});

export function isDemoState(state) {
  return DEMO_STATES.includes(state);
}

export function canTransitionDemoState(from, to) {
  if (!isDemoState(from) || !isDemoState(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

export function assertDemoTransition(from, to) {
  if (!canTransitionDemoState(from, to)) {
    return {
      ok: false,
      invalidTransition: true,
      message: `Invalid demo state transition: ${from ?? '(none)'} → ${to}`,
    };
  }
  return { ok: true };
}

export function deriveDemoOk(state) {
  return DEMO_RECORDING_SUCCESS_STATES.includes(state);
}

export function demoStatePath(cwd, name) {
  return configPath(cwd, 'demos', 'state', `${name}.json`);
}

export function loadDemoState(name, { cwd = process.cwd() } = {}) {
  const filePath = demoStatePath(cwd, name);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function persistDemoState(name, {
  cwd = process.cwd(),
  state,
  from = null,
  surface = null,
  message = null,
  artifactPath = null,
  enforceTransition = true,
} = {}) {
  if (!isDemoState(state)) {
    return { ok: false, message: `Unknown demo state: ${state}` };
  }

  const existing = loadDemoState(name, { cwd });
  const previous = existing?.state ?? null;
  if (enforceTransition && previous && previous !== state) {
    const gate = assertDemoTransition(previous, state);
    if (!gate.ok) return gate;
  }

  const record = {
    schema: DEMO_STATE_SCHEMA,
    name,
    state,
    surface,
    message,
    artifactPath,
    updatedAt: new Date().toISOString(),
    history: Array.isArray(existing?.history) ? [...existing.history] : [],
  };

  if (!previous || previous !== state) {
    record.history.push({
      from: previous,
      state,
      at: record.updatedAt,
    });
  }

  const filePath = demoStatePath(cwd, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { ok: true, state, statePath: filePath, record };
}

export function attachDemoOutcome(base, {
  cwd = process.cwd(),
  name,
  state,
  surface = base?.surface ?? null,
  message = base?.message ?? null,
  artifactPath = base?.artifactPath ?? base?.outputPath ?? null,
  persist = true,
  enforceTransition = false,
} = {}) {
  const ok = deriveDemoOk(state);
  const persisted = persist && name
    ? persistDemoState(name, {
      cwd,
      state,
      surface,
      message,
      artifactPath,
      enforceTransition,
    })
    : null;

  if (persisted && persisted.invalidTransition) {
    return {
      ...base,
      state,
      ok: false,
      invalidTransition: true,
      message: persisted.message,
    };
  }

  return {
    ...base,
    state,
    ok,
    statePath: persisted?.statePath ?? null,
  };
}

export function shouldFailDemoCli(state, { command = null, sourceOnly = false } = {}) {
  if (state === 'failed') return true;
  if (command === 'record' && !sourceOnly) return !deriveDemoOk(state);
  return false;
}

export function formatDemoCliOutcome(result, demoName, { command = null, sourceOnly = false } = {}) {
  if (deriveDemoOk(result.state)) {
    const pathOut = result.artifactPath || result.outputPath;
    return {
      lines: [
        `Demo (${demoName}) recorded via ${result.engine || result.surface} to:`,
        `  ${pathOut}`,
      ],
      exitCode: 0,
    };
  }

  if (result.state === 'served' && result.tapePath) {
    const lines = [`Demo tape (${demoName}): ${result.tapePath}`];
    if (result.message) lines.push('', `No recorder: ${result.message}`);
    return { lines, exitCode: 0 };
  }

  if (result.state === 'script-only') {
    return {
      lines: [result.message || `Demo (${demoName}) script printed (no recording surface available)`],
      exitCode: 0,
    };
  }

  return {
    lines: [result.message || `Demo (${demoName}) did not produce a recording (${result.state})`],
    exitCode: shouldFailDemoCli(result.state, { command, sourceOnly }) ? 1 : 0,
  };
}
