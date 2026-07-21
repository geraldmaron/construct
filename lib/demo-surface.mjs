/**
 * lib/demo-surface.mjs — demo execution with recording surfaces and fallbacks.
 *
 * Default surface is VHS tape recording. Users may target Playwright explicitly.
 * When a recorder is unavailable, the runner prints the demo script steps.
 */

import { loadDemoScript, formatDemoWelcome, createDemoGuide } from './demo-script.mjs';
import { loadDemoRecording } from './demo-recording.mjs';
import { recordPlaywrightDemo } from './playwright-demo.mjs';
import { attachDemoOutcome, deriveDemoOk, persistDemoState } from './demo-state.mjs';

export const DEMO_SURFACES = ['tape', 'playwright'];

export function buildDemoAttemptChain(requestedSurface, { script, recording = null, interactive = true } = {}) {
  const chain = [];
  const push = (surface) => { if (!chain.includes(surface)) chain.push(surface); };

  if (requestedSurface === 'playwright') {
    push('playwright');
  } else {
    push('tape');
  }

  if (recording?.engine === 'playwright' && requestedSurface !== 'tape') push('playwright');
  push('tape');
  return chain;
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
  if (deriveDemoOk(result.state) || result.state === 'served') {
    return attachDemoOutcome({
      surface: 'tape',
      ...result,
      message: result.artifactPath
        ? `Recorded tape demo to ${result.artifactPath}`
        : `Tape source: ${result.tapePath}`,
    }, {
      cwd: opts.cwd,
      name,
      state: result.state || 'recorded',
    });
  }
  const tapeState = result.state || (result.sourceOnly ? 'unavailable' : 'failed');
  return attachDemoOutcome(
    { surface: 'tape', soft: !opts.required, ...result },
    { cwd: opts.cwd, name, state: tapeState },
  );
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
  if (deriveDemoOk(result.state)) {
    return attachDemoOutcome({ surface: 'playwright', ...result }, {
      cwd: opts.cwd,
      name,
      state: result.state || 'recorded',
    });
  }
  const playwrightState = result.state === 'unavailable' ? 'unavailable' : 'failed';
  return attachDemoOutcome(
    { surface: 'playwright', soft: true, ...result },
    { cwd: opts.cwd, name, state: playwrightState },
  );
}

function printScriptFallback(name, opts, notices = []) {
  const script = loadDemoScript(name, opts);
  if (!script) {
    return attachDemoOutcome(
      {
        surface: 'script',
        message: `Unknown demo: ${name}. Run \`construct demo list\` or add templates/demos/scripts/${name}.json`,
      },
      { cwd: opts.cwd, name, state: 'failed', persist: false },
    );
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
  return attachDemoOutcome(
    { surface: 'script', message: 'Printed demo script (all surfaces unavailable)' },
    { cwd: opts.cwd, name, state: 'script-only' },
  );
}

export async function runDemoGuided(name, {
  cwd = process.cwd(),
  repoRoot,
  surface = 'tape',
  format = 'mp4',
  out = null,
  sourceOnly = false,
  required = false,
  output,
  errorOutput,
} = {}) {
  const errOut = errorOutput || process.stderr;

  const opts = {
    cwd, repoRoot, format, out, sourceOnly, required, output, errorOutput: errOut,
  };

  const script = loadDemoScript(name, opts);
  const recording = loadDemoRecording(name, opts);
  const requested = DEMO_SURFACES.includes(surface) ? surface : 'tape';
  const interactive = Boolean((output || process.stdout).isTTY);
  const chain = buildDemoAttemptChain(requested, { script, recording, interactive });
  const notices = [];

  if (script || recording) {
    persistDemoState(name, { cwd, state: 'declared', enforceTransition: false });
    persistDemoState(name, { cwd, state: 'ready', enforceTransition: true });
    persistDemoState(name, { cwd, state: 'served', enforceTransition: true });
  }

  for (const attempt of chain) {
    let result;
    if (attempt === 'tape') result = await tryTapeDemo(name, opts);
    else if (attempt === 'playwright') result = tryPlaywrightDemo(name, opts);
    else continue;

    if (deriveDemoOk(result.state) || result.state === 'served') {
      persistDemoState(name, { cwd, state: 'executed', enforceTransition: true });
      return { ...result, notices, demoGuide: script ? createDemoGuide(script) : null };
    }
    if (result.message) notices.push(`${attempt} unavailable: ${result.message}`);
    if (!result.soft && !required) break;
  }

  persistDemoState(name, { cwd, state: 'executed', enforceTransition: true });
  return printScriptFallback(name, opts, notices);
}
