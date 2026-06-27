/**
 * tests/visual/lib/live-turn.mjs — one real owned-loop turn for depth auditing.
 *
 * Runs the production AI SDK agent with a pinned Anthropic model so role depth
 * rubrics score actual specialist/skill output, not mocked events.
 */

import { createOwnedLoopDriver } from '../../../apps/chat/engine/loop-driver.mjs';
import { VISUAL_LIVE_MODEL } from './role-expectations.mjs';
import { hasSecret } from '../../../lib/providers/secret-resolver.mjs';

export const VISUAL_LIVE_ENV = 'CONSTRUCT_VISUAL_LIVE';
export const LEGACY_LIVE_ENVS = ['CONSTRUCT_CERTIFY_LIVE', 'CONSTRUCT_E2E_REAL_LLM'];

export function visualLiveOptIn(env = process.env) {
  if (env[VISUAL_LIVE_ENV] === '1') return true;
  return env.CONSTRUCT_CERTIFY_LIVE === '1' || env.CONSTRUCT_E2E_REAL_LLM === '1';
}

export function visualLiveSkipReason(env = process.env) {
  if (!visualLiveOptIn(env)) {
    return `set ${VISUAL_LIVE_ENV}=1 (or CONSTRUCT_CERTIFY_LIVE=1) for live visual depth tests`;
  }
  if (!hasSecret('ANTHROPIC_API_KEY', { env })) {
    return 'ANTHROPIC_API_KEY required for Anthropic Sonnet 4.6 visual tests';
  }
  return null;
}

export function resolveVisualModel(env = process.env) {
  return env.CX_MODEL_STANDARD?.trim()
    || env.CONSTRUCT_E2E_REAL_LLM_MODEL?.trim()
    || VISUAL_LIVE_MODEL;
}

async function createRealAgent(opts) {
  const { createAiSdkAgent } = await import('../../../apps/chat/engine/ai-sdk-agent.mjs');
  return createAiSdkAgent(opts);
}

export async function runLiveTurn(prompt, {
  env = process.env,
  model = resolveVisualModel(env),
  cwd = process.cwd(),
  witness = null,
} = {}) {
  const driver = createOwnedLoopDriver({
    createAgent: (agentOpts) => createRealAgent({ ...agentOpts, env: { ...env, CX_MODEL_STANDARD: model } }),
  });

  await driver.start({ env: { ...env, CX_MODEL_STANDARD: model }, cwd });
  if (witness?.onAction) witness.onAction('prompt', prompt);

  const events = [];
  let text = '';
  let resolvedModel = model;
  const started = Date.now();

  for await (const event of driver.prompt(prompt, { model, env: { ...env, CX_MODEL_STANDARD: model } })) {
    events.push(event);
    if (witness?.onEvent) witness.onEvent(event);
    if (event.type === 'text') text += event.text || '';
    if (event.type === 'model_resolved' && event.model) resolvedModel = event.model;
    if (event.type === 'usage' && event.model) resolvedModel = event.model;
  }

  await driver.stop();
  const elapsedMs = Date.now() - started;

  return {
    prompt,
    text,
    events,
    model: resolvedModel,
    elapsedMs,
    transcript: text,
  };
}

export async function runRoleConversation(role, {
  env = process.env,
  cwd = process.cwd(),
  witness = null,
  promptIndex = 0,
} = {}) {
  const scenario = role.prompts[promptIndex];
  if (!scenario) throw new Error(`role ${role.id} has no prompt at index ${promptIndex}`);

  const primary = await runLiveTurn(scenario.text, { env, cwd, witness });
  let followUp = null;
  if (scenario.followUp) {
    followUp = await runLiveTurn(scenario.followUp, { env, cwd, witness });
  }

  return {
    roleId: role.id,
    scenarioId: scenario.id,
    primary,
    followUp,
    transcript: [primary.transcript, followUp?.transcript].filter(Boolean).join('\n\n---\n\n'),
  };
}
