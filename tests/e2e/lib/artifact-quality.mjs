/**
 * tests/e2e/lib/artifact-quality.mjs — deterministic artifact-quality checks for
 * the Tier-3 / Layer-4 gate.
 *
 * The real-LLM layer produces a PRD / evidence brief via the specialist chain;
 * the checks below score that artifact on three machine-checkable dimensions
 * the plan calls out, with no model needed at assertion time:
 *
 *   - structure: required sections present (reuses lib/templates STRUCTURE_REQUIREMENTS
 *     via lintDocStructure) — proof the artifact used the construct template skeleton.
 *   - prose: real multi-sentence paragraphs, not a bullet-only outline — the
 *     "appropriate paragraph structure" requirement.
 *   - research: load-bearing claims are sourced (citations / arXiv / accessed-dated
 *     links) or honestly marked [unverified] — proof of research, not assertion.
 *
 * Returns a structured verdict so a test or the runner can assert per dimension
 * and a report can show the evidence. Heuristics are intentionally conservative:
 * they catch the "flat PRD, no research" failure without grading wording.
 */

import { readFileSync } from 'node:fs';
import { lintDocStructure } from '../../../lib/templates/visual-requirements.mjs';

// A block (blank-line-separated) is prose when it is not a heading, list item,
// table row, or code fence, and reads as sentences (≥2 sentence terminators or a
// substantial single sentence). Bullet outlines fail this on purpose.
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

// Citations: resolvable links, arXiv ids, accessed-dated sources, or [source: …]
// markers. Honest [unverified] markers count as research discipline, not sources.
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

export function assessArtifactQuality(filePath, type, { minProse = 3, minCitations = 2 } = {}) {
  const raw = readFileSync(filePath, 'utf8');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');

  const structureErrors = lintDocStructure(filePath, type) || [];
  const proseCount = countProseParagraphs(body);
  const citationCount = countCitations(body);
  const unverifiedDiscipline = /\[unverified\]/i.test(body);

  const structure = { ok: structureErrors.length === 0, errors: structureErrors };
  const prose = { ok: proseCount >= minProse, paragraphs: proseCount, min: minProse };
  const research = { ok: citationCount >= minCitations || (citationCount >= 1 && unverifiedDiscipline), citations: citationCount, unverifiedDiscipline };

  return { ok: structure.ok && prose.ok && research.ok, structure, prose, research };
}
