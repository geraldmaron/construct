/**
 * lib/prompt-composer.js — Assemble the final agent prompt from core file, task packet, and context digest.
 *
 * Called by the orchestrator and MCP dispatch layer before invoking a specialist agent.
 * Injects learned patterns from the observation store so agents improve over sessions.
 * Produces a token-aware prompt structure with priority-based pruning.
 *
 * NEW contract (no backward compat):
 *   { metadata, fragments, system, messages, staticEndIndex, totalTokens }
 *
 * Fragment order: core → role-flavor → task-context → learned-patterns → task-packet → context-digest → host-constraints
 * learned-patterns is inserted before the task packet so agents see what has been learned before reading the specific task.
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
import { estimateTokens, estimatePromptTokens, estimateTokensSync } from './token-engine.js';

// Token limits (replacing char limits)
const LEARNED_PATTERNS_TOKEN_LIMIT = 200;
const MAX_OBSERVATIONS = 3; // matched to token budget
const MAX_CONTEXT_TOKENS = 3000; // total prompt token budget

// Priority tiers (1 = never drop, 5 = drop first)
const PRIORITY = {
  'core': 1,
  'task-packet': 1,
  'role-flavor': 2,
  'context-digest': 3,
  'learned-patterns': 4,
  'host-constraints': 5,
};

const AGENT_FLAVOR_MAP = {
  architect: { classifierKey: 'architect', rolePrefix: 'architect' },
  'product-manager': { classifierKey: 'productManager', rolePrefix: 'product-manager' },
  qa: { classifierKey: 'qa', rolePrefix: 'qa' },
  security: { classifierKey: 'security', rolePrefix: 'security' },
  'data-analyst': { classifierKey: 'dataAnalyst', rolePrefix: 'data-analyst' },
  'data-engineer': { classifierKey: 'dataEngineer', rolePrefix: 'data-engineer' },
};

function compactTokens(text, tokenLimit = 300, { modelId = 'default' } = {}) {
  if (!text) return '';
  const normalized = String(text).trim();
  const estimated = estimateTokensSync(normalized, { modelId });
  if (estimated <= tokenLimit) return normalized;
  // Approximate: drop ~25% and retry
  const ratio = tokenLimit / estimated;
  const cutIdx = Math.floor(normalized.length * ratio);
  return `${normalized.slice(0, cutIdx)}…`;
}

function readPromptBody(promptFile, rootDir) {
  const filePath = path.join(rootDir, promptFile);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').trim();
}

function buildLearnedPatternsBlock(agentName, { intent = null, workCategory = null, project = null, modelId = 'default' } = {}) {
  try {
    const rootDir = homedir();
    const query = [agentName, intent, workCategory].filter(Boolean).join(' ');
    const shortName = String(agentName).replace(/^cx-/, '');
    const results = searchObservations(rootDir, query, {
      limit: MAX_OBSERVATIONS * 2,
      project: project ?? null,
    });

    const relevant = results
      .filter((o) => (o.confidence ?? 0) >= 0.7)
      .filter((o) => ['pattern', 'anti-pattern', 'decision', 'insight'].includes(o.category))
      .sort((a, b) => {
        const aMatch = a.role === agentName || a.role === shortName || a.role === 'construct' ? 0 : 1;
        const bMatch = b.role === agentName || b.role === shortName || b.role === 'construct' ? 0 : 1;
        return aMatch - bMatch;
      })
      .slice(0, MAX_OBSERVATIONS);

    if (!relevant.length) return { text: '', tokens: 0 };

    const lines = ['## Learned patterns (from prior sessions)', ''];
    let tokens = 0;
    for (const obs of relevant) {
      const prefix = obs.category === 'anti-pattern' ? '⚠ ' : obs.category === 'decision' ? '✓ ' : '• ';
      const line = `${prefix}${obs.summary}`;
      const lineTokens = estimateTokensSync(line + '\n', { modelId });
      if (tokens + lineTokens > LEARNED_PATTERNS_TOKEN_LIMIT) break;
      lines.push(line);
      tokens += lineTokens + 1;
    }
    lines.push('');
    return { text: lines.join('\n'), tokens };
  } catch {
    return { text: '', tokens: 0 };
  }
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
    prompt: composed.system || fallback,
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
  modelId = 'default',
} = {}) {
  const entry = resolvePromptEntry(agentName, { rootDir, registry });
  if (!entry?.promptFile) return { metadata: {}, fragments: [], system: '', messages: [], staticEndIndex: -1, totalTokens: 0 };

  const metadata = resolvePromptMetadata(agentName, { rootDir, registry });
  const fragments = [];

  // 1. Core (priority 1 — never dropped)
  fragments.push({ type: 'core', priority: PRIORITY['core'], label: entry.name, content: readPromptBody(entry.promptFile, rootDir), tokenBudget: null });

  // 2. Role flavor overlay (priority 2)
  const shortName = String(agentName).replace(/^cx-/, '');
  const flavorMapping = AGENT_FLAVOR_MAP[shortName];
  if (flavorMapping && roleFlavors) {
    const flavor = roleFlavors[flavorMapping.classifierKey];
    if (flavor) {
      const overlayBody = readRoleFile(rootDir, `${flavorMapping.rolePrefix}.${flavor}`);
      if (overlayBody) {
        fragments.push({
          type: 'role-flavor',
          priority: PRIORITY['role-flavor'],
          label: `${flavorMapping.rolePrefix}.${flavor}`,
          content: `### ${flavor} domain guidance\n\n${overlayBody}`,
          tokenBudget: null,
        });
      }
    }
  }

  // 3. Task context (priority varies, part of static if present)
  if (intent || workCategory) {
    const text = `Intent: ${intent || 'unknown'}\nWork category: ${workCategory || 'unknown'}`;
    fragments.push({
      type: 'task-context',
      priority: 2,
      label: 'task-classification',
      content: text,
      tokenBudget: 50,
    });
  }

  // 4. Learned patterns (priority 4)
  if (injectLearnedPatterns) {
    const { text: learnedBlock, tokens: learnedTokens } = buildLearnedPatternsBlock(agentName, {
      intent, workCategory, project, modelId,
    });
    if (learnedBlock) {
      fragments.push({
        type: 'learned-patterns',
        priority: PRIORITY['learned-patterns'],
        label: 'observations',
        content: learnedBlock,
        tokenBudget: LEARNED_PATTERNS_TOKEN_LIMIT,
        estimatedTokens: learnedTokens,
      });
    }
  }

  // 5. Task packet (priority 1 — never dropped)
  if (task) {
    const taskBlock = [
      task.title ? `Task: ${task.title}` : null,
      task.owner ? `Owner: ${task.owner}` : null,
      Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length
        ? `Acceptance: ${task.acceptanceCriteria.join('; ')}`
        : null,
      Array.isArray(task.readFirst) && task.readFirst.length
        ? `Read first: ${task.readFirst.join(', ')}`
        : null,
      Array.isArray(task.doNotChange) && task.doNotChange.length
        ? `Do not change: ${task.doNotChange.join(', ')}`
        : null,
    ].filter(Boolean).join('\n');

    if (taskBlock) {
      fragments.push({
        type: 'task-packet',
        priority: PRIORITY['task-packet'],
        label: 'workflow-task',
        content: compactTokens(taskBlock, 150, { modelId }),
        tokenBudget: 150,
      });
    }
  }

  // 6. Context digest (priority 3)
  const digest = buildContextDigest(contextState);
  if (digest) {
    const digestStr = JSON.stringify(digest);
    fragments.push({
      type: 'context-digest',
      priority: PRIORITY['context-digest'],
      label: 'context',
      content: compactTokens(digestStr, 200, { modelId }),
      tokenBudget: 200,
    });
  }

  // 7. Host constraints (priority 5 — dropped first)
  if (hostConstraints) {
    fragments.push({
      type: 'host-constraints',
      priority: PRIORITY['host-constraints'],
      label: 'host',
      content: compactTokens(JSON.stringify(hostConstraints), 75, { modelId }),
      tokenBudget: 75,
    });
  }

  // Priority-based pruning
  const pruned = pruneFragments(fragments, MAX_CONTEXT_TOKENS, modelId);
  const staticEndIndex = findStaticEndIndex(pruned);

  // Assemble outputs
  const system = assembleSystemMessage(pruned, staticEndIndex);
  const messages = assembleMessages(pruned, staticEndIndex);
  const totalTokens = estimateTokensSync(system || '', { modelId }) +
    (messages || []).reduce((sum, msg) => sum + estimateTokensSync(typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg.content || ''), { modelId }), 0) +
    (pruned || []).reduce((sum, f) => sum + estimateTokensSync(f.content || '', { modelId }), 0);

  return { metadata, fragments: pruned, system, messages, staticEndIndex, totalTokens };
}

function pruneFragments(fragments, tokenBudget, modelId) {
  // Calculate current token usage
  let currentTokens = 0;
  const estimated = fragments.map((f) => ({
    ...f,
    estimatedTokens: f.estimatedTokens ?? estimateTokensSync(f.content || '', { modelId }),
  }));

  for (const f of estimated) {
    currentTokens += f.estimatedTokens;
  }

  if (currentTokens <= tokenBudget) return fragments;

  // Drop lowest priority fragments first
  const sorted = [...estimated].sort((a, b) => a.priority - b.priority);

  const kept = [];
  let remainingBudget = tokenBudget;

  // Always keep priority 1
  for (const f of sorted) {
    if (f.priority === 1) {
      kept.push(f);
      remainingBudget -= f.estimatedTokens;
    }
  }

  // Then add higher priorities if budget allows
  for (const f of sorted) {
    if (f.priority === 1) continue; // already added
    if (f.estimatedTokens <= remainingBudget) {
      kept.push(f);
      remainingBudget -= f.estimatedTokens;
    }
  }

  return kept.sort((a, b) => fragments.indexOf(a) - fragments.indexOf(b)); // preserve original order
}

function findStaticEndIndex(fragments) {
  // Find the last fragment that is "static" (cacheable)
  // Priority 1-2 are static, 3+ are dynamic
  let lastStatic = -1;
  for (let i = 0; i < fragments.length; i++) {
    if (fragments[i].priority <= 2) {
      lastStatic = i;
    }
  }
  return lastStatic;
}

function assembleSystemMessage(fragments, staticEndIndex) {
  const staticFragments = staticEndIndex >= 0 ? fragments.slice(0, staticEndIndex + 1) : [];
  const parts = staticFragments.map((f) => f.content).filter(Boolean);
  return parts.join('\n\n');
}

function assembleMessages(fragments, staticEndIndex) {
  const dynamicFragments = staticEndIndex >= 0 ? fragments.slice(staticEndIndex + 1) : fragments;
  const systemContent = staticEndIndex >= 0
    ? assembleSystemMessage(fragments, staticEndIndex)
    : '';

  const messages = [];
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  const dynamicContent = dynamicFragments.map((f) => f.content).filter(Boolean).join('\n\n');
  if (dynamicContent) {
    messages.push({ role: 'user', content: dynamicContent });
  }

  return messages;
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
  const composedPromptHash = composed.system
    ? crypto.createHash('sha256').update(composed.system).digest('hex')
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
    totalTokens: composed.totalTokens,
    staticEndIndex: composed.staticEndIndex,
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
