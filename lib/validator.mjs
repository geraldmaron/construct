/**
 * lib/validator.mjs — Schema and contract validation for Construct data structures.
 *
 * Validates workflow state objects, task packets, agent registry entries, and
 * MCP tool payloads against expected shapes. Throws structured errors with
 * field-level detail. Backs workflow-state, cli-commands, and MCP tools
 * before they mutate persistent state.
 */
import { loadRegistry } from './registry/loader.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const VALID_TIERS = new Set(['reasoning', 'standard', 'fast']);
const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

const PROMPT_HARD_CAP_WORDS = 4000;
const DESCRIPTION_MAX_CHARS = 240;
const DISPLAY_NAME_MAX_CHARS = 60;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function loadPromptContent(rootDir, relPath) {
  if (!relPath) return null;
  try {
    return readFileSync(join(rootDir, relPath), 'utf8');
  } catch {
    return null;
  }
}

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

  // Handle unified registry format (v2) - convert specialists from object to array
  // and extract orchestrator from specialists
  let registry = reg;
  if (reg.version === 2 && typeof reg.specialists === 'object' && !Array.isArray(reg.specialists)) {
    const orchestrator = Object.values(reg.specialists || {}).find(s => s.role === 'orchestrator');
    const otherSpecialists = Object.values(reg.specialists || {}).filter(s => s.role !== 'orchestrator');
    registry = {
      version: 1,
      system: 'construct',
      prefix: 'cx',
      orchestrator: orchestrator ? {
        name: orchestrator.name,
        displayName: orchestrator.displayName || orchestrator.description?.split('—')[0].trim(),
        description: orchestrator.description || '',
        promptFile: orchestrator.promptFile,
        modelTier: orchestrator.modelTier || 'standard',
        skills: orchestrator.skills || [],
      } : null,
      specialists: otherSpecialists.map(s => ({
        name: s.name,
        displayName: s.displayName || s.description?.split('—')[0].trim(),
        description: s.description || '',
        promptFile: s.promptFile,
        modelTier: s.modelTier || 'standard',
        skills: s.skills || [],
        team: s.team,
        role: s.role,
        docArtifacts: s.docArtifacts || [],
        subscriptions: s.events || [],
        watchConditions: s.watchConditions || [],
        fence: s.fence || {},
      })),
      mcpServers: reg.mcpServers || {},
    };
  }

  if (!registry.version && registry.version !== 0) errors.push('registry: version is missing');
  if (!registry.system) errors.push('registry: system is missing');
  if (!registry.prefix) errors.push('registry: prefix is missing');

  if (!Array.isArray(registry.specialists) || registry.specialists.length === 0) {
    errors.push('registry: specialists must be a non-empty array');
  }
  if (!registry.orchestrator || typeof registry.orchestrator !== 'object') {
    errors.push('registry: orchestrator must be a non-empty object');
  }

  const specialists = Array.isArray(registry.specialists) ? registry.specialists : [];
  const orchestrator = registry.orchestrator && typeof registry.orchestrator === 'object' ? registry.orchestrator : null;

  const allIds = new Set();
  const specialistNames = new Set(specialists.map((s) => s?.name).filter(Boolean));

  function validateIdentity(entry, kind) {
    const n = entry.name;
    if (!n || typeof n !== 'string') {
      errors.push(`${kind}: name must be a non-empty string`);
      return '(unnamed)';
    }
    if (allIds.has(n)) errors.push(`${n}: duplicate id across specialists/orchestrator`);
    allIds.add(n);
    if (!/^[a-z][a-z0-9-]*$/.test(n)) {
      errors.push(`${n}: id must be lowercase kebab-case`);
    }
    return n;
  }

  for (const specialist of specialists) {
    const label = validateIdentity(specialist, 'specialist');

    if (!specialist.description || typeof specialist.description !== 'string') {
      errors.push(`${label}: description must be a non-empty string`);
    } else if (specialist.description.length > DESCRIPTION_MAX_CHARS) {
      errors.push(`${label}: description exceeds ${DESCRIPTION_MAX_CHARS} chars (got ${specialist.description.length})`);
    }
    if (specialist.prompt !== undefined && typeof specialist.prompt !== 'string') {
      errors.push(`${label}: prompt must be a string when present`);
    }
    if (specialist.promptFile !== undefined && typeof specialist.promptFile !== 'string') {
      errors.push(`${label}: promptFile must be a string when present`);
    }
    if (!specialist.prompt && !specialist.promptFile) {
      errors.push(`${label}: must define prompt or promptFile`);
    } else if (specialist.promptFile && !existsSync(join(rootDir, specialist.promptFile))) {
      errors.push(`${label}: promptFile does not exist (${specialist.promptFile})`);
    }
    const promptText = typeof specialist.prompt === 'string'
      ? specialist.prompt
      : loadPromptContent(rootDir, specialist.promptFile);
    if (promptText) {
      const cap = Number.isInteger(specialist.wordCapOverride) && specialist.wordCapOverride > 0
        ? specialist.wordCapOverride
        : PROMPT_HARD_CAP_WORDS;
      const words = wordCount(promptText);
      if (words > cap) {
        errors.push(`${label}: prompt is ${words} words, exceeds cap of ${cap} (set wordCapOverride if intentional)`);
      }
    }
    if (!specialist.model && !specialist.modelTier) {
      errors.push(`${label}: must define model or modelTier`);
    }
    if (specialist.modelTier && !VALID_TIERS.has(specialist.modelTier)) {
      errors.push(`${label}: modelTier must be reasoning|standard|fast, got '${specialist.modelTier}'`);
    }
    if (specialist.model && !hasProviderModelShape(specialist.model)) {
      errors.push(`${label}: model must be provider/model-id format`);
    }
    if (specialist.reasoningEffort && !VALID_REASONING_EFFORTS.has(specialist.reasoningEffort)) {
      errors.push(`${label}: reasoningEffort must be low|medium|high|xhigh`);
    }
    if ('claudeTools' in specialist && (!specialist.claudeTools || typeof specialist.claudeTools !== 'string')) {
      errors.push(`${label}: claudeTools must be a non-empty string when present`);
    }
    validateStringArray(errors, specialist.chain, `${label}.chain`, specialistNames);
    validateStringArray(errors, specialist.alsoInvokes, `${label}.alsoInvokes`, specialistNames);
  }

  if (orchestrator) {
    const label = validateIdentity(orchestrator, 'orchestrator');

    if (!orchestrator.description || typeof orchestrator.description !== 'string') {
      errors.push(`${label}: description must be a non-empty string`);
    } else if (orchestrator.description.length > DESCRIPTION_MAX_CHARS) {
      errors.push(`${label}: description exceeds ${DESCRIPTION_MAX_CHARS} chars (got ${orchestrator.description.length})`);
    }
    if (orchestrator.displayName && orchestrator.displayName.length > DISPLAY_NAME_MAX_CHARS) {
      errors.push(`${label}: displayName exceeds ${DISPLAY_NAME_MAX_CHARS} chars (got ${orchestrator.displayName.length})`);
    }
    if (!orchestrator.role || typeof orchestrator.role !== 'string') {
      errors.push(`${label}: role must be a non-empty string`);
    }
    if (!orchestrator.promptFile || typeof orchestrator.promptFile !== 'string') {
      errors.push(`${label}: promptFile must be a non-empty string`);
    } else if (!existsSync(join(rootDir, orchestrator.promptFile))) {
      errors.push(`${label}: promptFile does not exist (${orchestrator.promptFile})`);
    }
    const oPromptText = loadPromptContent(rootDir, orchestrator.promptFile);
    if (oPromptText) {
      const cap = Number.isInteger(orchestrator.wordCapOverride) && orchestrator.wordCapOverride > 0
        ? orchestrator.wordCapOverride
        : PROMPT_HARD_CAP_WORDS;
      const words = wordCount(oPromptText);
      if (words > cap) {
        errors.push(`${label}: prompt is ${words} words, exceeds cap of ${cap} (set wordCapOverride if intentional)`);
      }
    }
    if (!orchestrator.model && !orchestrator.modelTier) {
      errors.push(`${label}: must define model or modelTier`);
    }
    if (orchestrator.modelTier && !VALID_TIERS.has(orchestrator.modelTier)) {
      errors.push(`${label}: modelTier must be reasoning|standard|fast, got '${orchestrator.modelTier}'`);
    }
    if (orchestrator.model && !hasProviderModelShape(orchestrator.model)) {
      errors.push(`${label}: model must be provider/model-id format`);
    }
    if (orchestrator.reasoningEffort && !VALID_REASONING_EFFORTS.has(orchestrator.reasoningEffort)) {
      errors.push(`${label}: reasoningEffort must be low|medium|high|xhigh`);
    }
    validateStringArray(errors, orchestrator.chain, `${label}.chain`, specialistNames);
    validateStringArray(errors, orchestrator.alsoInvokes, `${label}.alsoInvokes`, specialistNames);
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

  const specialistCount = specialists.length;
  const summary = `1 orchestrator, ${specialistCount} specialists`;
  return { valid: errors.length === 0, errors, summary };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reg = loadRegistry();
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
