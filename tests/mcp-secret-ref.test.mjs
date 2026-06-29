/**
 * tests/mcp-secret-ref.test.mjs — remote MCP header secrets must be emitted as
 * host-resolved environment references, never as literal token values.
 *
 * A live credential (e.g. a GitHub token) embedded verbatim into Claude/OpenCode/
 * VS Code MCP config files scatters the secret across N files on disk. The builders
 * must instead emit each host's env-reference syntax so the token stays in one place
 * and the host resolves it at launch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClaudeMcpEntry, buildOpenCodeMcpEntry } from '../lib/mcp-platform-config.mjs';

const GITHUB_DEF = {
  type: 'url',
  url: 'https://api.githubcopilot.com/mcp/',
  headers: { Authorization: 'Bearer __GITHUB_TOKEN__' },
};

const SENTINEL = 'sentinel-value-must-not-be-embedded';

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
