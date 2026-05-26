/**
 * lib/intake/traceability.mjs — stamps intake provenance into artifact frontmatter.
 *
 * Backs `construct intake done <id> --output=<path>`: reads the intake packet,
 * extracts (id, confidence, rationale), and writes them into the artifact's
 * YAML frontmatter. Refuses to overwrite a different intake_id (an artifact
 * can be linked to exactly one intake source). Idempotent on re-stamping.
 *
 * Read by docs:verify checkIntakeTraceability to surface artifacts in
 * intake-fed locations that lack a reference.
 *
 * Field schema (in artifact YAML frontmatter):
 *   intake_id: construct-xxx
 *   intake_confidence: 0.7
 *   intake_rationale: "Matched 3 keywords: dashboard, latency, p95"
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export function parseArtifactFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: content, hasBlock: false };
  const out = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (!key) continue;
    const unquoted = rawValue.replace(/^["']|["']$/g, '');
    if (/^-?\d+(\.\d+)?$/.test(unquoted)) out[key] = Number(unquoted);
    else out[key] = unquoted;
  }
  return { frontmatter: out, body: content.slice(m[0].length), hasBlock: true };
}

function serializeFrontmatter(fm) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      const s = String(v);
      const needsQuoting = /[:#"'\n]|^\s|\s$/.test(s);
      lines.push(`${k}: ${needsQuoting ? JSON.stringify(s) : s}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function stampIntakeProvenance(artifactPath, { intakeId, confidence, rationale }) {
  if (!existsSync(artifactPath)) {
    throw new Error(`Output artifact not found: ${artifactPath}`);
  }
  if (!intakeId) throw new Error('intakeId required for stamping');
  const content = readFileSync(artifactPath, 'utf8');
  const { frontmatter, body, hasBlock } = parseArtifactFrontmatter(content);

  const existing = frontmatter.intake_id;
  if (existing && existing !== intakeId) {
    throw new Error(
      `Refusing to overwrite intake_id: artifact already references ${existing}, not ${intakeId}. Resolve manually or supersede.`,
    );
  }

  const next = {
    ...frontmatter,
    intake_id: intakeId,
    ...(confidence !== undefined && confidence !== null ? { intake_confidence: confidence } : {}),
    ...(rationale ? { intake_rationale: rationale } : {}),
  };

  const fmText = serializeFrontmatter(next);
  const out = hasBlock ? `${fmText}\n${body}` : `${fmText}\n\n${content}`;
  writeFileSync(artifactPath, out, 'utf8');
  return { intake_id: intakeId, intake_confidence: next.intake_confidence, intake_rationale: next.intake_rationale };
}

export function hasIntakeReference(artifactPath) {
  if (!existsSync(artifactPath)) return false;
  const { frontmatter } = parseArtifactFrontmatter(readFileSync(artifactPath, 'utf8'));
  if (frontmatter.intake_id) return true;
  if (frontmatter.intake === 'none') return true;
  return false;
}
