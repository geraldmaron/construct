/**
 * lib/prompt-composer.mjs — Assemble the final agent prompt from core file, task packet, and context digest.
 *
 * Called by the orchestrator and MCP dispatch layer before invoking a specialist agent.
 * Inlines role anti-pattern guidance from skills/roles/ when a role directive is present in the prompt.
 * Injects learned patterns from the observation store so agents improve over sessions.
 * Produces a deterministic, cache-friendly prompt string with a stable token footprint.
 *
 * Fragment order: core → role-flavor → task-context → learned-patterns → task-packet → context-digest → host-constraints
 * learned-patterns is inserted before the task packet so agents see what has been learned before
 * reading the specific task they are about to execute.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { buildContextDigest, readContextState } from './context-state.mjs';
import { resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from './model-router.mjs';
import { searchObservations } from './observation-store.mjs';
import { routeRequest } from './orchestration-policy.mjs';
import { resolvePromptEntry, resolvePromptMetadata } from './prompt-metadata.mjs';
import { readRoleFile } from './role-preload.mjs';

// Max characters of learned-patterns text to inject per prompt — keeps token budget bounded.
const LEARNED_PATTERNS_CHAR_LIMIT = 800;
// Only inject observations with confidence at or above this threshold.
const MIN_CONFIDENCE = 0.7;
// Max observations to surface per agent invocation.
const MAX_OBSERVATIONS = 5;

/**
 * Query the observation store for patterns and anti-patterns relevant to this
 * agent+intent combination. Returns a formatted block ready for prompt injection,
 * or an empty string if nothing relevant is found.
 *
 * Reads from homedir() so it works regardless of project rootDir.
 * Silently returns '' on any error — observation injection must never break dispatch.
 */
function buildLearnedPatternsBlock(agentName, { intent = null, workCategory = null, project = null } = {}) {
  try {
    const rootDir = homedir();
    const query = [agentName, intent, workCategory].filter(Boolean).join(' ');
    const shortName = String(agentName).replace(/^cx-/, '');
    const results = searchObservations(rootDir, query, {
      limit: MAX_OBSERVATIONS * 2,
      project: project ?? null,
    });

    const relevant = results
      .filter((o) => (o.confidence ?? 0) >= MIN_CONFIDENCE)
      .filter((o) => ['pattern', 'anti-pattern', 'decision', 'insight'].includes(o.category))
      // Prefer observations scoped to this agent role
      .sort((a, b) => {
        const aMatch = a.role === agentName || a.role === shortName || a.role === 'construct' ? 0 : 1;
        const bMatch = b.role === agentName || b.role === shortName || b.role === 'construct' ? 0 : 1;
        return aMatch - bMatch;
      })
      .slice(0, MAX_OBSERVATIONS);

    if (!relevant.length) return '';

    const lines = ['## Learned patterns (from prior sessions)', ''];
    let chars = 0;
    for (const obs of relevant) {
      const prefix = obs.category === 'anti-pattern' ? '⚠ ' : obs.category === 'decision' ? '✓ ' : '• ';
      const line = `${prefix}${obs.summary}`;
      if (chars + line.length > LEARNED_PATTERNS_CHAR_LIMIT) break;
      lines.push(line);
      chars += line.length + 1;
    }
    lines.push('');
    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Maps agent short names to their flavor classifier key (from classifyRoleFlavors)
 * and the role file prefix used to locate the overlay in skills/roles/.
 * Only agents that receive a core-only role at sync time need dynamic flavors.
 */
const AGENT_FLAVOR_MAP = {
  architect: { classifierKey: 'architect', rolePrefix: 'architect' },
  'product-manager': { classifierKey: 'productManager', rolePrefix: 'product-manager' },
  qa: { classifierKey: 'qa', rolePrefix: 'qa' },
  security: { classifierKey: 'security', rolePrefix: 'security' },
  'data-analyst': { classifierKey: 'dataAnalyst', rolePrefix: 'data-analyst' },
  'data-engineer': { classifierKey: 'dataEngineer', rolePrefix: 'data-engineer' },
};

function compactText(text, limit = 1200) {
  if (!text) return '';
  const normalized = String(text).trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`;
}

function readPromptBody(promptFile, rootDir) {
  const filePath = path.join(rootDir, promptFile);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').trim();
}

export function resolveBasePrompt(entryOrName, {
  rootDir = process.cwd(),
  registry,
  fallback = '',
} = {}) {
  return resolvePromptContract(entryOrName, { rootDir, registry, fallback }).prompt;
}

export function resolvePromptContract(entryOrName, {
  rootDir = process.cwd(),
  registry,
  fallback = '',
} = {}) {
  const directEntry = entryOrName && typeof entryOrName === 'object' ? entryOrName : null;
  if (directEntry?.prompt) {
    return {
      prompt: String(directEntry.prompt).trim(),
      metadata: resolvePromptMetadata(directEntry.name || entryOrName, { rootDir, registry }),
    };
  }

  const agentName = directEntry?.name || entryOrName;
  if (!agentName) return { prompt: fallback, metadata: {} };

  const composed = composePrompt(agentName, { rootDir, registry });
  return {
    prompt: composed.prompt || fallback,
    metadata: composed.metadata || {},
  };
}

export function composePrompt(agentName, {
  rootDir = process.cwd(),
  registry,
  task = null,
  contextState = null,
  hostConstraints = null,
  intent = null,
  workCategory = null,
  roleFlavors = null,
  project = null,
  injectLearnedPatterns = true,
} = {}) {
  const entry = resolvePromptEntry(agentName, { rootDir, registry });
  if (!entry?.promptFile) return { metadata: {}, fragments: [], prompt: '' };

  const metadata = resolvePromptMetadata(agentName, { rootDir, registry });
  const fragments = [];

  fragments.push({ type: 'core', label: entry.name, content: readPromptBody(entry.promptFile, rootDir) });

  // Inject dynamic flavor overlay when the route classifies one for this agent.
  const shortName = String(agentName).replace(/^cx-/, '');
  const flavorMapping = AGENT_FLAVOR_MAP[shortName];
  if (flavorMapping && roleFlavors) {
    const flavor = roleFlavors[flavorMapping.classifierKey];
    if (flavor) {
      const overlayBody = readRoleFile(rootDir, `${flavorMapping.rolePrefix}.${flavor}`);
      if (overlayBody) {
        fragments.push({ type: 'role-flavor', label: `${flavorMapping.rolePrefix}.${flavor}`, content: `### ${flavor} domain guidance\n\n${overlayBody}` });
      }
    }
  }

  if (intent || workCategory) {
    fragments.push({
      type: 'task-context',
      label: 'task-classification',
      content: compactText(`Intent: ${intent || 'unknown'}\nWork category: ${workCategory || 'unknown'}`, 200),
    });
  }

  // Inject learned patterns from the observation store — placed before the task packet
  // so agents see accumulated knowledge before reading what they are about to do.
  if (injectLearnedPatterns) {
    const learnedBlock = buildLearnedPatternsBlock(agentName, { intent, workCategory, project });
    if (learnedBlock) {
      fragments.push({ type: 'learned-patterns', label: 'observations', content: learnedBlock });
    }
  }

  if (task) {
    const taskBlock = [
      task.title ? `Task: ${task.title}` : null,
      task.owner ? `Owner: ${task.owner}` : null,
      Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length ? `Acceptance: ${task.acceptanceCriteria.join('; ')}` : null,
      Array.isArray(task.readFirst) && task.readFirst.length ? `Read first: ${task.readFirst.join(', ')}` : null,
      Array.isArray(task.doNotChange) && task.doNotChange.length ? `Do not change: ${task.doNotChange.join(', ')}` : null,
    ].filter(Boolean).join('\n');
    if (taskBlock) fragments.push({ type: 'task-packet', label: 'workflow-task', content: compactText(taskBlock, 500) });
  }

  const digest = buildContextDigest(contextState);
  if (digest) {
    fragments.push({ type: 'context-digest', label: 'context', content: compactText(JSON.stringify(digest), 600) });
  }

  if (hostConstraints) {
    fragments.push({ type: 'host-constraints', label: 'host', content: compactText(JSON.stringify(hostConstraints), 300) });
  }

  const prompt = fragments.filter((fragment) => fragment.content).map((fragment) => fragment.content).join('\n\n');
  return { metadata, fragments, prompt };
}

export function summarizePromptComposition(agentName, options = {}) {
  const route = options.route || (options.request ? routeRequest({ request: options.request }) : null);
  const executionContractModel = options.executionContractModel
    || resolveExecutionContractModelMetadata({
      envValues: options.envValues || {},
      registryModels: options.registryModels || {},
      requestedTier: options.requestedTier || selectModelTierForWorkCategory(route?.workCategory),
      workCategory: route?.workCategory || null,
    });
  const composed = composePrompt(agentName, {
    ...options,
    intent: options.intent || route?.intent || null,
    workCategory: options.workCategory || route?.workCategory || null,
    roleFlavors: options.roleFlavors || route?.roleFlavors || null,
  });
  const fragmentTypes = composed.fragments.map((fragment) => fragment.type);
  const composedPromptHash = composed.prompt
    ? crypto.createHash('sha256').update(composed.prompt).digest('hex')
    : null;
  const task = options.task || null;

  return {
    ...composed.metadata,
    ...(composedPromptHash ? {
      composedPromptHash,
      composedPromptVersion: composedPromptHash.slice(0, 12),
    } : {}),
    promptFragmentCount: composed.fragments.length,
    promptFragmentTypes: fragmentTypes,
    promptHasTaskPacket: fragmentTypes.includes('task-packet'),
    promptHasContextDigest: fragmentTypes.includes('context-digest'),
    promptHasHostConstraints: fragmentTypes.includes('host-constraints'),
    ...(task?.key ? { taskPacketKey: task.key } : {}),
    ...(task?.owner ? { taskPacketOwner: task.owner } : {}),
    ...(task?.phase ? { taskPacketPhase: task.phase } : {}),
    ...(route ? {
      routeIntent: route.intent,
      routeTrack: route.track,
      routeWorkCategory: route.workCategory,
      routeSpecialists: route.specialists,
      routeDispatchPlan: route.dispatchPlan,
      ...(route.roleFlavors ? { routeRoleFlavors: route.roleFlavors } : {}),
    } : {}),
    promptHasRoleFlavor: fragmentTypes.includes('role-flavor'),
    promptHasLearnedPatterns: fragmentTypes.includes('learned-patterns'),
    executionContractModel,
  };
}

export function resolveRuntimePromptMetadata(agentName, {
  rootDir = process.cwd(),
  registry,
  task = null,
  contextState = null,
  request = null,
  route = null,
  registryModels = {},
  envValues = {},
  executionContractModel = null,
  hostConstraints = null,
} = {}) {
  const resolvedTask = task ?? null;
  const resolvedContextState = contextState ?? readContextState(rootDir);
  const resolvedRoute = route || (request ? routeRequest({ request }) : null);

  return summarizePromptComposition(agentName, {
    rootDir,
    registry,
    task: resolvedTask,
    contextState: resolvedContextState,
    request,
    route: resolvedRoute,
    registryModels,
    envValues,
    executionContractModel,
    hostConstraints,
    intent: resolvedRoute?.intent || null,
    workCategory: resolvedRoute?.workCategory || null,
  });
}
