import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authentication, commandFor, executorStatus, loadDelegationConfig, parseResult } from '../../../src/hosts/delegation/adapters.ts';
import { safeEnvironment } from '../../../src/hosts/delegation/workspace.ts';
import { fakeExecutor, repository } from './support.ts';

test('all adapters use native structured execution without permission bypass or fallback', () => {
  for (const executor of ['claude', 'codex', 'cursor'] as const) {
    for (const role of ['implement', 'review'] as const) {
      const args = commandFor(executor, 'explicit-model', role, '/fixture/checkout');
      assert.ok(args.includes('explicit-model'));
      assert.doesNotMatch(args.join(' '), /--bare|--force|--yolo|--trust|--approve-mcps|dangerously|bypassPermissions|--fallback/);
    }
  }
  assert.ok(commandFor('claude', 'fixture-model', 'review', '/fixture').includes('Read,Glob,Grep'));
  assert.ok(commandFor('codex', 'fixture-model', 'review', '/fixture').includes('read-only'));
  assert.ok(commandFor('cursor', 'fixture-model', 'review', '/fixture').includes('ask'));
});

test('subscription identity must be proven; unknown and API modes do not qualify', () => {
  assert.equal(authentication('claude', '{"loggedIn":true,"authMethod":"claude.ai"}'), 'subscription');
  assert.equal(authentication('claude', '{"loggedIn":true,"authMethod":"api_key"}'), 'api');
  assert.equal(authentication('codex', 'Logged in using ChatGPT'), 'subscription');
  assert.equal(authentication('codex', 'Logged in using API key'), 'api');
  assert.equal(authentication('cursor', '{"authenticated":true}'), 'unknown');
  assert.equal(authentication('cursor', '{"isAuthenticated":true,"hasAccessToken":true,"hasRefreshToken":true}'), 'subscription');
  assert.equal(authentication('cursor', '{"isAuthenticated":true,"hasAccessToken":true,"hasRefreshToken":false}'), 'unknown');
  assert.equal(authentication('claude', 'unparseable'), 'unknown');
});

test('disabled by default; binary drift, missing receipts, or API environments disable configured adapters', async () => {
  const fixture = repository();
  try {
    assert.deepEqual(loadDelegationConfig(fixture.home).executors, {});
    const config = fakeExecutor(fixture, 'codex');
    assert.equal((await executorStatus('codex', 'implement', config, fixture.env)).liveVerified, true);
    assert.equal((await executorStatus('codex', 'implement', config, { ...fixture.env, OPENAI_API_KEY: 'fixture-not-a-secret' })).authenticated, 'api');
    appendFileSync(config.executors.codex!.binary, '\n');
    assert.equal((await executorStatus('codex', 'implement', config, fixture.env)).liveVerified, false);
    writeFileSync(join(fixture.home, 'delegation.json'), '{"surprise":true}');
    assert.throws(() => loadDelegationConfig(fixture.home), /unknown/);
  } finally { fixture.cleanup(); }
});

test('child environments preserve local login locations without inherited credentials or grants', () => {
  const env = safeEnvironment({ HOME: '/fixture/home', PATH: '/fixture/bin', CODEX_HOME: '/fixture/codex', CLAUDE_CONFIG_DIR: '/fixture/claude', OPENAI_API_KEY: 'not-secret', CLAIM_TOKEN: 'not-a-token', NODE_OPTIONS: '--require=untrusted' });
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'HOME', 'PATH']);
});

test('malformed streams, incomplete output, quota errors and denied permissions do not succeed', () => {
  assert.equal(parseResult('codex', 'bad json', 0).state, 'failed');
  assert.equal(parseResult('codex', '{"type":"thread.started"}', 0).state, 'failed');
  assert.equal(parseResult('claude', '{"type":"result","permission_denials":[{}]}', 0).state, 'blocked');
  assert.equal(parseResult('cursor', '{"type":"error","message":"quota"}', 0).state, 'blocked');
  assert.equal(parseResult('claude', '{"type":"system","mcp_servers":[{"name":"unexpected","status":"failed"}]}', 0).state, 'blocked');
  assert.equal(parseResult('codex', '', 1).state, 'failed');
  const valid = JSON.stringify({ type: 'result', result: JSON.stringify({ state: 'succeeded', summary: 'ok', findings: [] }) });
  assert.equal(parseResult('claude', valid, 0).usage, null);
});
