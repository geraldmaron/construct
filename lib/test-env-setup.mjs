/**
 * lib/test-env-setup.mjs — Shared test environment setup.
 *
 * Centralizes XDG environment clearing for all test runners so the logic
 * stays in sync across scripts/run-tests.mjs, npm test:functional, and
 * direct node --test invocations.
 *
 * Tests isolate user state by overriding HOME to a tmp dir, but lib/config/xdg.mjs
 * honors an absolute XDG_CONFIG_HOME/STATE_HOME/CACHE_HOME over HOME. A CI runner or
 * dev shell that exports those vars routes every test's config/state/cache to one
 * shared real location, collapsing per-test HOME isolation: suites cross-pollute (a
 * seeded dashboard token leaks into "config absent" assertions) and writes can land
 * in real host state. Clear them so resolution falls back to each test's HOME, as on
 * a stock local machine; tests that exercise XDG set it explicitly per call.
 */

export function clearXdgVars(env = process.env) {
  delete env.XDG_CONFIG_HOME;
  delete env.XDG_STATE_HOME;
  delete env.XDG_CACHE_HOME;
}
