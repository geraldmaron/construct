/**
 * lib/chat/web-session.mjs — owned-loop runtime factory for browser chat.
 *
 * Builds the same driver + session shape as lib/chat/cli.mjs so dashboard SSE
 * and construct chat --web share one configuration path. One runtime instance
 * is kept per conversation id for the lifetime of the server process.
 */
import { randomBytes } from 'crypto';
import { createOwnedLoopDriver } from '../../apps/chat/engine/loop-driver.mjs';
import { resolveChatModelSelectionAsync, resolveSessionModel } from '../../apps/chat/engine/models.mjs';
import { loadChatConfig, saveChatConfig, resolveChatModelLaunch } from './config.mjs';
import { loadConstructEnv } from '../env-config.mjs';
import { resolveLayers } from './transparency.mjs';
import { buildSystemPrompt } from './system-prompt.mjs';
import { createSessionUsage } from './tui/usage.mjs';
import { resolveExecutionCapabilityProfile } from '../models/execution-capability-profile.mjs';
import { compileExecutionPolicy } from '../models/execution-policy.mjs';
import { resolveDemoGuideForChat } from '../demo-surface.mjs';

const runtimes = new Map();
const pendingPermissions = new Map();

function createPermissionHandler({ session, onPermission = null }) {
  return async (req) => {
    const mode = session.permissionMode || 'allow_once';
    if (mode === 'reject') return 'reject';
    if (mode === 'allow_always') return 'allow_always';
    if (mode === 'allow_once') return 'allow';
    if (mode === 'ask') {
      const requestId = req.requestId || `perm-${randomBytes(8).toString('hex')}`;
      onPermission?.({
        type: 'permission',
        requestId,
        toolCall: { title: req.tool || req.toolCall?.title || 'tool', input: req.input ?? null },
        options: ['allow', 'allow_always', 'reject'],
      });
      return new Promise((resolve) => {
        pendingPermissions.set(requestId, { resolve, req, convId: session.convId });
        setTimeout(() => {
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId);
            resolve('reject');
          }
        }, 120_000);
      });
    }
    return 'allow';
  };
}

export function resolveWebPermission(requestId, decision) {
  const pending = pendingPermissions.get(requestId);
  if (!pending) return false;
  pendingPermissions.delete(requestId);
  pending.resolve(decision);
  return true;
}

export function listPendingPermissions(convId) {
  return [...pendingPermissions.entries()]
    .filter(([, p]) => p.convId === convId)
    .map(([requestId, p]) => ({
      requestId,
      title: p.req?.toolCall?.title || 'tool',
      options: p.req?.options || ['allow', 'reject'],
    }));
}

export function getWebChatRuntime(convId) {
  return runtimes.get(convId) || null;
}

export async function ensureWebChatRuntime({
  convId,
  cwd = process.cwd(),
  env = process.env,
  onPermission = null,
} = {}) {
  if (runtimes.has(convId)) return runtimes.get(convId);

  const effectiveEnv = loadConstructEnv({ rootDir: cwd, env, warn: false });
  const { config } = loadChatConfig({ cwd });
  const layers = resolveLayers({ flags: {}, env: effectiveEnv });
  for (const key of Object.keys(config.layers || {})) {
    if (config.layers[key] === false) layers[key] = false;
  }

  const launch = resolveChatModelLaunch({ config, env: effectiveEnv });
  if (launch.migrated) {
    try {
      saveChatConfig({ ...config, model: null, modelMode: 'follow-tier' }, { cwd });
    } catch { /* persistence is best-effort */ }
  }
  const modelMode = launch.modelMode;
  let resolvedModel = launch.requested;
  if (modelMode === 'free-router') {
    const sessionStub = { modelMode: 'free-router', failedModels: new Set() };
    resolvedModel = await resolveSessionModel(sessionStub, { env: effectiveEnv, tier: 'standard' });
  }

  const modelResolution = modelMode === 'free-router' && resolvedModel
    ? { id: resolvedModel, notice: null }
    : await resolveChatModelSelectionAsync({
      env: effectiveEnv,
      requested: modelMode === 'pinned' ? resolvedModel : null,
    });

  const demoName = effectiveEnv.CONSTRUCT_DEMO || null;
  const demoPack = demoName ? resolveDemoGuideForChat(demoName, { cwd, repoRoot: cwd }) : null;

  const session = {
    convId,
    model: modelResolution.id || resolvedModel,
    modelMode,
    permissionMode: config.permissionMode || 'allow_once',
    sandbox: config.sandbox || 'workspace-write',
    layers,
    usage: createSessionUsage(),
    demoGuide: demoPack?.guide || null,
    demoTitle: demoPack?.script?.title || null,
  };

  const handlers = {
    getSandbox: () => session.sandbox,
    getPermissionMode: () => session.permissionMode,
    requestPermission: createPermissionHandler({ session, onPermission }),
  };

  const { createAiSdkAgent } = await import('../../apps/chat/engine/ai-sdk-agent.mjs');
  const driver = createOwnedLoopDriver({
    env: effectiveEnv,
    cwd,
    model: session.model,
    handlers,
    systemPrompt: buildSystemPrompt({
      capabilityTier: compileExecutionPolicy({
        profile: resolveExecutionCapabilityProfile({ model: session.model }),
      }).prompt.systemPromptTier,
    }),
    createAgent: (opts) => createAiSdkAgent(opts),
  });

  const runtime = { convId, driver, session, layers, cwd, env: effectiveEnv, _started: false };
  runtimes.set(convId, runtime);

  if (!demoPack?.guide) {
    await driver.start();
    runtime._started = true;
  }

  return runtime;
}

export async function ensureDriverStarted(runtime) {
  if (!runtime || runtime._started) return runtime;
  await runtime.driver.start();
  runtime._started = true;
  return runtime;
}

export const createWebChatRuntime = ensureWebChatRuntime;

export function dropWebChatRuntime(convId) {
  const runtime = runtimes.get(convId);
  if (!runtime) return;
  try { runtime.driver.stop?.(); } catch { /* already stopped */ }
  runtimes.delete(convId);
}
