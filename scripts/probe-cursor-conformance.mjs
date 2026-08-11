#!/usr/bin/env node
/**
 * scripts/probe-cursor-conformance.mjs — check the pinned expectations in
 * src/hosts/cursor/pin.ts against a live `cursor-agent` binary.
 *
 * SPENDS THE SUBSCRIPTION. Every model run draws on the signed-in Cursor
 * account. The default probe makes THREE tiny runs (a success, a plan-mode
 * write attempt, and a hard-fail); each is a few hundred tokens.
 *
 *   node scripts/probe-cursor-conformance.mjs [--binary /path/to/cursor-agent]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPECTATIONS, PINNED_VERSION } from '../src/hosts/cursor/pin.ts';
import { reduceEnvelope } from '../src/hosts/cursor/result.ts';

const args = process.argv.slice(2);
const binaryIndex = args.indexOf('--binary');
const binary = binaryIndex >= 0 ? args[binaryIndex + 1] : 'cursor-agent';

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

console.log(`probe-cursor-conformance against "${binary}" (pinned: ${PINNED_VERSION})`);

// version-flag-reports-the-version
const version = await run(binary, ['--version']);
const versionLine = version.stdout.trim();
if (version.code === 0 && /^\d{4}\.\d{2}\.\d{2}-[0-9a-f]+$/.test(versionLine)) {
  pass('version-flag-reports-the-version', versionLine);
  if (versionLine !== PINNED_VERSION) {
    console.log(`  NOTE  installed ${versionLine} != pinned ${PINNED_VERSION}: re-verify before updating the pin`);
  }
} else {
  fail('version-flag-reports-the-version', `exit ${version.code}: ${versionLine || version.stderr.trim()}`);
}

// status-is-non-interactive
const status = await run(binary, ['status']);
const statusLine = status.stdout.split('\n').find((l) => l.trim())?.trim() ?? '';
if (status.code === 0 && /logged in/i.test(statusLine)) {
  pass('status-is-non-interactive', statusLine);
} else {
  fail('status-is-non-interactive', `exit ${status.code}: ${statusLine} (signed out? run cursor-agent login first)`);
}

// catalog-is-multi-vendor
const models = await run(binary, ['--list-models']);
const catalog = models.stdout;
if (models.code === 0 && /claude-/.test(catalog) && /gpt-/.test(catalog) && /gemini-/.test(catalog)) {
  pass('catalog-is-multi-vendor', 'claude, gpt, and gemini families all listed');
} else {
  fail('catalog-is-multi-vendor', `exit ${models.code}; vendors seen: ${['claude-', 'gpt-', 'gemini-'].filter((v) => catalog.includes(v)).join(', ') || 'none'}`);
}

const dir = mkdtempSync(join(tmpdir(), 'cursor-probe-'));
try {
  // workspace-trust-gates-headless-runs, half one: without --trust it refuses.
  const untrusted = await run(binary, ['-p', '--output-format', 'json', 'Reply: pong'], dir);
  const trustGateHeld = untrusted.code !== 0;

  // The success run proves the envelope, usage, and the other trust half.
  const ok = await run(binary, ['-p', '--mode', 'plan', '--trust', '--output-format', 'json', 'Reply with exactly the word: pong'], dir);
  const envelope = reduceEnvelope(ok.stdout);

  if (trustGateHeld && ok.code === 0 && envelope) {
    pass('workspace-trust-gates-headless-runs', 'refused untrusted, ran with --trust');
  } else {
    fail('workspace-trust-gates-headless-runs', `untrusted exit ${untrusted.code}, trusted exit ${ok.code}`);
  }

  if (envelope && envelope.subtype === 'success' && !envelope.isError && envelope.text.includes('pong') && envelope.sessionId) {
    pass('print-json-emits-one-envelope', `session ${envelope.sessionId}, text ${JSON.stringify(envelope.text)}`);
  } else {
    fail('print-json-emits-one-envelope', `exit ${ok.code}; parsed: ${JSON.stringify(envelope)}`);
  }

  if (envelope && envelope.usage.inputTokens > 0 && envelope.usage.outputTokens > 0 && envelope.usage.cost === 0) {
    pass('usage-counts-tokens-not-dollars', `${envelope.usage.inputTokens} in / ${envelope.usage.outputTokens} out, no cost field`);
  } else {
    fail('usage-counts-tokens-not-dollars', JSON.stringify(envelope?.usage));
  }

  if (!/"model"/.test(ok.stdout)) {
    pass('envelope-never-names-the-model');
  } else {
    fail('envelope-never-names-the-model', 'the envelope names a model; modelRan accounting must be revisited');
  }

  // plan-mode-is-read-only: ask for a write, then look for the file.
  const write = await run(
    binary,
    ['-p', '--mode', 'plan', '--trust', '--output-format', 'json', 'Create a file named probe-write.txt containing x in the current directory, then reply done'],
    dir,
  );
  if (write.code === 0 && !existsSync(join(dir, 'probe-write.txt'))) {
    pass('plan-mode-is-read-only', 'the write became a proposal; no file appeared');
  } else {
    fail('plan-mode-is-read-only', `exit ${write.code}; file exists: ${String(existsSync(join(dir, 'probe-write.txt')))}`);
  }

  // unknown-model-fails-hard
  const bogus = await run(binary, ['-p', '--mode', 'plan', '--trust', '--output-format', 'json', '--model', 'construct-probe-nonexistent-model', 'Reply: pong'], dir);
  if (bogus.code !== 0 && /cannot use this model/i.test(`${bogus.stdout}\n${bogus.stderr}`)) {
    pass('unknown-model-fails-hard', 'refused with the catalog echoed back');
  } else {
    fail('unknown-model-fails-hard', `exit ${bogus.code}: ${(bogus.stdout + bogus.stderr).slice(0, 120)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const expectation of EXPECTATIONS) {
  if (!checked.has(expectation.name)) {
    console.log(`  SKIP  ${expectation.name} — no probe wrote a verdict`);
  }
}

console.log(failed === 0 ? 'probe-cursor-conformance: pass' : `probe-cursor-conformance: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
