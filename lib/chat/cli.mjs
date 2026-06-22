/**
 * lib/chat/cli.mjs — `construct chat` command handler (zero-dep launcher).
 *
 * ADR-0041: Construct owns the loop. This launcher stays in the zero-dep core and
 * only orchestrates — it loads project settings, resolves the model, builds the
 * owned-loop driver (apps/chat/engine, which lazy-imports the optional Vercel AI
 * SDK and provider packages), persists the normalized event timeline under
 * .cx/chat-sessions/, and then chooses a surface.
 *
 * Surface selection: desktop window (Tauri or Chromium app mode) is the default on
 * machines with a display; `--web` opens a browser tab; `--plain`, `--accessible`,
 * NO_COLOR, TERM=dumb, and non-TTY streams route to the linear renderer.
 * `--window` is an alias for the desktop path. `--no-window` forces a browser tab.
 *
 * `--list` reports the model catalog and which providers are configured; `--model`
 * pins the model for this launch; `--resume` restores the latest (or given) session
 * transcript from `.cx/chat-sessions/`; the `--no-*` flags override saved transparency
 * layers.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveColors } from '../term-format.mjs';
import { resolveLayers } from './transparency.mjs';
import { runChatLoop } from './tui/render.mjs';
import { createSessionUsage } from './tui/usage.mjs';
import { loadChatConfig } from './config.mjs';
import { loadConstructEnv } from '../env-config.mjs';
import { createCommands } from './commands.mjs';
import { resolveResumePath, restoreFromSession } from './session-restore.mjs';
import { buildSystemPrompt } from './system-prompt.mjs';
import { resolveExecutionCapabilityProfile } from '../models/execution-capability-profile.mjs';
import { compileExecutionPolicy } from '../models/execution-policy.mjs';
import { createChatPersister } from './session-persist.mjs';
import { hasGuiDisplay } from './desktop-binary.mjs';
import { createOwnedLoopDriver } from '../../apps/chat/engine/loop-driver.mjs';
import { listChatModels, resolveChatModelSelectionAsync, resolveSessionModel } from '../../apps/chat/engine/models.mjs';
import { resolveDemoGuideForChat } from '../demo-surface.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function parseFlags(args) {
  const flags = {
    plain: false,
    accessible: false,
    web: false,
    window: false,
    noWindow: false,
    list: false,
    quiet: false,
    free: false,
    model: null,
    resume: null,
    ascii: null,
    demo: null,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list') flags.list = true;
    else if (arg === '--plain') flags.plain = true;
    else if (arg === '--accessible') flags.accessible = true;
    else if (arg === '--web') flags.web = true;
    else if (arg === '--window') flags.window = true;
    else if (arg === '--no-window') flags.noWindow = true;
    else if (arg === '--quiet') flags.quiet = true;
    else if (arg === '--free') flags.free = true;
    else if (arg === '--ascii') flags.ascii = true;
    else if (arg === '--resume') flags.resume = true;
    else if (arg.startsWith('--resume=')) flags.resume = arg.slice('--resume='.length);
    else if (arg === '--no-thinking') flags.thinking = false;
    else if (arg === '--no-path') flags.path = false;
    else if (arg === '--no-specialists') flags.specialists = false;
    else if (arg === '--no-tools') flags.tools = false;
    else if (arg === '--no-observability') flags.observability = false;
    else if (arg === '--model') flags.model = args[++i] || null;
    else if (arg.startsWith('--model=')) flags.model = arg.slice('--model='.length);
    else if (arg === '--demo') flags.demo = args[++i] || null;
    else if (arg.startsWith('--demo=')) flags.demo = arg.slice('--demo='.length);
  }
  return flags;
}

function printModels(output, env) {
  const colors = resolveColors({ stream: output, env });
  const models = listChatModels({ env });
  const configured = models.filter((m) => m.configured);
  output.write(`${colors.bold}Owned loop \u2014 model catalog${colors.reset}\n`);
  if (!configured.length) {
    output.write(`${colors.dim}No provider configured. Set a key (a value or an op:// reference) in ~/.construct/config.env, run \`construct creds login copilot\` for GitHub Copilot, or start Ollama locally.${colors.reset}\n`);
  }
  for (const m of models) {
    const mark = m.configured ? `${colors.green}\u2713${colors.reset}` : `${colors.dim}\u00b7${colors.reset}`;
    output.write(`  ${mark} ${m.id}${m.local ? `${colors.dim} (local)${colors.reset}` : ''}\n`);
  }
}

function createPersister({ cwd, sessionId, resumePath = null }) {
  return createChatPersister({ cwd, sessionId, resumePath, host: 'construct' });
}

function wantsLinearSurface({ flags, env, output, input }) {
  if (flags.plain || flags.accessible) return true;
  if (env.NO_COLOR || env.TERM === 'dumb') return true;
  if (env.CX_CHAT_FORCE_LINEAR === '1') return true;
  if (!output.isTTY || !input.isTTY) return true;
  return false;
}

function resolveChatSurface({ flags, env, output, input }) {
  if (wantsLinearSurface({ flags, env, output, input })) return 'linear';
  if (flags.web || flags.noWindow) return 'web';
  if (flags.window || env.CONSTRUCT_CHAT_WINDOW === '1' || hasGuiDisplay(env)) return 'desktop';
  return 'headless';
}

// Desktop means the native construct-chat window: an existing binary, or Tauri
// source that runDesktopChat builds on demand. A browser does not qualify;
// `construct chat --web` is the explicit browser path.

async function canLaunchDesktop(env, cwd = process.cwd()) {
  const { hasGuiDisplay, resolveDesktopBinary } = await import('./desktop-binary.mjs');
  if (!hasGuiDisplay(env)) return false;
  if (resolveDesktopBinary()) return true;
  const { hasDesktopSource } = await import('./desktop-build.mjs');
  return hasDesktopSource(cwd);
}

function resolveAsciiMode({ flags, env, config }) {
  if (flags.ascii === true) return true;
  if (env.CX_CHAT_ASCII === '1') return true;
  if (config.ui?.ascii) return true;
  if (process.platform === 'win32' && !env.WT_SESSION && !env.WT_PROFILE_ID && env.TERM !== 'xterm-256color') {
    return true;
  }
  return false;
}

function createPermissionHandler({ session, bridge }) {
  return async (req) => {
    const mode = session.permissionMode || 'allow_once';
    if (mode === 'reject') return 'reject';
    if (mode === 'allow_always') return 'allow_always';
    if (mode === 'allow_once') return 'allow';
    if (mode === 'ask' && bridge?.prompt) return bridge.prompt(req);
    return 'allow';
  };
}

export async function runChat(args = [], { env = process.env, cwd = process.cwd(), input = process.stdin, output = process.stdout, errorOutput = process.stderr } = {}) {
  const flags = parseFlags(args);
  if (!flags.demo && env.CONSTRUCT_DEMO) flags.demo = env.CONSTRUCT_DEMO;

  const effectiveEnv = loadConstructEnv({ rootDir: cwd, env: flags.plain ? { ...env, NO_COLOR: '1' } : env, warn: false });

  if (flags.list) { printModels(output, effectiveEnv); return 0; }

  const { config } = loadChatConfig({ cwd });

  let modelMode = config.modelMode || 'pinned';
  if (flags.free) modelMode = 'free-router';

  const savedModel = flags.model || (modelMode === 'pinned' ? config.model : null) || null;

  let resolvedModel = savedModel;
  if (modelMode === 'free-router') {
    const sessionStub = { modelMode: 'free-router', failedModels: new Set() };
    resolvedModel = await resolveSessionModel(sessionStub, { env: effectiveEnv, tier: 'standard' });
    if (!resolvedModel && !flags.list) {
      errorOutput.write('OpenRouter free router needs OPENROUTER_API_KEY in ~/.construct/config.env, or no free models are available.\n');
      return 1;
    }
  }

  // Saved layers seed the run; --no-* overrides win for this launch.
  const layers = resolveLayers({ flags, env: effectiveEnv });
  for (const key of Object.keys(config.layers)) {
    if (flags[key] === undefined && config.layers[key] === false) layers[key] = false;
  }
  if (config.thinking === false && flags.thinking === undefined) layers.thinking = false;

  const resumePath = resolveResumePath({ cwd, resume: flags.resume });
  const restored = resumePath ? restoreFromSession(resumePath) : null;

  const demoPack = flags.demo
    ? resolveDemoGuideForChat(flags.demo, { cwd, repoRoot: REPO_ROOT })
    : null;

  const modelResolution = modelMode === 'free-router' && resolvedModel
    ? { id: resolvedModel, source: 'free-router', notice: null, rejected: [] }
    : await resolveChatModelSelectionAsync({
      env: effectiveEnv,
      requested: savedModel,
    });

  const session = {
    model: modelResolution.id || resolvedModel,
    savedModel: modelMode === 'pinned' ? (savedModel || modelResolution.id) : null,
    modelMode,
    modelNotice: modelResolution.notice || null,
    failedModels: new Set(),
    layers,
    thinking: layers.thinking,
    permissionMode: config.permissionMode || 'allow_once',
    sandbox: config.sandbox || 'workspace-write',
    ui: {
      ascii: resolveAsciiMode({ flags, env: effectiveEnv, config }),
      inspector: config.ui?.inspector || 'auto',
      theme: config.ui?.theme || 'auto',
    },
    usage: restored?.usage || createSessionUsage(),
    demoGuide: demoPack?.guide || null,
    demoTitle: demoPack?.script?.title || null,
  };

  let surface = resolveChatSurface({ flags, env: effectiveEnv, output, input });

  if (surface === 'headless') {
    errorOutput.write('No graphical display available. Use `construct chat --plain` for terminal mode.\n');
    return 1;
  }

  if (surface === 'desktop') {
    if (!(await canLaunchDesktop(effectiveEnv, cwd))) {
      errorOutput.write('No graphical display available. Use `construct chat --plain` for terminal mode, or `construct chat --web` for a browser tab.\n');
      return 1;
    }
    try {
      const { runDesktopChat } = await import('./desktop-launcher.mjs');
      return runDesktopChat({ cwd, env: effectiveEnv, output, errorOutput });
    } catch (err) {
      errorOutput.write(`Desktop chat unavailable: ${err.message}\n`);
      return 1;
    }
  }

  if (surface === 'web') {
    try {
      const { runWebChat } = await import('./web-launcher.mjs');
      return runWebChat({ cwd, env: effectiveEnv, output, errorOutput });
    } catch (err) {
      errorOutput.write(`Web chat unavailable: ${err.message}\n`);
      return 1;
    }
  }

  const permissionBridge = { prompt: null };
  const handlers = {
    getSandbox: () => session.sandbox,
    getPermissionMode: () => session.permissionMode,
    requestPermission: createPermissionHandler({ session, bridge: permissionBridge }),
  };

  const createAgent = async (opts) => {
    const { createAiSdkAgent } = await import('../../apps/chat/engine/ai-sdk-agent.mjs');
    return createAiSdkAgent(opts);
  };

  const driver = createOwnedLoopDriver({
    env: effectiveEnv,
    cwd,
    model: session.model,
    handlers,
    systemPrompt: (() => {
      const base = buildSystemPrompt({ capabilityTier: compileExecutionPolicy({ profile: resolveExecutionCapabilityProfile({ model: session.model }) }).prompt.systemPromptTier });
      return demoPack?.systemOverlay ? `${base}\n\nDemo script:\n${demoPack.systemOverlay}` : base;
    })(),
    createAgent,
  });

  let started;
  try {
    started = await driver.start();
  } catch (err) {
    const hint = /Cannot find package|ERR_MODULE_NOT_FOUND|find module/i.test(err.message)
      ? '\nThe owned loop needs its optional dependencies. Install them with:\n  npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/openai-compatible zod'
      : '';
    errorOutput.write(`Failed to start the owned loop: ${err.message}${hint}\n`);
    try { driver.stop?.(); } catch { /* nothing started */ }
    return 1;
  }

  const notices = [];
  if (modelResolution.notice) notices.push(modelResolution.notice);
  if (demoPack?.welcome) notices.push(demoPack.welcome);
  if (!session.model) {
    notices.push('no model resolved \u2014 set a provider key or run `construct creds login copilot`, then use /model');
  }
  if (flags.resume && !restored?.sessionFile) {
    notices.push('no prior session found to resume \u2014 starting fresh');
  } else if (restored?.sessionFile && (restored.turnBlocks?.length || restored.transcript.length)) {
    const count = restored.turnBlocks?.length || restored.transcript.length;
    notices.push(`resumed ${count} turn(s) from ${path.basename(restored.sessionFile)}`);
  }

  const persist = createPersister({ cwd, sessionId: started.sessionId, resumePath: restored?.sessionFile || null });
  const commands = createCommands({
    driver,
    host: 'construct',
    hostId: 'construct',
    version: null,
    cwd,
    env: effectiveEnv,
    turnBlocksRef: () => [],
    demoGuide: demoPack?.guide || null,
  });

  try {
    await runChatLoop({
      driver,
      host: 'construct',
      version: null,
      layers,
      input,
      env: effectiveEnv,
      output,
      persist,
      commands,
      session,
      notices,
      permissionBridge,
      initialTranscript: restored?.transcript || [],
      initialTurnBlocks: restored?.turnBlocks || [],
      cwd,
      flags,
    });
  } finally {
    try { driver.stop?.(); } catch { /* already stopped */ }
  }
  return 0;
}

export { resolveChatSurface, wantsLinearSurface };
