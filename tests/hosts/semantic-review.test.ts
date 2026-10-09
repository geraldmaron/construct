import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableReviewMcp, semanticEventStream, pinSemanticReviewer, reviewerIdentityProblems } from '../../src/hosts/semantic-review.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from '../cli/support.ts';
const event = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
const start = (s: ReturnType<typeof semanticEventStream>) => { s.write(event({ type: 'thread.started', thread_id: 'isolated' })); s.write(event({ type: 'turn.started' })); };
const final = (s: ReturnType<typeof semanticEventStream>) => s.write(event({ type: 'item.completed', item: { type: 'agent_message', text: '{"checks":[]}' } }));
test('review stream retains only bounded public ordered observations', () => {
  let stopped = false; const s = semanticEventStream(() => { stopped = true; }); start(s);
  s.write(event({ type: 'item.completed', item: { type: 'reasoning', text: 'private fixture' } }));
  const b = event({ type: 'item.completed', item: { type: 'agent_message', text: 'café' } });
  for (const byte of b) s.write(Buffer.from([byte]));
  s.write(event({ type: 'turn.completed', usage: {} })); const r = s.finish();
  assert.equal(stopped, false); assert.equal(r.completed, true); assert.equal(r.text, 'café'); assert.deepEqual(r.problems, []);
  assert.ok(!JSON.stringify(r.observations).includes('private fixture'));
});
test('raw unterminated, private and stderr bytes all consume the same finite bound', () => {
  for (const mode of ['unterminated', 'private', 'stderr']) {
    let stopped = false; const s = semanticEventStream(() => { stopped = true; }, 128);
    s.write(mode === 'private' ? event({ type: 'thinking', text: 'x'.repeat(150) }) : Buffer.from('x'.repeat(150)), mode === 'stderr');
    assert.equal(stopped, true); assert.match(s.finish().problems.join(), /raw byte bound/);
  }
});
test('malformed envelopes, tools, duplicate terminal and late final messages cannot complete successfully', () => {
  for (const value of [null, [], 1, { type: 'item.completed', item: { type: 'command_execution', command: 'unsafe' } }, { type: 'turn.completed' }]) {
    const s = semanticEventStream(() => {}); start(s); s.write(event(value)); assert.ok(s.finish().problems.length);
  }
  for (const late of [{ type: 'turn.completed' }, { type: 'item.completed', item: { type: 'agent_message', text: 'changed' } }]) {
    const s = semanticEventStream(() => {}); start(s); final(s); s.write(event({ type: 'turn.completed' })); s.write(event(late));
    assert.match(s.finish().problems.join(), /after terminal/);
  }
});
test('startup does not pin a workspace PATH script; a changed frozen executable is unavailable', () => {
  const b = sandbox();
  try {
    const bin = join(b.cwd, 'bin'); mkdirSync(bin); const fake = join(bin, 'codex');
    writeFileSync(fake, '#!/bin/sh\necho codex-cli 0.145.0\n', { mode: 0o755 });
    assert.equal(pinSemanticReviewer('codex', { PATH: bin, HOME: b.home }, b.cwd), null);
    assert.equal(pinSemanticReviewer('cursor', { PATH: bin, HOME: b.home }, b.cwd), null);
    assert.match(reviewerIdentityProblems({ host: 'codex', binary: fake, digest: 'wrong', version: 'codex-cli 0.145.0', profile: 'codex-held-text-v1' }).join(), /changed/);
  } finally { b.cleanup(); }
});

test('MCP overrides use the native CLI key syntax and reject ambiguous names', () => {
  assert.deepEqual(disableReviewMcp(['construct', 'source_api']), ['-c', 'mcp_servers.construct.enabled=false', '-c', 'mcp_servers.source_api.enabled=false']);
  assert.throws(() => disableReviewMcp(['source.with.dot']), /cannot safely override/);
});
