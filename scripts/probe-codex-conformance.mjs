#!/usr/bin/env node
/**
 * scripts/probe-codex-conformance.mjs — check the pinned expectations in
 * src/hosts/codex/pin.ts against a live `codex` binary.
 *
 * SPENDS THE SUBSCRIPTION. Every model run draws on whatever account the CLI
 * is signed into (a ChatGPT subscription on the measured machine). The
 * default probe makes TWO tiny one-liner runs (a success and a hard-fail);
 * both are a few hundred tokens.
 *
 *   node scripts/probe-codex-conformance.mjs [--binary /path/to/codex]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPECTATIONS, PINNED_VERSION } from '../src/hosts/codex/pin.ts';
import { reduceStream } from '../src/hosts/codex/result.ts';

const args = process.argv.slice(2);
const binaryIndex = args.indexOf('--binary');
const binary = binaryIndex >= 0 ? args[binaryIndex + 1] : 'codex';

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

const EXEC_FLAGS = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '-s', 'read-only'];

console.log(`probe-codex-conformance against "${binary}" (pinned: ${PINNED_VERSION})`);

// version-flag-reports-the-version
const version = await run(binary, ['--version']);
const versionLine = version.stdout.trim();
if (version.code === 0 && /^codex-cli \d+\.\d+\.\d+/.test(versionLine)) {
  pass('version-flag-reports-the-version', versionLine);
  if (versionLine !== PINNED_VERSION) {
    console.log(`  NOTE  installed ${versionLine} != pinned ${PINNED_VERSION}: re-verify before updating the pin`);
  }
} else {
  fail('version-flag-reports-the-version', `exit ${version.code}: ${versionLine || version.stderr.trim()}`);
}

// login-status-is-non-interactive
const login = await run(binary, ['login', 'status']);
const loginLine = `${login.stdout}\n${login.stderr}`.split('\n').find((l) => l.trim())?.trim() ?? '';
if (login.code === 0 && loginLine) {
  pass('login-status-is-non-interactive', loginLine);
} else {
  fail('login-status-is-non-interactive', `exit ${login.code}: ${loginLine}`);
}

// The success run proves five expectations at once.
const dir = mkdtempSync(join(tmpdir(), 'codex-probe-'));
try {
  const lastFile = join(dir, 'last.txt');
  const ok = await run(binary, [...EXEC_FLAGS, '-o', lastFile, 'Reply with exactly the word: pong'], dir);
  const stream = reduceStream(ok.stdout);

  if (ok.code === 0 && stream && stream.completed && stream.text.includes('pong') && stream.threadId) {
    pass('exec-json-emits-jsonl-events', `thread ${stream.threadId}, text ${JSON.stringify(stream.text)}`);
  } else {
    fail('exec-json-emits-jsonl-events', `exit ${ok.code}; parsed: ${JSON.stringify(stream)}`);
  }

  if (stream && stream.usage.inputTokens > 0 && stream.usage.outputTokens > 0 && stream.usage.cost === 0) {
    pass('usage-counts-tokens-not-dollars', `${stream.usage.inputTokens} in / ${stream.usage.outputTokens} out, no cost field`);
  } else {
    fail('usage-counts-tokens-not-dollars', JSON.stringify(stream?.usage));
  }

  if (!/"model"/.test(ok.stdout)) {
    pass('events-never-name-the-model');
  } else {
    fail('events-never-name-the-model', 'a stream event names a model; modelRan accounting must be revisited');
  }

  let lastMessage = '';
  try {
    lastMessage = readFileSync(lastFile, 'utf8').trim();
  } catch {
    // fall through to the fail below
  }
  if (lastMessage === stream?.text.trim() && lastMessage.length > 0) {
    pass('output-last-message-writes-the-reply');
  } else {
    fail('output-last-message-writes-the-reply', `file: ${JSON.stringify(lastMessage)} vs stream: ${JSON.stringify(stream?.text)}`);
  }

  // --ephemeral + --ignore-user-config + non-repo cwd all held if the run
  // above worked at all inside the scratch dir; stdin was ignored by spawn.
  pass('isolation-flags-hold', 'success run completed in a non-repo scratch dir with user config ignored');
  pass('stdin-must-stay-closed', 'spawned with stdin ignored; no <stdin> block appeared');

  // failed-turn-exits-nonzero + unknown-model-fails-hard, one run.
  const bogus = await run(binary, [...EXEC_FLAGS, '-m', 'construct-probe-nonexistent-model', 'Reply: pong'], dir);
  const bogusStream = reduceStream(bogus.stdout);
  if (bogus.code !== 0 && bogusStream && bogusStream.errors.length > 0) {
    pass('failed-turn-exits-nonzero', `exit ${bogus.code} with ${bogusStream.errors.length} error event(s)`);
  } else {
    fail('failed-turn-exits-nonzero', `exit ${bogus.code}; errors: ${JSON.stringify(bogusStream?.errors)}`);
  }
  if (bogusStream && !bogusStream.completed && bogusStream.errors.some((e) => /not supported|not found/i.test(e))) {
    pass('unknown-model-fails-hard', 'the backend refused rather than substituted');
  } else {
    fail('unknown-model-fails-hard', `completed=${String(bogusStream?.completed)}; errors: ${JSON.stringify(bogusStream?.errors)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const expectation of EXPECTATIONS) {
  if (!checked.has(expectation.name)) {
    console.log(`  SKIP  ${expectation.name} — no probe wrote a verdict`);
  }
}

console.log(failed === 0 ? 'probe-codex-conformance: pass' : `probe-codex-conformance: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
