#!/usr/bin/env node
/**
 * scripts/probe-claude-conformance.mjs — check the pinned expectations in
 * src/hosts/claude/pin.ts against a live `claude` binary.
 *
 * COSTS REAL MONEY. Unlike the OpenCode probe (free local ollama), every model
 * run here bills the account the CLI is signed into. The default probe makes
 * ONE haiku one-liner (~$0.02). The silent-fallback expectation is only
 * checked under --spend-fallback, because reproducing it bills a run at the
 * session's default model (~$0.30 measured).
 *
 *   node scripts/probe-claude-conformance.mjs [--binary /path/to/claude] [--spend-fallback]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPECTATIONS, PINNED_VERSION } from '../src/hosts/claude/pin.ts';

const args = process.argv.slice(2);
const binaryIndex = args.indexOf('--binary');
const binary = binaryIndex >= 0 ? args[binaryIndex + 1] : 'claude';
const spendFallback = args.includes('--spend-fallback');

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
    child.stdout.setEncoding('utf8').on('data', (c) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
    child.on('error', (error) => resolve({ code: null, stdout, stderr: String(error) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// A scratch cwd, so the probe never picks up a project's own claude settings
// and never writes state into a real checkout.
const scratch = mkdtempSync(join(tmpdir(), 'construct-claude-probe-'));

try {
  console.log(`probing "${binary}" against pin ${PINNED_VERSION}\n`);

  const version = await run(binary, ['--version'], scratch);
  const reported = version.stdout.trim();
  if (version.code === 0 && reported) {
    pass('version-flag-reports-the-version', reported);
    if (reported !== PINNED_VERSION) {
      console.log(`  NOTE  installed "${reported}" differs from pin "${PINNED_VERSION}" — expectations may not hold`);
    }
  } else {
    fail('version-flag-reports-the-version', version.stderr.trim() || `exit ${String(version.code)}`);
  }

  const success = await run(
    binary,
    ['-p', 'Reply with exactly: ok', '--model', 'haiku', '--output-format', 'json'],
    scratch,
  );
  let envelope = null;
  try {
    envelope = JSON.parse(success.stdout.trim());
  } catch {
    envelope = null;
  }

  if (envelope && envelope.type === 'result' && typeof envelope.result === 'string' && typeof envelope.session_id === 'string') {
    pass('result-envelope-is-one-json-object', `session ${envelope.session_id}`);
  } else {
    fail('result-envelope-is-one-json-object', success.stderr.trim() || 'stdout did not parse as a result envelope');
  }

  if (envelope && typeof envelope.total_cost_usd === 'number' && typeof envelope.num_turns === 'number' && envelope.num_turns > 0) {
    pass('cost-is-reported-in-total-cost-usd', `$${envelope.total_cost_usd.toFixed(4)} over ${String(envelope.num_turns)} turn(s)`);
  } else {
    fail('cost-is-reported-in-total-cost-usd', 'total_cost_usd or num_turns missing');
  }

  const models = envelope && envelope.modelUsage ? Object.keys(envelope.modelUsage) : [];
  if (models.some((m) => m.includes('haiku'))) {
    pass('model-usage-names-the-model-that-ran', models.join(', '));
  } else {
    fail('model-usage-names-the-model-that-ran', `modelUsage keys: ${models.join(', ') || '(none)'}`);
  }

  if (success.code === 0 && envelope && envelope.is_error === false && envelope.subtype === 'success') {
    pass('success-sets-exit-zero-and-is-error-false');
  } else {
    fail('success-sets-exit-zero-and-is-error-false', `exit ${String(success.code)}, is_error ${String(envelope?.is_error)}`);
  }

  if (spendFallback) {
    const fallback = await run(
      binary,
      ['-p', 'Reply with exactly: ok', '--model', 'no-such-model-xyz', '--output-format', 'json'],
      scratch,
    );
    let fb = null;
    try {
      fb = JSON.parse(fallback.stdout.trim());
    } catch {
      fb = null;
    }
    const ranModels = fb && fb.modelUsage ? Object.keys(fb.modelUsage) : [];
    if (fallback.code === 0 && fb && fb.is_error === false && ranModels.length > 0 && !ranModels.some((m) => m.includes('no-such-model'))) {
      pass('an-unknown-model-runs-the-default-silently', `ran ${ranModels.join(', ')} at $${Number(fb.total_cost_usd).toFixed(4)}`);
    } else {
      // The CLI starting to REJECT unknown models would also land here — that
      // is a behavior change worth failing loudly on, since the adapter's
      // drift accounting was built against the silent version.
      fail('an-unknown-model-runs-the-default-silently', `exit ${String(fallback.code)}; ran ${ranModels.join(', ') || '(none)'}`);
    }
  }

  console.log('');
  for (const expectation of EXPECTATIONS) {
    if (!checked.has(expectation.name)) {
      console.log(`  skip  ${expectation.name} — only checked under --spend-fallback (costs a default-model run)`);
    }
  }

  console.log(failed === 0 ? '\nprobe: conformant' : `\nprobe: ${String(failed)} expectation(s) FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
