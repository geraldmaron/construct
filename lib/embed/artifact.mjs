/**
 * lib/embed/artifact.mjs — On-demand and embed-triggered artifact generation.
 *
 * Generates PRDs, RFCs, and ADRs as structured markdown files under docs/.
 * Each artifact type has a fixed schema and front-matter. Numbering is auto-
 * incremented by scanning the target directory. Can be called from the CLI,
 * from the embed daemon when analysis triggers a recommendation, or from the
 * dashboard API.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ── Constants ──────────────────────────────────────────────────────────────

const ARTIFACT_TYPES = ['prd', 'adr', 'rfc'];

const DIRS = {
  prd: 'docs/prd',
  adr: 'docs/adr',
  rfc: 'docs/rfc',
};

// ── Numbering ──────────────────────────────────────────────────────────────

/**
 * Scan a directory for existing artifacts and return the next sequence number.
 * Files must match the pattern NNNN-*.md.
 */
function nextSequenceNumber(dir) {
  if (!existsSync(dir)) return 1;
  const files = readdirSync(dir).filter(f => /^\d{4}-.*\.md$/.test(f));
  if (!files.length) return 1;
  const nums = files.map(f => parseInt(f.slice(0, 4), 10)).filter(n => !isNaN(n));
  return Math.max(...nums) + 1;
}

function padNum(n) {
  return String(n).padStart(4, '0');
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── Front-matter ───────────────────────────────────────────────────────────

function buildFrontMatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

// ── Templates ──────────────────────────────────────────────────────────────

function prdTemplate({ number, title, owner, problem, goals, nonGoals, users }) {
  const num = padNum(number);
  const date = new Date().toISOString().slice(0, 10);
  const fm = buildFrontMatter({
    cx_doc_id: randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    generator: 'construct/artifact',
    status: 'draft',
  });

  return `${fm}# PRD-${num}: ${title}

- **Date**: ${date}
- **Owner**: ${owner || 'TBD'}
- **Status**: draft

## Problem

${problem || 'TODO: Describe the problem this PRD addresses.'}

## Users

| Segment | Description | Current workaround |
|---|---|---|
| TODO | TODO | TODO |

## Goals

${(goals || []).map(g => `- ${g}`).join('\n') || '- TODO'}

## Non-goals

${(nonGoals || []).map(g => `- ${g}`).join('\n') || '- TODO'}

## Requirements

### Functional

| ID | Requirement | Priority |
|---|---|---|
| F1 | TODO | P0 |

### Non-functional

| ID | Requirement | Target |
|---|---|---|
| NF1 | TODO | TODO |

## Open questions

- TODO
`;
}

function adrTemplate({ number, title, status, context, decision, consequences, alternatives }) {
  const num = padNum(number);
  const fm = buildFrontMatter({
    cx_doc_id: randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    generator: 'construct/artifact',
    body_hash: 'sha256:placeholder',
  });

  const altSection = (alternatives || []).length
    ? alternatives.map(a => `### ${a.title}\n\n${a.reason || 'Rejected.'}`).join('\n\n')
    : '### Alternative A\n\nTODO: describe and explain rejection.';

  return `${fm}# ADR-${num}: ${title}

## Status

${status || 'Proposed'}

## Context

${context || 'TODO: Describe the context and problem that led to this decision.'}

## Decision

${decision || 'TODO: State the architectural decision.'}

## Consequences

${(consequences || []).map(c => `- ${c}`).join('\n') || '- TODO'}

## Rejected alternatives

${altSection}
`;
}

function rfcTemplate({ number, title, author, summary, motivation, design, drawbacks, alternatives, unresolved }) {
  const num = padNum(number);
  const date = new Date().toISOString().slice(0, 10);
  const fm = buildFrontMatter({
    cx_doc_id: randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    generator: 'construct/artifact',
    status: 'draft',
  });

  return `${fm}# RFC-${num}: ${title}

- **Date**: ${date}
- **Author**: ${author || 'TBD'}
- **Status**: draft

## Summary

${summary || 'TODO: One-paragraph summary of the change being proposed.'}

## Motivation

${motivation || 'TODO: Why is this change needed? What problem does it solve?'}

## Design

${design || 'TODO: Detailed description of the proposed design or implementation.'}

## Drawbacks

${(drawbacks || []).map(d => `- ${d}`).join('\n') || '- TODO'}

## Alternatives

${(alternatives || []).map(a => `- ${a}`).join('\n') || '- TODO'}

## Unresolved questions

${(unresolved || []).map(u => `- ${u}`).join('\n') || '- TODO'}
`;
}

// ── Core generator ─────────────────────────────────────────────────────────

/**
 * Generate an artifact file.
 *
 * @param {object} opts
 * @param {string} opts.type        - 'prd' | 'adr' | 'rfc'
 * @param {string} opts.title       - Human-readable title (required)
 * @param {string} [opts.rootDir]   - Project root (default: cwd)
 * @param {object} [opts.fields]    - Type-specific fields (see templates above)
 * @param {boolean} [opts.dryRun]   - If true, return content without writing
 * @returns {{ path: string, content: string, number: number }}
 */
export function generateArtifact({ type, title, rootDir, fields = {}, dryRun = false }) {
  if (!ARTIFACT_TYPES.includes(type)) {
    throw new Error(`Unknown artifact type "${type}". Must be one of: ${ARTIFACT_TYPES.join(', ')}`);
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new Error('title is required');
  }

  const root = rootDir || process.cwd();
  const dir = join(root, DIRS[type]);

  const number = nextSequenceNumber(dir);
  const slug = slugify(title.trim());
  const filename = `${padNum(number)}-${slug}.md`;
  const filePath = join(dir, filename);

  let content;
  const ctx = { number, title: title.trim(), ...fields };

  if (type === 'prd') content = prdTemplate(ctx);
  else if (type === 'adr') content = adrTemplate(ctx);
  else content = rfcTemplate(ctx);

  if (!dryRun) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }

  return { path: filePath, relativePath: join(DIRS[type], filename), content, number };
}

// ── List artifacts ─────────────────────────────────────────────────────────

/**
 * List all artifacts of a given type (or all types).
 *
 * @param {object} opts
 * @param {string} [opts.type]     - Filter by type; if omitted, returns all
 * @param {string} [opts.rootDir]  - Project root
 * @returns {Array<{ type, number, slug, filename, title, status, path }>}
 */
export function listArtifacts({ type, rootDir } = {}) {
  const root = rootDir || process.cwd();
  const types = type ? [type] : ARTIFACT_TYPES;
  const results = [];

  for (const t of types) {
    const dir = join(root, DIRS[t]);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir).sort()) {
      if (!/^\d{4}-.*\.md$/.test(file)) continue;
      const filePath = join(dir, file);
      let titleLine = file.replace('.md', '').replace(/^\d{4}-/, '').replace(/-/g, ' ');
      let status = 'unknown';

      try {
        const raw = readFileSync(filePath, 'utf8');
        const headingMatch = raw.match(/^# .+?: (.+)$/m);
        if (headingMatch) titleLine = headingMatch[1].trim();
        const statusMatch = raw.match(/\*\*Status\*\*: (\S+)|^## Status\s+\n+(\S[^\n]*)/m);
        if (statusMatch) status = (statusMatch[1] || statusMatch[2] || 'unknown').trim().toLowerCase();
      } catch { /* ignore read errors */ }

      results.push({
        type: t,
        number: parseInt(file.slice(0, 4), 10),
        filename: file,
        title: titleLine,
        status,
        path: filePath,
        relativePath: join(DIRS[t], file),
      });
    }
  }

  return results;
}

// ── Embed trigger ──────────────────────────────────────────────────────────

/**
 * Evaluate a snapshot and return artifact recommendations.
 * Called by the embed daemon after each snapshot cycle.
 *
 * @param {object} snapshot  - Snapshot from SnapshotEngine
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @returns {Array<{ type, title, reason, fields }>}
 */
export function recommendArtifacts(snapshot, { rootDir } = {}) {
  const root = rootDir || process.cwd();
  const existing = listArtifacts({ rootDir: root });
  const recommendations = [];

  // If no PRD exists, recommend one
  const hasPrd = existing.some(a => a.type === 'prd');
  if (!hasPrd) {
    recommendations.push({
      type: 'prd',
      title: 'Project Overview',
      reason: 'No PRD found. A product requirements document helps align contributors and agents.',
    });
  }

  // If snapshot has errors and no ADR for error handling, recommend one
  const snapshotHasErrors = snapshot?.summary?.some?.(s => s.status === 'error');
  if (snapshotHasErrors) {
    const hasErrorAdr = existing.some(a =>
      a.type === 'adr' && /error|resilience|failure/i.test(a.title)
    );
    if (!hasErrorAdr) {
      recommendations.push({
        type: 'adr',
        title: 'Error Handling and Resilience Strategy',
        reason: 'Snapshot detected provider errors. Document the error-handling strategy.',
      });
    }
  }

  // If there are multiple providers and no integration RFC, recommend one
  const providerCount = snapshot?.providers?.length ?? 0;
  if (providerCount >= 3) {
    const hasIntegrationRfc = existing.some(a =>
      a.type === 'rfc' && /integration|provider/i.test(a.title)
    );
    if (!hasIntegrationRfc) {
      recommendations.push({
        type: 'rfc',
        title: 'Multi-Provider Integration Strategy',
        reason: `${providerCount} providers are configured. Consider documenting the integration approach as an RFC.`,
      });
    }
  }

  return recommendations;
}
