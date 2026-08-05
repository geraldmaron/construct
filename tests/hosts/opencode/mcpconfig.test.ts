/**
 * tests/hosts/opencode/mcpconfig.test.ts — the role write surface on the second
 * host.
 *
 * These assert the two things that are Construct's to guarantee here: the
 * bearer reaches the server without ever touching argv, and it does not outlive
 * the invocation on disk. They deliberately do NOT assert that the role's tool
 * reach is confined to two writes, because on this host it is not — OpenCode has
 * no `--strict-mcp-config` equivalent and both its config seams merge with the
 * operator's own registrations. That finding is a named, probed expectation in
 * pin.ts, and a test claiming otherwise here would be the paper-over the bead
 * ruled out.
 *
 * The schema is OpenCode's, not Claude's, and the difference is not cosmetic:
 * `environment` rather than `env`, and a single argv array rather than command
 * plus args. Copying the Claude shape produces a config that parses cleanly and
 * registers nothing, which is why the key names are asserted literally.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  CONFIG_ENV_VAR,
  MCP_SERVER_NAME,
  buildOpenCodeConfig,
  writeOpenCodeConfig,
} from '../../../src/hosts/opencode/mcpconfig.ts';
import { createOpenCodeAdapter } from '../../../src/hosts/opencode/adapter.ts';
import { roleServeEnvironment } from '../../../src/hosts/environment.ts';

const BEARER = 'construct-role-bearer-do-not-log';
const ROLE_ENV = {
  CONSTRUCT_ROLE_TOKEN: BEARER,
  CONSTRUCT_ROLE_RUN: 'run-1',
  CONSTRUCT_ROLE_TASK: 't-1',
};

test('the config uses OpenCode\'s schema, not the Claude adapter\'s', () => {
  const config = buildOpenCodeConfig(ROLE_ENV, { command: ['/usr/bin/node', 'serve.js'] });
  const server = (config.mcp as Record<string, Record<string, unknown>>)[MCP_SERVER_NAME];

  assert.equal(server.type, 'local', 'OpenCode says "local"; "stdio" is Claude\'s word');
  assert.deepEqual(server.command, ['/usr/bin/node', 'serve.js'], 'one argv array, not command+args');
  assert.equal(server.enabled, true, 'a registered-but-disabled server is no write surface');
  assert.deepEqual(server.environment, ROLE_ENV, 'OpenCode reads "environment", not "env"');
  assert.equal('env' in server, false, 'the Claude key name would register nothing');
});

test('the host\'s mutation tools are off for a role: two MCP writes is the whole authority', () => {
  const config = buildOpenCodeConfig(ROLE_ENV);
  const tools = config.tools as Record<string, boolean>;

  for (const tool of ['bash', 'edit', 'write', 'patch']) {
    assert.equal(tools[tool], false, `${tool} is host authority a role must never need`);
  }
});

test('the role env wins over anything the launcher supplies', () => {
  const config = buildOpenCodeConfig(ROLE_ENV, {
    // A launcher trying, by accident or otherwise, to set the scope itself.
    env: { CONSTRUCT_STORE: '/tmp/store.db', CONSTRUCT_ROLE_RUN: 'some-other-run' },
  });
  const server = (config.mcp as Record<string, Record<string, string>>)[MCP_SERVER_NAME];
  const env = server.environment as unknown as Record<string, string>;

  assert.equal(env.CONSTRUCT_ROLE_RUN, 'run-1', 'the dispatcher owns the scope, not the launcher');
  assert.equal(env.CONSTRUCT_STORE, '/tmp/store.db', 'and the launcher still gets what it needs');
});

test('the bearer is written where only this user can read it', () => {
  const written = writeOpenCodeConfig(ROLE_ENV);
  try {
    assert.equal(statSync(written.path).mode & 0o777, 0o600, 'the file holds a live credential');
    const dir = written.path.replace(/\/[^/]+$/, '');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.match(readFileSync(written.path, 'utf8'), new RegExp(BEARER));
  } finally {
    written.dispose();
  }
});

test('disposing removes the bearer from disk, and disposing twice is safe', () => {
  const written = writeOpenCodeConfig(ROLE_ENV);
  assert.ok(existsSync(written.path));

  written.dispose();
  assert.equal(existsSync(written.path), false, 'the bearer must not outlive the invocation');

  // The adapter disposes in a finally that can run after an earlier dispose on
  // the error path; a throw there would replace the real failure with this one.
  written.dispose();
});

test('the path is what travels, never the bearer', () => {
  // The whole reason registration goes through a file: argv is world-readable
  // through `ps`. On this host not even the path rides argv — it is delivered
  // by environment — so the surface for a leak is smaller than Claude's, not
  // larger.
  const written = writeOpenCodeConfig(ROLE_ENV);
  try {
    assert.equal(CONFIG_ENV_VAR, 'OPENCODE_CONFIG');
    assert.doesNotMatch(written.path, new RegExp(BEARER), 'the path must not encode the secret');
  } finally {
    written.dispose();
  }
});

/**
 * The adapter half: roleEnv arriving at invoke() must become a real
 * registration, and must be gone afterwards. Before the isolation fix the adapter
 * accepted context.roleEnv and ignored it, so a run dispatched to OpenCode had
 * no write surface at all — and nothing failed, which is why it went unnoticed.
 */
test('the adapter turns roleEnv into a registration and cleans it up after', async () => {
  const seen: { env?: Record<string, string>; args: readonly string[] }[] = [];
  let configPath = '';

  const adapter = createOpenCodeAdapter({
    binary: '/nonexistent/opencode',
    spawn: (_command, args, options) => {
      const env = options.env as Record<string, string> | undefined;
      seen.push({ env, args });
      configPath = env?.OPENCODE_CONFIG ?? '';
      return {
        done: Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ type: 'text', part: { text: 'done' } }) + '\n',
          stderr: '',
        }),
        kill: () => {},
      };
    },
  });

  await adapter.init();
  await adapter.invoke(
    { role: 'privacy', task: 'report what this implicates' },
    { roleEnv: ROLE_ENV },
  );

  const run = seen.find((s) => s.args.includes('run'));
  assert.ok(run, 'the run should have been spawned');
  assert.ok(configPath, 'roleEnv must produce an OPENCODE_CONFIG for the child');

  // The bearer reaches the server through the file, and nothing else.
  assert.equal(
    run.args.some((arg) => arg.includes(BEARER)),
    false,
    'the bearer must never ride argv',
  );
  assert.equal(
    Object.values(run.env ?? {}).some((v) => v === BEARER),
    false,
    'nor the host process environment — only the config file the host reads',
  );
  assert.equal(existsSync(configPath), false, 'the config must not outlive the invocation');
});

test('a dispatch with no role env registers nothing at all', async () => {
  let env: Record<string, string> | undefined;
  const adapter = createOpenCodeAdapter({
    binary: '/nonexistent/opencode',
    spawn: (_command, _args, options) => {
      env = options.env as Record<string, string> | undefined;
      return {
        done: Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ type: 'text', part: { text: 'done' } }) + '\n',
          stderr: '',
        }),
        kill: () => {},
      };
    },
  });

  await adapter.init();
  await adapter.invoke({ role: 'privacy', task: 'report' });
  assert.equal(env?.OPENCODE_CONFIG, undefined, 'no surface is the safe default, not a broken one');
});

/**
 * The interaction between two correct decisions, which together were wrong
 * (found on a live probe).
 *
 * hostEnvironment() strips the XDG variables so the HOST reads its own config
 * rather than construct's scratch one — right. The role's MCP server resolves
 * construct's store through those same variables — also right. But the server is
 * launched BY the host, so it inherited the stripped environment and opened the
 * DEFAULT store while the run lived in an isolated one: registered, connected,
 * writing to the wrong database. Nothing failed loudly; the drafts simply landed
 * somewhere else.
 */
test('the role server is pointed at construct\'s store, not the host\'s stripped one', () => {
  const isolated = '/tmp/construct-test-isolated-share';
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = isolated;
  try {
    const config = buildOpenCodeConfig(ROLE_ENV, { env: roleServeEnvironment() });
    const server = (config.mcp as Record<string, Record<string, unknown>>)[MCP_SERVER_NAME];
    const env = server.environment as Record<string, string>;

    assert.equal(
      env.XDG_DATA_HOME,
      isolated,
      'the server must resolve the same store construct itself resolved',
    );
    // And the scope is still the dispatcher's: carrying paths must not become a
    // way for the environment to reach the run, task or bearer.
    assert.equal(env.CONSTRUCT_ROLE_RUN, 'run-1');
    assert.equal(env.CONSTRUCT_ROLE_TOKEN, BEARER);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
});
