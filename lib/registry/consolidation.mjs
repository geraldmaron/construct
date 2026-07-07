/**
 * lib/registry/consolidation.mjs — bound-orphan triage for skill consolidation proposals.
 *
 * A bound-orphan is a skill file not declared in any specialist's `skills:` array.
 * Profile/composer reachability is classified separately — nothing is deleted here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from '../registry/loader.mjs';
import { bindingForSpecialist } from '../roles/flavor-bindings.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

function collectSkillFiles(skillsDir) {
  const results = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, prefix ? `${prefix}/${entry.name}` : entry.name);
      else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
        results.push(prefix ? `${prefix}/${entry.name.replace(/\.md$/, '')}` : entry.name.replace(/\.md$/, ''));
      }
    }
  }
  walk(skillsDir);
  return results;
}

function roleBase(skill) {
  const m = skill.match(/^roles\/([^.]+)(?:\..*)?$/);
  return m ? m[1] : null;
}

function collectProfileRoles(root) {
  const dir = path.join(root, 'profiles');
  const roles = new Set();
  const scan = (node) => {
    if (Array.isArray(node)) { node.forEach(scan); return; }
    if (node && typeof node === 'object') {
      if (Array.isArray(node.roles)) for (const r of node.roles) if (typeof r === 'string') roles.add(r);
      for (const v of Object.values(node)) scan(v);
    }
  };
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try { scan(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* skip */ }
    }
  } catch { /* no profiles */ }
  return roles;
}

/**
 * Classify bound-orphans for maintainer approval (bind / merge / composer / review).
 */
export function triageBoundOrphans({ rootDir = REPO_ROOT } = {}) {
  const registry = loadRegistry({ rootDir });
  const declared = new Set();
  for (const s of Object.values(registry.specialists ?? {})) for (const sk of s.skills ?? []) declared.add(sk);

  const specialistNames = new Set(Object.values(registry.specialists ?? {}).map((s) => s.name));
  const profileRoles = collectProfileRoles(rootDir);
  const all = collectSkillFiles(path.join(rootDir, 'skills'));

  const items = [];
  for (const skill of all) {
    if (declared.has(skill)) continue;
    const base = roleBase(skill);
    let category = 'D-review';
    let recommendation = 'Manual review — not declared and no automatic owner signal';

    if (skill.startsWith('docs/') && skill.endsWith('-workflow')) {
      category = 'A-bind';
      recommendation = `Bind to owner specialist in registry.json (workflow skill)`;
    } else if (base && specialistNames.has(base)) {
      category = 'B-composer';
      recommendation = `Role flavor for cx-${base} — reachable via prompt-composer; document in registry or bind explicitly`;
    } else if (base && profileRoles.has(base)) {
      category = 'B-composer';
      recommendation = `Profile role "${base}" — may load via profile overlay; verify before merge`;
    } else if (base && bindingForSpecialist(base)?.specialistId) {
      // Base name doesn't match a specialist's own name, but
      // lib/roles/flavor-bindings.mjs still routes it onto a live anchor —
      // reachable via prompt-composer under that anchor's identity.
      category = 'B-composer';
      recommendation = `Role flavor bound to ${bindingForSpecialist(base).specialistId} via lib/roles/flavor-bindings.mjs — reachable via prompt-composer; document in registry or bind explicitly`;
    } else if (skill.startsWith('roles/')) {
      category = 'C-merge';
      recommendation = 'Consider merging into parent roles/<base>.md or binding to specialist';
    } else if (skill.startsWith('docs/')) {
      category = 'A-bind';
      recommendation = 'Bind to cx-operations or domain owner specialist';
    }

    items.push({ skill, category, recommendation });
  }

  const byCategory = Object.fromEntries(['A-bind', 'B-composer', 'C-merge', 'D-review'].map((c) => [c, []]));
  for (const item of items) byCategory[item.category].push(item);

  return {
    declaredCount: declared.size,
    fileCount: all.length,
    boundOrphanCount: items.length,
    composerReachableCount: items.filter((i) => i.category === 'B-composer').length,
    trueOrphanCount: items.filter((i) => i.category === 'D-review' || i.category === 'C-merge').length,
    aBindCount: items.filter((i) => i.category === 'A-bind').length,
    byCategory,
    items,
  };
}

export function formatConsolidationProposalMarkdown(triage, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const lines = [
    `# Skill Consolidation Proposal — ${date}`,
    '',
    'Gate: **nothing is deleted until the maintainer approves a list.**',
    '',
    `Reproduce: \`node -e "import('./lib/registry/consolidation.mjs').then(m => console.log(JSON.stringify(m.triageBoundOrphans(),null,2)))"\``,
    '',
    '## Summary',
    '',
    `- **${triage.fileCount}** skill files on disk`,
    `- **${triage.declaredCount}** declared in specialists/org`,
    `- **${triage.boundOrphanCount}** registry bound-orphans (not declared by any specialist)`,
    `- **${triage.composerReachableCount}** composer-reachable (B-composer — intentional via prompt composer)`,
    `- **${triage.trueOrphanCount}** true orphans (C-merge + D-review — need maintainer action)`,
    '',
    '## Categories',
    '',
    '| Category | Count | Action |',
    '|---|---:|---|',
    `| A-bind | ${triage.byCategory['A-bind'].length} | Wire to specialist in registry |`,
    `| B-composer | ${triage.byCategory['B-composer'].length} | Document composer reachability or bind |`,
    `| C-merge | ${triage.byCategory['C-merge'].length} | Propose merge into parent role skill |`,
    `| D-review | ${triage.byCategory['D-review'].length} | Manual review |`,
    '',
  ];

  for (const cat of ['A-bind', 'B-composer', 'C-merge', 'D-review']) {
    const rows = triage.byCategory[cat];
    if (!rows.length) continue;
    lines.push(`## ${cat} (${rows.length})`, '');
    for (const { skill, recommendation } of rows) {
      lines.push(`- \`skills/${skill}.md\` — ${recommendation}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
