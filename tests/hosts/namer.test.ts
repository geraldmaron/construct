/**
 * tests/hosts/namer.test.ts — the host-layer DomainNamer.
 *
 * The parser's job is narrow and its failure modes are asymmetric, which is
 * what these tests are shaped around. Being too strict turns a model's
 * formatting habit into a reported non-implication, and a user reads "no domain
 * applies" as an answer rather than as a parse failure. Being too loose lets a
 * malformed reply become an empty-but-confident result, which naming.ts would
 * then cache. So: tolerate the wrappers models actually add, and THROW on
 * everything else — because naming.ts turns a throw into an honestly-stated fallback and
 * an empty return into "the model considered the catalog and named nothing".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostNamer, namerPrompt, parseNamings } from '../../src/hosts/namer.ts';
import { DOMAINS } from '../../src/kernel/implication/domains.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';

const BODY = '{"domains":[{"domain":"privacy","why":"it moves personal data"}]}';

function host(result: Partial<HostResult>): HostAdapter {
  return {
    name: 'stub',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (): Promise<HostResult> => ({
      id: 'x',
      status: 'ok',
      output: null,
      error: null,
      ...result,
    }),
  };
}

test('plain JSON parses to a naming with its stated reason', () => {
  const namings = parseNamings(BODY);
  assert.deepEqual(namings, [{ domain: 'privacy', why: 'it moves personal data' }]);
});

test('a fenced code block is unwrapped rather than rejected', () => {
  assert.deepEqual(parseNamings('```json\n' + BODY + '\n```'), [
    { domain: 'privacy', why: 'it moves personal data' },
  ]);
});

test('prose around the JSON does not cost the answer', () => {
  const namings = parseNamings(`Here is my analysis.\n${BODY}\nHope that helps.`);
  assert.equal(namings.length, 1);
});

test('naming nothing is an answer, and parses as one', () => {
  assert.deepEqual(parseNamings('{"domains":[]}'), []);
});

test('a reply with no JSON throws rather than reading as silence', () => {
  assert.throws(() => parseNamings('I think privacy applies here.'), /no JSON object/);
});

test('malformed JSON throws rather than reading as silence', () => {
  assert.throws(() => parseNamings('{"domains":[{"domain":}]}'), /malformed JSON/);
});

test('JSON without a domains array throws rather than reading as silence', () => {
  assert.throws(() => parseNamings('{"result":"privacy"}'), /no "domains" array/);
});

test('an entry with no domain name is dropped, not guessed at', () => {
  const namings = parseNamings('{"domains":[{"why":"reasons"},{"domain":"privacy","why":"ok"}]}');
  assert.deepEqual(namings, [{ domain: 'privacy', why: 'ok' }]);
});

test('a naming with no reason survives parsing so naming.ts can reject it', () => {
  // The empty-reason bar belongs to naming.ts's admissible(), in one place.
  // Enforcing it here too would give a reasonless naming two different ways to
  // slip through, which is how the two checks drift apart.
  assert.deepEqual(parseNamings('{"domains":[{"domain":"privacy"}]}'), [
    { domain: 'privacy', why: '' },
  ]);
});

test('the prompt names every catalog domain and forbids inventing one', () => {
  const prompt = namerPrompt('ship a thing', DOMAINS);
  for (const domain of DOMAINS) assert.ok(prompt.includes(domain.domain), domain.domain);
  assert.match(prompt, /ONLY these concerns/);
  assert.match(prompt, /Naming nothing is a valid/);
  // The conditions are the point: a prompt carrying only the names is the
  // one-line catalog the situational definitions replaced.
  assert.match(prompt, /applies when:/);
  assert.match(prompt, /does NOT apply when:/);
});

test('a namer reads the host deliverable', async () => {
  const namer = createHostNamer(host({ output: { text: BODY } }));
  assert.deepEqual(await namer('anything', DOMAINS), [
    { domain: 'privacy', why: 'it moves personal data' },
  ]);
});

test('a non-ok host result throws, because the catalog was never considered', async () => {
  const namer = createHostNamer(host({ status: 'error', output: { text: BODY } }));
  await assert.rejects(() => namer('anything', DOMAINS), /returned status error/);
});

test('a host that returns no text throws rather than naming nothing', async () => {
  const namer = createHostNamer(host({ output: { text: '   ' } }));
  await assert.rejects(() => namer('anything', DOMAINS), /no text/);
});
