/**
 * lib/artifact-reviewers.mjs — Required reviewer resolution from manifest, agent log, and orchestration runs.
 *
 * Shared by artifact release gate, contract postconditions, and Oracle read-model.
 *
 * Reviewer sign-off gating: a manifest or overlay entry
 * may declare releaseGate.reviewerGate { mode, enforcementScope } to escalate
 * a missing reviewer sign-off from warning to gate failure. The DEFAULT is
 * advisory; `enforced` only blocks when enforcementScope names a team whose
 * own registry entry lists the decisionRight in decisionRights — and never
 * when the team's forbiddenDecisions names that same decision. Enforcement
 * is opt-in per team, expressed through data the team already owns
 * so a rule author cannot conscript a team into blocking.
 */

import fs from 'node:fs';
import { join } from 'node:path';
import { getArtifactEntry } from './artifact-manifest.mjs';
import { inferArtifactTypeFromPath } from './artifact-type-from-path.mjs';
import { loadRegistry } from './registry/loader.mjs';
import { configPath } from './config-dir.mjs';
import { runtimeDir } from './orchestration/run-store.mjs';

const RELEASE_GATE_BYPASS_FIELD = 'cx_release_gate';
const RELEASE_GATE_REASON_FIELD = 'cx_release_gate_reason';


function reviewerAliases(id = '') {
  const bare = String(id || '').replace(/^cx-/, '');
  if (!bare) return [];
  return [bare, `cx-${bare}`];
}

function addReviewerAliases(set, id) {
  for (const alias of reviewerAliases(id)) set.add(alias);
}

function isReviewerPresent(required, seen) {
  return reviewerAliases(required).some((alias) => seen.has(alias));
}

export function readOrchestrationRunReviewers(projectRoot = process.cwd()) {
  const dir = join(runtimeDir(projectRoot), 'runs');
  if (!fs.existsSync(dir)) return new Set();
  const reviewers = new Set();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const run = JSON.parse(fs.readFileSync(join(dir, name), 'utf8'));

      for (const task of run.tasks || []) {
        if (task.status !== 'done') continue;
        const id = task.workerProfileId || task.workerProfile;
        if (id) addReviewerAliases(reviewers, id);
      }
    } catch {
      /* skip corrupt run records */
    }
  }
  return reviewers;
}

export function resolveReviewersSeen(projectRoot = process.cwd(), reviewersSeen) {
  if (reviewersSeen) return reviewersSeen;
  const merged = readAgentLogReviewers(projectRoot);
  for (const id of readOrchestrationRunReviewers(projectRoot)) merged.add(id);
  return merged;
}

export function readAgentLogReviewers(projectRoot = process.cwd()) {
  const logPath = configPath(projectRoot, 'agent-log.jsonl');
  if (!fs.existsSync(logPath)) return new Set();
  const reviewers = new Set();
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const id = row.agent || row.specialist;
      if (id) addReviewerAliases(reviewers, id);
    } catch { /* skip */ }
  }
  return reviewers;
}

export function parseReleaseGateFrontmatter(filePath) {
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
    const match = head.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { bypass: false, reason: null };
    const fm = {};
    for (const line of match[1].split('\n')) {
      const m = line.match(/^([\w-]+)\s*:\s*(.+)$/);
      if (m) fm[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    const bypass = fm[RELEASE_GATE_BYPASS_FIELD] === 'bypass';
    return { bypass, reason: fm[RELEASE_GATE_REASON_FIELD] ?? null };
  } catch {
    return { bypass: false, reason: null };
  }
}

export function resolveRequiredReviewers({ docType, filePath, rootDir, cwd = process.cwd() }) {
  let type = docType;
  if (!type && filePath) {
    type = inferArtifactTypeFromPath(filePath, { rootDir: cwd });
  }
  if (!type) return [];
  const entry = getArtifactEntry(type, { rootDir });
  return entry?.releaseGate?.requiredReviewers ?? [];
}

export function missingRequiredReviewers({
  docType,
  filePath,
  rootDir,
  cwd = process.cwd(),
  reviewersSeen,
  recruitedReviewers = [],
} = {}) {
  const required = Array.from(new Set([
    ...resolveRequiredReviewers({ docType, filePath, rootDir, cwd }),
    ...recruitedReviewers.filter((r) => typeof r === 'string' && r.startsWith('cx-')),
  ]));
  if (required.length === 0) return [];
  const seen = resolveReviewersSeen(cwd, reviewersSeen);
  return required.filter((r) => !isReviewerPresent(r, seen));
}

/**
 * @param {object} opts — same resolution inputs as missingRequiredReviewers
 * @returns {{ mode: 'advisory'|'enforced', blocks: boolean, missing: string[], reason: string }}
 */
export function resolveReviewerGate({
  docType,
  filePath,
  rootDir,
  cwd = process.cwd(),
  reviewersSeen,
  recruitedReviewers = [],
} = {}) {
  const missing = missingRequiredReviewers({ docType, filePath, rootDir, cwd, reviewersSeen, recruitedReviewers });

  let type = docType;
  if (!type && filePath) type = inferArtifactTypeFromPath(filePath, { rootDir: cwd });
  const entry = type ? getArtifactEntry(type, { rootDir, cwd }) : null;
  const policy = entry?.releaseGate?.reviewerGate;

  if (!policy || policy.mode !== 'enforced') {
    return { mode: 'advisory', blocks: false, missing, reason: 'advisory (default) — missing sign-off warns, never blocks' };
  }

  const scope = policy.enforcementScope;
  if (!scope?.team || !scope?.decisionRight) {
    return { mode: 'advisory', blocks: false, missing, reason: 'enforced requested without enforcementScope {team, decisionRight} — falling back to advisory' };
  }

  let team = null;
  try {
    team = loadRegistry()?.teams?.[scope.team] ?? null;
  } catch {
    team = null;
  }
  if (!team) {
    return { mode: 'advisory', blocks: false, missing, reason: `enforcementScope team '${scope.team}' not in registry — falling back to advisory` };
  }
  if ((team.forbiddenDecisions ?? []).includes(scope.decisionRight)) {
    return { mode: 'advisory', blocks: false, missing, reason: `team '${scope.team}' forbids decision '${scope.decisionRight}' — cannot block` };
  }
  if (!(team.decisionRights ?? []).includes(scope.decisionRight)) {
    return { mode: 'advisory', blocks: false, missing, reason: `team '${scope.team}' does not hold decisionRight '${scope.decisionRight}' — enforcement is opt-in per team, falling back to advisory` };
  }

  return {
    mode: 'enforced',
    blocks: missing.length > 0,
    missing,
    reason: `enforced by ${scope.team} via decisionRight '${scope.decisionRight}'`,
  };
}
