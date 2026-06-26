/**
 * lib/specialists/schema.mjs — validation contract for specialists/org entries.
 *
 * Catches drift before it ships: missing description, unknown tool names,
 * promptFile pointing at a path that does not resolve, unrecognized
 * modelTier values. Run via `construct lint:agents` and in CI so a typo
 * in the registry can't silently disable an agent.
 */

import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FIELDS = ['name', 'description', 'promptFile'];

// Tool names that can appear in claudeTools. Anything outside this allowlist
// surfaces as an error; the host platform will silently drop unknown tool
// references and the agent will appear to "work" without the tool, which is
// the failure mode this lint catches.

export const ALLOWED_TOOLS = new Set([
  // Anthropic Claude Code built-ins
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'BashOutput',
  'WebSearch', 'WebFetch', 'TodoWrite', 'NotebookEdit', 'Task',
  // Construct MCP tools (from construct-mcp server)
  'list_skills', 'get_skill', 'search_skills',
  'list_teams', 'get_team',
  'list_templates', 'get_template',
  'agent_contract', 'orchestration_policy',
  'cx_trace', 'cx_score',
  // Memory MCP server
  'memory_search', 'memory_add_observations', 'memory_open_nodes',
  'memory_create_entities', 'memory_create_relations',
  // Other MCP servers Construct ships with
  'context7_resolve', 'context7_docs',
  'sequential_thinking',
  'playwright_navigate', 'playwright_screenshot',
  'github_search', 'github_get_pull_request',
]);

/**
 * Validate one agent record. Returns an array of error strings; empty means
 * the record passes.
 */
export function validateAgentRecord(record, { rootDir, registryKey } = {}) {
  const errors = [];
  const id = record?.name || `#${registryKey ?? '?'}`;

  if (!record || typeof record !== 'object') {
    return [`${id}: agent record must be an object`];
  }

  for (const field of REQUIRED_FIELDS) {
    if (!record[field]) errors.push(`${id}: missing required field "${field}"`);
  }

  if (record.description) {
    const desc = String(record.description).trim();
    if (desc.length < 20) errors.push(`${id}: description is too short (<20 chars) — the description is load-bearing for routing`);
    if (desc.length > 500) errors.push(`${id}: description is too long (>500 chars) — keep it scannable`);
  }

  if (record.when_to_use !== undefined && record.when_to_use !== null) {
    const wtu = String(record.when_to_use).trim();
    if (wtu.length < 20) errors.push(`${id}: when_to_use is too short (<20 chars) — should describe the trigger conditions`);
    if (wtu.length > 500) errors.push(`${id}: when_to_use is too long (>500 chars) — keep it scannable for routing`);
  }

  if (record.promptFile && rootDir) {
    const promptPath = path.join(rootDir, record.promptFile);
    if (!fs.existsSync(promptPath)) errors.push(`${id}: promptFile "${record.promptFile}" does not exist`);
  }

  if (record.claudeTools) {
    const tools = String(record.claudeTools).split(',').map((t) => t.trim()).filter(Boolean);
    for (const tool of tools) {
      if (!ALLOWED_TOOLS.has(tool)) {
        errors.push(`${id}: unknown tool "${tool}" in claudeTools — host platforms silently drop unknown tool names, causing this agent to appear to work without it`);
      }
    }
  }

  if (record.modelTier && !['fast', 'standard', 'reasoning'].includes(record.modelTier)) {
    errors.push(`${id}: modelTier must be one of fast | standard | reasoning (got "${record.modelTier}")`);
  }

  return errors;
}

/**
 * Validate every agent in a registry. Returns { errors: string[], agentCount }.
 */
export function validateRegistry(registry, { rootDir } = {}) {
  if (!registry) {
    return { errors: ['registry.specialists is missing or not an array'], agentCount: 0 };
  }
  const specialists = Array.isArray(registry.specialists)
    ? registry.specialists
    : Object.values(registry.specialists || {});
  const errors = [];
  const seenNames = new Set();
  for (let i = 0; i < specialists.length; i += 1) {
    const record = specialists[i];
    const recordErrors = validateAgentRecord(record, { rootDir, registryKey: i });
    errors.push(...recordErrors);
    if (record?.name) {
      if (seenNames.has(record.name)) errors.push(`${record.name}: duplicate agent name at registry index ${i}`);
      seenNames.add(record.name);
    }
  }
  return { errors, agentCount: specialists.length };
}

/**
 * Convenience: load registry.json from disk and validate it.
 */
export function validateRegistryFile({ registryPath, rootDir } = {}) {
  if (!fs.existsSync(registryPath)) {
    return { errors: [`registry not found at ${registryPath}`], agentCount: 0 };
  }
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (err) {
    return { errors: [`registry parse error: ${err.message}`], agentCount: 0 };
  }
  return validateRegistry(registry, { rootDir });
}
