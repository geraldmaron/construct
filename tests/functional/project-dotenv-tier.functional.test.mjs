/**
 * tests/functional/project-dotenv-tier.functional.test.mjs — construct-6y6w.8.
 *
 * lib/env-config.mjs's header promises a project `.env` tier (project .env
 * wins over user config.env, which wins over shell exports), but neither
 * public surface honored it: bin/construct bound `rootDir` to the toolkit
 * install checkout (ROOT_DIR) instead of the user's project, and
 * lib/mcp/server.mjs passed no `rootDir` at all. Both now resolve the
 * project root via lib/roots.mjs's resolveProjectRoot() (walk up from cwd to
 * a `.construct/` or `package.json` marker) before loading env, so a `.env` in the
 * user's repo loads on both surfaces.
 *
 * `CONSTRUCT_DEPLOYMENT_MODE` is the probe: bin/construct's `config mode`
 * prints getDeploymentMode(process.env) verbatim, and the MCP server's
 * `construct://status` resource reports the same value as `deploymentMode` —
 * both read process.env only after the fix's env-merge runs, so a value that
 * only exists in a temp project's `.env` proves that file was actually read.
 *
 * The toolkit-dev-checkout case (running construct from inside its own
 * source tree, no `.construct/` ancestor) stays unaffected: resolveProjectRoot falls
 * back to the nearest `package.json`, the same directory ROOT_DIR already
 * pointed to.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { resolveProjectRoot } from '../../lib/roots.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');
const SERVER = join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');

// bin/construct's own copy-into-process.env loop only assigns a merged file
// value when the key is not already present in process.env, so the spawn env
// below never sets CONSTRUCT_DEPLOYMENT_MODE itself — only the fixture .env
// files do. That guard (shell wins on an actual conflict) is a separate,
// pre-existing asymmetry between the CLI and MCP surfaces and out of scope
// here; leaving the key absent from the shell keeps the two file tiers
// (project vs. user config.env) the only ones under test.

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'cx-project-env-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(join(home, '.config', 'construct'), { recursive: true });
  mkdirSync(join(project, '.cx'), { recursive: true });
  return {
    root,
    home,
    project,
    writeProjectEnv(contents) { writeFileSync(join(project, '.env'), contents, 'utf8'); },
    writeUserEnv(contents) { writeFileSync(join(home, '.config', 'construct', 'config.env'), contents, 'utf8'); },
    cleanup() { rmTmpDir(root); },
  };
}

function runCli(env, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: env.project,
    encoding: 'utf8',
    timeout: 15_000,
    env: sterileSpawnEnv({
      HOME: env.home,
      USERPROFILE: env.home,
      CONSTRUCT_HOME_OVERRIDE: env.home,
      XDG_CONFIG_HOME: join(env.home, '.config'),
      CI: 'true',
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
    }),
  });
}

async function connectMcp(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: env.project,
    env: sterileSpawnEnv({
      HOME: env.home,
      USERPROFILE: env.home,
      CONSTRUCT_HOME_OVERRIDE: env.home,
      XDG_CONFIG_HOME: join(env.home, '.config'),
      CI: 'true',
    }),
  });
  const client = new Client({ name: 'project-dotenv-tier-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function readStatus(client) {
  const res = await client.readResource({ uri: 'construct://status' });
  const text = res.contents?.[0]?.text;
  return JSON.parse(text);
}

test('CLI: a .env in the project root loads and its value reaches process.env', () => {
  const env = sandbox();
  try {
    env.writeProjectEnv('CONSTRUCT_DEPLOYMENT_MODE=team\n');
    const res = runCli(env, ['config', 'mode']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), 'team', `expected the project .env value; stderr: ${res.stderr}`);
  } finally {
    env.cleanup();
  }
});

test('CLI: project .env wins over user config.env (documented tier order)', () => {
  const env = sandbox();
  try {
    env.writeProjectEnv('CONSTRUCT_DEPLOYMENT_MODE=team\n');
    env.writeUserEnv('CONSTRUCT_DEPLOYMENT_MODE=enterprise\n');
    const res = runCli(env, ['config', 'mode']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), 'team', 'project .env must win over user config.env');
  } finally {
    env.cleanup();
  }
});

test('CLI: user config.env still applies when the project .env does not set the key', () => {
  const env = sandbox();
  try {
    env.writeUserEnv('CONSTRUCT_DEPLOYMENT_MODE=enterprise\n');
    const res = runCli(env, ['config', 'mode']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), 'enterprise', 'user config.env tier must still be honored');
  } finally {
    env.cleanup();
  }
});

test('MCP: a .env in the project root loads into the server process and its value is observable', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  env.writeProjectEnv('CONSTRUCT_DEPLOYMENT_MODE=team\n');
  const client = await connectMcp(env);
  t.after(() => client.close());
  const status = await readStatus(client);
  assert.equal(status.deploymentMode, 'team', 'construct://status must reflect the project .env value');
});

test('MCP: project .env wins over user config.env (documented tier order)', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  env.writeProjectEnv('CONSTRUCT_DEPLOYMENT_MODE=team\n');
  env.writeUserEnv('CONSTRUCT_DEPLOYMENT_MODE=enterprise\n');
  const client = await connectMcp(env);
  t.after(() => client.close());
  const status = await readStatus(client);
  assert.equal(status.deploymentMode, 'team', 'project .env must win over user config.env on the MCP surface too');
});

test('toolkit-dev-checkout case: resolveProjectRoot falls back to the nearest package.json when there is no .construct/ ancestor', () => {
  const root = mkdtempSync(join(tmpdir(), 'cx-toolkit-equiv-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'pretend-toolkit-checkout' }), 'utf8');
    const nested = join(root, 'lib', 'mcp');
    mkdirSync(nested, { recursive: true });
    assert.equal(
      resolveProjectRoot(nested),
      root,
      'a cwd inside a package.json-rooted checkout (the toolkit-dev shape ROOT_DIR used to serve) must still resolve to that checkout root',
    );
  } finally {
    rmTmpDir(root);
  }
});
