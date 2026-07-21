/**
 * lib/prompt-composer.mjs — Assemble a Worker Profile prompt with task and context fragments.
 *
 * Called before invoking a worker.
 * Injects learned patterns from the observation store so agents improve over sessions.
 * Produces a token-aware prompt structure with priority-based pruning.
 *
 * NEW contract (no backward compat):
 *   { metadata, fragments, system, messages, staticEndIndex, totalTokens }
 *
 * Fragment order: core → role-flavor → model-profile → task-context → learned-patterns → task-packet → context-digest → strategy → host-constraints
 * strategy is injected after context-digest so agents have strategic grounding before learned-patterns affect framing.
 *
 * Workspace-type overlay auto-selection: when workspaceType is passed, the matching role overlay
 * is selected automatically (e.g. workspaceType='platform' → product-manager.platform overlay)
 * unless roleFlavors explicitly overrides it.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { buildContextDigest, readContextState } from './context-state.mjs';
import {
  MODEL_OPERATING_PROFILES,
  resolveExecutionContractModelMetadata,
  selectModelTierForWorkCategory,
} from './model-router.mjs';
import {
  resolveExecutionCapabilityProfile,
  operatingProfileIdFromProfile,
} from './models/execution-capability-profile.mjs';
import { listObservations } from './observation-store.mjs';
import { routeRequest } from './orchestration-policy.mjs';
import {
  resolvePromptEntry,
  resolvePromptMetadata,
  resolveWorkerProfilePromptPath,
} from './prompt-metadata.mjs';
import { readPerspectiveFile } from './perspective-preload.mjs';
import { estimateTokens, estimatePromptTokens, estimateTokensSync } from './token-engine.js';
import { getStrategyDigestSync } from './strategy-store.mjs';
import { bindingForWorkerProfile, bindingsForWorkerProfileId, resolveRoleOverlayId } from './roles/flavor-bindings.mjs';
import { PROMPT_LAYER_ORDER } from './prompt-layer-model.mjs';
import { PRIORITY } from './prompt-layer-contract.mjs';

export { PROMPT_LAYER_ORDER };

const MAX_OBSERVATIONS = 3;

// workspaceType → roleFlavors auto-selection when caller doesn't override
const WORKSPACE_FLAVOR_MAP = {
  platform: { productManager: 'platform', architect: 'platform', platformEngineer: 'core' },
  enterprise: { productManager: 'enterprise', architect: 'enterprise' },
  'ai-product': { productManager: 'ai-product', architect: 'ai-systems' },
  growth: { productManager: 'growth' },
  product: {},
};

// Merge workspaceType-derived overlays with explicit roleFlavors. Explicit always wins.
function resolveRoleFlavors(roleFlavors, workspaceType, shortName) {
  const workspaceDefaults = workspaceType ? (WORKSPACE_FLAVOR_MAP[workspaceType] ?? {}) : {};
  if (!roleFlavors && !workspaceType) return null;
  return { ...workspaceDefaults, ...(roleFlavors || {}) };
}

// Synchronous strategy digest for prompt injection — reads all scope files from the strategy directory.
function buildStrategyBlock({ tokenLimit = 400 } = {}) {
  return getStrategyDigestSync();
}

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

export function readPromptBody(promptPath, rootDir) {
  const filePath = path.join(rootDir, promptPath);
  if (!fs.existsSync(filePath)) return '';
  const raw = fs.readFileSync(filePath, 'utf8');
  return stripLeadingYamlFrontmatter(raw).trim();
}

export function stripLeadingYamlFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return content;
  const closeIdx = content.indexOf('\n---', 4);
  if (closeIdx === -1) return content;
  const afterClose = content.indexOf('\n', closeIdx + 1);
  if (afterClose === -1) return '';
  return content.slice(afterClose + 1);
}

function buildLearnedPatternsBlock(workerProfileId, {
  project = null,
  modelId = 'default',
  tokenLimit = MODEL_OPERATING_PROFILES.balanced.learnedPatternsTokens,
} = {}) {
  try {
    const rootDir = homedir();
    const shortName = String(workerProfileId);

    // Prompt composition runs at sync time (config generation). A live semantic
    // search here would load the 90MB embedding model and stall sync for ~80s on
    // a cold cache (and searchObservations is async — its Promise can't be
    // consumed from this synchronous function). Read the durable observation
    // index synchronously and rank by confidence + role match instead.

    const results = listObservations(rootDir, {
      limit: MAX_OBSERVATIONS * 4,
      project: project ?? null,
    });

    const relevant = results
      .filter((o) => (o.confidence ?? 0) >= 0.7)
      .filter((o) => ['pattern', 'anti-pattern', 'decision', 'insight'].includes(o.category))
      .sort((a, b) => {
        const aMatch = a.role === workerProfileId || a.role === shortName || a.role === 'construct' ? 0 : 1;
        const bMatch = b.role === workerProfileId || b.role === shortName || b.role === 'construct' ? 0 : 1;
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
      if (tokens + lineTokens > tokenLimit) break;
      lines.push(line);
      tokens += lineTokens + 1;
    }
    lines.push('');
    return { text: lines.join('\n'), tokens };
  } catch {
    return { text: '', tokens: 0 };
  }
}

export function resolveBasePrompt(workerProfileOrId, {
  rootDir = process.cwd(),
  registry,
  fallback = '',
} = {}) {
  return resolvePromptContract(workerProfileOrId, { rootDir, registry, fallback }).prompt;
}

export function resolvePromptContract(workerProfileOrId, {
  rootDir = process.cwd(),
  registry,
  fallback = '',
} = {}) {
  const workerProfileId = typeof workerProfileOrId === 'object'
    ? workerProfileOrId?.id
    : workerProfileOrId;
  if (!workerProfileId) return { prompt: fallback, metadata: {} };

  const composed = composePrompt(workerProfileId, { rootDir, registry });
  return {
    prompt: composed.system || fallback,
    metadata: composed.metadata || {},
  };
}

export function composePrompt(workerProfileId, {
  rootDir = process.cwd(),
  registry,
  task = null,
  contextState = null,
  hostConstraints = null,
  intent = null,
  workCategory = null,
  roleFlavors = null,
  workspaceType = null,
  project = null,
  injectLearnedPatterns = true,
  modelId = 'default',
  executionContractModel = null,
  emitProvenance = false,
} = {}) {
  const entry = resolvePromptEntry(workerProfileId, { rootDir, registry });
  const promptPath = resolveWorkerProfilePromptPath(workerProfileId, { rootDir, registry });
  if (!entry || !promptPath) return { metadata: {}, fragments: [], system: '', messages: [], staticEndIndex: -1, totalTokens: 0 };
  const corePrompt = readPromptBody(promptPath, rootDir);
  if (!corePrompt) return { metadata: {}, fragments: [], system: '', messages: [], staticEndIndex: -1, totalTokens: 0 };

  const metadata = resolvePromptMetadata(workerProfileId, { rootDir, registry });
  const fragments = [];
  const executionProfile = resolveExecutionCapabilityProfile({
    model: executionContractModel?.selectedModel ?? modelId,
    envValues: executionContractModel?.profile ? { CONSTRUCT_MODEL_PROFILE: executionContractModel.profile.id } : {},
  });
  const selectedProfile = MODEL_OPERATING_PROFILES[operatingProfileIdFromProfile(executionProfile)];

  fragments.push({ type: 'core', priority: PRIORITY['core'], label: entry.id, content: corePrompt, tokenBudget: null });

  const shortName = String(workerProfileId);

  // When workspaceType is provided and roleFlavors doesn't already specify this agent's flavor,
  // auto-select the matching overlay so agents get domain guidance without requiring explicit caller config.
  const effectiveRoleFlavors = resolveRoleFlavors(roleFlavors, workspaceType, shortName);

  // One Worker Profile can carry several flavor bindings
  // (e.g. engineer owns engineer/ai-engineer/platform-engineer/data-engineer
  // overlays). Prefer whichever candidate binding's classifierKey the caller
  // actually named in roleFlavors over the profile's own bare-name binding,
  // so a flavor-specific request (roleFlavors.platformEngineer) still resolves
  // even though bindingForWorkerProfile(shortName) alone would only ever return
  // the base 'engineer' entry.
  const candidates = bindingsForWorkerProfileId(workerProfileId);
  const flavorMapping = (effectiveRoleFlavors
    && candidates.find((b) => effectiveRoleFlavors[b.classifierKey]))
    || bindingForWorkerProfile(shortName);

  if (flavorMapping && effectiveRoleFlavors) {
    const flavor = effectiveRoleFlavors[flavorMapping.classifierKey];
    if (flavor) {
      const roleId = resolveRoleOverlayId(flavorMapping, flavor);
      const overlayBody = readPerspectiveFile(rootDir, roleId, {
        source: 'prompt-composer',
        callerContext: workerProfileId,
      });
      if (overlayBody) {
        // Always respect roleFlavorTokens so large overlays (e.g. engineer)
        // stay inside maxPromptTokens instead of being pruned entirely.
        const overlayContent = compactTokens(overlayBody, selectedProfile.roleFlavorTokens, { modelId });
        fragments.push({
          type: 'role-flavor',
          priority: PRIORITY['role-flavor'],
          label: roleId,
          // flavorMapping.rolePrefix (not the agent's own shortName) names the
          // domain guidance: one Worker Profile can carry
          // several flavor bindings (e.g. engineer), and shortName only
          // ever reflects the profile's own bare name, not which of its
          // several possible overlays actually matched.
          content: `### ${flavor === 'core' ? flavorMapping.rolePrefix : flavor} domain guidance\n\n${overlayContent}`,
          tokenBudget: selectedProfile.roleFlavorTokens,
          // Full-source digest so certification still notices edits past the
          // compaction cut (append-only changes would otherwise be invisible).
          sourceContentHash: crypto.createHash('sha256').update(overlayBody).digest('hex'),
        });
      }
    }
  }

  if (selectedProfile.retrievalFirst) {
    fragments.push({
      type: 'model-profile',
      priority: PRIORITY['model-profile'],
      label: `model-profile.${selectedProfile.id}`,
      content: [
        `## ${selectedProfile.label} operating mode`,
        '',
        'Prefer retrieval-first execution: gather focused evidence before broad edits.',
        'Keep plans and summaries compact, stage work in verified steps, and avoid whole-file rewrites unless the task requires them.',
      ].join('\n'),
      tokenBudget: 90,
    });
  }

  if (intent || workCategory) {
    const text = `Intent: ${intent || 'unknown'}\nWork category: ${workCategory || 'unknown'}`;
    fragments.push({
      type: 'task-context',
      priority: PRIORITY['task-context'],
      label: 'task-classification',
      content: text,
      tokenBudget: 50,
    });
  }

  if (injectLearnedPatterns) {
    const { text: learnedBlock, tokens: learnedTokens } = buildLearnedPatternsBlock(workerProfileId, {
      intent,
      workCategory,
      project,
      modelId,
      tokenLimit: selectedProfile.learnedPatternsTokens,
    });
    if (learnedBlock) {
      fragments.push({
        type: 'learned-patterns',
        priority: PRIORITY['learned-patterns'],
        label: 'observations',
        content: learnedBlock,
        tokenBudget: selectedProfile.learnedPatternsTokens,
        estimatedTokens: learnedTokens,
      });
    }
  }

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
        content: compactTokens(taskBlock, selectedProfile.taskPacketTokens, { modelId }),
        tokenBudget: selectedProfile.taskPacketTokens,
      });
    }
  }

  const digest = buildContextDigest(contextState);
  if (digest) {
    const digestStr = JSON.stringify(digest);
    fragments.push({
      type: 'context-digest',
      priority: PRIORITY['context-digest'],
      label: 'context',
      content: compactTokens(digestStr, selectedProfile.contextDigestTokens, { modelId }),
      tokenBudget: selectedProfile.contextDigestTokens,
    });
  }

  const strategyText = buildStrategyBlock({ modelId, tokenLimit: selectedProfile.strategyTokens ?? 400 });
  if (strategyText) {
    fragments.push({
      type: 'strategy',
      priority: PRIORITY['strategy'],
      label: 'active-strategy',
      content: strategyText,
      tokenBudget: selectedProfile.strategyTokens ?? 400,
    });
  }

  if (hostConstraints) {
    fragments.push({
      type: 'host-constraints',
      priority: PRIORITY['host-constraints'],
      label: 'host',
      content: compactTokens(JSON.stringify(hostConstraints), selectedProfile.hostConstraintsTokens, { modelId }),
      tokenBudget: selectedProfile.hostConstraintsTokens,
    });
  }

  const prePruneFragments = fragments.map((fragment) => ({ ...fragment }));
  const pruned = pruneFragments(fragments, selectedProfile.maxPromptTokens, modelId);
  const staticEndIndex = findStaticEndIndex(pruned);

  const system = assembleSystemMessage(pruned, staticEndIndex);
  const messages = assembleMessages(pruned, staticEndIndex);
  const totalTokens = estimateTokensSync(system || '', { modelId }) +
    (messages || []).reduce((sum, msg) => sum + estimateTokensSync(typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg.content || ''), { modelId }), 0) +
    (pruned || []).reduce((sum, f) => sum + estimateTokensSync(f.content || '', { modelId }), 0);

  const result = { metadata, fragments: pruned, system, messages, staticEndIndex, totalTokens };

  if (emitProvenance) {
    try {
      result.provenance = buildPromptProvenance({
        workerProfileId,
        promptPath,
        prePruneFragments,
        prunedFragments: pruned,
        modelId,
      });
    } catch (err) {
      result.provenance = { degraded: true, error: err?.message ?? String(err), layers: [] };
    }
  }

  return result;
}

function buildPromptProvenance({
  workerProfileId,
  promptPath,
  prePruneFragments,
  prunedFragments,
  modelId,
}) {
  const prunedKeys = new Set(
    prunedFragments.map((fragment) => `${fragment.type}:${fragment.label || fragment.type}`),
  );
  const layers = [];

  for (const layerName of PROMPT_LAYER_ORDER) {
    const matching = prePruneFragments.filter((fragment) => fragment.type === layerName);
    for (const fragment of matching) {
      const content = fragment.content || '';
      if (!content.trim()) continue;
      const key = `${fragment.type}:${fragment.label || fragment.type}`;
      const included = prunedKeys.has(key);
      layers.push({
        layer: layerName,
        label: fragment.label || layerName,
        contentLength: content.length,
        tokenEstimate: fragment.estimatedTokens ?? estimateTokensSync(content, { modelId }),
        pruned: !included,
        included,
        sourcePath: fragment.type === 'core' ? promptPath : null,
      });
    }
  }

  return {
    workerProfileId,
    layerOrder: [...PROMPT_LAYER_ORDER],
    layers,
    degraded: false,
  };
}

export function composePromptWithProvenance(workerProfileId, options = {}) {
  const composed = composePrompt(workerProfileId, { ...options, emitProvenance: true });
  return {
    composed,
    provenance: composed.provenance ?? { degraded: true, error: 'provenance missing', layers: [] },
  };
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

export function summarizePromptComposition(workerProfileId, options = {}) {
  const route = options.route || (options.request ? routeRequest({ request: options.request }) : null);
  const executionContractModel = options.executionContractModel
    || resolveExecutionContractModelMetadata({
      envValues: options.envValues || {},
      registryModels: options.registryModels || {},
      requestedTier: options.requestedTier || selectModelTierForWorkCategory(route?.workCategory),
      workCategory: route?.workCategory || null,
    });
  const composed = composePrompt(workerProfileId, {
    ...options,
    intent: options.intent || route?.intent || null,
    workCategory: options.workCategory || route?.workCategory || null,
    roleFlavors: options.roleFlavors || route?.roleFlavors || null,
  });
  const fragmentTypes = composed.fragments.map((fragment) => fragment.type);
  const flavorFragment = composed.fragments.find((fragment) => fragment.type === 'role-flavor');
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
      routeSuggestedWorkflowType: route.suggestedWorkflowType || null,
      routeWorkerProfiles: route.assignments,
      routeDispatchPlan: route.dispatchPlan,
      ...(route.roleFlavors ? { routeRoleFlavors: route.roleFlavors } : {}),
    } : {}),
    ...(flavorFragment ? { promptRoleFlavor: flavorFragment.label } : {}),
    promptHasRoleFlavor: fragmentTypes.includes('role-flavor'),
    promptHasLearnedPatterns: fragmentTypes.includes('learned-patterns'),
    executionContractModel,
    totalTokens: composed.totalTokens,
    staticEndIndex: composed.staticEndIndex,
  };
}

export function resolveRuntimePromptMetadata(workerProfileId, {
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

  return summarizePromptComposition(workerProfileId, {
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
