/**
 * lib/artifact-reviewers.mjs — Required reviewer resolution from manifest + agent log.
 *
 * Shared by artifact release gate, contract postconditions, and Oracle read-model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getArtifactEntry } from './artifact-manifest.mjs';
import { inferArtifactTypeFromPath } from './artifact-type-from-path.mjs';

const RELEASE_GATE_BYPASS_FIELD = 'cx_release_gate';
const RELEASE_GATE_REASON_FIELD = 'cx_release_gate_reason';

export function readAgentLogReviewers(projectRoot = process.cwd()) {
  const logPath = path.join(projectRoot, '.cx', 'agent-log.jsonl');
  if (!fs.existsSync(logPath)) return new Set();
  const reviewers = new Set();
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const id = row.agent || row.specialist;
      if (id) reviewers.add(String(id));
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
} = {}) {
  const required = resolveRequiredReviewers({ docType, filePath, rootDir, cwd });
  if (required.length === 0) return [];
  const seen = reviewersSeen ?? readAgentLogReviewers(cwd);
  return required.filter((r) => !seen.has(r) && !seen.has(r.replace(/^cx-/, 'cx-')));
}
