/**
 * tests/orchestration-worker-web.test.mjs — worker web-capable execution (ADR-0050).
 *
 * Proves runTaskViaProvider actually reaches the web for a web-capable Worker Profile through
 * every WebGrant mode, with F08 governance (trust:'untrusted' + Admiralty) on every result,
 * and honestly refuses when no path resolves. All provider calls are mocked via fetchImpl so
 * the mechanism is deterministic without network or keys; governed tests set WEB_SEARCH_URL,
 * provider-native and honesty tests deliberately LACK it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { runTaskViaProvider } from '../lib/orchestration/worker.mjs';

// Route mocked responses by URL substring; each route is a queue consumed in order, or a
// function (body, callIndex) => response for stateful cases. Records every request body.
function mockFetch(routes) {
  const calls = [];
  const impl = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    for (const r of routes) {
      if (url.includes(r.match)) {
        const payload = typeof r.reply === 'function' ? r.reply(body, calls.length) : r.queue.shift();
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const RUN = { request: { summary: 'battery technology advances in 2026' } };
const BASE_ENV = { CONSTRUCT_PROVIDER_TIMEOUT_MS: '5000' };

test('[governed] Anthropic tool-use loop executes Construct web_search; F08 on every result; claim defaulted', async () => {
  const fetchImpl = mockFetch([
    { match: 'api.anthropic.com', queue: [
      { stop_reason: 'tool_use', content: [
        { type: 'text', text: 'Let me search.' },
        { type: 'tool_use', id: 'toolu_1', name: 'web_search', input: { query: 'battery 2026' } }, // claim OMITTED
      ] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Final answer with sources.' }] },
    ] },
    { match: 'search.example', reply: () => ({ results: [{ url: 'https://example.com/a', title: 'A', snippet: 's' }] }) },
  ]);
  const env = { ...BASE_ENV, ANTHROPIC_API_KEY: 'k', WEB_SEARCH_URL: 'https://search.example/api' };
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'claude-opus-4-8', provider: 'anthropic', env, fetchImpl });

  assert.equal(res.webCapability, 'governed');
  assert.equal(res.output, 'Final answer with sources.');
  assert.equal(res.webEvidence.length, 1);
  assert.equal(res.webEvidence[0].trust, 'untrusted');
  assert.equal(res.webEvidence[0].admiralty, 'C3');
  assert.equal(res.webCalls, 1);
  // The follow-up request carried a tool_result whose (stringified) content is F08-governed.
  const followup = fetchImpl.calls.find((c) => c.url.includes('anthropic')
    && (c.body.messages || []).some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result')));
  assert.ok(followup, 'a tool_result turn was sent back to Anthropic');
  const trBlock = followup.body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_result');
  const toolResult = JSON.parse(trBlock.content);
  assert.ok(toolResult.results.some((r) => r.trust === 'untrusted'), 'the tool_result content is trust-labeled');
  // The search actually ran (proves the missing claim was defaulted, not rejected as INVALID_INPUT).
  assert.ok(fetchImpl.calls.some((c) => c.url.includes('search.example')), 'webSearch was invoked');
});

test('[governed] OpenRouter tool_calls loop resends tools[] and feeds role:tool results', async () => {
  const fetchImpl = mockFetch([
    { match: 'openrouter.ai', queue: [
      { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }] } }] },
      { choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }] },
    ] },
    { match: 'search.example', reply: () => ({ results: [{ url: 'https://ex.com/b', title: 'B' }] }) },
  ]);
  const env = { ...BASE_ENV, OPENROUTER_API_KEY: 'k', WEB_SEARCH_URL: 'https://search.example/api' };
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'openrouter/qwen/qwen3-coder:free', provider: 'openrouter', env, fetchImpl });

  assert.equal(res.webCapability, 'governed');
  assert.equal(res.output, 'Done.');
  assert.equal(res.webEvidence[0].trust, 'untrusted');
  const second = fetchImpl.calls.filter((c) => c.url.includes('openrouter'))[1];
  assert.ok(Array.isArray(second.body.tools) && second.body.tools[0].function.name === 'web_search', 'tools[] resent on the follow-up');
  assert.ok(second.body.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_1'), 'role:tool result fed back');
});

test('[provider-native] Anthropic web_search_20250305; citations re-graded to trust:untrusted; only for web-capable Worker Profile', async () => {
  const nativeReply = {
    stop_reason: 'end_turn',
    content: [
      { type: 'text', text: 'I searched. ' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://en.wikipedia.org/x', title: 'X', page_age: 'April 30, 2025' }] },
      { type: 'text', text: 'Answer.', citations: [{ type: 'web_search_result_location', url: 'https://en.wikipedia.org/x', title: 'X', cited_text: 'quote' }] },
    ],
    usage: { server_tool_use: { web_search_requests: 1 } },
  };
  const fetchImpl = mockFetch([{ match: 'api.anthropic.com', reply: () => nativeReply }]);
  const env = { ...BASE_ENV, ANTHROPIC_API_KEY: 'k' }; // NO WEB_SEARCH_URL
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'claude-opus-4-8', provider: 'anthropic', env, fetchImpl });

  assert.equal(res.webCapability, 'provider-native');
  assert.equal(res.webSearchRequests, 1);
  assert.equal(res.output, 'I searched. Answer.');
  assert.ok(res.webEvidence.length >= 1);
  assert.ok(res.webEvidence.every((e) => e.trust === 'untrusted' && e.admiralty === 'C3' && e.needsGrading === true && e.source === 'web'));
  const body = fetchImpl.calls[0].body;
  assert.deepEqual(body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);

  // A non-web-capable Worker Profile gets no web tool.
  const plain = mockFetch([{ match: 'api.anthropic.com', reply: () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'code' }] }) }]);
  const eng = await runTaskViaProvider({ task: { workerProfileId: 'engineer' }, run: RUN, model: 'claude-opus-4-8', provider: 'anthropic', env, fetchImpl: plain });
  assert.equal(eng.webCapability, undefined);
  assert.equal(plain.calls[0].body.tools, undefined);
});

test('[provider-native] OpenRouter openrouter:web_search; url_citation governed; non-https dropped', async () => {
  const reply = { choices: [{ finish_reason: 'stop', message: { content: 'Answer.', annotations: [
    { type: 'url_citation', url_citation: { url: 'https://site.com/p', title: 'P', content: 'excerpt' } },
    { type: 'url_citation', url_citation: { url: 'ftp://bad/x', title: 'bad', content: 'nope' } },
  ] } }] };
  const fetchImpl = mockFetch([{ match: 'openrouter.ai', reply: () => reply }]);
  const env = { ...BASE_ENV, OPENROUTER_API_KEY: 'k' }; // NO WEB_SEARCH_URL
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'openrouter/qwen/qwen3-coder:free', provider: 'openrouter', env, fetchImpl });

  assert.equal(res.webCapability, 'provider-native');
  assert.equal(res.output, 'Answer.');
  assert.equal(res.webEvidence.length, 1, 'non-https citation dropped by the grader');
  assert.equal(res.webEvidence[0].url, 'https://site.com/p');
  assert.equal(res.webEvidence[0].trust, 'untrusted');
  assert.deepEqual(fetchImpl.calls[0].body.tools, [{ type: 'openrouter:web_search', parameters: { engine: 'auto', max_results: 5 } }]);
});

test('[honesty guard] web-capable + no web path → capability-unavailable, no web tool, no-fabrication clause', async () => {
  const fetchImpl = mockFetch([{ match: 'api.openai.com', reply: () => ({ choices: [{ message: { content: 'I cannot reach the web here.' } }] }) }]);
  const env = { ...BASE_ENV, OPENAI_API_KEY: 'k' }; // openai + no WEB_SEARCH_URL → unavailable
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'openai/gpt-4o-mini', provider: 'openai', env, fetchImpl });

  assert.equal(res.webCapability, 'unavailable');
  const body = fetchImpl.calls[0].body;
  assert.equal(body.tools, undefined, 'no web tool sent when unavailable');
  assert.ok(body.messages[0].content.includes('NO live web'), 'the no-fabrication clause is in the system prompt');
});

test('[round cap] governed loop terminates at the cap with a tools-less final answer', async () => {
  let toolTurns = 0;
  const fetchImpl = mockFetch([
    { match: 'api.anthropic.com', reply: (body) => {
      // With no tools offered (past the cap), the model must answer.
      if (!body.tools) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Capped answer.' }] };
      toolTurns += 1;
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${toolTurns}`, name: 'web_search', input: { query: 'x' } }] };
    } },
    { match: 'search.example', reply: () => ({ results: [{ url: 'https://ex.com/c', title: 'C' }] }) },
  ]);
  const env = { ...BASE_ENV, ANTHROPIC_API_KEY: 'k', WEB_SEARCH_URL: 'https://search.example/api', CONSTRUCT_WORKER_TOOL_ROUNDS: '2' };
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'claude-opus-4-8', provider: 'anthropic', env, fetchImpl });

  assert.equal(res.output, 'Capped answer.');
  assert.equal(res.webCalls, 2, 'exactly the capped number of tool executions');
});

// construct-5wkl AC#5/AC#7: a citation the Worker Profile writes into its final
// answer that never appeared in its own governed webEvidence is unverified —
// fabricated, or drawn from ungoverned model memory rather than the retrieval
// Construct actually observed and trust-labeled.

test('[evidence grounding] a citation absent from governed webEvidence is downgraded, not silently trusted', async () => {
  const fetchImpl = mockFetch([
    { match: 'openrouter.ai', queue: [
      { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"battery 2026"}' } }] } }] },
      { choices: [{ finish_reason: 'stop', message: { content: 'Per https://ex.com/b this holds, and also see https://fabricated-source.example/nope for more.' } }] },
    ] },
    { match: 'search.example', reply: () => ({ results: [{ url: 'https://ex.com/b', title: 'B' }] }) },
  ]);
  const env = { ...BASE_ENV, OPENROUTER_API_KEY: 'k', WEB_SEARCH_URL: 'https://search.example/api' };
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'openrouter/qwen/qwen3-coder:free', provider: 'openrouter', env, fetchImpl });

  assert.equal(res.evidenceStatus, 'unverified-citations');
  assert.deepEqual(res.unverifiedCitations, ['https://fabricated-source.example/nope']);
});

test('[evidence grounding] every citation tracing to governed webEvidence carries no warning', async () => {
  const fetchImpl = mockFetch([
    { match: 'openrouter.ai', queue: [
      { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"battery 2026"}' } }] } }] },
      { choices: [{ finish_reason: 'stop', message: { content: 'Per https://ex.com/b, the claim holds.' } }] },
    ] },
    { match: 'search.example', reply: () => ({ results: [{ url: 'https://ex.com/b', title: 'B' }] }) },
  ]);
  const env = { ...BASE_ENV, OPENROUTER_API_KEY: 'k', WEB_SEARCH_URL: 'https://search.example/api' };
  const res = await runTaskViaProvider({ task: { workerProfileId: 'researcher' }, run: RUN, model: 'openrouter/qwen/qwen3-coder:free', provider: 'openrouter', env, fetchImpl });

  assert.equal(res.evidenceStatus, undefined);
  assert.equal(res.unverifiedCitations, undefined);
});
