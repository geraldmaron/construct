/**
 * lib/validator.mjs — Schema and contract validation for Construct data structures.
 *
 * Validates workflow state objects, task packets, agent registry entries, and
 * MCP tool payloads against expected shapes. Throws structured errors with
 * field-level detail. Used by workflow-state, cli-commands, and MCP tools
 * before mutating persistent state.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const VALID_TIERS = new Set(['reasoning', 'standard', 'fast']);
const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

function hasProviderModelShape(value) {
  return typeof value === 'string' && /^[^\s/]+\/\S+$/.test(value);
}

function validateStringArray(errors, value, label, validValues = null) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${label}: must be an array`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'string') {
      errors.push(`${label}[${index}]: must be a non-empty string`);
      continue;
    }
    if (validValues && !validValues.has(item)) {
      errors.push(`${label}[${index}]: unknown reference '${item}'`);
    }
  }
}

export function validateRegistry(reg, options = {}) {
  const errors = [];
  const rootDir = options.rootDir ?? join(__dirname, '..');

  if (!reg.version && reg.version !== 0) errors.push('registry: version is missing');
  if (!reg.system) errors.push('registry: system is missing');
  if (!reg.prefix) errors.push('registry: prefix is missing');

  if (!Array.isArray(reg.agents) || reg.agents.length === 0) {
    errors.push('registry: agents must be a non-empty array');
  }
  if (!Array.isArray(reg.personas) || reg.personas.length === 0) {
    errors.push('registry: personas must be a non-empty array');
  }

  const agents = Array.isArray(reg.agents) ? reg.agents : [];
  const personas = Array.isArray(reg.personas) ? reg.personas : [];

  const allIds = new Set();
  const agentNames = new Set(agents.map((agent) => agent?.name).filter(Boolean));

  function validateIdentity(entry, kind) {
    const n = entry.name;
    if (!n || typeof n !== 'string') {
      errors.push(`${kind}: name must be a non-empty string`);
      return '(unnamed)';
    }
    if (allIds.has(n)) errors.push(`${n}: duplicate id across agents/personas`);
    allIds.add(n);
    if (!/^[a-z][a-z0-9-]*$/.test(n)) {
      errors.push(`${n}: id must be lowercase kebab-case`);
    }
    return n;
  }

  for (const agent of agents) {
    const label = validateIdentity(agent, 'agent');

    if (!agent.description || typeof agent.description !== 'string') {
      errors.push(`${label}: description must be a non-empty string`);
    }
    if (agent.prompt !== undefined && typeof agent.prompt !== 'string') {
      errors.push(`${label}: prompt must be a string when present`);
    }
    if (agent.promptFile !== undefined && typeof agent.promptFile !== 'string') {
      errors.push(`${label}: promptFile must be a string when present`);
    }
    if (!agent.prompt && !agent.promptFile) {
      errors.push(`${label}: must define prompt or promptFile`);
    } else if (agent.promptFile && !existsSync(join(rootDir, agent.promptFile))) {
      errors.push(`${label}: promptFile does not exist (${agent.promptFile})`);
    }
    if (!agent.model && !agent.modelTier) {
      errors.push(`${label}: must define model or modelTier`);
    }
    if (agent.modelTier && !VALID_TIERS.has(agent.modelTier)) {
      errors.push(`${label}: modelTier must be reasoning|standard|fast, got '${agent.modelTier}'`);
    }
    if (agent.model && !hasProviderModelShape(agent.model)) {
      errors.push(`${label}: model must be provider/model-id format`);
    }
    if (agent.reasoningEffort && !VALID_REASONING_EFFORTS.has(agent.reasoningEffort)) {
      errors.push(`${label}: reasoningEffort must be low|medium|high|xhigh`);
    }
    if ('claudeTools' in agent && (!agent.claudeTools || typeof agent.claudeTools !== 'string')) {
      errors.push(`${label}: claudeTools must be a non-empty string when present`);
    }
    validateStringArray(errors, agent.chain, `${label}.chain`, agentNames);
    validateStringArray(errors, agent.alsoInvokes, `${label}.alsoInvokes`, agentNames);
  }

  for (const persona of personas) {
    const label = validateIdentity(persona, 'persona');

    if (!persona.description || typeof persona.description !== 'string') {
      errors.push(`${label}: description must be a non-empty string`);
    }
    if (!persona.role || typeof persona.role !== 'string') {
      errors.push(`${label}: role must be a non-empty string`);
    }
    if (!persona.promptFile || typeof persona.promptFile !== 'string') {
      errors.push(`${label}: promptFile must be a non-empty string`);
    } else if (!existsSync(join(rootDir, persona.promptFile))) {
      errors.push(`${label}: promptFile does not exist (${persona.promptFile})`);
    }
    if (!persona.model && !persona.modelTier) {
      errors.push(`${label}: must define model or modelTier`);
    }
    if (persona.modelTier && !VALID_TIERS.has(persona.modelTier)) {
      errors.push(`${label}: modelTier must be reasoning|standard|fast, got '${persona.modelTier}'`);
    }
    if (persona.model && !hasProviderModelShape(persona.model)) {
      errors.push(`${label}: model must be provider/model-id format`);
    }
    if (persona.reasoningEffort && !VALID_REASONING_EFFORTS.has(persona.reasoningEffort)) {
      errors.push(`${label}: reasoningEffort must be low|medium|high|xhigh`);
    }
    validateStringArray(errors, persona.chain, `${label}.chain`, agentNames);
    validateStringArray(errors, persona.alsoInvokes, `${label}.alsoInvokes`, agentNames);
  }

  if (!reg.models || typeof reg.models !== 'object') {
    errors.push('registry: models is missing');
  } else {
    for (const tier of ['reasoning', 'standard', 'fast']) {
      const t = reg.models[tier];
      if (!t || typeof t !== 'object') {
        errors.push(`models.${tier}: tier object is missing`);
        continue;
      }
      if (!hasProviderModelShape(t.primary)) {
        errors.push(`models.${tier}: primary must be a string in provider/model-id format`);
      }
      if (!Array.isArray(t.fallback)) {
        errors.push(`models.${tier}: fallback must be an array`);
      } else {
        const tierModels = new Set([t.primary]);
        t.fallback.forEach((entry, i) => {
          if (!hasProviderModelShape(entry)) {
            errors.push(`models.${tier}.fallback[${i}]: must be a string in provider/model-id format`);
          }
          if (tierModels.has(entry)) {
            errors.push(`models.${tier}.fallback[${i}]: duplicate model '${entry}'`);
          }
          tierModels.add(entry);
        });
      }
    }
  }

  const summary = `${personas.length} personas, ${agents.length} agents`;
  return { valid: errors.length === 0, errors, summary };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reg = JSON.parse(readFileSync(join(__dirname, '..', 'agents', 'registry.json'), 'utf8'));
  const result = validateRegistry(reg);
  if (result.valid) {
    console.log(`✓ Registry valid (${result.summary})`);
    process.exit(0);
  } else {
    console.error('Registry validation failed:');
    result.errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
}
