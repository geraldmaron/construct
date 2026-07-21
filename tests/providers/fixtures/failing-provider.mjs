/**
 * tests/providers/fixtures/failing-provider.mjs — plugin provider fixture.
 *
 * Registered via a project `.construct/providers.json` override in
 * provider-commands.test.mjs to exercise `provider health` against a
 * provider whose health probe always fails, without touching any real
 * built-in provider or its credentials.
 */

export function create() {
  return {
    meta: {
      id: 'fixture-failing',
      displayName: 'Fixture Failing Provider',
      capabilities: ['read'],
      description: 'Always-unhealthy provider fixture for CLI tests.',
    },
    async health() {
      return { ok: false, detail: 'fixture: intentionally unhealthy' };
    },
    async read() {
      return [];
    },
  };
}
