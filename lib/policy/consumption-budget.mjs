/**
 * lib/policy/consumption-budget.mjs — durable per-actor/run consumption budgets.
 *
 * Nothing durably bounded token/tool-call/external-write/queue-submission
 * consumption per actor or run before this: lib/mcp/broker.mjs's BrokerStore
 * covers only a fixed-window tool-call rate per actor+tool, reset
 * on every window rather than accumulating for the life of a run. This store
 * persists cumulative consumption per actor+run to
 * `<rootDir>/.construct/consumption-budgets.json`, survives process restarts the
 * same way BrokerStore does, and is consulted pre-execution so an exhausted
 * run halts with a clear, durable budget-denied record instead of a
 * surprise bill.
 *
 * Budgets default per deployment mode (lib/deployment-mode.mjs): solo is
 * `null` (unbounded) — a single local operator should never hit a wall a
 * team/enterprise multi-actor deployment needs; team/enterprise apply real
 * per-kind caps. An explicit `budget` object always overrides the mode
 * default.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getDeploymentMode } from '../deployment-mode.mjs';
import { configPath } from '../config-dir.mjs';

const BUDGET_STORE_SUBPATH = 'consumption-budgets.json';

export const CONSUMPTION_KINDS = ['tokens', 'toolCalls', 'externalWrites', 'queueSubmissions'];

export const DEFAULT_BUDGETS_BY_MODE = Object.freeze({
  solo: null,
  team: Object.freeze({ tokens: 2_000_000, toolCalls: 2000, externalWrites: 200, queueSubmissions: 500 }),
  enterprise: Object.freeze({ tokens: 5_000_000, toolCalls: 5000, externalWrites: 500, queueSubmissions: 1000 }),
});

export function resolveDefaultBudget(mode) {
  // `??` treats solo's deliberate `null` (unbounded) as absent and would fall
  // through to the team default, defeating the solo-is-unbounded default —
  // an explicit `in` check is required so null is a real, honored value.
  return mode in DEFAULT_BUDGETS_BY_MODE ? DEFAULT_BUDGETS_BY_MODE[mode] : DEFAULT_BUDGETS_BY_MODE.team;
}

export function budgetStorePath(rootDir) {
  return configPath(rootDir, BUDGET_STORE_SUBPATH);
}

function emptyConsumption() {
  return { tokens: 0, toolCalls: 0, externalWrites: 0, queueSubmissions: 0 };
}

function readStoreFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class BudgetExceeded extends Error {
  constructor({ actor, runId, kind, cap, projected }) {
    super(`consumption budget exceeded: actor '${actor}' run '${runId}' would reach ${projected} ${kind} against a budget of ${cap}`);
    this.name = 'BudgetExceeded';
    this.actor = actor;
    this.runId = runId;
    this.kind = kind;
    this.cap = cap;
    this.projected = projected;
  }
}

/**
 * ConsumptionBudgetStore — file-backed durable per-actor/run consumption.
 *
 * Read/write mirrors lib/mcp/broker.mjs's BrokerStore: in-memory `_data` is
 * the write buffer, `save()` persists the whole map, and every disk
 * operation is best-effort so a disk failure never breaks the caller.
 */
export class ConsumptionBudgetStore {
  constructor({ rootDir, file, env = process.env } = {}) {
    if (!rootDir && !file) throw new Error('ConsumptionBudgetStore: rootDir or file is required');
    this.rootDir = rootDir ?? null;
    this.env = env;
    this._storePath = file || budgetStorePath(rootDir);
    this._data = readStoreFile(this._storePath);
  }

  _key(actor, runId) {
    return `${actor}::${runId}`;
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this._storePath), { recursive: true });
      fs.writeFileSync(this._storePath, JSON.stringify(this._data), 'utf8');
    } catch { /* best-effort, mirrors BrokerStore.save */ }
  }

  /** Resolves the effective budget: an explicit override, else the deployment-mode default. */
  resolveBudget(budgetOverride) {
    if (budgetOverride !== undefined) return budgetOverride;
    const mode = getDeploymentMode(this.env, { cwd: this.rootDir ?? process.cwd() });
    return resolveDefaultBudget(mode);
  }

  /** Cumulative consumption recorded so far for actor+run, zeroed if none. */
  consumptionFor(actor, runId) {
    return { ...emptyConsumption(), ...(this._data[this._key(actor, runId)] || {}) };
  }

  /**
   * check(actor, runId, kind, amount, { budget }) — would recording `amount`
   * more of `kind` exceed the budget? Read-only, no state mutated.
   */
  check(actor, runId, kind, amount = 1, { budget } = {}) {
    const resolved = this.resolveBudget(budget);
    const consumption = this.consumptionFor(actor, runId);
    if (!resolved) return { allowed: true, cap: null, projected: consumption[kind] + amount, consumption };
    const cap = resolved[kind];
    if (!Number.isFinite(cap)) return { allowed: true, cap: null, projected: consumption[kind] + amount, consumption };
    const projected = consumption[kind] + amount;
    return { allowed: projected <= cap, cap, projected, consumption };
  }

  /** Durably record `amount` more of `kind` for actor+run. Returns the updated row. */
  record(actor, runId, kind, amount = 1) {
    const key = this._key(actor, runId);
    const current = { ...emptyConsumption(), ...(this._data[key] || {}) };
    current[kind] = (current[kind] || 0) + amount;
    this._data[key] = current;
    this._save();
    return current;
  }

  /** Every actor+run row with its resolved budget, for status surfacing. */
  allEntries() {
    return Object.entries(this._data).map(([key, consumption]) => {
      const sep = key.indexOf('::');
      const actor = sep === -1 ? key : key.slice(0, sep);
      const runId = sep === -1 ? null : key.slice(sep + 2);
      return {
        actor,
        runId,
        consumption: { ...emptyConsumption(), ...consumption },
        budget: this.resolveBudget(undefined),
      };
    });
  }
}
