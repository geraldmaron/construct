/**
 * lib/research-lint.mjs — enforce minimum structure for research and evidence artifacts.
 *
 * Validates markdown files under .cx/research/ and key .cx/product-intel/
 * folders so weak or incomplete evidence docs are flagged before they become
 * decision inputs. Used by `construct lint:research` and lightweight CI checks.
 */
import fs from 'node:fs';
import path from 'node:path';

const RESEARCH_RELPATH = /^\.cx\/research\/.+\.md$/;
const EVIDENCE_RELPATH = /^\.cx\/product-intel\/evidence-briefs\/.+\.md$/;
const SIGNAL_RELPATH = /^\.cx\/product-intel\/signals\/.+\.md$/;

const REQUIRED_SECTIONS = {
  research: ['Question', 'Method', 'Sources', 'Findings', 'Confidence', 'References'],
  evidence: ['Decision this evidence informs', 'Evidence threshold', 'Sources', 'What we observed', 'Confidence', 'Recommendation'],
  signal: ['Signal', 'Evidence', 'Why it matters', 'What would make this actionable', 'Follow-up'],
};

function relPath(rootDir, absPath) {
  return path.relative(rootDir, absPath).replace(/\\/g, '/');
}

function artifactKind(rel) {
  if (RESEARCH_RELPATH.test(rel)) return 'research';
  if (EVIDENCE_RELPATH.test(rel)) return 'evidence';
  if (SIGNAL_RELPATH.test(rel)) return 'signal';
  return null;
}

function lineForMatch(content, pattern) {
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index + 1;
  }
  return 1;
}

function hasHeading(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+${escaped}\\s*$`, 'm').test(content);
}

function hasDateMetadata(content) {
  return /^-\s+\*\*Date\*\*:\s+.+$/m.test(content)
    || /\b(?:publication|access)\s+date\b/i.test(content)
    || /\b\d{4}-\d{2}-\d{2}\b/.test(content);
}

function hasConfidenceCue(content) {
  return /\bconfidence\b/i.test(content)
    || /\bhigh\b|\bmedium\b|\blow\b/i.test(content)
    || /\bweak signal\b|\bconfirmed\b|\binferred\b/i.test(content);
}

function hasSourceCue(content) {
  return /\bsource\b/i.test(content)
    || /\bhttps?:\/\//i.test(content)
    || /\b\.cx\//.test(content)
    || /\bdocs\//.test(content);
}

function hasObservationInferenceCue(content) {
  return /\bobservation\b/i.test(content)
    || /\binference\b/i.test(content)
    || /\bwhat we observed\b/i.test(content);
}

export function lintResearchFile(filePath, { rootDir = process.cwd() } = {}) {
  const rel = relPath(rootDir, filePath);
  const kind = artifactKind(rel);
  if (!kind) return { path: rel, kind: null, errors: [], warnings: [] };

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { path: rel, kind, errors: [{ line: 1, label: 'unable to read file' }], warnings: [] };
  }

  const errors = [];
  const warnings = [];

  for (const heading of REQUIRED_SECTIONS[kind]) {
    if (!hasHeading(content, heading)) {
      errors.push({
        line: 1,
        label: `missing required section: ${heading}`,
      });
    }
  }

  if (!hasSourceCue(content)) {
    errors.push({
      line: lineForMatch(content, /^##\s+Sources\s*$/m),
      label: 'missing source references, links, or document paths',
    });
  }

  if (!hasDateMetadata(content)) {
    warnings.push({
      line: 1,
      label: 'missing explicit date or access-date basis',
    });
  }

  if (!hasConfidenceCue(content)) {
    errors.push({
      line: 1,
      label: 'missing confidence labeling or threshold language',
    });
  }

  if ((kind === 'research' || kind === 'evidence') && !hasObservationInferenceCue(content)) {
    warnings.push({
      line: 1,
      label: 'observation vs inference separation is not explicit',
    });
  }

  return { path: rel, kind, errors, warnings };
}

function walkDir(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'site', '.construct', '.claude'].includes(entry.name)) continue;
      walkDir(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

export function lintResearchRepo({ rootDir = process.cwd() } = {}) {
  const files = walkDir(rootDir).filter((filePath) => artifactKind(relPath(rootDir, filePath)));
  const results = files.map((filePath) => lintResearchFile(filePath, { rootDir }));
  return results.filter((result) => result.errors.length || result.warnings.length);
}

export function formatResearchLintResults(results) {
  if (!results.length) return { output: '  ✓  No research artifact issues found.\n', exitCode: 0 };

  const lines = [];
  let errorCount = 0;
  let warnCount = 0;
  for (const { path: filePath, errors, warnings } of results) {
    for (const { line, label } of errors) {
      lines.push(`  error  ${filePath}:${line}  ${label}`);
      errorCount += 1;
    }
    for (const { line, label } of warnings) {
      lines.push(`  warn   ${filePath}:${line}  ${label}`);
      warnCount += 1;
    }
  }
  lines.push(`\n  ${errorCount} error(s), ${warnCount} warning(s)`);
  return { output: `${lines.join('\n')}\n`, exitCode: errorCount > 0 ? 1 : 0 };
}

