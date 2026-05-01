/**
 * lib/dispatch-batch.js — Batch multiplexer for parallel agents.
 *
 * When orchestration policy returns a dispatch plan with parallel: true:
 *   1. Check all agents use the same model tier AND same provider family.
 *   2. Compose one shared system message (deduplicated static fragments).
 *   3. Append N per-agent task suffixes as separate user messages.
 *   4. Request structured JSON output with agent names as keys.
 *   5. Fall back to sequential dispatch if tiers differ.
 *
 * Only activates when dispatchPlan.someParallel === true AND agents share the same model.
 */
import { composePrompt } from './prompt-composer.js';
import { resolveProviderCapabilities } from './provider-capabilities.js';
import { estimateTokensSync } from './token-engine.js';

const MAX_BATCH_AGENTS = 5; // limit batch size for token budget

/**
 * Check if a dispatch plan can be batched.
 *
 * @param {Array} agents - [{ name, ... }]
 * @param {object} dispatchPlan
 * @returns {{ canBatch: boolean, reason: string, sharedModel: string }}
 */
export function canBatch(agents, dispatchPlan) {
  if (!dispatchPlan?.someParallel) {
    return { canBatch: false, reason: 'Dispatch plan does not request parallel execution' };
  }

  if (!Array.isArray(agents) || agents.length < 2) {
    return { canBatch: false, reason: 'Need at least 2 agents for batch' };
  }

  if (agents.length > MAX_BATCH_AGENTS) {
    return { canBatch: false, reason: `Batch size ${agents.length} exceeds max ${MAX_BATCH_AGENTS}` };
  }

  // Check all agents share the same model tier
  const tiers = new Set();
  const providers = new Set();

  for (const agent of agents) {
    tiers.add(agent.tier || 'standard');
    providers.add(agent.provider || 'unknown');
  }

  if (tiers.size > 1) {
    return { canBatch: false, reason: `Multiple tiers: ${[...tiers].join(', ')}` };
  }

  if (providers.size > 1) {
    return { canBatch: false, reason: `Multiple providers: ${[...providers].join(', ')}` };
  }

  const sharedModel = agents[0].modelId || '';
  return { canBatch: true, reason: null, sharedModel, sharedTier: [...tiers][0] };
}

/**
 * Build a batch prompt for parallel agents.
 *
 * @param {Array} agents - [{ name, task, ... }]
 * @param {object} options - { sharedModel, rootDir, ... }]
 * @returns {Promise<{ system, messages, expectedTokens }>}
 */
export async function buildBatchPrompt(agents, {
  rootDir = process.cwd(),
  ...opts
} = {}) {
  if (!agents?.length) return null;

  // Compose prompt for first agent (the template)
  const first = await composePrompt(agents[0].name, {
    rootDir,
    task: agents[0].task,
    intent: agents[0].intent,
    workCategory: agents[0].workCategory,
    ...opts,
  });

  // Extract shared system from first agent
  const sharedSystem = first.system || '';
  const staticEndIndex = first.staticEndIndex;

  // Build per-agent suffixes
  const agentSuffixes = [];
  let totalSuffixTokens = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const agentPrompt = await composePrompt(agent.name, {
      rootDir,
      task: agent.task,
      intent: agent.intent,
      workCategory: agent.workCategory,
      injectLearnedPatterns: i === 0, // only inject once
      ...opts,
    });

    // The dynamic part (after system)
    const suffix = agentPrompt.messages?.[1]?.content || agentPrompt.system || '';
    const suffixTokens = estimateTokensSync(suffix, { modelId: opts.sharedModel });

    agentSuffixes.push({
      agent: agent.name,
      content: suffix,
      tokens: suffixTokens,
    });
    totalSuffixTokens += suffixTokens;
  }

  const systemTokens = estimateTokensSync(sharedSystem, { modelId: opts.sharedModel });
  const totalTokens = systemTokens + totalSuffixTokens;

  // Build messages: one system + N user messages
  const messages = [
    { role: 'system', content: sharedSystem },
    ...agentSuffixes.map(a => ({
      role: 'user',
      content: `Agent: ${a.agent}\n\n${a.content}`,
    })),
  ];

  return {
    system: sharedSystem,
    messages,
    expectedTokens: totalTokens,
    agentSuffixes,
    canSend: totalTokens < 30000, // conservative limit for batch
  };
}

/**
 * Parse a structured batch response.
 *
 * @param {string} responseText - LLM response with JSON
 * @param {Array} agentNames
 * @returns {object} - { agentName: responseText }
 */
export function parseBatchResponse(responseText, agentNames) {
  if (!responseText || !Array.isArray(agentNames)) return {};

  try {
    // Try to parse as JSON
    const parsed = JSON.parse(responseText);
    if (typeof parsed === 'object' && parsed !== null) {
      // Check if response has agent keys
      const result = {};
      for (const name of agentNames) {
        result[name] = parsed[name] || parsed[name.replace(/^cx-/, '')] || '';
      }
      return result;
    }
  } catch {
    // Not JSON — return full text as fallback
  }

  // Fallback: split by agent headers
  const result = {};
  const lines = responseText.split('\n');
  let currentAgent = null;
  let currentText = [];

  for (const line of lines) {
    const agentMatch = line.match(/^Agent:\s*(cx-[^\s]+)/);
    if (agentMatch) {
      if (currentAgent) {
        result[currentAgent] = currentText.join('\n').trim();
      }
      currentAgent = agentMatch[1];
      currentText = [];
    } else {
      currentText.push(line);
    }
  }

  if (currentAgent) {
    result[currentAgent] = currentText.join('\n').trim();
  }

  return result;
}
