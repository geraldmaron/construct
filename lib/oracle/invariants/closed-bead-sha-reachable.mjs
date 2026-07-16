/**
 * lib/oracle/invariants/closed-bead-sha-reachable.mjs — Layer 1 deterministic invariant:
 * a CLOSED bead's cited commit SHA must be reachable from origin/main, or its close
 * reason must carry an explicit unmerged/not-reachable annotation.
 *
 * Per ADR-0091 (3-layer assurance model) and the oracle-miss-report's row 44 (M4
 * integration gap, the audit's headline finding): tracker truth (bd) and code truth
 * (git) are two unreconciled sources of record. `construct-p4cba` closed "6/6 children
 * complete" with real commit SHAs that were never checked against origin/main — this
 * invariant is the first invariant-registry seed that closes that gap;
 * construct-4uxq0.12.4 adds the remaining eleven.
 *
 * Per-item status values are drawn from ADR-0091's evidence-status vocabulary
 * (passed / failed / not-applicable / unknown / collection-error) — the subset this
 * single check needs, not the full 11-state set synthesize.mjs's rollup consumes.
 * `unknown` (not `failed`) is deliberately used when a cited SHA cannot be resolved
 * locally at all (e.g. a branch never fetched): git's exit code already distinguishes
 * "resolved, not an ancestor" (exit 1) from "not a valid object name here" (exit 128),
 * and collapsing the latter into `failed` would manufacture the exact kind of false
 * confidence this audit was commissioned to eliminate.
 */

import { execFileSync } from 'node:child_process';

export const id = 'closed-bead-sha-reachable-from-main-or-annotated';
export const layer = 1;
export const description =
  "A CLOSED bead's cited commit SHA must be reachable from origin/main, or the close reason must carry an explicit unmerged/not-reachable annotation.";

// git SHAs observed in this repo's own close reasons are lowercase hex, 7-40 chars
// (e.g. "deb043e6", "3a783f7e", "b6dc4bce" — from `bd list --status closed --json
// --limit 0`, 392/1813 real closed beads carry one). First match wins: real close
// reasons that cite two SHAs ("Landed: e10f0c4d (merge dbf66bc5)") name the landing
// commit first and the merge target second.

const SHA_PATTERN = /\b([0-9a-f]{7,40})\b/;

// Real precedent phrasing from this branch's own bd history — construct-wjap9's R1
// note ("NOT reachable from origin/main or origin/staging"), construct-36frs's R1 note
// ("verified NOT reachable from origin/main ... just unmerged"), construct-p4cba's
// reopen note ("exist only on the unmerged, not-to-be-merged-as-is ... branch").

const UNMERGED_ANNOTATION_PATTERN = /unmerged|not\s+(?:yet\s+)?merged|not\s+reachable\s+from\b/i;

export function extractCitedSha(closeReason) {
  if (!closeReason || typeof closeReason !== 'string') return null;
  const match = SHA_PATTERN.exec(closeReason);
  return match ? match[1] : null;
}

export function hasUnmergedAnnotation(closeReason) {
  if (!closeReason || typeof closeReason !== 'string') return false;
  return UNMERGED_ANNOTATION_PATTERN.test(closeReason);
}

// git distinguishes "resolved, not an ancestor" (exit 1) from "not a valid object
// name" (exit 128, e.g. a SHA on a branch never fetched locally) — surfaced as
// resolved:false rather than thrown, so a not-found SHA degrades to `unknown`
// instead of crashing the invariant or masquerading as a confirmed `failed`.

function isAncestor(sha, ref, cwd) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, ref], {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return { resolved: true, ancestor: true };
  } catch (err) {
    if (err.status === 1) return { resolved: true, ancestor: false };
    return { resolved: false, ancestor: null, error: (err.stderr || err.message || '').toString().trim() };
  }
}

/**
 * @param {{id: string, close_reason?: string, closeReason?: string}} bead
 * @param {{cwd?: string, mainRef?: string}} [opts]
 * @returns {{beadId: string, sha: string|null, status: string, detail: string, annotated?: boolean, violation?: boolean}}
 */
export function evaluateBead(bead, { cwd = process.cwd(), mainRef = 'origin/main' } = {}) {
  const closeReason = bead.close_reason ?? bead.closeReason ?? '';
  const sha = extractCitedSha(closeReason);

  if (!sha) {
    return { beadId: bead.id, sha: null, status: 'not-applicable', detail: 'no commit SHA cited in close reason' };
  }

  const annotated = hasUnmergedAnnotation(closeReason);
  const { resolved, ancestor, error } = isAncestor(sha, mainRef, cwd);

  if (!resolved) {
    if (annotated) {
      return {
        beadId: bead.id, sha, status: 'passed', annotated: true,
        detail: `${sha} could not be resolved locally against ${mainRef}, but the close reason carries an explicit unmerged annotation`,
      };
    }
    return {
      beadId: bead.id, sha, status: 'unknown',
      detail: `${sha} could not be resolved against ${mainRef} locally (${error || 'unknown git error'}) and no unmerged annotation is present`,
    };
  }

  if (ancestor) {
    return { beadId: bead.id, sha, status: 'passed', detail: `${sha} is an ancestor of ${mainRef}` };
  }

  if (annotated) {
    return {
      beadId: bead.id, sha, status: 'passed', annotated: true,
      detail: `${sha} is not an ancestor of ${mainRef}, but the close reason carries an explicit unmerged annotation`,
    };
  }

  return {
    beadId: bead.id, sha, status: 'failed', violation: true,
    detail: `${sha} is not an ancestor of ${mainRef} and the close reason carries no unmerged annotation`,
  };
}

function defaultListClosedBeads() {
  const raw = execFileSync('bd', ['list', '--status', 'closed', '--json', '--limit', '0'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * @param {{cwd?: string, mainRef?: string, listClosedBeads?: () => (Array|Promise<Array>)}} [opts]
 */
export async function check({ cwd = process.cwd(), mainRef = 'origin/main', listClosedBeads = defaultListClosedBeads } = {}) {
  let beads;
  try {
    beads = await listClosedBeads();
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to list closed beads: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const shaCited = beads.filter((bead) => extractCitedSha(bead.close_reason ?? bead.closeReason ?? ''));
  const results = shaCited.map((bead) => evaluateBead(bead, { cwd, mainRef }));
  const violations = results.filter((r) => r.status === 'failed');
  const unresolved = results.filter((r) => r.status === 'unknown');

  let status = 'passed';
  if (violations.length > 0) status = 'failed';
  else if (unresolved.length > 0) status = 'unknown';

  return { status, evaluated: results.length, violations, unresolved, results };
}
