/**
 * lib/artifact-release-gate.mjs — Real-org release validation for typed artifacts.
 *
 * Composes structure/visual lint, citation discipline, prose heuristics, and
 * optional reviewer sign-off from the artifact manifest releaseGate block.
 */

import fs from 'node:fs';
import path from 'node:path';
import { lintDocStructure, lintDocVisuals } from './templates/visual-requirements.mjs';
import { getArtifactEntry, resolveToneForArtifact } from './artifact-manifest.mjs';
import { lintFile } from './comment-lint.mjs';
import {
  missingRequiredReviewers,
  parseReleaseGateFrontmatter,
} from './artifact-reviewers.mjs';
import { inferArtifactTypeFromPath } from './artifact-type-from-path.mjs';

function countProseParagraphs(body) {
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let prose = 0;
  for (const b of blocks) {
    const first = b.split('\n')[0].trimStart();
    const isHeading = first.startsWith('#');
    const isList = /^([-*+]\s|\d+[.)]\s|>\s)/.test(first);
    const isTable = first.startsWith('|');
    const isFence = first.startsWith('```');
    if (isHeading || isList || isTable || isFence) continue;
    const sentences = (b.match(/[.!?](\s|$)/g) || []).length;
    if (sentences >= 2 || b.length >= 200) prose++;
  }
  return prose;
}

function countCitations(body) {
  const patterns = [
    /\bhttps?:\/\/[^\s)]+/g,
    /\barxiv:\s*\d{4}\.\d{4,5}/gi,
    /\[source:[^\]]+\]/gi,
    /\(accessed\s+\d{4}-\d{2}-\d{2}\)/gi,
  ];
  const hits = new Set();
  for (const re of patterns) for (const m of body.match(re) || []) hits.add(m.trim().toLowerCase());
  return hits.size;
}

export function validateArtifactRelease({
  filePath,
  type,
  cwd = process.cwd(),
  rootDir,
  reviewersSeen,
} = {}) {
  const resolvedType = type || inferArtifactTypeFromPath(filePath, { rootDir: cwd });
  const entry = getArtifactEntry(resolvedType, { rootDir });
  if (!entry) {
    return { ok: false, errors: [`Unknown artifact type: ${resolvedType}`], warnings: [], tone: null };
  }

  const { bypass, reason } = parseReleaseGateFrontmatter(filePath);
  if (bypass) {
    if (!reason) {
      return {
        ok: false,
        errors: ['cx_release_gate: bypass requires cx_release_gate_reason in frontmatter'],
        warnings: [],
        tone: resolveToneForArtifact(resolvedType, { cwd, rootDir }),
        type: resolvedType,
        filePath,
        bypassed: true,
      };
    }
    return {
      ok: true,
      errors: [],
      warnings: [`release gate bypassed: ${reason}`],
      tone: resolveToneForArtifact(resolvedType, { cwd, rootDir }),
      type: resolvedType,
      filePath,
      bypassed: true,
    };
  }

  const gate = entry.releaseGate ?? {};
  const errors = [];
  const warnings = [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');

  if (gate.structuralLint !== false) {
    errors.push(...lintDocStructure(filePath, resolvedType));
    errors.push(...lintDocVisuals(filePath, resolvedType));
  }

  if (gate.citationLint) {
    const isShippedTemplate = filePath.includes(`${path.sep}templates${path.sep}docs${path.sep}`);
    if (!isShippedTemplate) {
      const lint = lintFile(filePath);
      const artifactIssues = [...(lint.errors ?? []), ...(lint.warnings ?? [])].filter((w) => w.kind === 'artifact');
      for (const issue of artifactIssues) errors.push(issue.message || String(issue));
      const citations = countCitations(body);
      const unverified = /\[unverified\]/i.test(body);
      if (citations < 1 && !unverified) {
        errors.push('citationLint: no verifiable sources or [unverified] markers');
      }
    }
  }

  const minProse = gate.proseMinimum ?? 0;
  if (minProse > 0) {
    const prose = countProseParagraphs(body);
    if (prose < minProse) {
      errors.push(`proseMinimum: ${prose} paragraphs (need ${minProse})`);
    }
  }

  const missing = missingRequiredReviewers({
    docType: resolvedType,
    filePath,
    rootDir,
    cwd,
    reviewersSeen,
  });
  if (missing.length > 0) {
    warnings.push(`requiredReviewers not seen in agent log: ${missing.join(', ')}`);
  }

  const tone = resolveToneForArtifact(resolvedType, { cwd, rootDir });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    tone,
    type: resolvedType,
    filePath,
  };
}

export async function runArtifactValidateCli(args = []) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const filePath = positional[0];
  const typeArg = args.find((a) => a.startsWith('--type='));
  const json = args.includes('--json');

  if (!filePath || !typeArg) {
    process.stderr.write('Usage: construct artifact validate <path> --type=<doc-type> [--json]\n');
    process.exit(1);
  }

  const type = typeArg.split('=')[1];
  const result = validateArtifactRelease({ filePath, type });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Artifact release gate: ${type}\n`);
    process.stdout.write(`  Tone: ${result.tone}\n`);
    if (result.errors.length) {
      process.stdout.write(`  Errors (${result.errors.length}):\n`);
      for (const e of result.errors) process.stdout.write(`    - ${e}\n`);
    }
    if (result.warnings.length) {
      process.stdout.write(`  Warnings (${result.warnings.length}):\n`);
      for (const w of result.warnings) process.stdout.write(`    - ${w}\n`);
    }
    process.stdout.write(result.ok ? '  Result: PASS\n' : '  Result: FAIL\n');
  }

  if (!result.ok) process.exit(1);
}
