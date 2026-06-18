/**
 * lib/chat/cli.mjs — `construct chat` command handler (zero-dep launcher).
 *
 * ADR-0041: Construct owns the loop. This launcher stays in the zero-dep core and
 * only orchestrates — it loads project settings, resolves the model, builds the
 * owned-loop driver (apps/chat/engine, which lazy-imports the optional Vercel AI
 * SDK and provider packages), persists the normalized event timeline under
 * .cx/chat-sessions/, and then chooses a surface.
 *
 * Surface selection is the accessibility contract: the rich multi-pane Ink TUI is
 * the default only on a capable interactive TTY; `--plain`, `--accessible`,
 * NO_COLOR, TERM=dumb, and any non-TTY stream route to the linear, screen-reader
 * friendly renderer (lib/chat/tui/render.mjs). Both consume the same event union,
 * so there is one event model and two renderers. If the rich surface or its
 * optional dependencies are unavailable, the launcher falls back to linear with a
 * one-line notice rather than failing.
 *
 * `--list` reports the model catalog and which providers are configured; `--model`
 * pins the model for this launch; `--resume` restores the latest (or given) session
 * transcript from `.cx/chat-sessions/`; the `--no-*` flags override saved transparency
 * layers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProjectScopedPath } from '../project-root.mjs';
import { resolveColors } from '../term-format.mjs';
import { resolveLayers, planTurn } from './transparency.mjs';
import { runChatLoop } from './tui/render.mjs';
import { createSessionUsage } from './tui/usage.mjs';
import { loadChatConfig } from './config.mjs';
import { createCommands } from './commands.mjs';
import { resolveResumePath, restoreFromSession } from './session-restore.mjs';
import { createOwnedLoopDriver } from '../../apps/chat/engine/loop-driver.mjs';
import { resolveChatModelSelectionAsync, resolveFreeOpenRouterModel, listChatModels } from '../../apps/chat/engine/models.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const INK_BUNDLE = path.join(REPO_ROOT, 'apps', 'chat', 'dist', 'tui.mjs');

function parseFlags(args) {
  const flags = { plain: false, accessible: false, list: false, quiet: false, free: false, model: null, resume: null, ascii: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list') flags.list = true;
    else if (arg === '--plain') flags.plain = true;
    else if (arg === '--accessible') flags.accessible = true;
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
  try {
    const dir = resolveProjectScopedPath('chat-sessions', { cwd });
    fs.mkdirSync(dir, { recursive: true });
    const file = resumePath || path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-construct-${sessionId}.jsonl`);
    if (!resumePath) {
      fs.appendFileSync(file, `${JSON.stringify({ type: 'session_start', host: 'construct', sessionId, ts: new Date().toISOString() })}\n`);
    }
    const append = (row) => {
      try { fs.appendFileSync(file, `${JSON.stringify({ ...row, ts: new Date().toISOString() })}\n`); } catch { /* log is best-effort */ }
    };
    return {
      filePath: file,
      event: (event) => append(event),
      transcript: (role, text) => append({ type: 'transcript', role, text }),
    };
  } catch {
    return null;
  }
}

function resolveAsciiMode({ flags, env, config }) {
  if (flags.ascii === true) return true;
  if (env.CX_CHAT_ASCII === '1') return true;
  return Boolean(config.ui?.ascii);
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

// The rich surface is the default only when the terminal can host it: an
// interactive TTY, color allowed, not a dumb terminal, and the user did not opt
// into the linear/accessible path. Everything else uses the linear renderer.

function wantsRichSurface({ flags, env, output, input }) {
  if (flags.plain || flags.accessible) return false;
  if (env.NO_COLOR || env.TERM === 'dumb') return false;
  if (env.CX_CHAT_FORCE_LINEAR === '1') return false;
  return Boolean(output.isTTY) && Boolean(input.isTTY);
}

export async function runChat(args = [], { env = process.env, cwd = process.cwd(), input = process.stdin, output = process.stdout, errorOutput = process.stderr } = {}) {
  const flags = parseFlags(args);

  if (flags.list) { printModels(output, env); return 0; }

  const { config } = loadChatConfig({ cwd });
  const effectiveEnv = flags.plain ? { ...env, NO_COLOR: '1' } : env;

  if (flags.free) {
    const freeModel = await resolveFreeOpenRouterModel({ env: effectiveEnv, tier: 'standard' });
    if (!freeModel) {
      errorOutput.write('OpenRouter free models require OPENROUTER_API_KEY (a value or op:// ref in ~/.construct/config.env).\n');
      return 1;
    }
    flags.model = freeModel;
  }

  // Saved layers seed the run; --no-* overrides win for this launch.
  const layers = resolveLayers({ flags, env: effectiveEnv });
  for (const key of Object.keys(config.layers)) {
    if (flags[key] === undefined && config.layers[key] === false) layers[key] = false;
  }
  if (config.thinking === false && flags.thinking === undefined) layers.thinking = false;

  const resumePath = resolveResumePath({ cwd, resume: flags.resume });
  const restored = resumePath ? restoreFromSession(resumePath) : null;

  const modelResolution = await resolveChatModelSelectionAsync({
    env: effectiveEnv,
    requested: flags.model || config.model || null,
  });

  const session = {
    model: modelResolution.id,
    modelNotice: modelResolution.notice || null,
    layers,
    thinking: layers.thinking,
    permissionMode: config.permissionMode || 'allow_once',
    sandbox: config.sandbox || 'workspace-write',
    ui: { ascii: resolveAsciiMode({ flags, env: effectiveEnv, config }) },
    usage: restored?.usage || createSessionUsage(),
  };

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

  const driver = createOwnedLoopDriver({ env: effectiveEnv, cwd, model: session.model, handlers, createAgent });

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
  if (!session.model) {
    notices.push('no model resolved \u2014 set a provider key or run `construct creds login copilot`, then use /model');
  }
  if (flags.resume && !restored?.sessionFile) {
    notices.push('no prior session found to resume \u2014 starting fresh');
  } else if (restored?.sessionFile && restored.transcript.length) {
    notices.push(`resumed ${restored.transcript.length} message(s) from ${path.basename(restored.sessionFile)}`);
  }

  const persist = createPersister({ cwd, sessionId: started.sessionId, resumePath: restored?.sessionFile || null });
  const commands = createCommands({ driver, host: 'construct', hostId: 'construct', version: null, cwd });

  try {
    let ranRich = false;
    if (wantsRichSurface({ flags, env: effectiveEnv, output, input })) {
      try {
        const tui = await import(INK_BUNDLE);
        await tui.runInkChat({
          driver,
          session,
          layers,
          planTurn: (text) => planTurn(text, { env: effectiveEnv }),
          persist,
          cwd,
          permissionBridge,
          initialTranscript: restored?.transcript || [],
        });
        ranRich = true;
      } catch (err) {
        notices.push(`rich TUI unavailable (${err.message.split('\n')[0]}); using linear mode \u2014 build it with \`npm run build:chat\``);
      }
    }

    if (!ranRich) {
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
      });
    }
  } finally {
    try { driver.stop?.(); } catch { /* already stopped */ }
  }
  return 0;
}
