/** Real stdio connection recovery, with sterile projects and no host configuration. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProject } from '../../src/cli/context.ts';
import { sandbox, type Sandbox } from './support.ts';
import type { JsonRpcResponse } from '../../src/hosts/mcp/jsonrpc.ts';
import { WIRABLE_CLIENTS, type ClientId } from '../../src/hosts/wiring/clients.ts';
import { findOnPath } from '../../src/hosts/presence.ts';
import { toolsFor } from '../../src/kernel/broker/tools.ts';
const launcher = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
function cli(box: Sandbox, args: string[]): string {
  const r = spawnSync(process.execPath, [launcher, ...args], { cwd: box.cwd, env: box.ctx.env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  return r.stdout;
}
function session(box: Sandbox, client: ClientId = 'cursor') {
  const child = spawn(process.execPath, [launcher, 'serve', `--client=${client}`], { cwd: box.cwd, env: box.ctx.env });
  let buffer = '',
    stderr = '',
    next = 0;
  const pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const reply = JSON.parse(line) as JsonRpcResponse;
      const waiter = pending.get(Number(reply.id));
      if (waiter) {
        pending.delete(Number(reply.id));
        waiter.resolve(reply);
      }
    }
  });
  child.on('exit', (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`server exited ${String(code)}: ${stderr}`));
    pending.clear();
  });
  const rpc = (method: string, params: unknown = {}): Promise<JsonRpcResponse> =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout: ${method}, ${stderr}`));
      }, 10000);
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timeout);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  return {
    rpc,
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.stdin.end();
        setTimeout(() => {
          if (child.exitCode === null) child.kill();
        }, 2000).unref();
      }),
  };
}
function toolResult(reply: JsonRpcResponse): {
  isError?: boolean;
  structuredContent: { error?: string; next?: string; construct?: { project: { id: string } } };
} {
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  return reply.result as ReturnType<typeof toolResult>;
}
async function discovery(s: ReturnType<typeof session>) {
  const list = await s.rpc('tools/list');
  return (list.result as { tools: { name: string }[] }).tools.map((t) => t.name);
}
async function bootstrap(s: ReturnType<typeof session>) {
  return toolResult(await s.rpc('tools/call', { name: 'bootstrap', arguments: {} }));
}
for (const repair of ['init', 'migrate', 'malformed', 'newer', 'foreign'] as const) {
  test(`same stdio connection recovers after ${repair}, with stable discovery`, async (t) => {
    const lsof = repair === 'migrate' ? findOnPath('lsof', process.env) : null;
    if (repair === 'migrate' && !lsof) return t.skip('real process-holder inspection requires lsof');
    const box = sandbox();
    if (lsof) symlinkSync(lsof, join(box.ctx.env.PATH!, 'lsof'));
    let original = '';
    if (repair !== 'init') {
      cli(box, ['init', '--client=cursor']);
      original = readFileSync(join(box.cwd, '.construct/project.json'), 'utf8');
      if (repair === 'malformed') writeFileSync(join(box.cwd, '.construct/project.json'), '{broken');
      else {
        const db = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'));
        if (repair === 'foreign') db.prepare("UPDATE meta SET value='another-project' WHERE key='project_id'").run();
        else db.prepare("UPDATE meta SET value=? WHERE key='format_version'").run(repair === 'newer' ? '99' : '4');
        db.close();
      }
    }
    const s = session(box);
    try {
      const init = await s.rpc('initialize', { capabilities: {}, clientInfo: { name: 'sterile-lifecycle-test', version: '1' } });
      assert.equal((init.result as { capabilities: { tools: { listChanged: boolean } } }).capabilities.tools.listChanged, false);
      const names = await discovery(s);
      assert.deepEqual(
        names,
        toolsFor('interactive').map((t) => t.name),
      );
      const refused = await bootstrap(s);
      assert.equal(refused.isError, true);
      if (repair === 'newer') assert.match(refused.structuredContent.next!, /Upgrade Construct.*Do not reset/);
      if (repair === 'init') cli(box, ['init', '--client=cursor']);
      else if (repair === 'migrate') cli(box, ['migrate']);
      else if (repair === 'malformed') writeFileSync(join(box.cwd, '.construct/project.json'), original);
      else {
        const db = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'));
        if (repair === 'foreign')
          db.prepare("UPDATE meta SET value=? WHERE key='project_id'").run((JSON.parse(original) as { id: string }).id);
        else db.prepare("UPDATE meta SET value='5' WHERE key='format_version'").run();
        db.close();
      }
      const recovered = await bootstrap(s);
      assert.notEqual(recovered.isError, true, JSON.stringify(recovered));
      assert.ok(recovered.structuredContent.construct?.project.id);
      assert.deepEqual(await discovery(s), names);
      const doctor = JSON.parse(cli(box, ['doctor', '--json'])) as {
        healthy: boolean;
        scope: string;
        readiness: { connected: string; exercised: string };
      };
      assert.equal(doctor.healthy, true);
      assert.equal(doctor.scope, 'installation');
      assert.deepEqual(doctor.readiness, { installed: true, connected: 'unverified', exercised: 'unverified' });
    } finally {
      await s.close();
      box.cleanup();
    }
  });
}
test('a refused connection never follows replacement identity', async () => {
  const box = sandbox();
  cli(box, ['init', '--client=cursor']);
  const file = join(box.cwd, '.construct/project.json');
  const original = readFileSync(file, 'utf8');
  const db = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'));
  db.prepare("UPDATE meta SET value='99' WHERE key='format_version'").run();
  db.close();
  const s = session(box);
  try {
    await s.rpc('initialize');
    assert.equal((await bootstrap(s)).isError, true);
    // Invalid bytes cannot erase an identity observed before the format refusal.
    writeFileSync(file, '{broken');
    assert.equal((await bootstrap(s)).isError, true);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(original), id: 'replacement-project' }));
    const switched = await bootstrap(s);
    assert.equal(switched.isError, true);
    assert.match(switched.structuredContent.error!, /identity changed/);
    writeFileSync(file, original);
    const repaired = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'));
    repaired.prepare("UPDATE meta SET value='5' WHERE key='format_version'").run();
    repaired.close();
    assert.notEqual((await bootstrap(s)).isError, true);
  } finally {
    await s.close();
    box.cleanup();
  }
});

test('a refused connection does not follow a newly introduced nested project root', async () => {
  const box = sandbox();
  cli(box, ['init', '--client=cursor']);
  const nested = join(box.cwd, 'nested');
  mkdirSync(nested);
  const db = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'));
  db.prepare("UPDATE meta SET value='99' WHERE key='format_version'").run();
  db.close();
  const s = session({ ...box, cwd: nested });
  try {
    await s.rpc('initialize');
    assert.equal((await bootstrap(s)).isError, true);
    mkdirSync(join(nested, '.construct'));
    writeFileSync(join(nested, '.construct/project.json'), readFileSync(join(box.cwd, '.construct/project.json')));
    const refused = await bootstrap(s);
    assert.equal(refused.isError, true);
    assert.match(refused.structuredContent.error!, /root changed/);
  } finally {
    await s.close();
    box.cleanup();
  }
});

test('expected binding is checked against the actual bound files before opening state', () => {
  const box = sandbox();
  try {
    cli(box, ['init', '--client=cursor']);
    const config = JSON.parse(readFileSync(join(box.cwd, '.construct/project.json'), 'utf8')) as { id: string };
    const dbPath = join(box.cwd, '.construct/state/construct.sqlite');
    const before = readFileSync(dbPath);
    assert.throws(() => openProject(box.ctx, { root: box.cwd, id: 'foreign-id' }), /binding changed/);
    assert.deepEqual(readFileSync(dbPath), before);
    const opened = openProject(box.ctx, { root: box.cwd, id: config.id });
    opened.store.close();
  } finally {
    box.cleanup();
  }
});

for (const client of WIRABLE_CLIENTS) {
  test(`${client} adapter recovers on the same stdio connection after setup`, async () => {
    const box = sandbox();
    const s = session(box, client);
    try {
      await s.rpc('initialize', { clientInfo: { name: `${client}-sterile-probe`, version: '1' }, capabilities: {} });
      const names = await discovery(s);
      assert.equal((await bootstrap(s)).isError, true);
      cli(box, ['init', `--client=${client}`]);
      const recovered = await bootstrap(s);
      assert.notEqual(recovered.isError, true, JSON.stringify(recovered));
      assert.deepEqual(await discovery(s), names);
      const payload = recovered.structuredContent as { session?: { host: string; session: string; executor: string } };
      assert.equal(payload.session?.host, client);
      assert.ok(payload.session?.executor.includes(payload.session.session));
      const again = (await bootstrap(s)).structuredContent as typeof payload;
      assert.deepEqual(again.session, payload.session, 'recovery preserves one process session and executor');
      const doctor = JSON.parse(cli(box, ['doctor', '--json'])) as { healthy: boolean; scope: string; readiness: { connected: string } };
      assert.equal(doctor.healthy, true);
      assert.equal(doctor.scope, 'installation');
      assert.equal(doctor.readiness.connected, 'unverified');
    } finally {
      await s.close();
      box.cleanup();
    }
  });
}
