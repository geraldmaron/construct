/**
 * lib/artifact-type-from-path.mjs — Infer manifest doc type from artifact file paths.
 *
 * Resolves a manifest doc type when --type is omitted.
 * Resolution order: YAML frontmatter cx_doc_type → directory heuristics → filename hints.
 */

import fs from 'node:fs';
import path from 'node:path';
import { artifactTypes } from './artifact-manifest.mjs';

const KNOWN = new Set(artifactTypes());

function readFrontmatterType(filePath) {
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
    const match = head.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    for (const line of match[1].split('\n')) {
      const m = line.match(/^(?:cx_doc_type|artifactType|doc_type)\s*:\s*(.+)$/);
      if (m) {
        const value = m[1].trim().replace(/^['"]|['"]$/g, '');
        return KNOWN.has(value) ? value : null;
      }
    }
  } catch { /* unreadable */ }
  return null;
}

function inferPrdSubtype(rel, base) {
  const blob = `${rel} ${base}`.toLowerCase();
  if (/meta[\s-]?prd/.test(blob)) return 'meta-prd';
  if (/platform/.test(blob)) return 'prd-platform';
  if (/business/.test(blob)) return 'prd-business';
  return 'prd';
}

function inferRfcSubtype(rel, base) {
  const blob = `${rel} ${base}`.toLowerCase();
  if (/platform/.test(blob)) return 'rfc-platform';
  return 'rfc';
}

// Match both this repo's bucketed layout (docs/specs/prd, docs/decisions/adr, …)
// and the init-lane layout that `construct init` scaffolds downstream (docs/prd,
// docs/adr, …), so artifact-type inference works in either project shape.

const PREFIX_RULES = [
  [/^docs\/(?:specs\/)?prd\//, inferPrdSubtype],
  [/^docs\/(?:decisions\/)?adr\//, () => 'adr'],
  [/^docs\/(?:decisions\/)?rfc\//, inferRfcSubtype],
  [/^docs\/(?:notes\/)?research\//, () => 'research-brief'],
  [/^docs\/(?:operations\/)?runbooks?\//, () => 'runbook'],
  [/^\.cx\/research\//, () => 'research-brief'],
];

export function isArtifactGatePath(relPath) {
  const rel = relPath.replace(/\\/g, '/');
  if (!rel.endsWith('.md')) return false;
  if (rel.startsWith('templates/docs/')) return false;
  if (/^docs\//.test(rel) || /^\.cx\/research\//.test(rel)) return true;
  return false;
}

export function inferArtifactTypeFromPath(filePath, { rootDir = process.cwd() } = {}) {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
  if (!rel.endsWith('.md')) return null;

  const fromFm = readFrontmatterType(filePath);
  if (fromFm) return fromFm;

  if (!isArtifactGatePath(rel)) return null;

  const base = path.basename(filePath, path.extname(filePath));
  for (const [re, resolver] of PREFIX_RULES) {
    if (re.test(rel)) {
      const type = typeof resolver === 'function' ? resolver(rel, base) : resolver;
      return KNOWN.has(type) ? type : null;
    }
  }

  return null;
}
