import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
import type { Executor, ExecutorStatus, Role, WorkerResult, Finding } from '../../kernel/delegation/types.ts';
import { safeEnvironment } from './workspace.ts';

export interface ExecutorConfig {
  readonly binary: string;
  readonly model: string;
  readonly enabled: boolean;
  readonly receipt: string;
}

export interface DelegationConfig {
  readonly executors: Partial<Record<Executor, ExecutorConfig>>;
  readonly maxWorkers: number;
  readonly maxRepairCycles: number;
  readonly maxTimeoutMs: number;
  readonly validation: readonly (readonly string[])[];
}

const EMPTY: DelegationConfig = { executors: {}, maxWorkers: 2, maxRepairCycles: 2, maxTimeoutMs: 20 * 60_000, validation: [] };
const API_ENV = /^(?:OPENAI_API_KEY|OPENAI_BASE_URL|CODEX_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CURSOR_API_KEY|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY)$/;

export function loadDelegationConfig(configDir: string): DelegationConfig {
  const path = join(configDir, 'delegation.json');
  if (!existsSync(path)) return EMPTY;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['executors', 'maxWorkers', 'maxRepairCycles', 'maxTimeoutMs', 'validation'].includes(key))) throw new Error('unknown delegation configuration key');
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = raw[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`invalid delegation ${key}`);
    return value;
  };
  const executors = raw.executors as Record<string, ExecutorConfig> | undefined;
  if (executors && (Array.isArray(executors) || typeof executors !== 'object')) throw new Error('executors must be an object');
  for (const [key, config] of Object.entries(executors ?? {})) {
    if (!['claude', 'codex', 'cursor'].includes(key) || !config || typeof config !== 'object') throw new Error('invalid executor configuration');
    if (Object.keys(config).some(field => !['binary', 'model', 'enabled', 'receipt'].includes(field))) throw new Error('unknown executor configuration key');
    if (typeof config.enabled !== 'boolean' || typeof config.binary !== 'string' || !isAbsolute(config.binary) || typeof config.model !== 'string' || !/^[\w.:[\],=-]{1,160}$/.test(config.model) || typeof config.receipt !== 'string' || !isAbsolute(config.receipt)) throw new Error('executor needs explicit binary, model, enabled state, and receipt path');
  }
  const validation = raw.validation ?? [];
  if (!Array.isArray(validation) || validation.length > 20 || validation.some(command => !Array.isArray(command) || !command.length || command.length > 40 || command.some(arg => typeof arg !== 'string' || arg.length > 1000 || /[\x00-\x1f]/.test(arg)))) throw new Error('validation must contain bounded argument arrays');
  return { executors: executors ?? {}, maxWorkers: bounded('maxWorkers', 2, 1, 8), maxRepairCycles: bounded('maxRepairCycles', 2, 0, 5), maxTimeoutMs: bounded('maxTimeoutMs', 20 * 60_000, 1000, 60 * 60_000), validation };
}

export function commandFor(executor: Executor, model: string, _role: Role, directory: string): string[] {
  if (executor === 'codex') return ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json', '--color', 'never', '--model', model, '--sandbox', 'read-only', '--cd', directory, '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', '-'];
  if (executor === 'claude') return ['--print', '--safe-mode', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
  return ['--print', '--output-format', 'stream-json', '--model', model, '--workspace', directory, '--sandbox', 'enabled', '--mode', 'ask'];
}

export function installedBinary(executor: Executor, configured: ExecutorConfig | undefined, env: NodeJS.ProcessEnv): string | null {
  const name = executor === 'cursor' ? 'agent' : executor;
  const candidates = configured ? [configured.binary] : (env.PATH ?? '').split(delimiter).filter(Boolean).map(directory => join(directory, name));
  return candidates.find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } }) ?? null;
}

function probe(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise(resolve => {
    execFile(binary, args, { env: safeEnvironment(env), timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      resolve(error ? null : `${stdout}${stderr}`);
    });
  });
}

export function authentication(executor: Executor, output: string | null): ExecutorStatus['authenticated'] {
  if (output === null) return 'missing';
  if (executor === 'codex') return /Logged in using ChatGPT/i.test(output) ? 'subscription' : /API key/i.test(output) ? 'api' : 'unknown';
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    if (executor === 'claude') return value.loggedIn === true && value.authMethod === 'claude.ai' ? 'subscription' : /api/i.test(String(value.authMethod)) ? 'api' : 'unknown';
    if (value.authMethod === 'api-key' || value.authMethod === 'api_key') return 'api';
    return value.isAuthenticated === true && value.hasAccessToken === true && value.hasRefreshToken === true ? 'subscription' : 'unknown';
  } catch { return 'unknown'; }
}

export async function executorStatus(executor: Executor, role: Role, config: DelegationConfig, env: NodeJS.ProcessEnv): Promise<ExecutorStatus> {
  const configured = config.executors[executor];
  const binary = installedBinary(executor, configured, env);
  const base = { executor, installed: binary !== null, configured: configured?.enabled === true, authenticated: 'unknown' as const, liveVerified: false, model: configured?.model ?? null };
  if (!binary || !configured?.enabled) return { ...base, reason: binary ? 'not explicitly enabled by the person' : 'CLI not installed at the configured path' };
  if (Object.keys(env).some(key => API_ENV.test(key) && env[key])) return { ...base, authenticated: 'api', reason: 'API authentication or provider environment present; no subscription fallback attempted' };
  const auth = authentication(executor, await probe(binary, executor === 'claude' ? ['auth', 'status', '--json'] : executor === 'codex' ? ['login', 'status'] : ['status', '--format', 'json'], env));
  if (auth !== 'subscription') return { ...base, authenticated: auth, reason: 'subscription-only authentication could not be proved' };
  try {
    const receipt = JSON.parse(readFileSync(configured.receipt, 'utf8')) as Record<string, unknown>;
    const digest = createHash('sha256').update(readFileSync(binary)).digest('hex');
    const argsDigest = createHash('sha256').update(JSON.stringify(commandFor(executor, configured.model, role, '<checkout>'))).digest('hex');
    const version = await probe(binary, ['--version'], env);
    const roles = receipt.roles as Record<string, Record<string, unknown>> | undefined;
    const evidence = roles?.[role];
    const checkedAt = Date.parse(String(receipt.checkedAt));
    const verified = receipt.executor === executor && receipt.version === version?.trim() && receipt.binarySha256 === digest && receipt.model === configured.model && receipt.subscriptionOnly === true &&
      Number.isFinite(checkedAt) && checkedAt <= Date.now() && evidence?.argsSha256 === argsDigest && evidence.permissionBoundary === true && evidence.noMcp === true && evidence.noRecursiveLaunch === true && evidence.processTreeTermination === true &&
      evidence.readOnly === true && typeof evidence.record === 'string' && evidence.record.length > 0;
    return { ...base, authenticated: auth, liveVerified: verified, reason: verified ? 'operator-recorded live evidence matches this binary, model, role, and arguments' : 'live permission/subscription receipt missing or mismatched' };
  } catch {
    return { ...base, authenticated: auth, reason: 'live permission/subscription receipt unavailable' };
  }
}

export function parseResult(executor: Executor, stdout: string, exitCode: number | null): WorkerResult {
  const result = (state: WorkerResult['state'], summary: string): WorkerResult => ({ state, summary, findings: [], usage: null });
  if (exitCode !== 0) return result('failed', 'CLI failed; no executor fallback attempted');
  let events: Array<Record<string, unknown>>;
  try {
    events = stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Record<string, unknown>);
    if (!events.length || events.some(event => !event || typeof event !== 'object' || Array.isArray(event))) throw new Error();
  } catch { return result('failed', 'malformed structured CLI output'); }
  let finalText: string | null = null;
  let usage: Record<string, number> | null = null;
  let completed = false;
  for (const event of events) {
    if (Array.isArray(event.mcp_servers) && event.mcp_servers.length) return result('blocked', 'unexpected MCP initialization; the worker surface permits no servers');
    if (event.type === 'error' || event.type === 'turn.failed' || event.is_error === true) return result('blocked', 'CLI reported an error, quota limit, permission block, or initialization failure');
    if (Array.isArray(event.permission_denials) && event.permission_denials.length) return result('blocked', 'CLI reported denied permissions');
    if (executor === 'codex' && event.type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === 'agent_message' && typeof item.text === 'string') finalText = item.text;
    }
    if (event.type === 'result' || (executor === 'codex' && event.type === 'turn.completed')) {
      completed = true;
      if (typeof event.result === 'string') finalText = event.result;
      if (event.usage && typeof event.usage === 'object') usage = Object.fromEntries(Object.entries(event.usage).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0));
    }
  }
  if (!completed || finalText === null) return result('failed', 'CLI did not produce a terminal result');
  try {
    const parsed = JSON.parse(finalText) as Record<string, unknown>;
    if (!['succeeded', 'blocked', 'failed'].includes(String(parsed.state)) || typeof parsed.summary !== 'string' || !Array.isArray(parsed.findings) || parsed.findings.length > 50) throw new Error();
    const findings = parsed.findings as Finding[];
    if (new Set(findings.map(finding => finding.id)).size !== findings.length || findings.some(finding => !finding || typeof finding.id !== 'string' || typeof finding.path !== 'string' || typeof finding.requirement !== 'string' || typeof finding.evidence !== 'string' || typeof finding.blocking !== 'boolean')) throw new Error();
    if (parsed.patch !== undefined && (typeof parsed.patch !== 'string' || parsed.patch.length > 512 * 1024)) throw new Error();
    return { state: parsed.state as WorkerResult['state'], summary: parsed.summary, findings, usage, ...(typeof parsed.patch === 'string' ? { patch: parsed.patch } : {}) };
  } catch { return result('failed', 'terminal result did not match the bounded worker contract'); }
}
