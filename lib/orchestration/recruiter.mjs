/**
 * lib/orchestration/recruiter.mjs — condition-driven participant assembly:
 * the recruit stage of ADR-0070's pipeline, generalized from the Oracle
 * swarm dispatcher (construct-pteo2.5).
 *
 * Two entry points:
 *   recruit()               signals -> registry skill/rule query -> participants
 *   assembleParticipants()  seed Worker Profiles -> Assignment set
 *
 * recruit() maps truthy signal dimensions (lib/orchestration/signal-dimensions.mjs)
 * to Worker Profiles by querying the assembled registry for skill-emphasis matches —
 * never a hardcoded dimension-to-profile constant. When several profiles
 * match a dimension, the one with the fewest declared skills wins: a narrow
 * skill set that matches is a stronger specialization claim than a broad one.
 * Registry entries may also declare participationRules (ADR-0070,
 * schemas/participation-rules.schema.json); matching rules recruit their
 * stated targets with role/gate semantics. Affinities follow the same overlay
 * convention as signal-dimensions.mjs: canonical entries first, project
 * overlay (.construct/orchestration/recruitment-affinities.json) last-writer-wins.
 *
 * Signal values and rule expressions may derive from untrusted artifact
 * content (cdsp.81 threat review): signalExpr evaluation is a closed grammar
 * over boolean signal keys — bare key, !key, && conjunction — with no code
 * execution, and it fails closed on anything else.
 *
 * assembleParticipants() creates explicit Assignments without a team hierarchy.
 */

import { readFileSync, existsSync } from 'node:fs';
import { findProjectRoot } from '../project-root.mjs';
import { loadRegistry } from '../registry/loader.mjs';
import { watcherFires } from './routing-tables.mjs';
import { outcomeBoost } from '../outcomes/aggregate.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { configPath } from '../config-dir.mjs';

const CANONICAL_AFFINITIES = [
  { dimension: 'cost', skillPatterns: ['cost-optimization', 'pricing-positioning', 'raw-data-structuring'], reason: 'cost/quant' },
  { dimension: 'compliance', skillPatterns: ['compliance/', 'regulatory-review', 'license-audit'], reason: 'compliance' },
  { dimension: 'accessibility', skillPatterns: ['accessibility', 'screen-reader'], reason: 'accessibility' },
  { dimension: 'data', skillPatterns: ['raw-data-structuring', 'database', 'data-engineering'], reason: 'data/quant' },
  { dimension: 'reliability', skillPatterns: ['incident-response', 'oncall-rotation'], reason: 'reliability/operations' },
  { dimension: 'privacy', skillPatterns: ['data-privacy', 'compliance/'], reason: 'privacy' },
];

const ROLE_BY_KIND = {
  review: 'reviewer',
  author: 'author',
  advise: 'advisor',
};

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function loadOverlay() {
  const root = findProjectRoot();
  if (!root) return [];
  const overlayPath = configPath(root, 'orchestration', 'recruitment-affinities.json');
  if (!existsSync(overlayPath)) return [];
  const data = readJsonSafe(overlayPath);
  if (!Array.isArray(data)) return [];
  return data.filter(
    (entry) => entry && typeof entry.dimension === 'string' && Array.isArray(entry.skillPatterns),
  );
}

let affinityCache = null;

export function loadRecruitmentAffinities() {
  if (affinityCache) return affinityCache;
  const byDimension = new Map();
  for (const aff of CANONICAL_AFFINITIES) byDimension.set(aff.dimension, aff);
  for (const aff of loadOverlay()) byDimension.set(aff.dimension, aff);
  affinityCache = Array.from(byDimension.values());
  return affinityCache;
}

export function clearRecruiterCache() {
  affinityCache = null;
}

// Most-specialized-wins: rank matches by declared-skill count ascending, then
// by outcome boost (ADR-0076) descending, then alphabetically so equal counts
// stay deterministic. The boost only ever separates candidates the
// specialization signal already ranked equal — it cannot promote a broader
// generalist over a narrower specialist.

function profilesMatchingPatterns(patterns, workerProfiles, boostFor = () => 0) {
  const matches = [];
  for (const [id, entry] of Object.entries(workerProfiles)) {
    const skills = Array.isArray(entry?.skillEmphasis) ? entry.skillEmphasis : [];
    if (!skills.some((skill) => patterns.some((p) => skill.includes(p)))) continue;
    matches.push({ workerProfile: id, skillCount: skills.length, boost: boostFor(id) });
  }
  matches.sort(
    (a, b) => a.skillCount - b.skillCount || b.boost - a.boost || a.workerProfile.localeCompare(b.workerProfile),
  );
  return matches;
}

// outcomeBoost keys outcome files by the bare role (registry ids are cx-*);
// resolution is best-effort — a missing/unreadable config or summary must
// never break recruitment, so it degrades to "no boost" rather than throwing.

function resolveOutcomeRouting(cwd) {
  try {
    return (loadProjectConfig(cwd).config?.orchestration?.outcomeRouting ?? 'on') !== 'off';
  } catch {
    return true;
  }
}

function boostForWorkerProfile(cwd) {
  return (id) => {
    try {
      return outcomeBoost(cwd, id);
    } catch {
      return 0;
    }
  };
}

const SIGNAL_TERM = /^!?[a-zA-Z][a-zA-Z0-9_-]*$/;

// Shape-only twin of evaluateSignalExpr: authoring surfaces (org-api, CLI)
// need "is this expression in the closed grammar?" without a signals object,
// and evaluateSignalExpr returning false cannot distinguish a grammar
// violation from a non-firing condition.

export function parseSignalExpr(expr) {
  const terms = String(expr ?? '')
    .split('&&')
    .map((t) => t.trim());
  if (terms.length === 0 || terms.some((t) => !SIGNAL_TERM.test(t))) return null;
  return terms.map((t) => (t.startsWith('!') ? { key: t.slice(1), negated: true } : { key: t, negated: false }));
}

export function evaluateSignalExpr(expr, signals) {
  const terms = parseSignalExpr(expr);
  if (!terms) return false;
  return terms.every(({ key, negated }) =>
    negated ? signals[key] !== true : signals[key] === true,
  );
}

function ruleMatches(when, signals) {
  if (!when || typeof when !== 'object') return false;
  if (typeof when.watchCondition === 'string') {
    return watcherFires(when.watchCondition, signals);
  }
  if (typeof when.signalExpr === 'string') {
    return evaluateSignalExpr(when.signalExpr, signals);
  }
  return false;
}

function rulesOf(entry) {
  const declared = entry?.participationRules;
  if (Array.isArray(declared)) return declared;
  if (declared && Array.isArray(declared.rules)) return declared.rules;
  return [];
}

function addParticipant(byKey, participant) {
  const key = participant.workerProfile;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, participant);
    return;
  }
  if (!existing.reason.includes(participant.reason)) {
    existing.reason = `${existing.reason}; ${participant.reason}`;
  }
  for (const d of participant.dimensions ?? []) {
    if (!existing.dimensions.includes(d)) existing.dimensions.push(d);
  }
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} [opts.signals] — boolean signal dimensions (requestSignals shape)
 * @param {'review'|'author'|'advise'} [opts.kind] — participant function on the produced artifact
 * @param {string[]} [opts.exclude] — Worker Profile ids never recruited
 * @param {object} [opts.registry] — assembled registry override for sterile tests
 * @param {string} [opts.cwd] — project root for outcome-boost lookups (ADR-0076); defaults to findProjectRoot()
 * @returns {Array<{workerProfile: string, assignmentRole: string, reason: string, dimensions: string[], gate: string, via: string, rule?: string}>}
 */
export function recruit({ signals = {}, kind = 'review', exclude = [], registry, cwd } = {}) {
  const reg = registry ?? loadRegistry();
  const workerProfiles = reg?.workerProfiles ?? {};
  const role = ROLE_BY_KIND[kind] ?? 'reviewer';
  const excluded = new Set(exclude);
  const byKey = new Map();

  const effectiveCwd = cwd ?? findProjectRoot() ?? process.cwd();
  const boostFor = resolveOutcomeRouting(effectiveCwd) ? boostForWorkerProfile(effectiveCwd) : () => 0;

  for (const aff of loadRecruitmentAffinities()) {
    if (signals[aff.dimension] !== true) continue;
    const candidates = profilesMatchingPatterns(aff.skillPatterns, workerProfiles, boostFor).filter(
      (candidate) => !excluded.has(candidate.workerProfile),
    );
    if (candidates.length === 0) continue;
    const pick = candidates[0].workerProfile;
    addParticipant(byKey, {
      workerProfile: pick,
      assignmentRole: role,
      reason: aff.reason,
      dimensions: [aff.dimension],
      gate: 'advisory',
      via: 'skill-affinity',
    });
  }

  const ruleSources = Object.entries(workerProfiles);
  for (const [id, entry] of ruleSources) {
    for (const rule of rulesOf(entry)) {
      if (!ruleMatches(rule?.when, signals)) continue;
      const assignmentRole = rule.assignmentRole ?? role;
      const gate = rule.gate ?? 'advisory';
      const reason = rule.reason ?? rule.id ?? `participation rule on ${id}`;
      const dims = rule.dimension ? [rule.dimension] : [];
      for (const target of rule.workerProfiles ?? []) {
        if (excluded.has(target)) continue;
        addParticipant(byKey, {
          workerProfile: target,
          assignmentRole,
          reason,
          dimensions: [...dims],
          gate,
          via: 'participation-rule',
          rule: rule.id,
        });
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Build an explicit Assignment set from ordered Worker Profile ids.
 *
 * @param {object} opts
 * @param {string[]} opts.seeds — ordered Worker Profile ids; first is primary
 * @returns {{ mode: 'single'|'parallel', primary: string, workerProfiles: string[], assignments: object[] }}
 */
export function assembleParticipants({ seeds = [] } = {}) {
  const workerProfiles = Array.from(new Set(seeds.filter(Boolean)));
  const primary = workerProfiles[0] ?? null;
  return {
    mode: workerProfiles.length <= 1 ? 'single' : 'parallel',
    primary,
    workerProfiles,
    assignments: workerProfiles.map((workerProfile, index) => ({
      id: `assignment-${index + 1}`,
      workerProfile,
      primary: index === 0,
    })),
  };
}
