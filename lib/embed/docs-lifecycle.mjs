/**
 * lib/embed/docs-lifecycle.mjs — documentation maintenance job for embed mode.
 *
 * Responsibilities:
 *   - Detect stale, missing, or outdated docs across targets
 *   - Emit document.stale lifecycle events for each stale gap surfaced
 *     (consumed by cx-docs-keeper and any project-bound subscribers)
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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTargets } from './target-resolver.mjs';
import { configPath } from '../config-dir.mjs';
import { buildRoleLens } from './role-framing.mjs';
import { WORKSPACE_DOCS_LANES } from './config.mjs';
import { recommendArtifacts } from './artifact.mjs';
import { createRecommendation, autoSuppressStale, recommendationStats, isRecommendationActive } from './recommendation-store.mjs';
import { detectConflicts } from './conflict-detection.mjs';
import { emitBestEffort as emitRoleEvent } from '../roles/event-bus.mjs';

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
    // Remote-only targets have no local filesystem to inspect; gap detection requires the local docs tree.
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
  const altRoadmapPath = configPath(target.path, 'roadmap.md');
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
 * Scan pending intake packets for patterns that warrant doc creation.
 * Returns 'recommend-artifact' gaps when multiple items share a topic.
 */
export function detectIntakeDocGaps(rootDir) {
  const gaps = [];
  const pendingDir = configPath(rootDir, 'intake', 'pending');
  if (!existsSync(pendingDir)) return gaps;

  let pendingFiles;
  try {
    pendingFiles = readdirSync(pendingDir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    process.stderr.write('[docs-lifecycle.mjs] read-pending-intake: ' + (err?.message ?? String(err)) + '\n');
    return gaps;
  }
  if (pendingFiles.length < 2) return gaps; // need 2+ items for a pattern

  // Read all pending packets
  const packets = [];
  for (const file of pendingFiles) {
    try {
      const data = JSON.parse(readFileSync(join(pendingDir, file), 'utf8'));
      if (data?.triage) packets.push({ id: file.replace('.json', ''), ...data });
    } catch { /* skip malformed */ }
  }

  // Group by intakeType
  const byType = {};
  for (const p of packets) {
    const t = p.triage?.intakeType || 'unknown';
    byType[t] = byType[t] || [];
    byType[t].push(p);
  }

  // Recommend artifacts when multiple items share a type
  for (const [type, items] of Object.entries(byType)) {
    if (items.length < 2) continue;

    const typeToLane = {
      'customer-feedback': 'prds',
      'bug-report': 'postmortems',
      'incident-report': 'postmortems',
      'feature-request': 'rfcs',
      'support-ticket': 'runbooks',
      'compliance': 'adrs',
    };
    const lane = typeToLane[type];
    if (!lane) continue;

    const lanePath = join(rootDir, 'docs', lane);
    const exists = existsSync(lanePath) && safeReaddir(lanePath).length > 0;

    gaps.push({
      type: 'recommend-artifact',
      lane,
      severity: 'medium',
      summary: `${items.length} pending intake items of type "${type}" — ${exists ? 'consider reviewing existing' : 'consider creating'} ${lane} docs`,
      payload: { count: items.length, intakeType: type, intakeIds: items.map((i) => i.id) },
    });
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
  const recommendations = [];
  const conflicts = [];
  const localTargets = targets.filter((target) => target.access !== 'remote' && target.path);
  let suppressed = 0;
  for (const target of localTargets) {
    suppressed += autoSuppressStale({ project: target.path });
  }

  for (const target of targets) {
    const gaps = detectDocGaps(target, { snapshot, roleLens });
    allGaps.push(...gaps.map((g) => ({ ...g, target: targetLabel(target) })));

    // Surface staleness as lifecycle events for any specialist subscribed
    // to document.stale (cx-docs-keeper by default).

    for (const gap of gaps) {
      if (gap.type !== 'stale') continue;
      emitRoleEvent('document.stale', {
        summary: gap.summary,
        context: {
          lane: gap.lane,
          file: gap.file,
          ageMs: gap.age,
          target: targetLabel(target),
        },
      });
    }

    // Check intake patterns for artifact recommendations (uses recommendation store for dedup)
    const intakeGaps = detectIntakeDocGaps(target.path);
    for (const gap of intakeGaps) {
      const payload = gap.payload || {};
      const recResult = createRecommendation({
        type: gap.lane?.replace(/s$/, '') || 'prd',
        title: payload.intakeType
          ? `${payload.intakeType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} documentation`
          : `Documentation for ${gap.lane}`,
        reason: gap.summary,
        signalCount: payload.count || 1,
        customerImpact: payload.count >= 5 ? 2 : payload.count >= 3 ? 1 : 0,
        recencyBonus: 2,
        sourceSignalIds: payload.intakeIds || [],
        lane: gap.lane,
        project: target.path,
      });
      recommendations.push(recResult);
      allGaps.push({ ...gap, target: targetLabel(target), recommendation: recResult });
    }

    // Check existing artifact coverage (PRDs, ADRs, RFCs)
    if (snapshot) {
      const artifactRecs = recommendArtifacts(snapshot, { rootDir: target.path });
      for (const rec of artifactRecs) {
        // Use recommendation store for dedup
        const { active, existing } = isRecommendationActive(rec.type, rec.title, { project: target.path });
        if (!active) {
          const recResult = createRecommendation({
            type: rec.type,
            title: rec.title,
            reason: rec.reason,
            signalCount: 1,
            project: target.path,
          });
          recommendations.push(recResult);
          allGaps.push({
            type: 'recommend-artifact',
            lane: rec.type,
            severity: 'medium',
            summary: `${rec.title}: ${rec.reason}`,
            payload: rec,
            target: targetLabel(target),
            recommendation: recResult,
          });
        } else {
          // Already recommended — still surface in gaps but mark as existing
          allGaps.push({
            type: 'recommend-artifact',
            lane: rec.type,
            severity: 'low',
            summary: `Already recommended: ${rec.title}`,
            payload: { ...rec, existingRecommendation: existing?.id },
            target: targetLabel(target),
          });
        }
      }
    }

    // Run conflict detection on pending intake items
    if (snapshot?.intakePackets?.length) {
      try {
        const packetConflicts = await detectConflicts(snapshot.intakePackets[0], { rootDir: target.path });
        conflicts.push(...packetConflicts.map(c => ({ ...c, target: targetLabel(target) })));
      } catch (err) {
        process.stderr.write(`[docs-lifecycle] Conflict detection error: ${err.message}\n`);
      }
    }

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

  const stats = recommendationStats({ project: localTargets[0]?.path });

  return {
    gaps: allGaps,
    actions,
    targets: targets.length,
    recommendations,
    conflicts,
    suppressedStale: suppressed,
    recommendationStats: stats,
  };
}

function targetLabel(t) {
  if (t.type === 'workspace') return 'workspace';
  return t.ref ?? t.path ?? 'unknown';
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.'));
  } catch (err) {
    process.stderr.write('[docs-lifecycle.mjs] safeReaddir: ' + (err?.message ?? String(err)) + '\n');
    return [];
  }
}
