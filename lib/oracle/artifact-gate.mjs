/**
 * lib/oracle/artifact-gate.mjs — Oracle read-model signals for typed artifact gates.
 *
 * Surfaces manifest audit drift, release-gate bypass markers, and high-risk
 * artifacts missing required reviewers in the agent log.
 */

import fs from 'node:fs';
import path from 'node:path';

import { auditSpecialists } from '../audit-specialists.mjs';
import { inferArtifactTypeFromPath, isArtifactGatePath } from '../artifact-type-from-path.mjs';
import {
  missingRequiredReviewers,
  parseReleaseGateFrontmatter,
} from '../artifact-reviewers.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';

function walkMarkdown(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function collectBypassArtifacts(projectDir) {
  const roots = [
    path.join(projectDir, 'docs'),
    path.join(projectDir, '.cx', 'research'),
  ];
  const bypassed = [];
  for (const root of roots) {
    for (const file of walkMarkdown(root)) {
      const rel = path.relative(projectDir, file).replace(/\\/g, '/');
      if (!isArtifactGatePath(rel)) continue;
      const { bypass, reason } = parseReleaseGateFrontmatter(file);
      if (!bypass) continue;
      bypassed.push({
        path: rel,
        type: inferArtifactTypeFromPath(file, { rootDir: projectDir }),
        reason: reason || null,
      });
    }
  }
  return bypassed;
}

function collectReviewerGaps(projectDir) {
  const roots = [
    path.join(projectDir, 'docs', 'prd'),
    path.join(projectDir, 'docs', 'adr'),
    path.join(projectDir, 'docs', 'rfc'),
  ];
  const gaps = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkMarkdown(root)) {
      const rel = path.relative(projectDir, file).replace(/\\/g, '/');
      const type = inferArtifactTypeFromPath(file, { rootDir: projectDir });
      if (!type) continue;
      const missing = missingRequiredReviewers({ filePath: file, cwd: projectDir });
      if (missing.length > 0) {
        gaps.push({ path: rel, type, missingReviewers: missing });
      }
    }
  }
  return gaps.slice(0, 20);
}

export function collectArtifactGateSignals({ rootDir, projectDir }) {
  const bypassed = collectBypassArtifacts(projectDir);
  const reviewerGaps = collectReviewerGaps(projectDir);

  let specialistAudit = { present: false, pass: true, crossCheckCount: 0 };
  if (isConstructPackageRepo(projectDir)) {
    try {
      const audit = auditSpecialists({ rootDir, silent: true });
      specialistAudit = {
        present: true,
        pass: audit.pass,
        crossCheckCount: audit.crossCheckIssues?.length ?? 0,
        crossCheckIssues: (audit.crossCheckIssues ?? []).slice(0, 5),
      };
    } catch {
      specialistAudit = { present: true, pass: false, crossCheckCount: -1 };
    }
  }

  return {
    bypassed,
    bypassCount: bypassed.length,
    reviewerGaps,
    reviewerGapCount: reviewerGaps.length,
    specialistAudit,
  };
}
