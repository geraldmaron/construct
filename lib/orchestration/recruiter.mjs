/**
 * lib/orchestration/recruiter.mjs — condition-driven participant assembly:
 * the recruit stage of ADR-0070's pipeline, generalized from the Oracle
 * swarm dispatcher (construct-pteo2.5).
 *
 * Two entry points:
 *   recruit()               signals -> registry skill/rule query -> participants
 *   assembleParticipants()  seed specialists -> hierarchy-aware static/swarm set
 *
 * recruit() maps truthy signal dimensions (lib/orchestration/signal-dimensions.mjs)
 * to specialists by querying the assembled registry for declared-skill matches —
 * never a hardcoded dimension->specialist constant. When several specialists
 * match a dimension, the one with the fewest declared skills wins: a narrow
 * skill set that matches is a stronger specialization claim than a broad one.
 * Registry entries may also declare participationRules (ADR-0070,
 * schemas/participation-rules.schema.json); matching rules recruit their
 * stated targets with role/gate semantics. Affinities follow the same overlay
 * convention as signal-dimensions.mjs: canonical entries first, project
 * overlay (.cx/orchestration/recruitment-affinities.json) last-writer-wins.
 *
 * Signal values and rule expressions may derive from untrusted artifact
 * content (cdsp.81 threat review): signalExpr evaluation is a closed grammar
 * over boolean signal keys — bare key, !key, && conjunction — with no code
 * execution, and it fails closed on anything else.
 *
 * assembleParticipants() is the hierarchy step extracted verbatim from
 * lib/oracle/remediation-dispatch.mjs: team routing via orchestration-policy,
 * static mode when one team owns the work, swarm when several are involved.
 * The Oracle is now one caller of this module, not the owner of the logic.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../project-root.mjs';
import { loadRegistry } from '../registry/loader.mjs';
import { classifyIntent, teamRoutingForSpecialists } from '../orchestration-policy.mjs';
import { watcherFires } from './routing-tables.mjs';

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
  const overlayPath = join(root, '.cx', 'orchestration', 'recruitment-affinities.json');
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
// alphabetically so equal counts stay deterministic.

function specialistsMatchingPatterns(patterns, specialists) {
  const matches = [];
  for (const [id, entry] of Object.entries(specialists)) {
    const skills = Array.isArray(entry?.skills) ? entry.skills : [];
    if (!skills.some((skill) => patterns.some((p) => skill.includes(p)))) continue;
    matches.push({ specialist: id, skillCount: skills.length });
  }
  matches.sort((a, b) => a.skillCount - b.skillCount || a.specialist.localeCompare(b.specialist));
  return matches;
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
  const key = participant.specialist ?? `team:${participant.team}`;
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
 * @param {string[]} [opts.exclude] — specialist ids never recruited (e.g. already on the field)
 * @param {object} [opts.registry] — assembled registry override for sterile tests
 * @returns {Array<{specialist?: string, team?: string, role: string, reason: string, dimensions: string[], gate: string, via: string, rule?: string}>}
 */
export function recruit({ signals = {}, kind = 'review', exclude = [], registry } = {}) {
  const reg = registry ?? loadRegistry();
  const specialists = reg?.specialists ?? {};
  const role = ROLE_BY_KIND[kind] ?? 'reviewer';
  const excluded = new Set(exclude);
  const byKey = new Map();

  for (const aff of loadRecruitmentAffinities()) {
    if (signals[aff.dimension] !== true) continue;
    const candidates = specialistsMatchingPatterns(aff.skillPatterns, specialists).filter(
      (c) => !excluded.has(c.specialist),
    );
    if (candidates.length === 0) continue;
    const pick = candidates[0].specialist;
    addParticipant(byKey, {
      specialist: pick,
      role,
      reason: aff.reason,
      dimensions: [aff.dimension],
      gate: 'advisory',
      via: 'skill-affinity',
      team: specialists[pick]?.team ?? null,
    });
  }

  // Rules attach to specialist entries AND team entries (ADR-0070: a
  // participationRules array lives alongside any registry entry). A recruited
  // team collaborates at squad level: its participant entry carries the
  // squad's member specialists so callers see who the recruitment pulls in.

  const ruleSources = [
    ...Object.entries(specialists),
    ...Object.entries(reg?.teams ?? {}),
  ];
  for (const [id, entry] of ruleSources) {
    for (const rule of rulesOf(entry)) {
      if (!ruleMatches(rule?.when, signals)) continue;
      const ruleRole = rule.role ?? role;
      const gate = rule.gate ?? 'advisory';
      const reason = rule.reason ?? rule.id ?? `participation rule on ${id}`;
      const dims = rule.dimension ? [rule.dimension] : [];
      for (const target of rule.recruit?.specialists ?? []) {
        if (excluded.has(target)) continue;
        addParticipant(byKey, {
          specialist: target,
          role: ruleRole,
          reason,
          dimensions: [...dims],
          gate,
          via: 'participation-rule',
          rule: rule.id,
          team: specialists[target]?.team ?? null,
        });
      }
      for (const team of rule.recruit?.teams ?? []) {
        addParticipant(byKey, {
          team,
          role: ruleRole,
          reason,
          dimensions: [...dims],
          gate,
          via: 'participation-rule',
          rule: rule.id,
          members: Object.entries(specialists)
            .filter(([, s]) => s?.team === team)
            .map(([sid]) => sid),
        });
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Hierarchy-aware participant-set assembly, extracted from the Oracle's
 * remediation dispatcher. Static when a single team owns every seed; swarm
 * when the seeds span teams.
 *
 * @param {object} opts
 * @param {string[]} opts.seeds — ordered seed specialists; first is primary
 * @param {string} [opts.request] — remediation/request text for intent classification
 * @param {string|null} [opts.cwd]
 * @returns {{ mode: 'static'|'swarm', primary: string, specialists: string[], teamRouting: object }}
 */
export function assembleParticipants({ seeds = [], request = '', cwd = null } = {}) {
  const specialists = seeds.filter(Boolean);
  const primary = specialists[0];
  const intent = classifyIntent(request);
  const teamRouting = teamRoutingForSpecialists(specialists, { intent, request, cwd });

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
