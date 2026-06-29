/**
 * lib/skills/composition-graph.mjs — Skill routing and workflow composition audit.
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadRegistry } from '../registry/loader.mjs';
import { listScopes } from '../scopes/loader.mjs';

const GET_SKILL_RE = /get_skill\("([^"]+)"\)/g;

function walkSkills(skillsDir, prefix = '') {
  const out = new Set();
  if (!fs.existsSync(skillsDir)) return out;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(skillsDir, entry.name);
    if (entry.isDirectory()) {
      for (const s of walkSkills(full, rel)) out.add(s);
    } else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
      out.add(rel.replace(/\.md$/, ''));
    }
  }
  return out;
}

function collectRegistrySkills(registry) {
  const set = new Set();
  for (const agent of Object.values(registry.specialists || {})) {
    for (const s of agent.skills || []) set.add(s);
  }
  return set;
}

function collectRoutingTargets(root) {
  const set = new Set();
  const jsonPath = path.join(root, 'skills', 'routing.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      for (const route of data.routes || data || []) {
        const target = route.path || route.skill || route.skillId || route.target;
        if (target) set.add(target.replace(/^skills\//, ''));
      }
    } catch { /* skip */ }
  }
  return set;
}

function collectWorkflowRefs(root) {
  const set = new Set();
  const docsDir = path.join(root, 'skills', 'docs');
  if (!fs.existsSync(docsDir)) return set;
  for (const f of fs.readdirSync(docsDir)) {
    if (!f.endsWith('-workflow.md')) continue;
    const body = fs.readFileSync(path.join(docsDir, f), 'utf8');
    for (const m of body.matchAll(GET_SKILL_RE)) set.add(m[1]);
  }
  return set;
}

export function auditSkillComposition({ rootDir } = {}) {
  const root = rootDir || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const allOnDisk = walkSkills(path.join(root, 'skills'));
  const registry = loadRegistry({ rootDir: root });
  const entitled = collectRegistrySkills(registry);
  const routed = collectRoutingTargets(root);
  const workflowRefs = collectWorkflowRefs(root);

  const reachable = new Set([...entitled, ...routed, ...workflowRefs]);
  for (const id of entitled) {
    if (id.startsWith('roles/')) reachable.add(id);
  }

  const unreachable = [...allOnDisk].filter((id) => {
    if (id.startsWith('roles/')) return false;
    if (id.startsWith('brand/')) return false;
    return !reachable.has(id);
  });

  const blocking = [];
  for (const id of unreachable) {
    if (id.startsWith('docs/') && id.endsWith('-workflow')) continue;
    blocking.push(`unreachable skill: ${id} (not in registry, routing.json, or workflow chain)`);
  }

  return {
    pass: blocking.length === 0,
    blocking,
    stats: {
      onDisk: allOnDisk.size,
      entitled: entitled.size,
      routed: routed.size,
      workflowRefs: workflowRefs.size,
      unreachable: unreachable.length,
    },
  };
}
