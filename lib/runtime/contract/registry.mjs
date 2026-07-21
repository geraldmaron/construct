/**
 * lib/runtime/contract/registry.mjs — a runtime-adapter factory registry,
 * mirroring lib/providers/contract/adapter-factories.mjs's shape for
 * provider adapters. A caller resolves a runtime by key through one shared
 * registry instead of importing an adapter module directly — the seam this
 * bead's replacement proof exercises: swapping which factory a key maps to
 * is a one-line registry edit, not a caller change, and an already-resolved
 * runtime instance is unaffected by a later re-registration (see
 * tests/functional/runtime-adapter-swap.functional.test.mjs for the proof).
 */

export function createRuntimeRegistry(initialFactories = {}) {
  const factories = new Map(Object.entries(initialFactories));

  return {
    /**
     * Register (or replace) the factory for a runtime key. Replacing an
     * existing key is the swap operation this bead's replacement proof uses
     * — it never mutates runtime instances already vended by resolve().
     */
    register(key, factory) {
      if (typeof factory !== 'function') {
        throw new TypeError(`register("${key}") requires a factory function`);
      }
      factories.set(key, factory);
    },

    /**
     * Resolve a fresh runtime instance for a key by calling its registered
     * factory. Each call returns a new instance; callers that need a
     * long-lived runtime hold onto the returned object themselves.
     */
    resolve(key) {
      const factory = factories.get(key);
      if (!factory) {
        throw new Error(`resolveRuntime: unknown runtime "${key}" (known: ${[...factories.keys()].join(', ')})`);
      }
      return factory();
    },

    has(key) {
      return factories.has(key);
    },

    keys() {
      return [...factories.keys()];
    },
  };
}
