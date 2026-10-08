#!/usr/bin/env node
/**
 * conformance.mjs — host conformance, run on demand, never in CI.
 *
 * For every supported host it checks, without credentials: whether the host
 * is installed here, that its project MCP file can be written and reads
 * back bound, that the file carries no machine path and starts the server
 * exactly as written, that the operational skill is planted in the project
 * skills directory the host reads, that Claude Code's hooks stay in its
 * machine-local settings, that `construct serve` completes the MCP handshake the host would
 * perform, that the interactive surface preserves the current host (no
 * spawn path exists in the server or the broker), that ordinary language
 * classifies as the directive's examples say, that a skill body loads only
 * when asked, that a managed workflow runs end to end with decisions relayed
 * and a final handback, and that the headless surface cannot decide.
 *
 * `--live` additionally drives an installed host's own CLI with a prompt and
 * asks it to call bootstrap; that needs the host's credential and cannot run
 * from inside a host session. Claude Code, Codex, and Cursor are driven
 * through scripts/host-cli.mjs, with the host's own login and the project's
 * Construct pinned to the scratch home; Codex, Cursor, and OpenCode need
 * `--model=<model>`, and Cursor also `--allow-cursor-state`, because a run
 * touches the person's ~/.cursor: its model selection is put back and the
 * chats the call made are moved under .tmp-conformance/cursor-live/.
 * Optional `--host=<id>` limits the
 * run to one host. A missing host, a missing credential, a missing model
 * where required, or a nested session is reported as untested with the
 * reason, never as a pass.
 *
 * Output: a markdown table on stdout and a JSON report at --out (default
 * .tmp-conformance/report.json, ignored by git).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientWiring, projectSkillsDirFor } from '../src/hosts/wiring/clients.ts';
import { launchOf } from '../src/hosts/wiring/wire.ts';
import { EVAL_HOSTS, codexProviderFromConfig, hostArgs, hostEnv, mcpEntry, parseHostStream, pinHookEnvironment } from './host-cli.mjs';
import { cursorSnapshot, restoreCursor } from './evals-live.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LAUNCHER = join(ROOT, 'bin', 'construct.mjs');
const live = process.argv.includes('--live');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice('--out='.length) : join(ROOT, '.tmp-conformance', 'report.json');
const modelArg = process.argv.find((a) => a.startsWith('--model='));
const MODEL = modelArg ? modelArg.slice('--model='.length) : null;
const hostArg = process.argv.find((a) => a.startsWith('--host='));
const HOST_FILTER = hostArg ? hostArg.slice('--host='.length) : null;

const ALL_HOSTS = [
  { id: 'claude-code', binary: 'claude', liveArgs: (prompt) => ['-p', prompt, '--output-format', 'json', '--max-turns', '3'] },
  { id: 'cursor', binary: 'cursor-agent', liveArgs: (prompt) => ['-p', prompt, '--output-format', 'json'] },
  { id: 'vscode', binary: 'code', liveArgs: null },
  { id: 'opencode', binary: 'opencode', liveArgs: (prompt, model) => model ? ['run', '-m', model, prompt] : ['run', prompt], needsModel: true },
  { id: 'codex', binary: 'codex', liveArgs: (prompt) => ['exec', prompt] },
  { id: 'bob', binary: 'bob', liveArgs: null },
];
const HOSTS = HOST_FILTER ? ALL_HOSTS.filter((h) => h.id === HOST_FILTER) : ALL_HOSTS;
if (HOST_FILTER && HOSTS.length === 0) {
  process.stderr.write(`conformance: unknown --host=${HOST_FILTER}\n`);
  process.exit(2);
}

function which(binary) {
  const r = spawnSync('sh', ['-lc', `command -v ${binary}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n').pop() : null;
}

function cli(args, cwd, env) {
  const r = spawnSync(process.execPath, [LAUNCHER, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/**
 * A PATH holding only this checkout's launcher as `construct`, the running
 * node, and git, so a host file's `construct` resolves here and never to a
 * global install.
 */
function scratchBin(dir) {
  mkdirSync(dir, { recursive: true });
  symlinkSync(LAUNCHER, join(dir, 'construct'));
  symlinkSync(process.execPath, join(dir, 'node'));
  const git = which('git');
  if (git) symlinkSync(git, join(dir, 'git'));
  return dir;
}

/** A served session; by default this checkout's serve, or exactly the command a host file names. */
function session(cwd, env, client, launch = { command: process.execPath, args: [LAUNCHER, 'serve', `--client=${client}`] }) {
  const child = spawn(launch.command, launch.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let stderr = '';
  let failed = null;
  const pending = new Map();
  let next = 1;
  const fail = (message) => {
    for (const [, resolve] of pending) resolve({ error: { code: -1, message } });
    pending.clear();
  };
  child.on('error', (error) => {
    failed = `could not start ${launch.command}: ${error.message}`;
    fail(failed);
  });
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('exit', (code) => fail(`serve exited with ${String(code)}: ${stderr.trim().slice(0, 300)}`));
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        p(msg);
      }
    }
  });
  const rpc = (method, params) => new Promise((resolve) => {
    if (failed) {
      resolve({ error: { code: -1, message: failed } });
      return;
    }
    const id = next++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    if (!r || r.error) throw new Error(`${name}: ${r?.error?.message ?? 'no reply'}`);
    if (r.result.isError) throw new Error(`${name}: ${r.result.structuredContent?.error ?? r.result.content[0].text}`);
    return r.result.structuredContent ?? JSON.parse(r.result.content[0].text);
  };
  const close = () => new Promise((resolve) => {
    if (failed || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.stdin.end();
    child.on('exit', resolve);
  });
  return { rpc, call, close };
}

const checks = [];
const record = (host, check, status, detail) => checks.push({ host, check, status, detail });

/**
 * The host file carries no machine path, and starting it exactly as written
 * (workspace variables substituted, from the project directory, with only
 * construct, node, and git on PATH) serves this project.
 */
async function checkPortableWiring(host, project, env, bin) {
  const w = clientWiring(host.id);
  const launch = launchOf(host.id, project);
  if (!w || !launch) {
    record(host.id, 'portable wiring', 'failed', `no construct entry to start in ${w?.relativePath ?? 'the host file'}`);
    return;
  }
  const text = readFileSync(join(project, w.relativePath), 'utf8');
  const parts = [launch.command, ...launch.args];
  const pinned = parts.filter((p) => isAbsolute(p) || /\bv?\d+\.\d+\.\d+\b/.test(p));
  const leaked = [project, realpathSync(project), ROOT.replace(/\/$/, ''), process.execPath].filter((p) => text.includes(p));
  if (pinned.length > 0 || leaked.length > 0) {
    record(host.id, 'portable wiring', 'failed', `${w.relativePath} carries a machine path: ${[...pinned, ...leaked].join(', ')}`);
    return;
  }
  const substitute = (a) => a.replaceAll('${workspaceFolder}', project);
  const s = session(project, { ...env, PATH: scratchBin(bin) }, host.id, { command: launch.command, args: launch.args.map(substitute) });
  try {
    const initMsg = await s.rpc('initialize', {});
    if (!initMsg.result) throw new Error(initMsg.error?.message ?? 'no initialize reply');
    const boot = await s.call('bootstrap');
    const root = boot.construct?.project?.root;
    const same = typeof root === 'string' && realpathSync(root) === realpathSync(project);
    record(host.id, 'portable wiring', same ? 'passed' : 'failed', `${w.relativePath} starts ${parts.join(' ')}; bootstrap bound ${String(root)}`);
  } catch (error) {
    record(host.id, 'portable wiring', 'failed', `${w.relativePath} starts ${parts.join(' ')}: ${String(error instanceof Error ? error.message : error).slice(0, 300)}`);
  } finally {
    await s.close();
  }
}

/**
 * Claude Code's hooks stay on this machine: init records them installed in
 * .claude/settings.local.json, git ignores that file, the shared
 * .claude/settings.json holds no construct hook, and each hook runs through
 * the launcher rather than naming Node or the install. Construct ships hooks
 * for Claude Code only.
 */
function checkLocalHooks(project, wiredHost, env) {
  const hooks = wiredHost?.hooks;
  const local = join(project, '.claude', 'settings.local.json');
  const shared = join(project, '.claude', 'settings.json');
  const commands = (file) => {
    if (!existsSync(file)) return [];
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    return Object.values(settings.hooks ?? {}).flatMap((list) => list.flatMap((e) => (e.hooks ?? []).map((h) => String(h.command))));
  };
  const ours = (c) => / hook (?:post-tool|stop|session-start) --client=claude-code /.test(c);
  const problems = [];
  if (hooks?.status !== 'installed' || realpathSync(hooks.path) !== realpathSync(local)) problems.push(`init recorded hooks ${hooks ? `${hooks.status} in ${hooks.path}` : 'nowhere'}`);
  if (commands(shared).some(ours)) problems.push('the shared .claude/settings.json holds construct hooks');
  const installed = commands(local).filter(ours);
  if (installed.length !== 3) problems.push(`${String(installed.length)} grounding hook(s) in .claude/settings.local.json, not 3`);
  if (installed.some((c) => c.includes(process.execPath) || !c.includes('/.construct/state/launcher'))) problems.push('a hook names Node or the install instead of the launcher');
  if (spawnSync('git', ['check-ignore', '-q', '.claude/settings.local.json'], { cwd: project, env }).status !== 0) problems.push('git does not ignore .claude/settings.local.json');
  record('claude-code', 'machine-local hooks', problems.length === 0 ? 'passed' : 'failed', problems.length === 0 ? '.claude/settings.local.json runs the three hooks through the launcher; git ignores it; .claude/settings.json holds none' : problems.join('; '));
}

async function checkHost(host) {
  const scratch = mkdtempSync(join(tmpdir(), `construct-conformance-${host.id}-`));
  const home = join(scratch, 'home');
  const project = join(scratch, 'project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(project, 'README.md'), '# Conformance\n\nA project for the conformance run.\n');
  writeFileSync(join(project, 'docs', 'design.md'), '# Design\n\n- Keep the kernel host-agnostic\n');
  spawnSync('git', ['init', '-q', project]);
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.state'), XDG_DATA_HOME: join(home, '.data'), XDG_CACHE_HOME: join(home, '.cache') };
  const binary = which(host.binary);
  record(host.id, 'installed', binary ? 'passed' : 'untested', binary ? binary : `${host.binary} is not installed here`);
  try {
    const init = cli(['init', `--client=${host.id}`, '--scale=solo', '--outcome=prove conformance', '--constraint=never write outside the project', '--json'], project, env);
    const rec = init.code === 0 ? JSON.parse(init.out) : null;
    record(host.id, 'installation and binding', init.code === 0 ? 'passed' : 'failed', init.code === 0 ? `init bound ${project}` : init.err.trim());
    const wiredHost = rec?.hosts?.find((h) => h.client === host.id);
    record(host.id, 'host wiring', wiredHost?.mcp?.status === 'installed' ? 'passed' : 'failed', wiredHost?.mcp ? `${wiredHost.mcp.path} ${wiredHost.mcp.status}` : 'no wiring recorded');
    await checkPortableWiring(host, project, env, join(scratch, 'bin'));
    if (host.id === 'claude-code') checkLocalHooks(project, wiredHost, env);
    // The project skills directory this host reads when it is the only host wired.
    const dir = join(realpathSync(project), projectSkillsDirFor(host.id, [host.id]));
    const present = existsSync(join(dir, 'construct', 'SKILL.md'));
    const same = present && Buffer.compare(readFileSync(join(dir, 'construct', 'SKILL.md')), readFileSync(join(ROOT, 'skills', 'construct', 'SKILL.md'))) === 0;
    const recorded = wiredHost?.skill?.dir === dir;
    record(host.id, 'operational skill discovery', same && recorded ? 'passed' : 'failed', same && recorded ? `${dir}/construct/SKILL.md is the shipped bytes` : `not planted at ${dir}${recorded ? '' : ` (init recorded ${String(wiredHost?.skill?.dir)})`}`);
    const s = session(project, env, host.id);
    try {
      const initMsg = await s.rpc('initialize', {});
      record(host.id, 'bootstrap invocation', initMsg.result?.serverInfo?.name === 'construct' ? 'passed' : 'failed', `initialize → ${initMsg.result?.serverInfo?.name ?? JSON.stringify(initMsg.error)}`);
      if (!initMsg.result) throw new Error(initMsg.error?.message ?? 'no initialize reply');
      const boot = await s.call('bootstrap');
      record(host.id, 'bootstrap summary', boot.session?.host === host.id && typeof boot.next === 'string' ? 'passed' : 'failed', `host ${boot.session?.host}; next: ${boot.next}`);
      const cls = [['What does this function do?', 'answer'], ['Remember that we will not add schema migration until stable', 'remember'], ['Review this implementation against our design principles', 'manage'], ['Every January, compare team strategies to active Jira work and capacity', 'maintain']];
      const results = [];
      for (const [text, expected] of cls) results.push((await s.call('classify_request', { text })).class === expected);
      record(host.id, 'ordinary-language classification', results.every(Boolean) ? 'passed' : 'failed', `${results.filter(Boolean).length}/${results.length} directive examples`);
      const meta = await s.call('skills', { action: 'show', id: 'context-mapping' });
      const body = await s.call('skills', { action: 'show', id: 'context-mapping', includeBody: true });
      record(host.id, 'targeted skill loading', meta.body === undefined && typeof body.body === 'string' ? 'passed' : 'failed', 'body absent by default, present on request');
      const started = await s.call('start_outcome', { workflowId: 'design-conformance', input: { target: 'README.md' } });
      const outputs = { gather: { principles: ['Keep the kernel host-agnostic'], targetSummary: 'the README', unknownPrinciples: ['Does host-agnostic cover the CLI?'] }, deterministic: { findings: [] }, review: { summary: 'conforms', findings: [], assumptions: [] }, record: { driftFindingIds: [], decisionIds: [] } };
      let steps = 0;
      for (let i = 0; i < 4; i += 1) {
        const c = await s.call('claim_work', { runId: started.run.id });
        if (!c.work) break;
        const r = await s.call('submit_work', { stepRunId: c.work.stepRunId, owner: c.work.owner, token: c.work.token, output: outputs[c.work.step.id], evidence: [{ ref: 'docs/design.md' }] });
        if (r.step.state === 'succeeded') steps += 1;
      }
      const status = await s.call('run_status', { runId: started.run.id });
      record(host.id, 'managed workflow execution', status.run.state === 'succeeded' ? 'passed' : 'failed', `${steps}/4 steps; run ${status.run.state}`);
      const validated = status.deliverables.find((d) => d.trust === 'validated');
      // The session asks for acceptance; only the person gives it. A relayed
      // approval of that ask is refused and the deliverable's trust is unchanged.
      let handback = null;
      if (validated) {
        await s.call('promote_deliverable', { deliverableId: validated.id, to: 'challenged' });
        const asked = await s.call('promote_deliverable', { deliverableId: validated.id, to: 'accepted' });
        const relayed = asked?.pendingDecision ? await s.call('decide', { decisionId: asked.pendingDecision, resolution: 'approve' }) : null;
        const after = await s.call('run_status', { runId: started.run.id });
        const still = after.deliverables.find((d) => d.id === validated.id);
        handback = { held: asked?.personRequired === true && relayed?.personRequired === true && relayed?.decision?.state === 'open' && still?.trust === 'challenged' };
      }
      record(host.id, 'final handback', handback?.held ? 'passed' : 'failed', handback ? (handback.held ? 'acceptance waits in the inbox for the person; a relayed approval is refused' : 'a relayed acceptance changed the deliverable’s trust') : 'no validated deliverable');
      // Decision relay: a fresh project with open onboarding questions, answered through decide.
      const list = await s.rpc('tools/list');
      record(host.id, 'no nested host spawn', !list.result.tools.some((t) => /spawn|launch|run_host/.test(t.name)) ? 'passed' : 'failed', 'no tool offers to start another host; the server and broker import no process spawning');
    } catch (error) {
      record(host.id, 'interactive session', 'failed', String(error instanceof Error ? error.message : error).slice(0, 300));
    } finally {
      await s.close();
    }
    const decisionProject = join(scratch, 'decisions');
    mkdirSync(decisionProject, { recursive: true });
    spawnSync('git', ['init', '-q', decisionProject]);
    cli(['init', '--no-wire', `--skills-dir=${join(home, 'skills')}`], decisionProject, env);
    const s2 = session(decisionProject, env, host.id);
    try {
      const boot = await s2.call('bootstrap');
      const q = boot.profile.openQuestions.find((x) => x.options);
      const decided = q ? await s2.call('decide', { decisionId: q.id, resolution: 'solo' }) : null;
      const relayed = decided?.decision?.state === 'resolved' && String(decided?.decision?.resolvedBy ?? '').startsWith('relayed via');
      record(host.id, 'decision relay', relayed ? 'passed' : 'failed', q ? `question "${q.question.slice(0, 40)}…" ${relayed ? 'resolved and recorded as relayed, not as the person' : `recorded as ${String(decided?.decision?.resolvedBy)}`}` : 'no open question at bootstrap');
    } catch (error) {
      record(host.id, 'decision relay', 'failed', String(error instanceof Error ? error.message : error).slice(0, 300));
    } finally {
      await s2.close();
    }
    const headless = cli(['serve', '--headless', '--executor=runner:conformance', '--json'], project, env);
    const h = headless.code === 0 ? JSON.parse(headless.out) : null;
    record(host.id, 'headless surface is limited', h && h.maxTier === 'project_write' && !h.capabilities.includes('ask_user') ? 'passed' : 'failed', h ? `max tier ${h.maxTier}` : headless.err.trim());
    if (live) {
      if (!binary) record(host.id, 'live host call', 'untested', `${host.binary} is not installed`);
      else if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CURSOR_AGENT) record(host.id, 'live host call', 'untested', 'this conformance run is itself inside a host session; a live call would nest a host');
      else if (!host.liveArgs) record(host.id, 'live host call', 'untested', `${host.id} has no scripted prompt entry point`);
      else if ((host.needsModel || (EVAL_HOSTS.includes(host.id) && host.id !== 'claude-code')) && !MODEL) record(host.id, 'live host call', 'untested', `${host.id} live needs --model=<model>`);
      else if (host.id === 'cursor' && !process.argv.includes('--allow-cursor-state')) record(host.id, 'live host call', 'untested', 'a Cursor live call runs in the person\'s own ~/.cursor; pass --allow-cursor-state once they have opted in');
      else {
        const prompt = 'Call the construct MCP tool named bootstrap and reply with the value of its "next" field only.';
        let r;
        let reply;
        if (EVAL_HOSTS.includes(host.id)) {
          // The host keeps its own login; the Construct it starts keeps the scratch home.
          const server = { command: [process.execPath, LAUNCHER, 'serve', `--client=${host.id}`, `--project=${project}`], env };
          const entry = { mcpServers: { construct: mcpEntry(server.command, env) } };
          if (host.id === 'claude-code') writeFileSync(join(project, '.mcp.json'), `${JSON.stringify(entry, null, 2)}\n`);
          if (host.id === 'cursor') {
            mkdirSync(join(project, '.cursor'), { recursive: true });
            writeFileSync(join(project, '.cursor', 'mcp.json'), `${JSON.stringify(entry, null, 2)}\n`);
            writeFileSync(join(project, '.cursor', 'cli.json'), `${JSON.stringify({ permissions: { allow: ['Mcp(construct:*)', 'Read(**)'], deny: ['Write(**)', 'Shell(*)'] } }, null, 2)}\n`);
          }
          if (host.id === 'claude-code') for (const name of ['settings.json', 'settings.local.json']) pinHookEnvironment(join(project, '.claude', name), env);
          const runHome = join(scratch, 'host-home');
          mkdirSync(runHome, { recursive: true });
          const args = hostArgs(host.id, { model: MODEL ?? 'haiku', prompt, mcpConfig: join(project, '.mcp.json'), server, provider: host.id === 'codex' ? codexProviderFromConfig() : null });
          // Cursor runs under the person's own HOME: its model selection is put back and the chats the call made move next to the report.
          const cursorBefore = host.id === 'cursor' ? cursorSnapshot() : null;
          try {
            r = spawnSync(binary, args, { cwd: project, env: hostEnv(host.id, { runHome }), encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
          } finally {
            if (cursorBefore) restoreCursor(cursorBefore, join(OUT, '..', 'cursor-live'));
          }
          reply = parseHostStream(host.id, r.stdout ?? '').finalText ?? '';
        } else {
          r = spawnSync(binary, host.liveArgs(prompt, MODEL), { cwd: project, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 180000 });
          reply = r.stdout ?? '';
        }
        record(host.id, 'live host call', r.status === 0 && /listen|question|decision|run/.test(reply) ? 'passed' : 'failed', r.status === 0 ? reply.slice(0, 200).replace(/\s+/g, ' ') : (r.stderr || r.error?.message || 'no output').slice(0, 200));
      }
    } else {
      record(host.id, 'live host call', 'untested', 'run with --live outside any host session, with the host’s credential present');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

for (const host of HOSTS) await checkHost(host);

// Static: neither the MCP server nor the broker can spawn a process.
const spawnFree = ['src/hosts/mcp/server.ts', 'src/hosts/mcp/jsonrpc.ts', 'src/kernel/broker/tools.ts', 'src/kernel/workflow/service.ts'].every((f) => !/child_process|spawn\(|exec\(/.test(readFileSync(join(ROOT, f), 'utf8')));
record('all', 'current host preserved (static)', spawnFree ? 'passed' : 'failed', 'no process spawning in the server, broker, or workflow service');

const rows = checks.map((c) => `| ${c.host} | ${c.check} | ${c.status} | ${c.detail.replaceAll('|', '\\|')} |`);
process.stdout.write(['| Host | Check | Status | Detail |', '|---|---|---|---|', ...rows, ''].join('\n'));
const summary = { passed: checks.filter((c) => c.status === 'passed').length, failed: checks.filter((c) => c.status === 'failed').length, untested: checks.filter((c) => c.status === 'untested').length };
process.stdout.write(`\nconformance: ${summary.passed} passed, ${summary.failed} failed, ${summary.untested} untested${live ? ' (live)' : ' (static; pass --live for host calls)'}\n`);
mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), live, model: MODEL, hostFilter: HOST_FILTER, cwdHome: homedir(), summary, checks }, null, 2)}\n`);
process.exit(summary.failed > 0 ? 1 : 0);
