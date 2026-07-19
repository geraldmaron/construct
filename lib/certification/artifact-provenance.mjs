/**
 * lib/certification/artifact-provenance.mjs — provenance and accessibility certification.
 *
 * Validates golden artifact fixtures for cx_doc_id / fixture provenance stamps and
 * WCAG-oriented structure (heading order, alt-text placeholders on visual types).
 */

import fs from 'node:fs';
import path from 'node:path';

import { artifactTypes } from '../artifact-manifest.mjs';
import { goldenFixturePath } from './artifact-fixtures.mjs';
import { splitFrontmatter } from '../worker-profiles/prompt-schema.mjs';

const RELEASE_CRITICAL_TYPES = new Set(['prd', 'adr', 'rfc', 'threat-model', 'security-review']);

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function hasProvenanceStamp(frontmatter, body) {
  if (frontmatter?.cx_doc_id) return true;
  if (frontmatter?.cx_fixture_type) return true;
  if (frontmatter?.cx_fixture_source) return true;
  if (/\bcx_doc_id:/i.test(body.slice(0, 500))) return true;
  return false;
}

function headingLevel(line) {
  const m = /^(#{1,6})\s/.exec(line.trim());
  return m ? m[1].length : null;
}

function validateHeadingStructure(body) {
  const errors = [];
  const levels = body.split('\n').map(headingLevel).filter((l) => l != null);
  if (!levels.includes(1)) errors.push('missing h1 (# heading)');
  let prev = 0;
  for (const level of levels) {
    if (prev > 0 && level > prev + 1) {
      errors.push(`heading skip: h${prev} → h${level}`);
      break;
    }
    prev = level;
  }
  return errors;
}

function validateAltPlaceholders(body, type) {
  if (!['prd', 'architecture-overview', 'system-design'].includes(type)) return [];
  const hasImage = /!\[[^\]]*\]\([^)]+\)/.test(body);
  const hasPlaceholder = /alt\s*text|describe the (image|diagram)|\[alt:/i.test(body);
  if (hasImage && !hasPlaceholder) {
    return ['image without alt-text placeholder guidance'];
  }
  return [];
}

export function validateArtifactProvenance(type, { rootDir, strict = true } = {}) {
  const root = findConstructRoot(rootDir);
  const filePath = goldenFixturePath(type, { rootDir: root });
  const errors = [];

  if (!fs.existsSync(filePath)) {
    return { type, pass: false, errors: [`missing golden fixture: ${type}`] };
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);

  if (!hasProvenanceStamp(frontmatter, body)) {
    errors.push(`${type}: missing provenance stamp (cx_doc_id or cx_fixture_*)`);
  }

  errors.push(...validateHeadingStructure(body).map((e) => `${type}: ${e}`));
  errors.push(...validateAltPlaceholders(body, type).map((e) => `${type}: ${e}`));

  const blocking = strict && RELEASE_CRITICAL_TYPES.has(type) && errors.length > 0;
  return { type, pass: errors.length === 0, blocking, errors };
}

export function validateAllArtifactProvenance({ rootDir, strict = true } = {}) {
  const results = [];
  const errors = [];
  for (const type of artifactTypes({ rootDir: findConstructRoot(rootDir) })) {
    const result = validateArtifactProvenance(type, { rootDir, strict });
    results.push(result);
    if (!result.pass) errors.push(...result.errors);
  }
  return { pass: errors.length === 0, strict, results, errors };
}
