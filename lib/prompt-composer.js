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
import { resolvePromptEntry, resolvePromptMetadata } from './prompt-metadata.mjs';
import { stripSectionMarkers } from './persona-sections.mjs';
import { readRoleFile } from './role-preload.mjs';
import { estimateTokens, estimatePromptTokens, estimateTokensSync } from './token-engine.js';
import { cxDir } from './paths.mjs';
import { getStrategyDigestSync } from './strategy-store.mjs';
import { loadRegistry } from './registry/loader.mjs';
import { bindingForSpecialist, resolveRoleOverlayId } from './roles/flavor-bindings.mjs';

const MAX_OBSERVATIONS = 3;

// Priority tiers (1 = never drop, 5 = drop first)
const PRIORITY = {
  'core': 1,
  'task-packet': 1,
  'role-flavor': 2,
  'team-context': 2,
  'model-profile': 2,
  'context-digest': 3,
  'strategy': 3,
  'learned-patterns': 4,
  'host-constraints': 5,
};

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

export function readPromptBody(promptFile, rootDir) {
  const filePath = path.join(rootDir, promptFile);
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

function buildLearnedPatternsBlock(agentName, {
  project = null,
  modelId = 'default',
  tokenLimit = MODEL_OPERATING_PROFILES.balanced.learnedPatternsTokens,
} = {}) {
  try {
    const rootDir = homedir();
    const shortName = String(agentName).replace(/^cx-/, '');

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

  if (directEntry?.promptFile) {
    const body = stripSectionMarkers(readPromptBody(directEntry.promptFile, rootDir));
    return {
      prompt: body || fallback,
      metadata: resolvePromptMetadata(directEntry.name, { rootDir, registry }),
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

function buildTeamBlock(entry, registry, { tokenLimit = 200, modelId = 'default' } = {}) {
  if (!entry?.team || !registry?.teams) return null;
  const squad = registry.teams[entry.team];
  if (!squad) return null;
  const groupId = squad.groupId || entry.groupId;
  const group = groupId ? registry.teams[groupId] : null;
  const collaborators = (squad.collaborators || []).filter(Boolean);
  const lines = [
    '## Team context',
    '',
    `Squad: **${squad.name || squad.id}** (\`${squad.id}\`)`,
  ];
  if (group) lines.push(`Group: **${group.name || groupId}** (\`${groupId}\`)`);
  if (squad.charter) lines.push('', compactTokens(squad.charter, tokenLimit, { modelId }));
  if (collaborators.length) {
    lines.push('', `Collaborators: ${collaborators.map((c) => `\`${c}\``).join(', ')}`);
  }
  lines.push('', 'Invoke sibling squad specialists when work crosses squad boundaries. Call `suggest_skills` when the task domain is ambiguous.');
  return lines.join('\n');
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
  workspaceType = null,
  project = null,
  injectLearnedPatterns = true,
  modelId = 'default',
  executionContractModel = null,
} = {}) {
  const entry = resolvePromptEntry(agentName, { rootDir, registry });
  if (!entry?.promptFile) return { metadata: {}, fragments: [], system: '', messages: [], staticEndIndex: -1, totalTokens: 0 };

  const metadata = resolvePromptMetadata(agentName, { rootDir, registry });
  const fragments = [];
  const executionProfile = resolveExecutionCapabilityProfile({
    model: executionContractModel?.selectedModel ?? modelId,
    envValues: executionContractModel?.profile ? { CONSTRUCT_MODEL_PROFILE: executionContractModel.profile.id } : {},
  });
  const selectedProfile = MODEL_OPERATING_PROFILES[operatingProfileIdFromProfile(executionProfile)];

  fragments.push({ type: 'core', priority: PRIORITY['core'], label: entry.name, content: stripSectionMarkers(readPromptBody(entry.promptFile, rootDir)), tokenBudget: null });

  const resolvedRegistry = registry || loadRegistry({ rootDir });
  const teamBlock = buildTeamBlock(entry, resolvedRegistry, { modelId });
  if (teamBlock) {
    fragments.push({
      type: 'team-context',
      priority: PRIORITY['team-context'],
      label: entry.team,
      content: teamBlock,
      tokenBudget: 200,
    });
  }

  const shortName = String(agentName).replace(/^cx-/, '');
  const flavorMapping = bindingForSpecialist(shortName);

  // When workspaceType is provided and roleFlavors doesn't already specify this agent's flavor,
  // auto-select the matching overlay so agents get domain guidance without requiring explicit caller config.
  const effectiveRoleFlavors = resolveRoleFlavors(roleFlavors, workspaceType, shortName);

  if (flavorMapping && effectiveRoleFlavors) {
    const flavor = effectiveRoleFlavors[flavorMapping.classifierKey];
    if (flavor) {
      const roleId = resolveRoleOverlayId(flavorMapping, flavor);
      const overlayBody = readRoleFile(rootDir, roleId, {
        source: 'prompt-composer',
        callerContext: agentName,
      });
      if (overlayBody) {
        const overlayContent = selectedProfile.preferCompressedRoleGuidance
          ? compactTokens(overlayBody, selectedProfile.roleFlavorTokens, { modelId })
          : overlayBody;
        fragments.push({
          type: 'role-flavor',
          priority: PRIORITY['role-flavor'],
          label: roleId,
          content: `### ${flavor === 'core' ? shortName : flavor} domain guidance\n\n${overlayContent}`,
          tokenBudget: selectedProfile.roleFlavorTokens,
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
      priority: 2,
      label: 'task-classification',
      content: text,
      tokenBudget: 50,
    });
  }

  if (injectLearnedPatterns) {
    const { text: learnedBlock, tokens: learnedTokens } = buildLearnedPatternsBlock(agentName, {
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

  // Priority-based pruning
  const pruned = pruneFragments(fragments, selectedProfile.maxPromptTokens, modelId);
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
      routeSpecialists: route.specialists,
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
