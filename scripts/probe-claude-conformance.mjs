#!/usr/bin/env node
/**
 * scripts/probe-claude-conformance.mjs — check the pinned expectations in
 * src/hosts/claude/pin.ts against a live `claude` binary.
 *
 * COSTS REAL MONEY. Unlike the OpenCode probe (free local ollama), every model
 * run here bills the account the CLI is signed into. The default probe makes
 * ONE haiku one-liner (~$0.02). Two expectations are gated behind flags:
 *
 *   --spend-fallback   the silent-fallback expectation, because reproducing it
 *                      bills a run at the session's default model (~$0.30).
 *   --spend-mcp        the four role-write-surface expectations, because they
 *                      need a live haiku run that actually calls the tool
 *                      (~$0.03 measured). Nothing else can prove them: the
 *                      question is whether a real model reaches a real write
 *                      surface and whether the bearer stays out of the host's
 *                      own session store.
 *
 *   node scripts/probe-claude-conformance.mjs [--binary /path/to/claude] [--spend-fallback] [--spend-mcp]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTATIONS, PINNED_VERSION } from '../src/hosts/claude/pin.ts';
import { mcpArgsFor, ROLE_TOOL_NAMES, writeMcpConfig } from '../src/hosts/claude/mcpconfig.ts';
import { openStore } from '../src/kernel/store/open.ts';
import { enqueueTask, claimTask } from '../src/kernel/store/tasks.ts';
import { readWorkLog } from '../src/kernel/store/worklog.ts';
import { loadOrCreateSecret } from '../src/kernel/capabilities/secretfile.ts';
import { issueRoleToken } from '../src/kernel/capabilities/tokens.ts';
import { buildRoleEnv } from '../src/kernel/run/roleenv.ts';

const args = process.argv.slice(2);
const binaryIndex = args.indexOf('--binary');
const binary = binaryIndex >= 0 ? args[binaryIndex + 1] : 'claude';
const spendFallback = args.includes('--spend-fallback');
const spendMcp = args.includes('--spend-mcp');

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

function run(cmd, cmdArgs, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
    child.on('error', (error) => resolve({ code: null, stdout, stderr: String(error) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const MCP_EXPECTATIONS = new Set([
  'mcp-config-is-read-from-a-path',
  'mcp-config-flag-is-variadic',
  'strict-mcp-config-excludes-the-users-own-servers',
  'mcp-tool-names-are-namespaced',
  'bearer-appears-in-no-host-transcript',
]);

const CONSTRUCT_BIN = fileURLToPath(new URL('../bin/construct.mjs', import.meta.url));

/**
 * Every file the host's own session store gained or touched during the run.
 * Bounded by mtime rather than walking the whole history, so a long-lived
 * ~/.claude does not turn the grep into a sweep — and unbounded is the wrong
 * shape anyway: what this expectation asks is whether THIS run leaked.
 */
function transcriptsTouchedSince(since) {
  const root = join(homedir(), '.claude', 'projects');
  const found = [];
  if (!existsSync(root)) return found;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && statSync(path).mtimeMs >= since) found.push(path);
    }
  };
  walk(root);
  return found;
}

/**
 * The four role-write-surface expectations, measured the only way they can be:
 * a real model, a real MCP registration, and the store checked afterwards for
 * what the model actually did. A sterile XDG root holds the store, so the
 * probe writes nothing into the operator's real construct state — but HOME is
 * deliberately NOT sterilized, because the transcript-absence expectation is
 * about the host's real session store.
 */
async function probeRoleWriteSurface() {
  const startedAt = Date.now();
  const root = mkdtempSync(join(tmpdir(), 'construct-claude-mcp-'));
  const dataDir = join(root, 'construct');
  const storeFile = join(dataDir, 'construct.db');
  let mcp;
  try {
    const secret = loadOrCreateSecret(join(dataDir, 'capability-secret'));
    const at = new Date().toISOString();
    const store = openStore(storeFile);
    enqueueTask(store, {
      id: 'probe-task',
      run: 'probe-run',
      role: 'privacy',
      brief: { id: 'probe-task', outcome: 'probe', role: 'privacy', inputs: [], capabilities: [], postconditions: [] },
      at,
    });
    const leaseUntil = new Date(startedAt + 15 * 60 * 1000).toISOString();
    claimTask(store, { owner: 'probe', leaseUntil, now: at });
    store.close();

    const token = issueRoleToken(
      { run: 'probe-run', task: 'probe-task', role: 'privacy', expiresAt: leaseUntil, nonce: '1' },
      secret,
    );
    const roleEnv = buildRoleEnv({ token, run: 'probe-run', task: 'probe-task' });
    mcp = writeMcpConfig(roleEnv, {
      command: process.execPath,
      args: [CONSTRUCT_BIN, 'role-serve'],
      env: {
        XDG_DATA_HOME: root,
        XDG_CONFIG_HOME: join(root, 'cfg'),
        XDG_STATE_HOME: join(root, 'state'),
        XDG_CACHE_HOME: join(root, 'cache'),
      },
    });

    // One run, two measurements. The enumeration is how the strict expectation
    // is probed at all: the envelope carries no server list on the pinned
    // version, so the tool surface that reached the model is read from the
    // model. See pin.ts — that indirection is recorded, not hidden.
    const prompt =
      'Call the submit_draft tool exactly once with deliverable set to the text ' +
      '"probe deliverable". Do not ask for confirmation. Then reply with the ' +
      'exact names of every tool available to you, comma separated, and nothing else.';
    const result = await run(
      binary,
      ['-p', prompt, '--model', 'haiku', '--output-format', 'json', ...mcpArgsFor(mcp.path)],
      scratch,
    );
    let envelope = null;
    try {
      envelope = JSON.parse(result.stdout.trim());
    } catch {
      envelope = null;
    }

    // What the model actually did, read from the store the server wrote —
    // not from the model's own account of itself.
    let drafts = [];
    try {
      const reopened = openStore(storeFile);
      drafts = readWorkLog(reopened, 'probe-run').filter((entry) => entry.action === 'draft-submitted');
      reopened.close();
    } catch (error) {
      drafts = [];
      console.log(`  NOTE  could not reopen the probe store: ${String(error)}`);
    }

    if (drafts.length > 0) {
      pass('mcp-config-is-read-from-a-path', `${String(drafts.length)} draft(s) landed for role ${drafts[0].role}`);
      pass('mcp-tool-names-are-namespaced', ROLE_TOOL_NAMES.join(', '));
    } else {
      const detail = result.stderr.trim() || envelope?.result || `exit ${String(result.code)}`;
      fail('mcp-config-is-read-from-a-path', `no draft reached the store — ${detail}`);
      fail('mcp-tool-names-are-namespaced', 'the allow-listed name was never successfully called');
    }

    // A behavior change that STARTED reporting a server list would be worth
    // knowing about — the direct observable is better than the indirect one.
    if (envelope && 'mcp_servers' in envelope) {
      console.log('  NOTE  the envelope now carries mcp_servers — probe this expectation directly instead');
    }
    const enumerated = typeof envelope?.result === 'string' ? envelope.result.match(/mcp__[A-Za-z0-9_]+/g) ?? [] : null;
    if (enumerated === null) {
      fail('strict-mcp-config-excludes-the-users-own-servers', 'the run produced no text to read a tool surface from');
    } else {
      const foreign = [...new Set(enumerated)].filter((name) => !ROLE_TOOL_NAMES.includes(name));
      if (foreign.length === 0) {
        pass(
          'strict-mcp-config-excludes-the-users-own-servers',
          enumerated.length > 0
            ? `the model saw only ${[...new Set(enumerated)].join(', ')}`
            : 'the model named no MCP tool outside this config',
        );
      } else {
        fail(
          'strict-mcp-config-excludes-the-users-own-servers',
          `the model could also reach: ${foreign.join(', ')} — a role would inherit them`,
        );
      }
    }

    // Measured with no model at all: the flag eats following positionals.
    const variadic = await run(binary, ['--mcp-config', mcp.path, 'no-such-config-path'], scratch);
    if (`${variadic.stdout}${variadic.stderr}`.includes('no-such-config-path')) {
      pass('mcp-config-flag-is-variadic', 'the trailing positional was read as another config path');
    } else {
      fail('mcp-config-flag-is-variadic', 'the trailing positional was NOT consumed — argv shape assumption changed');
    }

    const leaked = [];
    if (result.stdout.includes(token) || result.stderr.includes(token)) leaked.push('(host stdout/stderr)');
    for (const path of transcriptsTouchedSince(startedAt)) {
      try {
        if (readFileSync(path, 'utf8').includes(token)) leaked.push(path);
      } catch {
        // Unreadable is not evidence of absence, but it is also not a leak we
        // can demonstrate; the CLI's own store is the only thing under test.
      }
    }
    if (leaked.length === 0) {
      pass('bearer-appears-in-no-host-transcript', 'zero hits in the host session store, stdout, or stderr');
    } else {
      fail('bearer-appears-in-no-host-transcript', `bearer found in: ${leaked.join(', ')}`);
    }
  } finally {
    mcp?.dispose();
    rmSync(root, { recursive: true, force: true });
  }
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

  if (spendMcp) await probeRoleWriteSurface();

  console.log('');
  for (const expectation of EXPECTATIONS) {
    if (!checked.has(expectation.name)) {
      const gate = MCP_EXPECTATIONS.has(expectation.name) ? '--spend-mcp' : '--spend-fallback';
      console.log(`  skip  ${expectation.name} — only checked under ${gate} (costs a model run)`);
    }
  }

  console.log(failed === 0 ? '\nprobe: conformant' : `\nprobe: ${String(failed)} expectation(s) FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
