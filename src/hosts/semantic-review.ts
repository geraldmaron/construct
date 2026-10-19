import { observeSemanticReview } from './semantic-observation.ts';
/** Explicit host-invoked review of held text. No MCP handler invokes this adapter,
 * no arbitrary command can establish semantic review, and no fallback is made. */
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { StateStore } from '../kernel/state/open.ts';
import type { RefResolver } from '../kernel/project/evidence.ts';
import { getStep, heldLease } from '../kernel/state/steps.ts';
import { getRun } from '../kernel/state/runs.ts';
import { appendActivity } from '../kernel/state/activity.ts';
import {
  assertReviewBundleCapacity,
  semanticReviewPrompt,
  readPreparedReview,
  reviewFreshnessProblems,
  semanticJudgmentProblems,
  canonicalReview,
  type SemanticWitness,
  type NativeReviewerIdentity,
} from '../kernel/workflow/semantic-review.ts';
import { authentication, apiEnvironmentPresent } from './delegation/adapters.ts';
import { safeEnvironment } from './delegation/workspace.ts';
import { findOnPath } from './presence.ts';
import { codexProviderArgs, codexProviderFromConfig } from './codex-provider.ts';
import { redact } from '../kernel/render/redact.ts';
import { createReviewDiagnostics } from './semantic-review-diagnostics.ts';
import { runAppServerHeldReview } from './semantic-review-app-server.ts';

// This reviewed adapter profile admits held text only. Unsupported native hosts
// return unavailable; their names are not evidence of an equivalent boundary.
export const REVIEW_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'multi_agent',
  'multi_agent_v2',
  'hooks',
  'plugins',
  'remote_plugin',
  'apps',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'in_app_browser',
  'image_generation',
  'code_mode',
  'code_mode_host',
  'artifact',
  'skill_search',
  'skill_mcp_dependency_install',
  'tool_suggest',
  'workspace_dependencies',
  'request_permissions_tool',
  'executor_capability_discovery',
  'deferred_executor',
  'standalone_web_search',
  'shell_snapshot',
  'code_mode_buffered_exec',
  'code_mode_only',
  'enable_mcp_apps',
  'memories',
  'external_agent_memory_import',
  'goals',
  'plugin_sharing',
  'auth_elicitation',
  'tool_call_mcp_elicitation',
  'exec_permission_approvals',
];
export function disableReviewMcp(names: readonly string[]): string[] {
  if (names.some((name) => !/^[A-Za-z0-9_-]+$/.test(name)))
    throw new Error('native review cannot safely override an MCP name in this CLI version; no invocation started');
  return names.flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]);
}
export function semanticAppServerArgs(provider: ReturnType<typeof codexProviderFromConfig>, mcpNames: readonly string[] = []): string[] {
  return [
    ...REVIEW_DISABLED_FEATURES.flatMap((name) => ['--disable', name]),
    '-c',
    'approval_policy="never"',
    '-c',
    'web_search="disabled"',
    '-c',
    'forced_login_method="chatgpt"',
    ...codexProviderArgs(provider),
    ...disableReviewMcp(mcpNames),
    'app-server',
    '--stdio',
  ];
}
function probe(binary: string, argv: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<string> {
  return new Promise((accept, reject) =>
    execFile(binary, argv, { env, cwd, timeout: 10_000, maxBuffer: 128_000 }, (error, out, stderr) =>
      error
        ? reject(
            new Error(
              `native review host probe ${argv
                .filter((a) => !a.startsWith('mcp_servers.'))
                .slice(0, 3)
                .join(' ')} failed (${error.code ?? 'unknown'}): ${redact(stderr).slice(0, 1000)}; no fallback`,
            ),
          )
        : accept((out || stderr).trim()),
    ),
  );
}
/** Pin a native installation before producer work begins. This trusts the host's
 * startup environment, not PATH supplied later by a review command. */
export function pinSemanticReviewer(host: string, env: NodeJS.ProcessEnv, root: string): NativeReviewerIdentity | null {
  if (host !== 'codex') return null;
  try {
    const candidate = findOnPath('codex', env);
    if (!candidate) return null;
    let binary = realpathSync(candidate);
    // The npm launcher is not the native identity. Resolve the platform package
    // without executing the launcher or evaluating project code.
    if (binary.endsWith('/bin/codex.js')) {
      const pkg = JSON.parse(readFileSync(join(dirname(binary), '..', 'package.json'), 'utf8'));
      if (pkg.name !== '@openai/codex') return null;
      const platform =
        process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : process.platform === 'win32' ? 'win32' : null;
      const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
      if (!platform || !arch) return null;
      const triple = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'darwin' ? 'apple-darwin' : platform === 'linux' ? 'unknown-linux-musl' : 'pc-windows-msvc'}`;
      const require = createRequire(binary);
      const platformRoot = dirname(require.resolve(`@openai/codex-${platform}-${arch}/package.json`));
      binary = realpathSync(join(platformRoot, 'vendor', triple, 'bin', platform === 'win32' ? 'codex.exe' : 'codex'));
    }
    const rel = relative(realpathSync(root), binary);
    if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return null;
    const bytes = readFileSync(binary);
    // Reject scripts/wrappers, including PATH fixtures in a workspace.
    const magic = bytes.subarray(0, 4).toString('hex');
    if (
      !['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', '7f454c46'].includes(magic) &&
      bytes.subarray(0, 2).toString() !== 'MZ'
    )
      return null;
    const version = execFileSync(binary, ['--version'], {
      env: safeEnvironment(env),
      cwd: root,
      timeout: 10_000,
      maxBuffer: 128_000,
      encoding: 'utf8',
    }).trim();
    // This finite profile is version-specific; upgrades need fresh qualification.
    if (version !== 'codex-cli 0.163.0') return null;
    return {
      host: 'codex',
      isolation: 'held_text',
      binary,
      digest: createHash('sha256').update(bytes).digest('hex'),
      version,
      profile: 'codex-app-server-held-text-v2',
    };
  } catch {
    return null;
  }
}
export function reviewerIdentityProblems(pin: NativeReviewerIdentity): string[] {
  try {
    if (realpathSync(pin.binary) !== pin.binary || createHash('sha256').update(readFileSync(pin.binary)).digest('hex') !== pin.digest)
      return ['pinned native review executable changed; start a newly qualified session'];
    return [];
  } catch {
    return ['pinned native review executable is unavailable'];
  }
}

export async function executeSemanticReview(input: {
  store: StateStore;
  runId: string;
  stepRunId: string;
  token: string;
  preparedRef: string;
  host: string;
  model: string;
  env: NodeJS.ProcessEnv;
  root: string;
  resolve: RefResolver;
  now: () => string;
  timeoutMs?: number;
}) {
  if (input.host !== 'codex')
    throw new Error(
      `semantic review adapter unavailable for ${input.host}; the draft remains unverified. No host or permission fallback occurred.`,
    );
  if (!/^[\w.:[\],=-]{1,160}$/.test(input.model)) throw new Error('semantic review needs an explicit native model');
  if (apiEnvironmentPresent(input.env))
    throw new Error('semantic review refuses API credentials or provider environment overrides; no subscription fallback');
  const prepared = readPreparedReview(input.store, input.preparedRef),
    row = getStep(input.store, input.stepRunId),
    run = getRun(input.store, input.runId);
  const lease = row?.leaseOwner ? heldLease(input.store, { id: row.id, owner: row.leaseOwner, nonce: input.token }) : null;
  const startedAt = input.now();
  if (
    !prepared ||
    !run ||
    !lease ||
    lease.runId !== run.id ||
    lease.leaseUntil <= startedAt ||
    run.cancelRequested ||
    prepared.bundle.runId !== run.id ||
    prepared.bundle.stepRunId !== lease.id ||
    prepared.bundle.attempt !== lease.token
  )
    throw new Error('semantic review needs the prepared candidate and current unexpired lease of this run');
  assertReviewBundleCapacity(prepared.bundle);
  const stale = reviewFreshnessProblems(input.store, prepared, input.resolve);
  if (stale.length) throw new Error(stale.join('; '));
  const timeoutMs = input.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new Error('semantic review timeout must be between 1 and 300000 milliseconds');
  const pin = prepared.bundle.contract.reviewer;
  if (!pin || pin.host !== input.host || pin.profile !== 'codex-app-server-held-text-v2')
    throw new Error('no native reviewer identity was frozen at session startup; the draft remains unverified');
  if (typeof pin.binary !== 'string')
    throw new Error('This native adapter requires an executable identity; use the qualified host-tool adapter for that profile');
  const nativePin = pin as NativeReviewerIdentity;
  const identityProblems = reviewerIdentityProblems(nativePin);
  if (identityProblems.length) throw new Error(identityProblems.join('; '));
  const binary = pin.binary;
  const env = safeEnvironment(input.env),
    hostVersion = await probe(binary, ['--version'], env, input.root);
  if (hostVersion !== pin.version) throw new Error('pinned native review version changed');
  if (authentication('codex', await probe(binary, ['login', 'status'], env, input.root)) !== 'subscription')
    throw new Error('native review requires existing subscription authentication');
  const provider = codexProviderFromConfig(input.env);
  if (provider && provider.id !== 'openai' && provider.requires_openai_auth !== true)
    throw new Error('native review requires the configured provider to use existing subscription authentication');
  // Preserve the invoking project's and user's policy. An empty MCP map merges
  // with configured entries in Codex; each resolved server must be disabled.
  const featureArgs = REVIEW_DISABLED_FEATURES.flatMap((name) => ['--disable', name]);
  const inventoryText = await probe(binary, [...featureArgs, 'mcp', 'list', '--json'], env, input.root);
  const inventory: unknown = JSON.parse(inventoryText);
  if (!Array.isArray(inventory) || inventory.some((v) => !v || typeof v.name !== 'string'))
    throw new Error('native review cannot establish the configured MCP inventory');
  const inventoryFingerprint = (items: any[]) =>
    createHash('sha256')
      .update(
        canonicalReview(
          items
            .map(({ name, enabled, transport, startup_timeout_sec, tool_timeout_sec }) => ({
              name,
              enabled,
              transport,
              startup_timeout_sec,
              tool_timeout_sec,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .digest('hex');
  const inventoryDigest = inventoryFingerprint(inventory);
  const mcpNames = inventory.map((v) => v.name as string).sort();
  const root = input.root,
    argv = semanticAppServerArgs(provider, mcpNames),
    id = randomUUID();
  const disabled = disableReviewMcp(mcpNames);
  const resolved: unknown = JSON.parse(await probe(binary, [...featureArgs, ...disabled, 'mcp', 'list', '--json'], env, root));
  if (
    !Array.isArray(resolved) ||
    resolved.some((v) => !v || v.enabled !== false) ||
    canonicalReview(resolved.map((v) => v.name).sort()) !== canonicalReview(mcpNames)
  )
    throw new Error('native review could not disable every configured MCP server; no invocation started');
  const prompt = semanticReviewPrompt(prepared.bundle);
  let timedOut = false;
  // One dispatch per prepared generation. A crashed dispatch stays visible and
  // must recover through a new lease; retries cannot silently duplicate model work.
  input.store.transaction(() => {
    const currentLease = heldLease(input.store, { id: lease.id, owner: lease.leaseOwner, nonce: input.token });
    const currentRun = getRun(input.store, run.id);
    if (
      !currentLease ||
      currentLease.token !== lease.token ||
      currentLease.leaseUntil <= input.now() ||
      currentRun?.cancelRequested ||
      !currentRun ||
      ['succeeded', 'failed', 'cancelled'].includes(currentRun.state)
    )
      throw new Error('review dispatch lost its active lease or run while probing the host');
    const dispatchProblems = [...reviewFreshnessProblems(input.store, prepared, input.resolve), ...reviewerIdentityProblems(nativePin)];
    if (dispatchProblems.length) throw new Error(dispatchProblems.join('; '));
    const latest = input.store.db
      .prepare(
        "SELECT id FROM activity_events WHERE kind = 'semantic.prepared' AND run_id = ? AND step_run_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(run.id, lease.id) as { id: number } | undefined;
    if (!latest || `review:${latest.id}` !== prepared.ref) throw new Error('review candidate was replaced during host probing');
    const prior = input.store.db
      .prepare(
        "SELECT id FROM activity_events WHERE kind = 'semantic.dispatched' AND run_id = ? AND json_extract(payload_json, '$.preparedRef') = ?",
      )
      .get(run.id, prepared.ref);
    if (prior)
      throw new Error('this prepared generation already has a review dispatch; inspect its receipt or recover an interrupted lease');
    appendActivity(input.store, {
      at: startedAt,
      kind: 'semantic.dispatched',
      runId: run.id,
      stepRunId: lease.id,
      actor: 'native semantic review adapter',
      channel: 'host_semantic',
      payload: { id, preparedRef: prepared.ref, binaryDigest: pin.digest, profile: pin.profile },
    });
  });
  const problems: string[] = [];
  {
    let exitStatus: number | null;
    let observed: Awaited<ReturnType<typeof runAppServerHeldReview>>;
    const outputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['checks'],
      properties: {
        checks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'verdict', 'reason', 'refs'],
            properties: {
              id: { type: 'string', enum: prepared.bundle.contract.obligations.map((item) => item.id) },
              verdict: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
              reason: { type: 'string' },
              refs: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };
    const result = await runAppServerHeldReview({
      binary,
      argv,
      root,
      env,
      model: input.model,
      heldText: prompt,
      timeoutMs,
      outputSchema,
    });
    exitStatus = result.exitStatus;
    timedOut = result.timedOut;
    observed = { ...result, problems: [...result.problems], observations: [...result.observations] };
    const { text, sessionId, completed, transcriptDigest, observations } = observed;
    problems.push(...observed.problems, ...reviewerIdentityProblems(nativePin));
    let judgment: unknown = null;
    try {
      judgment = JSON.parse(text);
    } catch {
      problems.push('native review did not return one JSON judgment');
    }
    const afterInventory = await probe(binary, [...featureArgs, 'mcp', 'list', '--json'], env, root);
    if (inventoryFingerprint(JSON.parse(afterInventory)) !== inventoryDigest)
      problems.push('native host MCP configuration changed during review');
    problems.push(...semanticJudgmentProblems(prepared.bundle, judgment), ...reviewFreshnessProblems(input.store, prepared, input.resolve));
    const held = heldLease(input.store, { id: lease.id, owner: lease.leaseOwner, nonce: input.token });
    if (!held || held.token !== lease.token || held.leaseUntil <= input.now() || getRun(input.store, run.id)?.cancelRequested)
      problems.push('review completed after cancellation or loss of its lease');
    const receipt: SemanticWitness = {
      preparedRef: prepared.ref,
      bundleDigest: prepared.digest,
      attempt: lease.token,
      isolation: 'held_text',
      invocation: { id, host: 'codex', hostVersion, model: input.model, sessionId, completed, exitStatus, timedOut, transcriptDigest },
      judgment,
      problems,
    };
    const observedReview = observeSemanticReview({
      store: input.store,
      witness: receipt,
      token: input.token,
      resolve: input.resolve,
      at: input.now(),
      actor: 'native semantic review adapter',
      metadata: {
        startedAt,
        observations,
        rawOutputBytes: observed.bytes,
        binaryDigest: pin.digest,
        argvDigest: createHash('sha256').update(JSON.stringify(argv)).digest('hex'),
        profile: pin.profile,
        inventoryDigest,
        disabledMcpNames: mcpNames,
        modelSource: 'requested',
        assurance: 'observed_review; not a proof of truth',
      },
    });
    return { ...observedReview, preparedRef: prepared.ref };
  }
}
