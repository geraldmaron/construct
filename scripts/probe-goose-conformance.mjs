#!/usr/bin/env node
/**
 * scripts/probe-goose-conformance.mjs — check the pinned expectations in
 * src/hosts/goose/pin.ts against a live `goose` binary.
 *
 * Defaults to a local Ollama model so re-verification costs nothing. `goose`
 * takes provider and model as two separate flags; --model here still takes a
 * single "provider/model" string for consistency with the other probes in
 * this repo and is split before being passed on.
 *
 *   node scripts/probe-goose-conformance.mjs [--binary /path/to/goose] [--model ollama/qwen3.5:4b]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPECTATIONS, PINNED_VERSION } from '../src/hosts/goose/pin.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const binary = flag('binary', 'goose');
const modelArg = flag('model', 'ollama/qwen3.5:4b');
const slash = modelArg.indexOf('/');
const provider = slash >= 0 ? modelArg.slice(0, slash) : 'ollama';
const model = slash >= 0 ? modelArg.slice(slash + 1) : modelArg;

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

function run(cmd, cmdArgs, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', () => resolve({ code: null, stdout, stderr }));
  });
}

function requestLogFreshness() {
  const dir = join(homedir(), '.local', 'state', 'goose', 'logs');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('llm_request.') && f.endsWith('.jsonl'));
  if (files.length === 0) return null;
  return Math.max(...files.map((f) => statSync(join(dir, f)).mtimeMs));
}

console.log(`probe-goose-conformance against "${binary}" (pinned: ${PINNED_VERSION}), provider=${provider} model=${model}`);

// version-flag-reports-the-version
const version = await run(binary, ['--version']);
const versionLine = version.stdout.trim();
if (version.code === 0 && versionLine) {
  pass('version-flag-reports-the-version', JSON.stringify(version.stdout));
  if (versionLine !== PINNED_VERSION) {
    console.log(`  NOTE  installed ${versionLine} != pinned ${PINNED_VERSION}: re-verify before updating the pin`);
  }
} else {
  fail('version-flag-reports-the-version', `exit ${version.code}: ${versionLine || version.stderr.trim()}`);
}

const dir = mkdtempSync(join(tmpdir(), 'goose-probe-'));
try {
  const logBefore = requestLogFreshness();

  // run-accepts-a-prompt-non-interactively, quiet-is-required-for-clean-stdout-in-every-format,
  // output-format-json-is-one-object-not-ndjson, usage-is-token-counts-only-no-cost-field,
  // explicit-provider-and-model-flags-override-a-configured-default
  const ok = await run(
    binary,
    ['run', '--no-session', '--provider', provider, '--model', model, '--output-format', 'json', '--quiet', '-t', 'Reply with exactly the word: pong'],
    dir,
  );
  let parsed = null;
  try {
    parsed = JSON.parse(ok.stdout);
  } catch {
    // left null; the checks below report the raw stdout
  }
  const lastMessage = parsed?.messages?.at(-1);
  const lastText = lastMessage?.content?.find((c) => c.type === 'text')?.text ?? '';

  if (ok.code === 0 && parsed && Array.isArray(parsed.messages) && lastMessage?.role === 'assistant') {
    pass('run-accepts-a-prompt-non-interactively', `exit 0, ${parsed.messages.length} messages`);
  } else {
    fail('run-accepts-a-prompt-non-interactively', `exit ${ok.code}; stdout: ${ok.stdout.slice(0, 200)}`);
  }

  if (parsed && ok.stdout.trimStart().startsWith('{')) {
    pass('quiet-is-required-for-clean-stdout-in-every-format', 'stdout under --quiet parsed as JSON with no leading banner');
  } else {
    fail('quiet-is-required-for-clean-stdout-in-every-format', `stdout did not start clean: ${ok.stdout.slice(0, 120)}`);
  }

  // `parsed` already proves the "one object, not NDJSON" half: JSON.parse on the
  // WHOLE stdout string only succeeds if stdout is a single JSON value. Genuine
  // NDJSON (one object per line) would fail this same parse with a syntax error,
  // which is caught above and leaves `parsed` null.
  if (parsed && lastText.includes('pong')) {
    pass('output-format-json-is-one-object-not-ndjson', 'stdout parsed whole as a single JSON value; reply text found at messages[-1].content[].text');
  } else {
    fail('output-format-json-is-one-object-not-ndjson', `reply text: ${JSON.stringify(lastText)}`);
  }

  const usage = parsed?.metadata;
  if (usage && typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number' && !('cost' in usage)) {
    pass('usage-is-token-counts-only-no-cost-field', `${usage.input_tokens} in / ${usage.output_tokens} out, status ${usage.status}`);
  } else {
    fail('usage-is-token-counts-only-no-cost-field', JSON.stringify(usage));
  }

  const inference = lastMessage?.metadata?.inference;
  if (inference?.provider === provider && inference?.requestedModel === model) {
    pass(
      'explicit-provider-and-model-flags-override-a-configured-default',
      `requested ${inference.provider}/${inference.requestedModel} echoed back; the config-fallback half is a recorded ` +
        'one-time observation, not re-probed here (mutating the machine\'s active_provider is out of scope for this script)',
    );
  } else {
    fail('explicit-provider-and-model-flags-override-a-configured-default', `metadata.inference: ${JSON.stringify(inference)}`);
  }

  // a-failed-model-call-exits-0-and-reads-as-success
  const bogus = await run(
    binary,
    ['run', '--no-session', '--provider', provider, '--model', 'construct-probe-nonexistent-model', '--output-format', 'json', '--quiet', '-t', 'Reply: pong'],
    dir,
  );
  let bogusParsed = null;
  try {
    bogusParsed = JSON.parse(bogus.stdout);
  } catch {
    // left null
  }
  const bogusText = bogusParsed?.messages?.at(-1)?.content?.find((c) => c.type === 'text')?.text ?? '';
  if (bogus.code === 0 && bogusParsed?.metadata?.status === 'completed' && /error/i.test(bogusText)) {
    pass('a-failed-model-call-exits-0-and-reads-as-success', `exit 0, status "completed", text: ${JSON.stringify(bogusText.slice(0, 80))}`);
  } else {
    fail('a-failed-model-call-exits-0-and-reads-as-success', `exit ${bogus.code}; status ${bogusParsed?.metadata?.status}; text ${JSON.stringify(bogusText.slice(0, 120))}`);
  }

  // no-session-skips-the-shared-session-store-but-not-the-request-log
  const logAfter = requestLogFreshness();
  if (logAfter !== null && (logBefore === null || logAfter > logBefore)) {
    pass(
      'no-session-skips-the-shared-session-store-but-not-the-request-log',
      'the request log advanced under --no-session; the sessions.db half is a recorded one-time observation, not re-probed here',
    );
  } else {
    fail('no-session-skips-the-shared-session-store-but-not-the-request-log', `request log freshness before=${logBefore} after=${logAfter}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const expectation of EXPECTATIONS) {
  if (!checked.has(expectation.name)) {
    console.log(`  SKIP  ${expectation.name} — no probe wrote a verdict`);
  }
}

console.log(failed === 0 ? 'probe-goose-conformance: pass' : `probe-goose-conformance: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
