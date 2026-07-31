/**
 * lib/artifact-release-gate.mjs — Real-org release validation for typed artifacts.
 *
 * Composes structure/visual lint, citation discipline, prose heuristics, and
 * optional reviewer sign-off from the artifact manifest releaseGate block.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { lintDocStructure, lintDocVisuals } from './templates/visual-requirements.mjs';
import { lintDocPresentationFile } from './templates/doc-presentation.mjs';
import { artifactTypes, getArtifactEntry, resolveToneForArtifact, resolveArtifactWorkflowContract } from './artifact-manifest.mjs';
import { planGateForLevel, resolveGateLevel } from './artifact-gate-levels.mjs';
import { lintFile } from './comment-lint.mjs';
import {
  parseReleaseGateFrontmatter,
  resolveReviewerGate,
} from './artifact-reviewers.mjs';
import { inferArtifactTypeFromPath } from './artifact-type-from-path.mjs';
import { validateArtifactLinks, urlsMissingInlineMarkdownLinks } from './artifact-link-validate.mjs';
import { evaluateArtifactContracts } from './contracts/artifact-gate.mjs';

function formatUnknownArtifactTypeError(resolvedType, { rootDir } = {}) {
  const types = artifactTypes({ rootDir }).sort();
  const listed = types.length > 0 ? types.join(', ') : '(none registered)';
  return `Unknown artifact type: ${resolvedType || '(empty)'}. Valid types: ${listed}`;
}

function printArtifactValidateUsage({ rootDir } = {}) {
  const types = artifactTypes({ rootDir }).sort();
  process.stderr.write(
    'Usage: construct artifact validate <path> --type=<doc-type> [--check-links|--no-check-links] [--json] [--recruited=<csv>]\n',
  );
  process.stderr.write(`Valid types: ${types.length > 0 ? types.join(', ') : '(none registered)'}\n`);
  process.stderr.write('Next: construct artifact validate path/to/doc.md --type=prd\n');
}

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

export function dedupeGateErrors(errors = []) {
  return [...new Set((errors || []).filter(Boolean))];
}

function validateArtifactBodyCore({
  body,
  resolvedType,
  entry,
  cwd,
  rootDir,
  reviewersSeen,
  recruitedReviewers = [],
  filePath = null,
}) {
  const gate = entry.releaseGate ?? {};
  const errors = [];
  const warnings = [];
  const rawBody = String(body || '');
  const stripped = rawBody.replace(/^---\n[\s\S]*?\n---\n/, '');
  const bodyWithoutComments = stripped.replace(/<!--[\s\S]*?-->/g, '');

  if (gate.structuralLint !== false && filePath) {
    errors.push(...lintDocStructure(filePath, resolvedType));
    errors.push(...lintDocVisuals(filePath, resolvedType));
    const presentation = lintDocPresentationFile(filePath, resolvedType);
    errors.push(...presentation.errors);
    warnings.push(...presentation.warnings);
  }

  if (gate.citationLint) {
    const isShippedTemplate = filePath?.includes(`${path.sep}templates${path.sep}docs${path.sep}`);
    if (!isShippedTemplate) {
      if (filePath) {
        const lint = lintFile(filePath);
        const artifactIssues = [...(lint.errors ?? []), ...(lint.warnings ?? [])].filter((w) => w.kind === 'artifact');
        for (const issue of artifactIssues) errors.push(issue.message || String(issue));
      }
      const citations = countCitations(bodyWithoutComments);
      const unverified = /\[unverified\]/i.test(bodyWithoutComments);
      if (citations < 1 && !unverified) {
        errors.push('citationLint: no verifiable sources or [unverified] markers');
      }
    }
  }

  const minProse = gate.proseMinimum ?? 0;
  if (minProse > 0) {
    const prose = countProseParagraphs(bodyWithoutComments);
    if (prose < minProse) {
      errors.push(`proseMinimum: ${prose} paragraphs (need ${minProse})`);
    }
  }

  // Reviewer sign-off gate: advisory by default —
  // missing sign-offs warn. An enforced reviewerGate blocks ONLY when its
  // enforcementScope team holds the named decisionRight in its own registry
  // entry (opt-in per team) and does not forbid the decision.

  let reviewerGate = null;
  if (filePath) {
    reviewerGate = resolveReviewerGate({
      docType: resolvedType,
      filePath,
      rootDir,
      cwd,
      reviewersSeen,
      recruitedReviewers,
    });
    if (reviewerGate.missing.length > 0) {
      if (reviewerGate.blocks) {
        errors.push(`requiredReviewers not seen in agent log: ${reviewerGate.missing.join(', ')} — ${reviewerGate.reason}`);
      } else {
        warnings.push(`requiredReviewers not seen in agent log: ${reviewerGate.missing.join(', ')} (${reviewerGate.reason})`);
      }
    }
  }

  return {
    ok: dedupeGateErrors(errors).length === 0,
    errors: dedupeGateErrors(errors),
    warnings,
    tone: resolveToneForArtifact(resolvedType, { cwd, rootDir }),
    type: resolvedType,
    filePath,
    reviewerGate: reviewerGate
      ? { mode: reviewerGate.mode, blocked: reviewerGate.blocks, missing: reviewerGate.missing, reason: reviewerGate.reason }
      : null,
  };
}

export function validateArtifactBody({
  body,
  type,
  cwd = process.cwd(),
  rootDir,
  reviewersSeen,
} = {}) {
  const resolvedType = type;
  const entry = getArtifactEntry(resolvedType, { rootDir });
  if (!entry) {
    return {
      ok: false,
      errors: [formatUnknownArtifactTypeError(resolvedType, { rootDir })],
      warnings: [],
      tone: null,
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-artifact-gate-'));
  const filePath = path.join(tmpDir, 'draft.md');
  try {
    fs.writeFileSync(filePath, body.endsWith('\n') ? body : `${body}\n`);
    return validateArtifactBodyCore({
      body,
      resolvedType,
      entry,
      cwd,
      rootDir,
      reviewersSeen,
      filePath,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function validateArtifactRelease({
  filePath,
  type,
  cwd = process.cwd(),
  rootDir,
  reviewersSeen,
  recruitedReviewers = [],
} = {}) {
  const resolvedType = type || inferArtifactTypeFromPath(filePath, { rootDir: cwd });
  const entry = getArtifactEntry(resolvedType, { rootDir });
  if (!entry) {
    return {
      ok: false,
      errors: [formatUnknownArtifactTypeError(resolvedType, { rootDir })],
      warnings: [],
      tone: null,
    };
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

  const raw = fs.readFileSync(filePath, 'utf8');

  const result = validateArtifactBodyCore({
    body: raw,
    resolvedType,
    entry,
    cwd,
    rootDir,
    reviewersSeen,
    recruitedReviewers,
    filePath,
  });

  if (entry.releaseGate?.citationLint && (resolvedType === 'research-brief' || resolvedType === 'research-finding')) {
    for (const url of urlsMissingInlineMarkdownLinks(raw)) {
      result.errors.push(`citation: URL appears without an inline markdown link [label](url): ${url}`);
    }
  }

  // The contract ladder runs last so a hard block reads as the final word on
  // the artifact rather than competing with structural lint for attention.

  const contracts = evaluateArtifactContracts({
    filePath,
    artifactType: resolvedType,
    projectRoot: cwd,
    rootDir,
  });
  result.errors.push(...contracts.errors);
  result.warnings.push(...contracts.warnings);
  result.ok = result.errors.length === 0;

  return { ...result, filePath, contractGate: contracts.contractGate };
}

export async function applyArtifactLinkValidation(result, {
  filePath,
  type,
  fetchImpl = globalThis.fetch,
  requireInlineMarkdownLinks = null,
} = {}) {
  const resolvedType = type || result?.type;
  const raw = fs.readFileSync(filePath || result.filePath, 'utf8');
  const links = await validateArtifactLinks(raw, {
    fetchImpl,
    requireInlineMarkdownLinks: requireInlineMarkdownLinks
      ?? (resolvedType === 'research-brief' || resolvedType === 'research-finding'),
  });
  const next = {
    ...result,
    errors: [...(result.errors || []), ...links.errors],
    warnings: [...(result.warnings || []), ...links.warnings],
    linkCheck: { checked: links.checked, ok: links.ok },
  };
  if (links.checked > 0 && links.ok) {
    next.warnings.push(`citation: verified ${links.checked} http(s) link(s)`);
  }
  next.ok = next.errors.length === 0;
  return next;
}

// Level-aware entry: runs the release gate (the source-lint category that exists today) and
// attaches the gate plan for the artifact's level, so callers see both what was enforced and the
// higher-tier categories still owed. The level comes from the artifact's qualityContract unless
// passed explicitly. Pending categories are reported, never silently treated as passed.

export function runGateAtLevel({ filePath, type, level, cwd = process.cwd(), rootDir } = {}) {
  const resolvedType = type || inferArtifactTypeFromPath(filePath, { rootDir: cwd });
  let effectiveLevel = level;
  if (!effectiveLevel) {
    const contract = resolveArtifactWorkflowContract(resolvedType, { rootDir, cwd });
    effectiveLevel = resolveGateLevel(contract?.qualityContract);
  }
  const release = validateArtifactRelease({ filePath, type: resolvedType, cwd, rootDir });
  const plan = planGateForLevel(effectiveLevel);
  return { ...release, gateLevel: plan.level, gatePlan: { runs: plan.runs, pending: plan.pending } };
}

export async function runArtifactValidateCli(args = []) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const filePath = positional[0];
  const typeArg = args.find((a) => a.startsWith('--type='));
  const json = args.includes('--json');
  const checkLinks = args.includes('--check-links');
  const noCheckLinks = args.includes('--no-check-links');

  if (!filePath || !typeArg) {
    printArtifactValidateUsage();
    process.exit(1);
  }

  const type = typeArg.split('=')[1];
  const recruitedArg = args.find((a) => a.startsWith('--recruited='));
  const recruitedReviewers = recruitedArg
    ? recruitedArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  let result = validateArtifactRelease({
    filePath,
    type,
    recruitedReviewers,
  });

  const entry = getArtifactEntry(type);
  const citationLintOn = Boolean(entry?.releaseGate?.citationLint);
  const shouldFetch = checkLinks || (citationLintOn && !noCheckLinks && !result.bypassed);
  if ((shouldFetch || checkLinks) && entry) {
    result = await applyArtifactLinkValidation(result, { filePath, type });
  }

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

  if (!result.ok) process.exit(result.reviewerGate?.blocked ? 2 : 1);
}
