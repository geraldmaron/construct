/**
 * examples/provider-plugin/index.mjs — minimal Construct provider plugin.
 *
 * Reference implementation of the Construct provider contract. Returns canned
 * data so the plugin can be exercised without any external credentials.
 *
 * Usage:
 *   1. Copy this directory somewhere accessible (npm package or local path).
 *   2. Add it to ~/.construct/providers.json:
 *        { "hello-world": "/absolute/path/to/examples/provider-plugin" }
 *      or register via CLI:
 *        construct provider plugins add /path/to/examples/provider-plugin
 *   3. Verify: construct provider list
 *   4. Test:   construct provider test hello-world --query "greet"
 *
 * See docs/providers/authoring.md for the full contract reference.
 */

import { assertProviderContract } from '../../lib/providers/contract.mjs';

const ITEMS = [
  { id: 'hello-1', title: 'Hello, World!', body: 'The simplest possible greeting.', url: 'https://example.com/1' },
  { id: 'hello-2', title: 'Hello, Construct!', body: 'A greeting for the Construct system.', url: 'https://example.com/2' },
  { id: 'hello-3', title: 'Greetings from the reference plugin', body: 'This item is returned by the example provider.', url: 'https://example.com/3' },
];

/**
 * Provider factory. Receives options and returns a provider instance.
 *
 * @param {object} [options]
 * @param {object} [options.env] - Environment variables (default: process.env)
 * @returns {ProviderInstance}
 */
export function create({ env = process.env } = {}) {
  const provider = {
    meta: {
      id: 'hello-world',
      displayName: 'Hello World (example plugin)',
      capabilities: ['read', 'search'],
    },

    configSchema: {
      type: 'object',
      properties: {
        HELLO_WORLD_PREFIX: {
          type: 'string',
          description: 'Optional prefix to prepend to all returned items',
        },
      },
      required: [],
    },

    async health(config) {
      return { ok: true, detail: 'example provider is always healthy' };
    },

    async read(config, query) {
      const id = typeof query === 'string' ? query : query?.id;
      const item = ITEMS.find((i) => i.id === id);
      return item ? [item] : [];
    },

    async search(config, query) {
      const q = (typeof query === 'string' ? query : query?.q || '').toLowerCase();
      if (!q) return ITEMS;
      return ITEMS.filter(
        (i) => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q),
      );
    },
  };

  assertProviderContract(provider);
  return provider;
}
