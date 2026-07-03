/**
 * tests/fakes/index.mjs — barrel export for all fake providers.
 *
 * These fakes are test-only. They satisfy the provider contract defined in
 * lib/providers/contract.mjs and can be validated by assertProviderContract,
 * but they never make real network calls.
 *
 * NETWORK GUARD
 * =============
 * All three fakes are pure in-memory implementations. To enforce that no
 * real network traffic escapes during a test run, pair fakes with a global
 * fetch override at the top of your test file or in your test harness setup:
 *
 *   globalThis.fetch = () => {
 *     throw new Error('Real network blocked in test — use fake providers');
 *   };
 *
 * The fakes themselves never call fetch(), so this guard will only fire if
 * production code (or another test helper) accidentally reaches out to a
 * real service. Restore the real fetch after the test suite completes if
 * other tests in the same process need actual network access.
 *
 * USAGE
 * =====
 *   import { FakeGitHub, FakeJira, FakeConfluence } from './tests/fakes/index.mjs';
 *
 *   const github = FakeGitHub.create();
 *   const jira   = FakeJira.create();
 *   const conf   = FakeConfluence.create();
 *
 * Each create() call returns a fresh, isolated instance with independent state.
 */

export { create as FakeGitHub } from './fake-github.mjs';
export { create as FakeJira } from './fake-jira.mjs';
export { create as FakeConfluence } from './fake-confluence.mjs';
export { create as FakeSlack } from './fake-slack.mjs';
