/**
 * lib/embed/docs-lifecycle.mjs — documentation maintenance job for embed mode.
 *
 * Responsibilities:
 *   - Detect stale, missing, or outdated docs across targets
 *   - Generate/update docs as artifacts in the appropriate docs lane
 *   - Route writes through the authority guard (direct-write for low-risk, approval-queued for high-risk)
 *   - Treat ALL doc types uniformly: adrs, prds, memos, notes, intake, roadmaps
 *
 * Doc types and risk levels:
 *   - LOW risk (direct-write): status updates, timestamps, cross-refs, roadmap refresh, notes
 *   - HIGH risk (approval-queued): new ADRs, new PRDs, issue creation, external posts
 *
 * Each doc type has a generator that produces markdown content from snapshot data,
 * observations, and role lens context.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { resolveTargets, routeArtifact, resolveArtifactPath } from './target-resolver.mjs';
import { buildRoleLens } from './role-framing.mjs';
import { WORKSPACE_DOCS_LANES } from './config.mjs';

/**
 * Risk classification for doc operations.
 */
const RISK_LEVEL = {
  // Low risk — can be written autonomously
  'notes': 'low',
  'roadmap': 'low',
  'status-update': 'low',
  'cross-ref': 'low',
  // High risk — needs approval
  'adrs': 'high',
  'prds': 'high',
  'memos': 'high',
  'intake': 'high',
};

/**
 * Staleness thresholds (ms). If a doc hasn't been updated in this long, flag it.
 */
const STALE_THRESHOLD = {
  roadmap: 6 * 60 * 60 * 1000,       // 6 hours
  notes: 24 * 60 * 60 * 1000,        // 24 hours
  adrs: 7 * 24 * 60 * 60 * 1000,     // 7 days (decisions shouldn't go stale fast)
  prds: 7 * 24 * 60 * 60 * 1000,     // 7 days
  memos: 3 * 24 * 60 * 60 * 1000,    // 3 days
};

/**
 * Scan a target's docs lanes and identify gaps or staleness.
 *
 * @param {object} target - Resolved target from target-resolver
 * @param {object} [opts]
 * @param {object} [opts.snapshot] - Latest snapshot data
 * @param {object} [opts.roleLens] - Combined role lens
 * @returns {DocGap[]} List of detected gaps
 */
export function detectDocGaps(target, opts = {}) {
  const gaps = [];

  if (target.access === 'remote') {
    // Remote-only targets: can't inspect filesystem, skip for now
    return gaps;
  }

  const docsBase = join(target.path, 'docs');
  if (!existsSync(docsBase)) {
    gaps.push({ type: 'missing-structure', severity: 'high', summary: `No docs/ directory at ${target.path}` });
    return gaps;
  }

  // Check each lane
  for (const lane of WORKSPACE_DOCS_LANES) {
    const lanePath = join(docsBase, lane);
    if (!existsSync(lanePath)) {
      gaps.push({ type: 'missing-lane', lane, severity: 'medium', summary: `Missing docs lane: ${lane}` });
      continue;
    }

    // Check for staleness
    const files = safeReaddir(lanePath);
    if (!files.length && lane !== 'intake') {
      gaps.push({ type: 'empty-lane', lane, severity: 'low', summary: `Empty docs lane: ${lane}` });
      continue;
    }

    const threshold = STALE_THRESHOLD[lane];
    if (threshold) {
      for (const file of files) {
        const filePath = join(lanePath, file);
        try {
          const stat = statSync(filePath);
          const age = Date.now() - stat.mtimeMs;
          if (age > threshold) {
            gaps.push({
              type: 'stale',
              lane,
              file,
              severity: 'low',
              age,
              summary: `Stale: ${lane}/${file} (${Math.round(age / 86400000)}d old)`,
            });
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  // Check for roadmap presence
  const roadmapPath = join(docsBase, 'roadmap.md');
  const altRoadmapPath = join(target.path, '.cx', 'roadmap.md');
  if (!existsSync(roadmapPath) && !existsSync(altRoadmapPath)) {
    if (opts.snapshot?.sections?.length) {
      gaps.push({ type: 'missing-roadmap', severity: 'low', summary: 'No roadmap.md found — can generate from snapshot' });
    }
  }

  // Role-lens driven gap detection
  if (opts.roleLens?.artifactBias?.length) {
    for (const biasLane of opts.roleLens.artifactBias) {
      const lanePath = join(docsBase, biasLane);
      const files = existsSync(lanePath) ? safeReaddir(lanePath) : [];
      if (!files.length) {
        gaps.push({
          type: 'role-gap',
          lane: biasLane,
          severity: 'medium',
          summary: `Role-prioritized lane "${biasLane}" is empty (${opts.roleLens.roles?.primary ?? 'configured role'} focuses here)`,
        });
      }
    }
  }

  return gaps;
}

/**
 * Run the full docs lifecycle check for all resolved targets.
 *
 * @param {object} opts
 * @param {object}   opts.config          - Normalized embed config
 * @param {object}   opts.providerRegistry
 * @param {object}   [opts.snapshot]      - Latest snapshot
 * @param {object}   [opts.authorityGuard]
 * @param {object[]} [opts.signals]       - Source signals for target discovery
 * @returns {Promise<DocsLifecycleResult>}
 */
export async function runDocsLifecycle(opts) {
  const { config, providerRegistry, snapshot, authorityGuard, signals } = opts;

  const targets = await resolveTargets(config, providerRegistry, { signals });
  const roleLens = buildRoleLens(config.roles);
  const allGaps = [];
  const actions = [];

  for (const target of targets) {
    const gaps = detectDocGaps(target, { snapshot, roleLens });
    allGaps.push(...gaps.map((g) => ({ ...g, target: targetLabel(target) })));

    // Determine actions for each gap
    for (const gap of gaps) {
      const risk = RISK_LEVEL[gap.lane] ?? (gap.type === 'missing-roadmap' ? 'low' : 'high');

      if (risk === 'low') {
        // Can act autonomously
        actions.push({ gap, target, action: 'auto-fix', risk });
      } else {
        // Queue for approval
        if (authorityGuard) {
          const decision = await authorityGuard.check('publishDocs', {
            description: gap.summary,
            payload: { lane: gap.lane, target: targetLabel(target) },
          });
          actions.push({ gap, target, action: decision.allowed ? 'approved' : 'queued', risk, queueId: decision.queueId });
        } else {
          actions.push({ gap, target, action: 'skipped-no-guard', risk });
        }
      }
    }
  }

  return { gaps: allGaps, actions, targets: targets.length };
}

function targetLabel(t) {
  if (t.type === 'workspace') return 'workspace';
  return t.ref ?? t.path ?? 'unknown';
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.'));
  } catch {
    return [];
  }
}
