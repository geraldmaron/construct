/**
 * lib/workplace-loop/align.mjs — strategy/objective alignment check against
 * real Workspace strategy and objectives.
 *
 * Spike D checked signals against a fixture strategy.md with hand-written
 * pillar text (docs/notes/research/workspace-control-plane/spikes/
 * d-daily-workplace-loop/loop/run-loop.mjs's checkAlignment()). Production
 * has no fixture to read — the real Workspace domain store
 * (lib/workspace/store.mjs) is the only real place a Workspace's strategy
 * pillars live today (target-model.md's Objective/Directive stores are not
 * built yet; E2's `settings` JSON blob is the documented seam for schemaless
 * per-workspace config until a real Objective store exists — design doc
 * §3.2/AW2). Strategy pillars are read from the `workplaceLoop.strategyPillars`
 * setting key: `[{name, keywords: string[]}]`. When unset, every signal gets
 * verdict `no_strategy_configured` — never a fabricated conflict — because
 * CLAUDE.md's no-fabrication rule forbids inventing an alignment verdict
 * against strategy content that was never actually provided.
 */

import { getSetting } from '../workspace/store.mjs';

const STRATEGY_SETTING_KEY = 'workplaceLoop.strategyPillars';

/**
 * @param {string} rootDir
 * @returns {Array<{name: string, keywords: string[]}>}
 */
export function loadStrategyPillars(rootDir) {
  const pillars = getSetting(rootDir, STRATEGY_SETTING_KEY);
  return Array.isArray(pillars) ? pillars : [];
}

function textOf(signal) {
  return `${signal.summary ?? ''} ${(signal.sources ?? []).map((s) => s.repo ?? '').join(' ')}`.toLowerCase();
}

/**
 * Check one signal against the loaded strategy pillars. A signal conflicts
 * with a pillar when any of the pillar's keywords appear in the signal's own
 * summary text — a coarse keyword match, not language-level judgment (spike
 * D's own honest caveat, §4: this pipeline proves the scaffolding, not that
 * rule-based matching generalizes to prose judgment a human TPM would apply).
 *
 * @param {object} signal
 * @param {Array<{name: string, keywords: string[]}>} pillars
 * @returns {{verdict: 'conflict'|'aligned'|'no_strategy_configured', pillar: string|null, rationale: string}}
 */
export function checkAlignment(signal, pillars) {
  if (!pillars || pillars.length === 0) {
    return { verdict: 'no_strategy_configured', pillar: null, rationale: `no strategy pillars are configured for this workspace (setting "${STRATEGY_SETTING_KEY}"); alignment cannot be checked honestly, so none is asserted.` };
  }
  const haystack = textOf(signal);
  for (const pillar of pillars) {
    const hit = (pillar.keywords ?? []).find((k) => haystack.includes(String(k).toLowerCase()));
    if (hit) {
      return {
        verdict: 'conflict',
        pillar: pillar.name,
        rationale: `signal text matches pillar "${pillar.name}"'s keyword "${hit}" — a ${signal.type} against a stated strategic priority warrants review.`,
      };
    }
  }
  return { verdict: 'aligned', pillar: null, rationale: 'no configured pillar keyword matched; no strategic conflict asserted.' };
}

/**
 * Annotate every signal in `signals` with its alignment verdict, reading the
 * Workspace's real strategy pillars once for the whole batch.
 */
export function alignSignals(rootDir, signals) {
  const pillars = loadStrategyPillars(rootDir);
  return signals.map((signal) => ({ ...signal, alignment: checkAlignment(signal, pillars) }));
}
