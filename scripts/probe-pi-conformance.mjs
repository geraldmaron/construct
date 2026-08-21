#!/usr/bin/env node
/**
 * scripts/probe-pi-conformance.mjs — check the pinned expectations in
 * src/hosts/pi/pin.ts against a live `pi` binary.
 *
 * pi has no subscription-backed path this probe could default to: its Claude
 * Pro/Max login is interactive-only, with no non-interactive equivalent, and
 * it registers no MCP client at all (docs/host-trial-pi.md). Development
 * model calls otherwise come from Gerald's Claude Code or Cursor
 * subscriptions, never a local server (CLAUDE.md); with neither reachable
 * through pi, this probe refuses without --model rather than picking one for
 * you. `pi` takes provider and model as two separate flags; --model here
 * still takes a single "provider/model" string for consistency with the
 * other probes in this repo and is split before being passed on. Ollama only
 * becomes reachable once a `models.json` custom-provider entry names it (see
 * src/hosts/pi/pin.ts) — this probe assumes that hand-authoring has already
 * happened on the measuring machine for the checks that need a real model
 * call; the negative case (a fresh config directory with none of that done)
 * is checked separately and does not depend on it.
 *
 *   node scripts/probe-pi-conformance.mjs --model ollama/qwen3.5:4b   # explicit opt-in, once hand-configured above
 *   node scripts/probe-pi-conformance.mjs [--binary /path/to/pi] --model <provider>/<model>
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPECTATIONS, PINNED_VERSION } from '../src/hosts/pi/pin.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const binary = flag('binary', 'pi');
const modelArg = flag('model', undefined);
if (!modelArg) {
  console.error(
    'pi has no subscription-backed path: its Claude Pro/Max login is\n' +
      'interactive-only and it registers no MCP client at all, so nothing here\n' +
      'can choose a model for you. Pass --model <provider>/<model> naming a\n' +
      "provider already hand-configured in pi's own models.json (see\n" +
      'src/hosts/pi/pin.ts) — for example --model ollama/qwen3.5:4b to probe\n' +
      'against a local model on purpose.',
  );
  process.exit(2);
}
const slash = modelArg.indexOf('/');
if (slash === -1) {
  console.error(`--model must be <provider>/<model>, e.g. ollama/qwen3.5:4b (got "${modelArg}")`);
  process.exit(2);
}
const provider = modelArg.slice(0, slash);
const model = modelArg.slice(slash + 1);

const checked = new Set();
let failed = 0;

function pass(name, detail) {
  checked.add(name);
  console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  checked.add(name);
  failed += 1;
  console.log(`  FAIL  ${name} — ${detail}`);
}

function run(cmd, cmdArgs, options = {}) {
  const { cwd, env, timeoutMs = 60000 } = options;
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', () => resolve({ code: null, stdout, stderr }));
  });
}

/** Parse stdout as NDJSON, silently dropping any line that is not valid JSON. */
function ndjsonEvents(stdout) {
  return stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e !== null);
}

console.log(`probe-pi-conformance against "${binary}" (pinned: ${PINNED_VERSION}), provider=${provider} model=${model}`);

// version-flag-reports-the-version
const version = await run(binary, ['--version']);
const versionLines = version.stdout.split('\n').filter((l) => l.trim());
if (version.code === 0 && versionLines.length === 1 && /^\d+\.\d+\.\d+$/.test(versionLines[0].trim())) {
  const installed = versionLines[0].trim();
  pass('version-flag-reports-the-version', installed);
  if (installed !== PINNED_VERSION) {
    console.log(`  NOTE  installed ${installed} != pinned ${PINNED_VERSION}: re-verify before updating the pin`);
  }
} else {
  fail('version-flag-reports-the-version', `exit ${version.code}: ${JSON.stringify(version.stdout)}`);
}

const dir = mkdtempSync(join(tmpdir(), 'pi-probe-'));
try {
  // print-is-the-documented-non-interactive-entry-point
  const printRun = await run(
    binary,
    ['--print', '--provider', provider, '--model', model, '--no-session', 'Reply with exactly the word: pong'],
    { cwd: dir },
  );
  if (printRun.code === 0 && printRun.stdout.includes('pong')) {
    pass('print-is-the-documented-non-interactive-entry-point', `exit 0, stdout ${JSON.stringify(printRun.stdout.trim().slice(0, 60))}`);
  } else {
    fail(
      'print-is-the-documented-non-interactive-entry-point',
      `exit ${printRun.code}; stdout: ${printRun.stdout.slice(0, 200)}; stderr: ${printRun.stderr.slice(0, 200)}`,
    );
  }

  // mode-json-emits-ndjson-session-transcript, usage-cost-is-locally-computed-not-provider-reported
  const jsonRun = await run(
    binary,
    ['--print', '--mode', 'json', '--provider', provider, '--model', model, '--no-session', 'Reply with exactly the word: pong'],
    { cwd: dir },
  );
  const events = ndjsonEvents(jsonRun.stdout);
  const types = events.map((e) => e.type);
  const hasCoreSequence =
    types[0] === 'session' &&
    types.includes('agent_start') &&
    types.includes('turn_start') &&
    types.includes('message_start') &&
    types.includes('message_end') &&
    types.includes('turn_end') &&
    types.at(-2) === 'agent_end' &&
    types.at(-1) === 'agent_settled';
  if (jsonRun.code === 0 && events.length > 0 && hasCoreSequence) {
    pass('mode-json-emits-ndjson-session-transcript', `${events.length} events; distinct types: ${[...new Set(types)].join(',')}`);
  } else {
    fail('mode-json-emits-ndjson-session-transcript', `exit ${jsonRun.code}; ${events.length} parsed events; types: ${JSON.stringify(types)}`);
  }

  const agentEnd = events.find((e) => e.type === 'agent_end');
  const lastAssistant = agentEnd?.messages?.filter((m) => m.role === 'assistant').at(-1);
  const usage = lastAssistant?.usage;
  if (usage && typeof usage.totalTokens === 'number' && usage.cost && typeof usage.cost.total === 'number' && usage.cost.total === 0) {
    pass(
      'usage-cost-is-locally-computed-not-provider-reported',
      `totalTokens ${usage.totalTokens}, cost.total ${usage.cost.total} — an unrated local model reads as exactly free`,
    );
  } else {
    fail('usage-cost-is-locally-computed-not-provider-reported', JSON.stringify(usage));
  }

  // tools-are-on-by-default: a task that genuinely requires a tool, rather
  // than hoping the model spontaneously reaches for one on a trivial prompt
  // (the pin's own recorded observation is exactly that coin flip).
  writeFileSync(join(dir, 'probe-notes.txt'), 'alpha\nbeta\ngamma\n');
  const toolRun = await run(
    binary,
    [
      '--print',
      '--mode', 'json',
      '--provider', provider,
      '--model', model,
      '--no-session',
      'Use the read tool to read probe-notes.txt and quote its exact contents back to me',
    ],
    { cwd: dir },
  );
  if (toolRun.code === 0 && /"type":"toolCall"/.test(toolRun.stdout)) {
    pass('tools-are-on-by-default', 'a toolCall event appeared with no --tools flag passed');
  } else {
    fail('tools-are-on-by-default', `exit ${toolRun.code}; no toolCall event in ${toolRun.stdout.length} bytes of stdout`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// zero-providers-are-configured-out-of-the-box
const freshConfigDir = mkdtempSync(join(tmpdir(), 'pi-probe-freshconf-'));
try {
  const freshEnv = { ...process.env, PI_CODING_AGENT_DIR: freshConfigDir };
  const listed = await run(binary, ['--list-models'], { env: freshEnv });
  // Any provider name proves this claim on a fresh config dir, since none is
  // configured yet — the string below is deliberately not "ollama" or any
  // other real provider, so this reads as the negative-path probe it is
  // rather than as a sourcing default.
  const bareUnconfigured = await run(
    binary,
    ['--print', '--provider', 'construct-probe-unconfigured-provider', '--model', model, '--no-session', 'Reply: pong'],
    { env: freshEnv },
  );
  const reportsEmpty = listed.code === 0 && /no models available/i.test(listed.stdout);
  const bareProviderFails = bareUnconfigured.code !== 0 && /unknown provider/i.test(bareUnconfigured.stderr);
  if (reportsEmpty && bareProviderFails) {
    pass(
      'zero-providers-are-configured-out-of-the-box',
      `fresh config dir: --list-models reports none, and an unconfigured --provider fails client-side ("${bareUnconfigured.stderr.trim()}")`,
    );
  } else {
    fail(
      'zero-providers-are-configured-out-of-the-box',
      `--list-models exit ${listed.code} ${JSON.stringify(listed.stdout.slice(0, 120))}; bare unconfigured-provider exit ${bareUnconfigured.code} ${JSON.stringify(bareUnconfigured.stderr.slice(0, 120))}`,
    );
  }
} finally {
  rmSync(freshConfigDir, { recursive: true, force: true });
}

// unknown-model-is-forwarded-not-refused, failed-turn-exit-signal-depends-on-mode
const bogusDir = mkdtempSync(join(tmpdir(), 'pi-probe-bogus-'));
try {
  const bogusText = await run(
    binary,
    ['--print', '--provider', provider, '--model', 'construct-probe-nonexistent-model', '--no-session', 'Reply: pong'],
    { cwd: bogusDir },
  );
  const warnedAndForwarded = /not found for provider/i.test(bogusText.stderr) && /using custom model id/i.test(bogusText.stderr);
  if (warnedAndForwarded) {
    pass('unknown-model-is-forwarded-not-refused', `stderr warned and still placed the request: ${bogusText.stderr.trim().split('\n')[0]}`);
  } else {
    fail('unknown-model-is-forwarded-not-refused', `stderr: ${bogusText.stderr.slice(0, 200)}`);
  }

  const textModeClean = bogusText.code === 1 && bogusText.stdout === '';
  const bogusJson = await run(
    binary,
    ['--print', '--mode', 'json', '--provider', provider, '--model', 'construct-probe-nonexistent-model', '--no-session', 'Reply: pong'],
    { cwd: bogusDir },
  );
  const jsonEvents = ndjsonEvents(bogusJson.stdout);
  const jsonAgentEnd = jsonEvents.find((e) => e.type === 'agent_end');
  const jsonLastAssistant = jsonAgentEnd?.messages?.filter((m) => m.role === 'assistant').at(-1);
  const jsonModeZeroWithErrorField =
    bogusJson.code === 0 && jsonLastAssistant?.stopReason === 'error' && typeof jsonLastAssistant?.errorMessage === 'string';
  if (textModeClean && jsonModeZeroWithErrorField) {
    pass(
      'failed-turn-exit-signal-depends-on-mode',
      `text mode: exit ${bogusText.code}, stdout empty; json mode: exit ${bogusJson.code}, stopReason "${jsonLastAssistant?.stopReason}"`,
    );
  } else {
    fail(
      'failed-turn-exit-signal-depends-on-mode',
      `text mode exit ${bogusText.code} stdout len ${bogusText.stdout.length}; json mode exit ${bogusJson.code} stopReason ${jsonLastAssistant?.stopReason}`,
    );
  }
} finally {
  rmSync(bogusDir, { recursive: true, force: true });
}

// session-persists-by-default-keyed-by-cwd — --session-dir pins the session
// directory to a known temp path instead of reverse-engineering pi's cwd
// encoding scheme, which is undocumented and not what this expectation is about.
const sessionDir = mkdtempSync(join(tmpdir(), 'pi-probe-sessiondir-'));
const workDir = mkdtempSync(join(tmpdir(), 'pi-probe-work-'));
try {
  const countFiles = () => readdirSync(sessionDir).length;
  const before = countFiles();
  await run(binary, ['--print', '--provider', provider, '--model', model, '--session-dir', sessionDir, '--no-session', 'Reply: pong'], { cwd: workDir });
  const afterNoSession = countFiles();
  await run(binary, ['--print', '--provider', provider, '--model', model, '--session-dir', sessionDir, 'Reply: pong'], { cwd: workDir });
  const afterWithSession = countFiles();
  if (before === 0 && afterNoSession === before && afterWithSession === before + 1) {
    pass('session-persists-by-default-keyed-by-cwd', `--no-session added 0 files; the default run added 1 (${afterWithSession} total)`);
  } else {
    fail('session-persists-by-default-keyed-by-cwd', `before ${before}, after --no-session ${afterNoSession}, after default ${afterWithSession}`);
  }
} finally {
  rmSync(sessionDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
}

// rpc-mode-is-not-a-one-shot-json-mode
const rpc = await run(binary, ['--print', '--mode', 'rpc', '--provider', provider, '--model', model, '--no-session', 'Reply: pong'], {
  timeoutMs: 15000,
});
if (rpc.code === 0 && rpc.stdout === '' && rpc.stderr === '') {
  pass('rpc-mode-is-not-a-one-shot-json-mode', 'exit 0, both streams empty — not a substitute for --mode json in a probe or adapter');
} else {
  fail('rpc-mode-is-not-a-one-shot-json-mode', `exit ${rpc.code}; stdout ${rpc.stdout.length} bytes; stderr ${rpc.stderr.length} bytes`);
}

for (const expectation of EXPECTATIONS) {
  if (!checked.has(expectation.name)) {
    console.log(`  SKIP  ${expectation.name} — no probe wrote a verdict`);
  }
}

console.log(failed === 0 ? 'probe-pi-conformance: pass' : `probe-pi-conformance: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
