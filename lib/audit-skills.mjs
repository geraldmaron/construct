/**
 * lib/audit-skills.mjs — Audit agent↔skill bindings for orphans and missing files.
 *
 * Reports: (a) skills with no agent owner, (b) agents with no skill bindings,
 * (c) skill paths declared in registry but missing on disk.
 * Called by 'construct audit skills' and incorporated into 'construct doctor'.
 *
 * A `roles/<base>[.<flavor>]` skill is owned when `<base>` is a specialist OR a role
 * named in any profile (profiles/*.json) — a role skill loads when its specialist or
 * profile role runs, even without a direct registry `skills:` binding. Counting only
 * registry bindings over-reported orphans (it missed profile roles like `operator`
 * from operations.json and conditional specialist flavors); see bead construct-ksfa.
 */
import fs from 'node:fs';
import path from 'node:path';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'specialists', 'registry.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function collectSkillFiles(skillsDir) {
  const results = new Set();
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
        const rel = prefix ? `${prefix}/${entry.name.replace(/\.md$/, '')}` : entry.name.replace(/\.md$/, '');
        results.add(rel);
      }
    }
  }
  try { walk(skillsDir); } catch { /* skills dir missing */ }
  return results;
}

// Collect every role name a profile declares — top-level `roles` and nested
// `departments[].roles` — so a role skill counts as owned when a profile uses its
// base even if no specialist declares the skill path directly.
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
      try { scan(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* skip malformed */ }
    }
  } catch { /* no profiles dir */ }
  return roles;
}

// The base of a role skill: roles/architect.data → architect; roles/qa → qa.
function roleBase(skill) {
  const m = skill.match(/^roles\/([^.]+)(?:\..*)?$/);
  return m ? m[1] : null;
}

export function auditSkills({ rootDir, silent = false } = {}) {
  const root = rootDir ?? findConstructRoot();
  const registryPath = path.join(root, 'specialists', 'registry.json');
  const skillsDir = path.join(root, 'skills');

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const allSkillFiles = collectSkillFiles(skillsDir);

  const declaredSkills = new Set();
  const agentsWithNoSkills = [];
  const missingSkillFiles = [];

  for (const agent of registry.specialists ?? []) {
    const skills = agent.skills ?? [];
    if (skills.length === 0) {
      agentsWithNoSkills.push(agent.name);
    }
    for (const skill of skills) {
      declaredSkills.add(skill);
      if (!allSkillFiles.has(skill)) {
        missingSkillFiles.push({ agent: agent.name, skill });
      }
    }
  }

  // Owning role bases = specialist names (registry) ∪ profile role names. A role
  // skill is owned when its base is in this set, even without a direct binding.
  const ownerBases = new Set([
    ...(registry.specialists ?? []).map((a) => a.name.replace(/^cx-/, '')),
    ...collectProfileRoles(root),
  ]);
  const isOwned = (s) => declaredSkills.has(s) || (ownerBases.has(roleBase(s)));

  const orphanSkills = [...allSkillFiles].filter((s) => !isOwned(s));

  const issues = [];
  if (agentsWithNoSkills.length > 0) issues.push({ kind: 'agents-no-skills', items: agentsWithNoSkills });
  if (orphanSkills.length > 0) issues.push({ kind: 'orphan-skills', items: orphanSkills });
  if (missingSkillFiles.length > 0) issues.push({ kind: 'missing-skill-files', items: missingSkillFiles });

  if (!silent) {
    const line = (msg) => process.stdout.write(`${msg}\n`);
    line('Construct Skill Audit');
    line('═════════════════════');
    line('');

    if (agentsWithNoSkills.length === 0) {
      line('  ✓ All agents have at least one skill binding');
    } else {
      line(`  ⚠ Agents with no skill bindings (${agentsWithNoSkills.length}):`);
      for (const n of agentsWithNoSkills) line(`      - cx-${n}`);
    }
    line('');

    if (orphanSkills.length === 0) {
      line('  ✓ All skills have at least one agent owner');
    } else {
      line(`  ⚠ Skills with no agent owner (${orphanSkills.length}):`);
      for (const s of orphanSkills) line(`      - skills/${s}.md`);
    }
    line('');

    if (missingSkillFiles.length === 0) {
      line('  ✓ All declared skill paths exist on disk');
    } else {
      line(`  ✗ Declared skills missing on disk (${missingSkillFiles.length}):`);
      for (const { agent, skill } of missingSkillFiles) line(`      - cx-${agent} → skills/${skill}.md`);
    }
    line('');

    const hasErrors = missingSkillFiles.length > 0;
    const hasWarnings = agentsWithNoSkills.length > 0 || orphanSkills.length > 0;
    if (hasErrors) line('  Result: FAIL — fix missing skill files before syncing');
    else if (hasWarnings) line('  Result: WARN — bindings incomplete but system is functional');
    else line('  Result: PASS');
  }

  return {
    agentsWithNoSkills,
    orphanSkills,
    missingSkillFiles,
    pass: missingSkillFiles.length === 0,
  };
}

export async function runAuditSkillsCli(args = []) {
  const rootDir = args.find((a) => a.startsWith('--root='))?.split('=')[1] ?? undefined;
  if (args.includes('--inventory')) {
    const { runSkillInventoryAuditCli } = await import('./certification/skill-inventory.mjs');
    return runSkillInventoryAuditCli(args.filter((a) => a !== '--inventory'), { rootDir });
  }
  const result = auditSkills({ rootDir });
  if (!result.pass) process.exit(1);
}
