/**
 * tests/research-gate.test.mjs — the research-shaped engagement gate (construct, follow-up to the gate audit).
 *
 * requiresExternalResearch decides whether web research is engaged. Beyond named
 * entities and writing/architecture/docs work, it fires on research-shaped intent
 * — the vocabulary of external and landscape research — so a free-form research
 * question with no proper noun engages web sourcing rather than a local-only
 * answer. These pin both halves: every research shape engages, and a
 * code-walkthrough of the user's own system stays local (the precision floor).
 */
import test from 'node:test';
import assert from 'node:assert';
import { requiresExternalResearch, classifyResearchShape, requiresLiveWebAccess, determineExecutionTrack, routeRequest } from '../lib/orchestration-policy.mjs';

const fires = (request) => requiresExternalResearch({ request });

test('each research shape engages external research without a named entity', () => {
  const cases = [
    ['comparative', 'compare the top vector databases for our use case'],
    ['comparative', 'what are the trade-offs between rest and graphql'],
    ['selection', 'what is the best framework for background jobs'],
    ['selection', 'which queue should we use for at-least-once delivery'],
    ['landscape', 'give me the landscape of open-source feature-flag tools'],
    ['landscape', 'what is the state of the art in retrieval augmented generation'],
    ['market', 'competitive analysis of observability vendors'],
    ['benchmark', 'benchmark the leading embedding models'],
    ['standards', 'what are the best practices for oauth token rotation'],
  ];
  for (const [shape, request] of cases) {
    const result = fires(request);
    assert.equal(result.required, true, `should engage: ${request}`);
    assert.equal(result.reason, 'research-shaped', `reason for: ${request}`);
    assert.equal(result.shape, shape, `shape for: ${request}`);
  }
});

test('classifyResearchShape names the kind, or null when absent', () => {
  assert.equal(classifyResearchShape('compare A and B'), 'comparative');
  assert.equal(classifyResearchShape('best practices for caching'), 'standards');
  assert.equal(classifyResearchShape('which library should we use'), 'selection');
  assert.equal(classifyResearchShape('refactor the parser module'), null);
});

test('a code walkthrough of the local system stays local (precision floor)', () => {
  const local = [
    'explain how the caching layer works',
    'understand the retrieval path in our indexer',
    'walk me through the auth flow',
    'how does the session-reflect hook fire',
    'fix the login regression',
    'refactor the parser for clarity',
    "what's the best fix for this crash", // "best fix" is not a research shape
  ];
  for (const request of local) {
    assert.equal(fires(request).required, false, `should stay local: ${request}`);
  }
});

test('the pre-existing triggers still take precedence', () => {
  const entity = requiresExternalResearch({ request: 'evaluate whether to adopt Temporal for workflows' });
  assert.equal(entity.required, true);
  assert.equal(entity.reason, 'named-entities', 'a proper noun still wins the reason');
});

test('live web access engages external research and routes off the immediate track', () => {
  const webAsks = [
    'try to connect to the internet',
    'fetch the contents of example.com and summarize them',
    'download the file from https://example.com/data.csv',
    'check if our status page is online',
    'curl the health endpoint',
  ];
  for (const request of webAsks) {
    assert.equal(requiresLiveWebAccess(request), true, `should need web access: ${request}`);
    const gate = requiresExternalResearch({ request });
    assert.equal(gate.required, true, `gate fires: ${request}`);
    assert.equal(gate.reason, 'web-access', `reason is web-access: ${request}`);
    assert.notEqual(determineExecutionTrack({ request }), 'immediate', `must dispatch, not answer directly: ${request}`);
    assert.ok(routeRequest({ request }).specialists.includes('cx-researcher'), `cx-researcher is dispatched: ${request}`);
  }
});

test('local work is not mistaken for live web access (precision floor)', () => {
  const notWeb = [
    'fetch the user record from the database',
    'explain how the retrieval path works',
    'open the config file and add a flag',
    'load the fixture into the test',
    'pull the latest changes and rebase',
  ];
  for (const request of notWeb) {
    assert.equal(requiresLiveWebAccess(request), false, `should not trigger web access: ${request}`);
  }
});
