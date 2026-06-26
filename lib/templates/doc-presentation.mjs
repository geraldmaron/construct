/**
 * lib/templates/doc-presentation.mjs — Presentation lint for Construct artifacts.
 *
 * Complements lintDocStructure with spacing, bullet walls, heading hierarchy,
 * and diagram heuristics aligned with skills/brand/output-vibe.md.
 */
import { readFileSync } from 'node:fs';

export function lintDocPresentation(body, { type } = {}) {
  const errors = [];
  const warnings = [];
  const lines = body.split(/\r?\n/);

  const h1Count = (body.match(/^#\s+/gm) || []).length;
  if (h1Count > 1) errors.push('multiple H1 headings (use single title)');

  let consecutiveBullets = 0;
  let maxConsecutiveBullets = 0;
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      consecutiveBullets++;
      maxConsecutiveBullets = Math.max(maxConsecutiveBullets, consecutiveBullets);
    } else if (line.trim() !== '') {
      consecutiveBullets = 0;
    }
  }
  if (maxConsecutiveBullets > 7) {
    errors.push(`bullet wall: ${maxConsecutiveBullets} consecutive bullets (max 7 without prose bridge)`);
  }

  if (/\n{4,}/.test(body)) {
    warnings.push('more than three consecutive blank lines');
  }

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]) && i > 0 && lines[i - 1].trim() !== '') {
      errors.push(`missing blank line before heading: ${lines[i].trim()}`);
      break;
    }
  }

  if (/```mermaid[\s\S]*?flowchart/i.test(body)) {
    if (!/error|fail|rollback|escalat/i.test(body)) {
      warnings.push('flowchart may lack error/rollback path (output-vibe expects one non-happy path)');
    }
  }

  if (/!\[[^\]]*\]\([^)]+\)/.test(body)) {
    if (/!\[\s*\]\(/.test(body)) errors.push('image missing alt text');
  }

  if (type?.startsWith('prd') && !/\bFR-\d/i.test(body) && !/^## Requirements/m.test(body)) {
    warnings.push('prd-family: consider FR-* or ## Requirements section');
  }

  return { errors, warnings };
}

export function lintDocPresentationFile(filePath, type) {
  const raw = readFileSync(filePath, 'utf8');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  return lintDocPresentation(body, { type });
}
