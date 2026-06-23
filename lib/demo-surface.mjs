/**
 * lib/demo-surface.mjs — chat-first demo execution with surface targeting and fallbacks.
 *
 * Default surface is construct chat (Ink on capable TTY, linear otherwise). Users
 * may target web, tape (VHS), or dashboard explicitly. When chat is unavailable
 * (no provider, non-interactive), the runner degrades through the script's
 * fallback chain without failing the command.
 */

import { spawnSync } from 'node:child_process';
import { hasAnySecret } from './providers/secret-resolver.mjs';
import { loadConstructEnv } from './env-config.mjs';
import { loadDemoScript, formatDemoWelcome, createDemoGuide } from './demo-script.mjs';
import { loadDemoRecording } from './demo-recording.mjs';
import { recordDashboardDemo } from './dashboard-demo.mjs';
import { recordPlaywrightDemo } from './playwright-demo.mjs';

export const DEMO_SURFACES = ['chat', 'web', 'tape', 'dashboard', 'playwright'];

const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_TOKEN'];

function which(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

export function detectChatDemoReady({ env = process.env, cwd = process.cwd() } = {}) {
  const effective = loadConstructEnv({ rootDir: cwd, env, warn: false });
  if (hasAnySecret(PROVIDER_KEYS, { env: effective, cwd })) {
    return { ready: true, reason: 'provider configured' };
  }
  if (which('ollama')) {
    return { ready: true, reason: 'local Ollama detected' };
  }
  return {
    ready: false,
    reason: 'No LLM provider configured. Set a key in ~/.construct/config.env, run `construct creds login copilot`, or start Ollama.',
  };
}

export function buildDemoAttemptChain(requestedSurface, { script, recording = null, interactive = true } = {}) {
  const chain = [];
  const push = (surface) => { if (!chain.includes(surface)) chain.push(surface); };

  if (requestedSurface === 'dashboard') {
    push('dashboard');
    push('playwright');
    push('chat');
    push('web');
  } else if (requestedSurface === 'playwright') {
    push('playwright');
    push('dashboard');
  } else if (requestedSurface === 'web') {
    push('web');
    push('chat');
  } else if (requestedSurface === 'tape') {
    push('tape');
    return chain;
  } else {
    push('chat');
    push('web');
  }

  if (script?.dashboardDemo && requestedSurface !== 'tape') push('dashboard');
  if (recording?.engine === 'playwright' && requestedSurface !== 'tape') push('playwright');
  push('tape');

  if (!interactive && recording?.engine === 'playwright') {
    const filtered = chain.filter((s) => s !== 'chat' && s !== 'web');
    return filtered.length ? filtered : ['tape'];
  }
  if (!interactive && chain[0] === 'chat') {
    const filtered = chain.filter((s) => s !== 'chat' && s !== 'web');
    return filtered.length ? filtered : ['tape'];
  }
  return chain;
}

function buildChatArgs(name, opts) {
  const args = [`--demo=${name}`];
  if (opts.web) args.push('--web');
  if (opts.plain) args.push('--plain');
  if (opts.accessible) args.push('--accessible');
  if (opts.free) args.push('--free');
  if (opts.model) args.push(`--model=${opts.model}`);
  return args;
}

async function tryChatDemo(name, opts, { web = false } = {}) {
  const readiness = detectChatDemoReady({ env: opts.env, cwd: opts.cwd });
  if (!readiness.ready) {
    return { ok: false, surface: web ? 'web' : 'chat', soft: true, message: readiness.reason };
  }

  const script = loadDemoScript(name, opts);
  if (!script) {
    return { ok: false, surface: web ? 'web' : 'chat', soft: true, message: `No demo script for ${name}` };
  }

  const chatArgs = buildChatArgs(name, { ...opts, web });
  const { runChat } = await import('./chat/cli.mjs');
  const code = await runChat(chatArgs, {
    cwd: opts.cwd,
    env: { ...opts.env, CONSTRUCT_DEMO: name },
    input: opts.input || process.stdin,
    output: opts.output || process.stdout,
    errorOutput: opts.errorOutput || process.stderr,
  });

  if (code === 0) {
    return { ok: true, surface: web ? 'web' : 'chat', message: `Demo ${name} finished in chat` };
  }
  return { ok: false, surface: web ? 'web' : 'chat', soft: true, message: `Chat exited ${code}` };
}

async function tryTapeDemo(name, opts, { sourceOnly = false } = {}) {
  const { runDemoRecord, resolveTapeSource, listProjectTapes } = await import('./demo.mjs');
  const tapeName = loadDemoScript(name, opts)?.tape || name;
  const hasTape = resolveTapeSource(tapeName, { cwd: opts.cwd })
    || listProjectTapes(opts.cwd).includes(tapeName);
  if (!hasTape) {
    return { ok: false, surface: 'tape', soft: true, message: `No tape for ${tapeName}` };
  }
  const result = runDemoRecord(tapeName, {
    cwd: opts.cwd,
    format: opts.format || 'mp4',
    out: opts.out,
    sourceOnly: sourceOnly || opts.sourceOnly,
    required: opts.required,
  });
  if (result.ok) {
    return {
      ok: true,
      surface: 'tape',
      ...result,
      message: result.artifactPath
        ? `Recorded tape demo to ${result.artifactPath}`
        : `Tape source: ${result.tapePath}`,
    };
  }
  return { ok: false, surface: 'tape', soft: !opts.required, ...result };
}

function tryPlaywrightDemo(name, opts) {
  const recording = loadDemoRecording(name, opts);
  if (!recording || recording.engine !== 'playwright') {
    return { ok: false, surface: 'playwright', soft: true, message: 'No Playwright recording configured' };
  }
  const result = recordPlaywrightDemo(recording, {
    cwd: opts.cwd,
    repoRoot: opts.repoRoot,
    outputPath: opts.out ? opts.out : null,
    format: opts.format || 'mp4',
  });
  if (result.ok) return { ok: true, surface: 'playwright', ...result };
  return { ok: false, surface: 'playwright', soft: true, ...result };
}

function tryDashboardDemo(name, opts) {
  const script = loadDemoScript(name, opts);
  const demoName = script?.dashboardDemo;
  if (!demoName) {
    return { ok: false, surface: 'dashboard', soft: true, message: 'No dashboard demo configured' };
  }
  const result = recordDashboardDemo(demoName, { cwd: opts.cwd, repoRoot: opts.repoRoot });
  if (result.ok) return { ok: true, surface: 'dashboard', ...result };
  return { ok: false, surface: 'dashboard', soft: true, ...result };
}

function printScriptFallback(name, opts, notices = []) {
  const script = loadDemoScript(name, opts);
  if (!script) {
    return {
      ok: false,
      surface: 'script',
      message: `Unknown demo: ${name}. Run \`construct demo list\` or add templates/demos/scripts/${name}.json`,
    };
  }
  const out = opts.output || process.stdout;
  for (const line of notices) out.write(`${line}\n`);
  out.write(`\n${formatDemoWelcome(script)}\n\n`);
  script.steps.forEach((step, i) => {
    out.write(`${i + 1}. ${step.title || 'Step'}\n`);
    if (step.prompt) out.write(`   prompt: ${step.prompt}\n`);
    if (step.command) out.write(`   command: ${step.command}\n`);
    out.write('\n');
  });
  return { ok: true, surface: 'script', message: 'Printed demo script (all surfaces unavailable)' };
}

export async function runDemoGuided(name, {
  cwd = process.cwd(),
  repoRoot,
  surface = 'chat',
  format = 'mp4',
  out = null,
  sourceOnly = false,
  required = false,
  model = null,
  plain = false,
  accessible = false,
  web = false,
  free = false,
  env = process.env,
  input,
  output,
  errorOutput,
} = {}) {
  const opts = {
    cwd, repoRoot, format, out, sourceOnly, required, model, plain, accessible, web, free, env, input, output, errorOutput,
  };

  const script = loadDemoScript(name, opts);
  const recording = loadDemoRecording(name, opts);
  const requested = web ? 'web' : (DEMO_SURFACES.includes(surface) ? surface : 'chat');
  const interactive = Boolean((input || process.stdin).isTTY && (output || process.stdout).isTTY);
  const chain = buildDemoAttemptChain(requested, { script, recording, interactive });
  const notices = [];

  for (const attempt of chain) {
    let result;
    if (attempt === 'chat') result = await tryChatDemo(name, opts, { web: false });
    else if (attempt === 'web') result = await tryChatDemo(name, opts, { web: true });
    else if (attempt === 'tape') result = await tryTapeDemo(name, opts);
    else if (attempt === 'playwright') result = tryPlaywrightDemo(name, opts);
    else if (attempt === 'dashboard') result = tryDashboardDemo(name, opts);
    else continue;

    if (result.ok) {
      return { ...result, notices, demoGuide: script ? createDemoGuide(script) : null };
    }
    if (result.message) notices.push(`${attempt} unavailable: ${result.message}`);
    if (!result.soft && !required) break;
  }

  return printScriptFallback(name, opts, notices);
}

export function resolveDemoGuideForChat(name, { cwd = process.cwd(), repoRoot } = {}) {
  const script = loadDemoScript(name, { cwd, repoRoot });
  if (!script) return null;
  return {
    script,
    guide: createDemoGuide(script),
    welcome: formatDemoWelcome(script),
    systemOverlay: script.systemOverlay,
  };
}
