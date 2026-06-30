/**
 * tests/mcp-secret-ref.test.mjs — remote MCP header secrets must be emitted as
 * host-resolved environment references, never as literal token values.
 *
 * A live credential (e.g. a GitHub token) embedded verbatim into Claude/OpenCode/
 * VS Code MCP config files scatters the secret across N files on disk. The builders
 * must instead emit each host's env-reference syntax so the token stays in one place
 * and the host resolves it at launch.
 *
 * For local/stdio MCPs the value-to-reference flip is deferred (no confirmed per-host
 * env-block interpolation), but the builders must still never persist an op:// reference
 * or an unresolved __NAME__ template into a host env block. These cases cover the local
 * env path for Claude, OpenCode, and Codex.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClaudeMcpEntry, buildOpenCodeMcpEntry } from '../lib/mcp-platform-config.mjs';
import { buildCodexMcpEntry } from '../lib/codex-config.mjs';

const GITHUB_DEF = {
  type: 'url',
  url: 'https://api.githubcopilot.com/mcp/',
  headers: { Authorization: 'Bearer __GITHUB_TOKEN__' },
};

const LOCAL_DEF = {
  command: 'npx',
  args: ['-y', '@example/stdio-mcp'],
  env: { EXAMPLE_API_KEY: '__EXAMPLE_API_KEY__' },
};

const SENTINEL = 'sentinel-value-must-not-be-embedded';

const OP_REF = 'op://Private/example/credential';

test('OAuth is the default: no auth header / token is written at all', () => {
  const claude = buildClaudeMcpEntry('github', GITHUB_DEF, { GITHUB_TOKEN: SENTINEL });
  const vscode = buildClaudeMcpEntry('github', GITHUB_DEF, { GITHUB_TOKEN: SENTINEL }, { host: 'vscode' });
  const { entry: opencode } = buildOpenCodeMcpEntry('github', GITHUB_DEF, { GITHUB_TOKEN: SENTINEL });
  for (const entry of [claude, vscode, opencode]) {
    assert.equal(entry.headers, undefined, 'OAuth config must carry no headers');
    assert.ok(!JSON.stringify(entry).includes(SENTINEL), 'no token value may appear in an OAuth entry');
  }
  assert.equal(claude.url, 'https://api.githubcopilot.com/mcp/');
});

test('PAT fallback (Claude) references ${GITHUB_TOKEN}, not the literal token', () => {
  const entry = buildClaudeMcpEntry('github', GITHUB_DEF, { GITHUB_TOKEN: SENTINEL }, { auth: 'pat' });
  assert.equal(entry.headers.Authorization, 'Bearer ${GITHUB_TOKEN}');
  assert.ok(!JSON.stringify(entry).includes(SENTINEL), 'literal token must not appear in the Claude entry');
});

test('PAT fallback (VS Code) references ${env:GITHUB_TOKEN}', () => {
  const entry = buildClaudeMcpEntry('github', GITHUB_DEF, { GITHUB_TOKEN: SENTINEL }, { host: 'vscode', auth: 'pat' });
  assert.equal(entry.headers.Authorization, 'Bearer ${env:GITHUB_TOKEN}');
  assert.ok(!JSON.stringify(entry).includes(SENTINEL), 'literal token must not appear in the VS Code entry');
});

test('PAT fallback (OpenCode) references {env:GITHUB_TOKEN}', () => {
  const { entry } = buildOpenCodeMcpEntry('github', GITHUB_DEF, { GITHUB_TOKEN: SENTINEL }, { auth: 'pat' });
  assert.equal(entry.headers.Authorization, 'Bearer {env:GITHUB_TOKEN}');
  assert.ok(!JSON.stringify(entry).includes(SENTINEL), 'literal token must not appear in the OpenCode entry');
});

test('PAT fallback emits a reference even when no token value is resolvable', () => {
  const entry = buildClaudeMcpEntry('github', GITHUB_DEF, {}, { auth: 'pat' });
  assert.equal(entry.headers.Authorization, 'Bearer ${GITHUB_TOKEN}');
});

test('local/stdio env: an op:// reference is never written into the env block', () => {
  const claude = buildClaudeMcpEntry('example', LOCAL_DEF, { EXAMPLE_API_KEY: OP_REF });
  const { entry: opencode } = buildOpenCodeMcpEntry('example', LOCAL_DEF, { EXAMPLE_API_KEY: OP_REF });
  assert.equal(claude.env, undefined, 'op:// must be stripped, leaving no Claude env block');
  assert.equal(opencode.environment, undefined, 'op:// must be stripped, leaving no OpenCode env block');
  assert.ok(!JSON.stringify(claude).includes('op://'), 'no op:// reference may appear in the Claude entry');
  assert.ok(!JSON.stringify(opencode).includes('op://'), 'no op:// reference may appear in the OpenCode entry');
});

test('local/stdio env: an unresolved __NAME__ template is never written into the env block', () => {
  const claude = buildClaudeMcpEntry('example', LOCAL_DEF, {});
  const { entry: opencode } = buildOpenCodeMcpEntry('example', LOCAL_DEF, {});
  assert.equal(claude.env, undefined, 'unresolved template must be stripped from the Claude env block');
  assert.equal(opencode.environment, undefined, 'unresolved template must be stripped from the OpenCode env block');
});

test('Codex stdio env drops both op:// references and unresolved templates', () => {
  const fromRef = buildCodexMcpEntry('example', LOCAL_DEF, { EXAMPLE_API_KEY: OP_REF });
  const fromTemplate = buildCodexMcpEntry('example', LOCAL_DEF, {});
  assert.equal(fromRef.env, undefined, 'op:// must be stripped from the Codex env block');
  assert.equal(fromTemplate.env, undefined, 'unresolved template must be stripped from the Codex env block');
  assert.ok(!JSON.stringify(fromRef).includes('op://'), 'no op:// reference may appear in the Codex entry');
});

test('Codex stdio env keeps a resolved literal value (flip deferred, no env interpolation)', () => {
  const canaryNotAKey = 'CANARY-zz9-not-a-key';
  const entry = buildCodexMcpEntry('example', LOCAL_DEF, { EXAMPLE_API_KEY: canaryNotAKey });
  assert.equal(entry.env.EXAMPLE_API_KEY, canaryNotAKey, 'Codex needs the literal at sync time');
});
