/**
 * lib/mcp/tools/skills.mjs — Skills, templates, agent contracts, orchestration policy, and team tools.
 *
 * Exposes listSkills, getSkill, searchSkills, getTemplate, listTemplates, agentContract,
 * orchestrationPolicy, listTeams, and getTeam. All synchronous except agentContract (dynamic import).
 * Requires ROOT_DIR injected via the opts argument on each call.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { routeRequest, requiresExecutiveApproval, TERMINAL_STATES } from '../../orchestration-policy.mjs';
import { buildTaskPacketFromIntent } from '../../workflow-state.mjs';

export function listSkills({ ROOT_DIR }) {
  const skillsDir = join(ROOT_DIR, 'skills');
  if (!existsSync(skillsDir)) return { error: 'Skills directory not found.' };

  const listDirRecursive = (dir, prefix = '') => {
    let results = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        results = results.concat(listDirRecursive(join(dir, entry.name), `${prefix}${entry.name}/`));
      } else if (entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
        results.push(`${prefix}${entry.name.replace('.md', '')}`);
      }
    }
    return results;
  };

  const skills = listDirRecursive(skillsDir).sort();
  return { skills };
}

export function getSkill(args, { ROOT_DIR }) {
  const { path: skillPath } = args;
  if (!skillPath) return { error: 'Missing path argument' };

  const fullPath = join(ROOT_DIR, 'skills', `${skillPath}.md`);

  if (!existsSync(fullPath)) {
    return { error: `Skill not found: ${skillPath}` };
  }
  const content = readFileSync(fullPath, 'utf8');
  return { content };
}

export function searchSkills(args, { ROOT_DIR }) {
  const { pattern } = args;
  if (!pattern) return { error: 'Missing pattern argument' };
  const skillsDir = join(ROOT_DIR, 'skills');

  try {
    const output = execSync(`rg -i "${pattern.replace(/"/g, '\\"')}" "${skillsDir}"`, { encoding: 'utf8' });
    return { results: output.split('\n').filter(Boolean) };
  } catch {
    try {
      const output = execSync(`grep -ri "${pattern.replace(/"/g, '\\"')}" "${skillsDir}"`, { encoding: 'utf8' });
      return { results: output.split('\n').filter(Boolean) };
    } catch {
      return { results: [], note: 'No matches found or grep error' };
    }
  }
}

function listTemplatesRaw({ ROOT_DIR }) {
  const shipped = [];
  const override = [];
  const shippedDir = join(ROOT_DIR, 'templates', 'docs');
  if (existsSync(shippedDir)) {
    for (const f of readdirSync(shippedDir)) {
      if (f.endsWith('.md')) shipped.push(f.replace(/\.md$/, ''));
    }
  }
  const overrideDir = join(process.cwd(), '.cx', 'templates', 'docs');
  if (existsSync(overrideDir)) {
    for (const f of readdirSync(overrideDir)) {
      if (f.endsWith('.md')) override.push(f.replace(/\.md$/, ''));
    }
  }
  return { shipped: shipped.sort(), overridden: override.sort() };
}

export function getTemplate(args, { ROOT_DIR }) {
  const { name } = args;
  if (!name) return { error: 'Missing name argument' };
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return { error: 'Invalid template name' };

  const cwd = process.cwd();
  const candidates = [
    { source: 'project-override', path: join(cwd, '.cx', 'templates', 'docs', `${safe}.md`) },
    { source: 'shipped-default', path: join(ROOT_DIR, 'templates', 'docs', `${safe}.md`) },
  ];
  for (const { source, path: p } of candidates) {
    if (existsSync(p)) {
      return { source, path: p, content: readFileSync(p, 'utf8') };
    }
  }
  return { error: `Template not found: ${safe}`, available: listTemplatesRaw({ ROOT_DIR }) };
}

export function listTemplates({ ROOT_DIR }) {
  return listTemplatesRaw({ ROOT_DIR });
}

export async function agentContract(args = {}) {
  const {
    getAllContracts,
    getContractById,
    getContract,
    getOutgoingContracts,
    getIncomingContracts,
    summarize,
  } = await import('../../agent-contracts.mjs');
  const { id, producer, consumer } = args;
  if (id) {
    const match = getContractById(String(id));
    return match ? { contract: match } : { error: `Contract not found: ${id}` };
  }
  if (producer && consumer) {
    const match = getContract(String(producer), String(consumer));
    return match ? { contract: match } : { error: `No contract for ${producer} → ${consumer}` };
  }
  if (producer) return { producer: String(producer), contracts: getOutgoingContracts(String(producer)) };
  if (consumer) return { consumer: String(consumer), contracts: getIncomingContracts(String(consumer)) };
  return { summary: summarize(), contracts: getAllContracts() };
}

export function orchestrationPolicy(args) {
  const route = routeRequest(args || {});
  const approvalRequired = requiresExecutiveApproval(args?.approval || {});
  const draftTask = route.track !== 'immediate'
    ? buildTaskPacketFromIntent(args?.request || '', { fileCount: args?.fileCount, moduleCount: args?.moduleCount })
    : null;
  return {
    ...route,
    approvalRequired,
    terminalStates: TERMINAL_STATES,
    draftTask,
  };
}

export function listTeams({ ROOT_DIR }) {
  const teamsPath = join(ROOT_DIR, 'agents', 'teams.json');
  if (!existsSync(teamsPath)) return { error: 'agents/teams.json not found' };
  const { templates } = JSON.parse(readFileSync(teamsPath, 'utf8'));
  return {
    teams: Object.entries(templates).map(([name, t]) => ({
      name,
      description: t.description,
      members: t.members,
      focus: t.focus,
      skills: t.skills,
      promotionGates: t.promotionGates,
    })),
  };
}

export function getTeam(args, { ROOT_DIR }) {
  const { name } = args;
  if (!name) return { error: 'Missing name argument' };
  const teamsPath = join(ROOT_DIR, 'agents', 'teams.json');
  if (!existsSync(teamsPath)) return { error: 'agents/teams.json not found' };
  const { templates } = JSON.parse(readFileSync(teamsPath, 'utf8'));
  const team = templates[name];
  if (!team) return { error: `Team not found: ${name}`, available: Object.keys(templates) };
  return { name, ...team };
}
