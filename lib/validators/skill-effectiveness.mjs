/**
 * lib/validators/skill-effectiveness.mjs — Content-depth validation beyond structure.
 *
 * Checks role failure modes, workflow chains, domain boundaries, and resolvable
 * skill references for scope lint and release-gate enforcement.
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadRegistry } from '../registry/loader.mjs';
import { artifactTypes } from '../artifact-manifest.mjs';

const GET_SKILL_RE = /get_skill\("([^"]+)"\)/g;
const WORKER_PROFILE_REF_RE = /\bworker-profile:([a-z][a-z0-9.-]*)\b/g;

function walkSkills(skillsDir, prefix = '') {
  const out = [];
  if (!fs.existsSync(skillsDir)) return out;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(skillsDir, entry.name);
    if (entry.isDirectory()) out.push(...walkSkills(full, rel));
    else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
      out.push({ rel: rel.replace(/\.md$/, ''), full });
    }
  }
  return out;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw.startsWith('[')) {
      try { meta[key] = JSON.parse(raw); } catch { meta[key] = raw; }
    } else {
      meta[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: content.slice(m[0].length) };
}

function isRoleSkill(rel) {
  return rel.startsWith('perspectives/');
}

function isWorkflowSkill(rel) {
  return rel.startsWith('docs/') && rel.endsWith('-workflow');
}

function isDomainSkill(rel) {
  return !isRoleSkill(rel) && !isWorkflowSkill(rel) && rel !== 'routing';
}

function validateRoleDepth(rel, body, errors) {
  const numberedH3 = (body.match(/^###\s+\d+\./gm) || []).length;
  const numberedList = (body.match(/^\d+\.\s+\*\*/gm) || []).length;
  if (numberedH3 + numberedList < 3) {
    errors.push(`${rel}: role overlay needs ≥3 numbered failure-mode sections (### N. or 1. **Title**)`);
  }
  const hasSymptom = /\*\*Symptom\*\*:|Symptom:/i.test(body);
  const hasCounter = /\*\*Counter-move\*\*:|Counter-move:|Counter:/i.test(body);
  if (!hasSymptom || !hasCounter) {
    errors.push(`${rel}: role overlay missing Symptom/Counter-move pattern`);
  }
  const isBase = !rel.includes('.') && !/^roles\/[^/]+\.[^/]+$/.test(rel);
  if (isBase && !/## Self-check|## Methodology|## Ship Check/i.test(body)) {
    errors.push(`${rel}: base role file should include Self-check or Methodology section`);
  }
}

function countWorkflowSteps(body) {
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let count = 0;
  for (const line of lines) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    if (inFence) continue;
    if (/^\d+\.\s+/.test(line)) count++;
  }
  return count;
}

function validateWorkflowDepth(rel, meta, body, errors) {
  if (!meta.verificationBar || String(meta.verificationBar).length < 40) {
    errors.push(`${rel}: workflow missing verificationBar (≥40 chars)`);
  }
  if (!meta.artifactType) {
    errors.push(`${rel}: workflow missing artifactType`);
  }
  if (!/construct artifact validate/i.test(body)) {
    errors.push(`${rel}: workflow must mention construct artifact validate`);
  }
  if (countWorkflowSteps(body) < 4) {
    errors.push(`${rel}: workflow needs ≥4 numbered steps`);
  }
}

function validateDomainDepth(rel, body, meta, errors) {
  const stripped = body.replace(/^---[\s\S]*?---/, '').trim();
  if (stripped.length < 400) {
    errors.push(`${rel}: domain skill body too short (<400 chars)`);
  }
  const desc = String(meta.description || '');
  const boundary =
    /when not to use|when to use|do not use|use this skill when|use this skill to|use when:/i.test(body) ||
    /use when|use this skill when|use this skill to|do not use/i.test(desc);
  if (!boundary) {
    errors.push(`${rel}: domain skill missing boundary section (When not to use / When to use)`);
  }
}

function validateReferences(rel, body, skillsSet, registry, errors) {
  for (const m of body.matchAll(GET_SKILL_RE)) {
    const id = m[1];
    if (!skillsSet.has(id)) {
      errors.push(`${rel}: unresolved get_skill("${id}")`);
    }
  }
  if (isWorkflowSkill(rel)) {
    for (const match of body.matchAll(WORKER_PROFILE_REF_RE)) {
      const id = match[1];
      if (!registry.workerProfiles?.[id]) errors.push(`${rel}: unknown worker profile ${id}`);
    }
    const types = artifactTypes();
    for (const m of body.matchAll(/`([a-z][a-z0-9-]*)`/g)) {
      const t = m[1];
      if (t.startsWith('prd') || t === 'rfc' || t === 'adr' || t === 'memo') {
        if (!types.includes(t) && !types.includes(t.replace(/-platform$/, ''))) {
          /* template ids vary — only warn on explicit get_template */
        }
      }
    }
  }
}

export function validateSkillEffectiveness({ rootDir } = {}) {
  const root = rootDir || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const skillsDir = path.join(root, 'skills');
  const errors = [];
  const warnings = [];
  const files = walkSkills(skillsDir);
  const skillsSet = new Set(files.map((f) => f.rel));
  let registry;
  try {
    registry = loadRegistry({ rootDir: root });
  } catch {
    registry = { workerProfiles: {} };
  }

  for (const { rel, full } of files) {
    const raw = fs.readFileSync(full, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    if (isRoleSkill(rel) && meta.role?.includes('.')) {
      validateRoleDepth(rel, body, errors);
    } else if (isRoleSkill(rel)) {
      if (body.length > 200) validateRoleDepth(rel, body, errors);
    } else if (isWorkflowSkill(rel)) {
      validateWorkflowDepth(rel, meta, body, errors);
    } else if (isDomainSkill(rel)) {
      validateDomainDepth(rel, body, meta, errors);
    }
    validateReferences(rel, body, skillsSet, registry, errors);
  }

  return { valid: errors.length === 0, errors, warnings, checked: files.length };
}
