/**
 * host-cli.mjs — how Construct's scripts drive a real host CLI: the
 * environment it runs with, its arguments, and how its event stream reads.
 * The live intake runner and `conformance --live` both use it, so a host is
 * invoked one way. The flags are the ones the 2026-10-08 probes ran with on
 * claude 2.1.250, codex-cli 0.145.0 and cursor-agent 2026.09.26; where this
 * module departs from them, the comment at the flag says why.
 *
 * The Construct server a host starts is always built here, as
 * [node, <server>/bin/construct.mjs, serve, --client, --project], so a run
 * measures the server it names and never whatever `construct` the PATH finds.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeEnvironment } from '../src/hosts/delegation/workspace.ts';
import { PREREGISTRATION } from '../src/kernel/skills/routing.ts';
import { codexProviderArgs } from '../src/hosts/codex-provider.ts';
export { CODEX_PROVIDER_KEYS, codexProvider, codexProviderFromConfig, codexProviderArgs } from '../src/hosts/codex-provider.ts';

/** Hosts the live runner can drive headlessly here. */
export const EVAL_HOSTS = ['claude-code', 'codex', 'cursor'];

/** The command each host installs. */
export const HOST_BINARY = { 'claude-code': 'claude', codex: 'codex', cursor: 'cursor-agent' };

/** Where each host reads project skills; the operational skill is planted there, as production init plants it. */
export const PROJECT_SKILLS_DIR = { 'claude-code': join('.claude', 'skills'), codex: join('.agents', 'skills'), cursor: join('.agents', 'skills') };

export const TAP = fileURLToPath(new URL('./evals-live-tap.mjs', import.meta.url));
export const STUB = fileURLToPath(new URL('./evals-live-stub.mjs', import.meta.url));

function known(host) {
  if (!EVAL_HOSTS.includes(host)) throw new Error(`unknown host ${String(host)}; use one of ${EVAL_HOSTS.join(', ')}`);
}

/** A Construct home of its own, so neither init nor the server it starts reads or writes the person's. */
export function constructEnv(home, base = process.env) {
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_STATE_HOME: join(home, '.state'),
    XDG_DATA_HOME: join(home, '.data'),
    XDG_CACHE_HOME: join(home, '.cache'),
    ...(base.PATH ? { PATH: base.PATH } : {}),
    ...(base.LANG ? { LANG: base.LANG } : {}),
    ...(base.TMPDIR ? { TMPDIR: base.TMPDIR } : {}),
  };
}

/** The server command for one run: this node, the named server's launcher, bound to the run's project and host. */
export function serverCommand(server, host, project) {
  return [process.execPath, join(server, 'bin', 'construct.mjs'), 'serve', `--client=${host}`, `--project=${project}`];
}

/** The same command behind the stdio tap, which logs every frame to `log`. */
export function tapCommand(log, command) {
  return [process.execPath, TAP, log, ...command];
}

/** A stub server's command; `spec` is the path of its JSON spec. */
export function stubCommand(spec) {
  return [process.execPath, STUB, spec];
}

/** A stdio MCP entry as the JSON host files hold it. */
export function mcpEntry(command, env) {
  return { type: 'stdio', command: command[0], args: command.slice(1), ...(env ? { env } : {}) };
}

/**
 * The environment a host runs with: the delegation allowlist (HOME, PATH,
 * locale, temp, XDG, the host config dirs), never an API key, never a
 * CLAUDECODE or CLAUDE_CODE_* marker inherited from the session that runs
 * the eval.
 * - claude: the real HOME, where its login lives; auto memory off; tool
 *   search off only in the no-tool-search condition.
 * - codex: HOME is the run's own, so the person's ~/.agents skills stay out;
 *   CODEX_HOME stays at the real ~/.codex for the login.
 * - cursor: the real HOME; under any other HOME cursor-agent is not logged in.
 */
export function hostEnv(host, { runHome = null, condition = 'default', env = process.env } = {}) {
  known(host);
  const base = safeEnvironment(env);
  const realHome = env.HOME || homedir();
  if (host === 'claude-code') {
    return { ...base, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ...(condition === 'no-tool-search' ? { ENABLE_TOOL_SEARCH: 'false' } : {}) };
  }
  if (host === 'codex') {
    if (!runHome) throw new Error('codex runs need a run home');
    return { ...base, HOME: runHome, CODEX_HOME: env.CODEX_HOME || join(realHome, '.codex') };
  }
  return { ...base };
}

/** A value as a TOML literal, for codex's `-c key=value` overrides. */
export function toml(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(', ')}]`;
  if (value && typeof value === 'object') {
    const key = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
    return `{ ${Object.entries(value).map(([k, v]) => `${key(k)} = ${toml(v)}`).join(', ')} }`;
  }
  throw new Error(`no TOML form for ${String(value)}`);
}


const quote = (s) => (/^[\w./:@=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/**
 * Construct's hook commands in a Claude Code settings file, each prefixed
 * with `env` so it runs under the given Construct home rather than the
 * person's. Other hooks and settings are left as they are; a second pass
 * changes nothing. Returns whether the file changed.
 */
export function pinHookEnvironment(path, env) {
  if (!existsSync(path)) return false;
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  const prefix = `env ${Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`).join(' ')} `;
  let changed = false;
  for (const groups of Object.values(settings.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (typeof hook?.command === 'string' && / hook /.test(hook.command) && hook.command.includes('construct') && !hook.command.startsWith('env ')) {
          hook.command = prefix + hook.command;
          changed = true;
        }
      }
    }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return changed;
}

function codexServer(name, server) {
  const key = `mcp_servers.${name}`;
  return [
    '-c', `${key}.command=${toml(server.command[0])}`,
    '-c', `${key}.args=${toml(server.command.slice(1))}`,
    ...(server.env ? ['-c', `${key}.env=${toml(server.env)}`] : []),
    '-c', `${key}.default_tools_approval_mode="approve"`,
  ];
}

/**
 * The host's argv for one run, without the binary.
 * - claude: one turn as `-p <prompt>`, several over `--input-format
 *   stream-json`; the MCP file is the project's own .mcp.json as init wrote
 *   it and the runner rewrote it; only Construct and the run's stubs may be
 *   called. Construct's hooks are in the project or the local settings
 *   file, so both load; the person's user settings never do.
 * - codex: ephemeral, read-only, the person's config ignored except the
 *   provider keys above; Construct and the stubs attached with -c; earlier
 *   turns are written into the prompt.
 * - cursor: print mode with MCP approval and the sandbox on; never --force.
 */
export function hostArgs(host, opts) {
  known(host);
  const { model, prompt = null, multiTurn = false, effort = null } = opts;
  if (!model) throw new Error('a run names its model');
  if (host === 'claude-code') {
    const allowed = ['mcp__construct', ...(opts.stubs ?? []).map((s) => `mcp__${s.name}`)];
    if (!multiTurn && typeof prompt !== 'string') throw new Error('a one-turn run needs its prompt');
    return [
      ...(multiTurn ? ['-p', '--input-format', 'stream-json'] : ['-p', prompt]),
      '--output-format', 'stream-json', '--verbose',
      '--model', model,
      '--strict-mcp-config', '--mcp-config', opts.mcpConfig,
      '--setting-sources', 'project,local',
      '--no-session-persistence',
      '--max-turns', String(PREREGISTRATION.maxTurns),
      '--max-budget-usd', String(PREREGISTRATION.claudeBudgetUsd),
      '--allowedTools', allowed.join(' '),
    ];
  }
  if (typeof prompt !== 'string') throw new Error(`${host} runs take one prompt`);
  if (host === 'codex') {
    return [
      'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config',
      '-s', 'read-only',
      '-m', model,
      ...(effort ? ['-c', `model_reasoning_effort=${toml(effort)}`] : []),
      ...codexProviderArgs(opts.provider ?? null),
      ...codexServer('construct', opts.server),
      ...(opts.stubs ?? []).flatMap((s) => codexServer(s.name, s)),
      prompt,
    ];
  }
  return ['-p', prompt, '--output-format', 'stream-json', '--model', model, '--approve-mcps', '--trust', '--sandbox', 'enabled'];
}

/** The prompt for a host that cannot replay turns: the earlier turns, then the request. */
export function promptFor(turns) {
  const last = turns[turns.length - 1].text;
  if (turns.length === 1) return last;
  return `Earlier in this conversation I said:\n${turns.slice(0, -1).map((t) => `- ${t.text}`).join('\n')}\n\n${last}`;
}

/** True when a reply's last paragraph asks the person something: a sentence in it ends with a question mark. */
export function endedWithQuestion(text) {
  if (typeof text !== 'string') return false;
  const paragraphs = text.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paragraphs[paragraphs.length - 1] ?? '';
  return /\?(?=[)"'*`_]*(?:\s|$))/.test(last);
}

const SKILL_FILE = /(?:^|[/\s'"])skills\/([A-Za-z0-9._-]+)\/SKILL\.md/;

function events(lines) {
  const list = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
  const out = [];
  for (const line of list) {
    if (typeof line !== 'string' || !line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && !Array.isArray(e)) out.push(e);
    } catch {
      // A host prints a few non-JSON lines; only events count.
    }
  }
  return out;
}

/**
 * What a host's event stream says about a run: the model and version it
 * reports, every tool it used, the skills it loaded, whether it searched for
 * tools, its final text and whether that ends on a question, how many turns
 * it took, its usage, and whether it stopped on an error or a limit.
 */
export function parseHostStream(host, lines) {
  known(host);
  const out = { modelId: null, modelSource: 'requested', hostVersion: null, toolUses: [], skillLoads: [], toolSearch: { available: null, calls: 0 }, finalText: null, endedWithQuestion: false, turns: 0, usage: null, error: null, truncated: false, mcpServers: [] };
  const list = events(lines);
  if (host === 'claude-code') {
    let results = 0;
    for (const e of list) {
      if (e.type === 'system' && e.subtype === 'init') {
        if (typeof e.model === 'string') { out.modelId = e.model; out.modelSource = 'reported'; }
        if (typeof e.claude_code_version === 'string') out.hostVersion = e.claude_code_version;
        if (Array.isArray(e.tools)) out.toolSearch.available = e.tools.includes('ToolSearch');
        if (Array.isArray(e.mcp_servers)) out.mcpServers = e.mcp_servers.map((s) => ({ name: s.name, status: s.status }));
      }
      if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
        for (const b of e.message.content) {
          if (b?.type !== 'tool_use') continue;
          out.toolUses.push({ name: b.name, input: b.input ?? {} });
          if (b.name === 'ToolSearch') out.toolSearch.calls += 1;
          if (b.name === 'Skill' && typeof b.input?.skill === 'string') out.skillLoads.push(b.input.skill);
          const path = b.input?.file_path ?? b.input?.path ?? b.input?.command;
          const m = typeof path === 'string' ? path.match(SKILL_FILE) : null;
          if (m) out.skillLoads.push(m[1]);
        }
      }
      if (e.type === 'result') {
        results += 1;
        out.turns += typeof e.num_turns === 'number' ? e.num_turns : 0;
        if (typeof e.result === 'string') out.finalText = e.result;
        out.usage = { costUsd: e.total_cost_usd ?? null, inputTokens: e.usage?.input_tokens ?? null, outputTokens: e.usage?.output_tokens ?? null };
        const limited = /max_turns|max_budget/.test(String(e.subtype)) || /max_turns|max_budget/.test(String(e.terminal_reason));
        if (limited) out.truncated = true;
        else if (e.is_error === true) out.error = String(e.subtype ?? 'error');
      }
    }
    if (results === 0 && !out.truncated) out.error = out.error ?? 'no result event';
  } else if (host === 'codex') {
    let completed = false;
    for (const e of list) {
      const item = e.item;
      if (e.type === 'item.completed' && item?.type === 'mcp_tool_call') out.toolUses.push({ name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} });
      if (e.type === 'item.completed' && item?.type === 'command_execution') {
        out.toolUses.push({ name: 'shell', input: { command: item.command } });
        const m = typeof item.command === 'string' ? item.command.match(SKILL_FILE) : null;
        if (m) out.skillLoads.push(m[1]);
      }
      if (e.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') out.finalText = item.text;
      if (e.type === 'turn.completed') {
        completed = true;
        out.turns += 1;
        out.usage = { inputTokens: e.usage?.input_tokens ?? null, cachedInputTokens: e.usage?.cached_input_tokens ?? null, outputTokens: e.usage?.output_tokens ?? null };
      }
      if (e.type === 'turn.failed' || e.type === 'error') out.error = String(e.error?.message ?? e.message ?? e.type);
    }
    if (!completed && out.error === null) out.error = 'no completed turn';
  } else {
    let result = false;
    for (const e of list) {
      if (e.type === 'system' && e.subtype === 'init' && typeof e.model === 'string') { out.modelId = e.model; out.modelSource = 'reported'; }
      if (e.type === 'tool_call' && e.subtype === 'completed') {
        const call = e.tool_call ?? {};
        if (call.mcpToolCall) {
          const a = call.mcpToolCall.args ?? {};
          out.toolUses.push({ name: `mcp__${a.providerIdentifier ?? a.serverIdentifier}__${a.toolName}`, input: a.args ?? {} });
        } else if (call.getMcpToolsToolCall) {
          out.toolSearch.calls += 1;
        } else if (call.readToolCall) {
          const p = call.readToolCall.args?.path;
          out.toolUses.push({ name: 'read', input: { path: p } });
          const m = typeof p === 'string' ? p.match(SKILL_FILE) : null;
          if (m) out.skillLoads.push(m[1]);
        } else {
          const name = Object.keys(call).find((k) => k.endsWith('ToolCall'));
          if (name) out.toolUses.push({ name, input: call[name]?.args ?? {} });
        }
      }
      if (e.type === 'result') {
        result = true;
        out.turns += 1;
        if (typeof e.result === 'string') out.finalText = e.result;
        out.usage = { inputTokens: e.usage?.inputTokens ?? null, outputTokens: e.usage?.outputTokens ?? null };
        if (e.is_error === true) out.error = String(e.subtype ?? 'error');
      }
    }
    if (!result && out.error === null) out.error = 'no result event';
  }
  out.endedWithQuestion = endedWithQuestion(out.finalText);
  out.skillLoads = [...new Set(out.skillLoads)];
  return out;
}
