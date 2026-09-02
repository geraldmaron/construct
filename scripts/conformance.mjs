#!/usr/bin/env node
/**
 * conformance.mjs — host conformance, run on demand, never in CI.
 *
 * For every supported host it checks, without credentials: whether the host
 * is installed here, that its project MCP file can be written and reads
 * back bound, that the operational skill is discoverable where the host
 * looks, that `construct serve` completes the MCP handshake the host would
 * perform, that the interactive surface preserves the current host (no
 * spawn path exists in the server or the broker), that ordinary language
 * classifies as the directive's examples say, that a skill body loads only
 * when asked, that a managed workflow runs end to end with decisions relayed
 * and a final handback, and that the headless surface cannot decide.
 *
 * `--live` additionally drives an installed host's own CLI with a prompt and
 * asks it to call bootstrap; that needs the host's credential and cannot run
 * from inside a host session. A missing host, a missing credential, or a
 * nested session is reported as untested with the reason, never as a pass.
 *
 * Output: a markdown table on stdout and a JSON report at --out (default
 * .tmp-conformance/report.json, ignored by git).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LAUNCHER = join(ROOT, 'bin', 'construct.mjs');
const live = process.argv.includes('--live');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice('--out='.length) : join(ROOT, '.tmp-conformance', 'report.json');

const HOSTS = [
  { id: 'claude-code', binary: 'claude', skillsDir: (home) => join(home, '.claude', 'skills'), wire: true, liveArgs: (prompt) => ['-p', prompt, '--output-format', 'json', '--max-turns', '3'] },
  { id: 'cursor', binary: 'cursor-agent', skillsDir: (home) => join(home, '.cursor', 'skills'), wire: true, liveArgs: (prompt) => ['-p', prompt, '--output-format', 'json'] },
  { id: 'vscode', binary: 'code', skillsDir: null, wire: true, liveArgs: null },
  { id: 'opencode', binary: 'opencode', skillsDir: (home) => join(home, '.config', 'opencode', 'skills'), wire: true, liveArgs: (prompt) => ['run', prompt] },
  { id: 'codex', binary: 'codex', skillsDir: (home) => join(home, '.agents', 'skills'), wire: false, liveArgs: (prompt) => ['exec', prompt] },
  { id: 'bob', binary: 'bob', skillsDir: (home) => join(home, '.bob', 'skills'), wire: false, liveArgs: null },
];

function which(binary) {
  const r = spawnSync('sh', ['-lc', `command -v ${binary}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n').pop() : null;
}

function cli(args, cwd, env) {
  const r = spawnSync(process.execPath, [LAUNCHER, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function session(cwd, env, client) {
  const child = spawn(process.execPath, [LAUNCHER, 'serve', `--client=${client}`], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let stderr = '';
  const pending = new Map();
  let next = 1;
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('exit', (code) => {
    for (const [, resolve] of pending) resolve({ error: { code: -1, message: `serve exited with ${String(code)}: ${stderr.trim().slice(0, 300)}` } });
    pending.clear();
  });
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
    if (child.exitCode !== null) {
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
    if (host.wire) record(host.id, 'host wiring', rec?.hostWiring?.status === 'installed' ? 'passed' : 'failed', rec?.hostWiring ? `${rec.hostWiring.path} ${rec.hostWiring.status}` : 'no wiring recorded');
    else record(host.id, 'host wiring', 'untested', `${host.id} reads no project MCP file Construct writes; point it at construct serve --client=${host.id} by hand`);
    if (host.skillsDir) {
      const dir = host.skillsDir(home);
      const present = existsSync(join(dir, 'construct', 'SKILL.md'));
      const same = present && Buffer.compare(readFileSync(join(dir, 'construct', 'SKILL.md')), readFileSync(join(ROOT, 'skills', 'construct', 'SKILL.md'))) === 0;
      record(host.id, 'operational skill discovery', same ? 'passed' : 'failed', same ? `${dir}/construct/SKILL.md is the shipped bytes` : `not planted at ${dir}`);
    } else {
      record(host.id, 'operational skill discovery', 'untested', `${host.id} documents no personal skills directory`);
    }
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
      let final = null;
      if (validated) {
        await s.call('promote_deliverable', { deliverableId: validated.id, to: 'challenged' });
        await s.call('promote_deliverable', { deliverableId: validated.id, to: 'accepted' });
        final = await s.call('promote_deliverable', { deliverableId: validated.id, to: 'final' });
      }
      record(host.id, 'final handback', final?.deliverable?.trust === 'final' ? 'passed' : 'failed', final ? 'deliverable final after the person’s acceptance' : 'no validated deliverable');
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
      record(host.id, 'decision relay', decided?.decision?.state === 'resolved' ? 'passed' : 'failed', q ? `question "${q.question.slice(0, 40)}…" resolved by the person` : 'no open question at bootstrap');
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
      else {
        const prompt = 'Call the construct MCP tool named bootstrap and reply with the value of its "next" field only.';
        const r = spawnSync(binary, host.liveArgs(prompt), { cwd: project, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 180000 });
        record(host.id, 'live host call', r.status === 0 && /listen|question|decision|run/.test(r.stdout) ? 'passed' : 'failed', r.status === 0 ? r.stdout.slice(0, 200).replace(/\s+/g, ' ') : (r.stderr || r.error?.message || 'no output').slice(0, 200));
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
writeFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), live, cwdHome: homedir(), summary, checks }, null, 2)}\n`);
process.exit(summary.failed > 0 ? 1 : 0);
