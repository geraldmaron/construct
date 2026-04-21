/**
 * lib/prompt-composer.mjs — Assemble the final agent prompt from core file, task packet, and context digest.
 *
 * Called by the orchestrator and MCP dispatch layer before invoking a specialist agent.
 * Inlines role anti-pattern guidance from skills/roles/ when a role directive is present in the prompt.
 * Produces a deterministic, cache-friendly prompt string with a stable token footprint.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { buildContextDigest, readContextState } from './context-state.mjs';
import { resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from './model-router.mjs';
import { routeRequest } from './orchestration-policy.mjs';
import { resolvePromptEntry, resolvePromptMetadata } from './prompt-metadata.mjs';
import { readRoleFile } from './role-preload.mjs';
import { loadWorkflow } from './workflow-state.mjs';

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

function resolveActiveTask(workflow) {
  if (!workflow || !Array.isArray(workflow.tasks)) return null;
  if (workflow.currentTaskKey) {
    const currentTask = workflow.tasks.find((task) => task.key === workflow.currentTaskKey && !['done', 'skipped'].includes(task.status));
    if (currentTask) return currentTask;
  }
  return workflow.tasks.find((task) => ['in-progress', 'in_progress', 'blocked_needs_user'].includes(task.status)) || null;
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
    ...(task?.key ? { workflowTaskKey: task.key } : {}),
    ...(task?.owner ? { workflowTaskOwner: task.owner } : {}),
    ...(task?.phase ? { workflowTaskPhase: task.phase } : {}),
    ...(route ? {
      routeIntent: route.intent,
      routeTrack: route.track,
      routeWorkCategory: route.workCategory,
      routeSpecialists: route.specialists,
      routeDispatchPlan: route.dispatchPlan,
      ...(route.roleFlavors ? { routeRoleFlavors: route.roleFlavors } : {}),
    } : {}),
    promptHasRoleFlavor: fragmentTypes.includes('role-flavor'),
    executionContractModel,
  };
}

export function resolveRuntimePromptMetadata(agentName, {
  rootDir = process.cwd(),
  registry,
  workflow = null,
  task = null,
  contextState = null,
  request = null,
  route = null,
  registryModels = {},
  envValues = {},
  executionContractModel = null,
  hostConstraints = null,
} = {}) {
  const resolvedWorkflow = workflow ?? loadWorkflow(rootDir);
  const resolvedTask = task ?? resolveActiveTask(resolvedWorkflow);
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
