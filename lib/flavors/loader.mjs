/**
 * lib/flavors/loader.mjs — Role flavor overlay loader and validator.
 *
 * Reads frontmatter from skills/roles/<role>.<flavor>.md files, exposes:
 *   - listFlavors(role?, profile?) — overlays that apply to role and profile
 *   - validateFlavor(path) — frontmatter conformance check against the schema
 *   - perRoleFlavorCount(profile) — flavor counts per role for cap enforcement
 *
 * The cap is enforced at sync time and in lint-prose's sibling lint-flavors.
 * Six flavors per role per profile is the current ceiling; bumping requires
 * an ADR. Existing roles like qa already have 6, so the cap is set tight.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const FLAVORS_DIR = path.join(REPO_ROOT, 'skills', 'roles');

export const FLAVOR_CAP_PER_ROLE_PER_PROFILE = 6;

// Files may start with an HTML comment block before the YAML frontmatter.
// The /m flag lets ^ match line-start so we find the YAML wherever it sits.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/m;

function parseFrontmatter(content) {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  const out = {};
  let currentArrayKey = null;
  for (const rawLine of m[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (currentArrayKey && /^\s*-\s+/.test(line)) {
      out[currentArrayKey].push(line.replace(/^\s*-\s+/, '').trim());
      continue;
    }
    currentArrayKey = null;
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    const value = valueRaw.trim();
    if (value === '') {
      out[key] = [];
      currentArrayKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      const items = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      out[key] = items;
    } else if (value === 'null') {
      out[key] = null;
    } else if (/^-?\d+$/.test(value)) {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Read and parse every overlay in skills/roles/. Returns { path, frontmatter }
 * tuples. Files without parseable frontmatter are skipped silently.
 */
export function listAllFlavors() {
  if (!fs.existsSync(FLAVORS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(FLAVORS_DIR)) {
    if (!f.endsWith('.md') || f === 'README.md') continue;
    const full = path.join(FLAVORS_DIR, f);
    const content = fs.readFileSync(full, 'utf8');
    const fm = parseFrontmatter(content);
    if (fm) out.push({ path: full, file: f, frontmatter: fm });
  }
  return out;
}

/**
 * Return overlays that match the given role (any-flavor for that role) and
 * apply to the given profile. Pass undefined for either to skip that filter.
 */
export function listFlavors({ role, profile } = {}) {
  return listAllFlavors().filter(({ frontmatter }) => {
    if (role) {
      const roleId = frontmatter.role || '';
      const baseRole = roleId.split('.')[0];
      if (baseRole !== role && roleId !== role) return false;
    }
    if (profile) {
      const profiles = frontmatter.profiles;
      if (!Array.isArray(profiles) || profiles.length === 0) return true;
      if (!profiles.includes(profile)) return false;
    }
    return true;
  });
}

/**
 * Count flavor overlays per base role for a given profile.
 * Returns { [baseRole]: count }. Excludes the canonical base file (e.g.
 * architect.md) so only true flavors count toward the cap.
 */
export function perRoleFlavorCount(profile = 'rnd') {
  const counts = {};
  for (const entry of listFlavors({ profile })) {
    const roleId = entry.frontmatter.role || '';
    const isFlavor = roleId.includes('.');
    if (!isFlavor) continue;
    const base = roleId.split('.')[0];
    counts[base] = (counts[base] || 0) + 1;
  }
  return counts;
}

/**
 * Validate one overlay's frontmatter against the schema invariants. Returns
 * an array of error strings; empty array means valid.
 */
export function validateFlavor(filePath) {
  const errors = [];
  if (!fs.existsSync(filePath)) return [`file not found: ${filePath}`];
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) return [`${filePath}: missing or unparseable frontmatter`];

  if (!fm.role || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/.test(fm.role)) {
    errors.push(`${filePath}: invalid role "${fm.role}"`);
  }
  if (!Array.isArray(fm.applies_to) || fm.applies_to.length === 0) {
    errors.push(`${filePath}: applies_to must be a non-empty array`);
  }
  if (!Array.isArray(fm.profiles) || fm.profiles.length === 0) {
    errors.push(`${filePath}: profiles must be a non-empty array; add a frontmatter line like \`profiles: [rnd]\``);
  }
  return errors;
}
