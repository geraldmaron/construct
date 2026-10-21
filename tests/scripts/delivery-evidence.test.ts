import { readFileSync } from 'node:fs';
/** Synthetic protocol/scorer and receipt regressions. No private corpus, traces or model runs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDelivery, digestBytes, DELIVERY_CHECKS, DELIVERY_HOSTS, DELIVERY_SCENARIOS } from '../../scripts/delivery-evidence.mjs';
import { pairToolCalls, isQuestionResult, isEngagementWrite, redactObservation, type TapFrame } from '../../scripts/tool-observations.ts';
import { parseHostStream } from '../../scripts/host-cli.mjs';
import { checkRelease } from '../../scripts/release-gate.mjs';

test('protocol parsing and scoring preserve errors, unanswered calls, questions and successful local work', () => {
  const frame = (dir: TapFrame['dir'], message: unknown, t = 1): TapFrame => ({ dir, t, line: JSON.stringify(message) });
  const frames = [
    frame('host->server', { id: 1, method: 'tools/call', params: { name: 'work', arguments: { action: 'add' } } }),
    frame('server->host', { id: 1, result: { structuredContent: { error: 'missing stakes' }, isError: true } }, 2),
    frame('host->server', { id: 'next', method: 'tools/call', params: { name: 'start_outcome', arguments: {} } }),
    frame(
      'server->host',
      { id: 'next', result: { content: [{ type: 'text', text: JSON.stringify({ started: false, questions: ['Target?'] }) }] } },
      3,
    ),
    frame('host->server', { id: 3, method: 'tools/call', params: { name: 'work', arguments: { action: 'add' } } }),
    frame('server->host', { id: 3, result: { structuredContent: { id: 'work-example', admittedBy: 'request' } } }, 4),
    frame('host->server', { id: 4, method: 'tools/call', params: { name: 'remember', arguments: {} } }),
  ];
  const calls = pairToolCalls(frames);
  assert.equal(calls.length, 4);
  assert.equal(isEngagementWrite(calls[0]!), false);
  assert.equal(isEngagementWrite({ ...calls[0]!, isError: false, result: { error: 'refused' } }), false);
  assert.equal(isQuestionResult(calls[1]!), true);
  assert.equal(isEngagementWrite(calls[1]!), false);
  assert.equal(isEngagementWrite(calls[2]!), true);
  assert.equal(isEngagementWrite(calls[3]!), false);
  const claude = parseHostStream('claude-code', [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'fixture-model', claude_code_version: 'fixture-version' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'ok', name: 'Bash', input: { command: 'node check-greeting.txt' } },
          { type: 'tool_use', id: 'bad', name: 'Bash', input: { command: 'exit 1' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'ok', content: 'passed' },
          { type: 'tool_result', tool_use_id: 'bad', content: 'failed', is_error: true },
        ],
      },
    }),
    JSON.stringify({ type: 'result', result: 'Done.', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);
  assert.equal(claude.modelId, 'fixture-model');
  assert.deepEqual(
    claude.commands.map((c: { success: boolean }) => c.success),
    [true, false],
  );
  const codex = parseHostStream('codex', [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'node check-greeting.txt', exit_code: 0 } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);
  assert.equal(codex.finalText, 'Done.');
  assert.equal(codex.usage.inputTokens, 10);
  assert.equal(codex.commands[0].success, true);
});

test('persisted protocol observations remove capabilities even inside JSON text blocks', () => {
  const value = {
    token: 'private-lease',
    content: [{ text: JSON.stringify({ claimToken: 'private-claim', nested: { acceptanceKey: 'private-key' }, value: '8000' }) }],
    session: '11111111-2222-4333-8444-555555555555',
  };
  const result = JSON.stringify(redactObservation(value));
  for (const secret of ['private-lease', 'private-claim', 'private-key', '11111111-2222-4333-8444-555555555555'])
    assert.equal(result.includes(secret), false);
  assert.match(result, /8000/);
});

function fixture() {
  const files = new Map<string, Buffer>();
  const entry = (path: string, raw: unknown) => {
    const bytes = Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));
    files.set(path, bytes);
    return { path, sha256: digestBytes(bytes) };
  };
  const identity = {
    version: '3.0.0-alpha.34',
    sourceDigest: 'a'.repeat(64),
    surfaceDigest: 'b'.repeat(64),
    tarballSha256: 'c'.repeat(64),
  };
  const receipt = (host: string) => ({
    format: 'construct-delivery-host-v1',
    ...identity,
    host,
    status: 'passed',
    broadQualification: false,
    attestation: 'maintainer-observed',
    hostVersion: 'fixture-version',
    sessionId: `fixture-${host}`,
    model: { id: 'fixture-model', source: 'reported' },
    startedAt: '2026-10-21T01:00:00Z',
    finishedAt: '2026-10-21T01:01:00Z',
    trace: entry(`${host}.log`, 'Synthetic protocol fixture; no native host ran.'),
    scenarios: DELIVERY_SCENARIOS.map((id: string) => ({
      id,
      result: 'pass',
      observed: 'Synthetic validator fixture only.',
      evidence: entry(`${host}-${id}.log`, 'Synthetic observation.'),
    })),
  });
  const manifest: any = {
    format: 'construct-delivery-v1',
    tier: 'delivery',
    ...identity,
    broadQualification: false,
    limitations:
      'Synthetic fixture only. This checks receipt structure and content identity; it does not establish semantic correctness or live host support.',
    checks: Object.fromEntries(
      DELIVERY_CHECKS.map((id: string) => [
        id,
        {
          command:
            id === 'test'
              ? 'npm test'
              : id === 'cleanCheckout'
                ? 'npm ci'
                : id === 'smoke'
                  ? 'npm run smoke -- --tarball candidate.tgz'
                  : `npm run ${id}`,
          result: 'pass',
          observed: 'Synthetic passing command record.',
          evidence: entry(`${id}.log`, 'Synthetic command log.'),
        },
      ]),
    ),
  };
  const receipts = DELIVERY_HOSTS.map(receipt);
  const freeze = () => (manifest.hosts = receipts.map((r: any) => ({ host: r.host, ...entry(`${r.host}.json`, r) })));
  freeze();
  const check = () =>
    checkDelivery({
      manifest,
      version: identity.version,
      source: identity.sourceDigest,
      surface: identity.surfaceDigest,
      tarballSha256: identity.tarballSha256,
      read: (path: string) => {
        const b = files.get(path);
        if (!b) throw Error('absent');
        return b;
      },
    });
  return { manifest, receipts, files, freeze, check };
}
test('delivery requires both hosts, every observed scenario and matching external evidence', async () => {
  assert.equal(fixture().check().ok, true);
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.manifest.hosts.pop();
    },
    (f: ReturnType<typeof fixture>) => {
      f.manifest.sourceDigest = 'd'.repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.receipts[0]!.tarballSha256 = 'd'.repeat(64);
      f.freeze();
    },
    (f: ReturnType<typeof fixture>) => {
      f.receipts[0]!.scenarios.pop();
      f.freeze();
    },
    (f: ReturnType<typeof fixture>) => {
      f.files.set('claude-code.log', Buffer.from('Changed'));
    },
    (f: ReturnType<typeof fixture>) => {
      f.manifest.checks.test.result = 'not_run';
    },
    (f: ReturnType<typeof fixture>) => {
      f.manifest.broadQualification = true;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(f.check().ok, false);
  }
  assert.match((await checkRelease({ tier: 'qualified' })).problems.join(' '), /retired/);
  assert.match((await checkRelease()).problems.join(' '), /requires --manifest/);
});

test('release automation validates and publishes the same supplied tarball', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.ok(workflow.indexOf('npm run release:check -- --manifest=') < workflow.indexOf('npm publish'));
  assert.match(workflow, /npm run smoke -- --tarball/);
  assert.match(workflow, /npm publish "\$\{\{ steps.candidate.outputs.path \}\}" --provenance --tag alpha/);
  assert.doesNotMatch(workflow, /npm pack|tier=experimental-alpha|tier=qualified/);
});
