/**
 * lib/audit-skills.mjs — Audit agent↔skill bindings for orphans and missing files.
 *
 * Reports: (a) skills with no agent owner, (b) agents with no skill bindings,
 * (c) skill paths declared in registry but missing on disk.
 * Called by 'construct audit skills' and incorporated into 'construct doctor'.
 */
import fs from 'node:fs';
import path from 'node:path';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'agents', 'registry.json'))) return current;
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

export function auditSkills({ rootDir, silent = false } = {}) {
  const root = rootDir ?? findConstructRoot();
  const registryPath = path.join(root, 'agents', 'registry.json');
  const skillsDir = path.join(root, 'skills');

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const allSkillFiles = collectSkillFiles(skillsDir);

  const declaredSkills = new Set();
  const agentsWithNoSkills = [];
  const missingSkillFiles = [];

  for (const agent of registry.agents ?? []) {
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

  const orphanSkills = [...allSkillFiles].filter((s) => !declaredSkills.has(s));

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
  const result = auditSkills({ rootDir });
  if (!result.pass) process.exit(1);
}
