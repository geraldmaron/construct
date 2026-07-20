/**
 * child-worker.mjs — spike F in-flight-safety experiment, child process.
 *
 * Imports the adapter module once, reports which transport generation it
 * loaded (a marker only the new REST version exposes), sleeps for
 * INFLIGHT_SLEEP_MS to model an in-progress write call, then imports the
 * exact same specifier again and reports the marker a second time. Node's
 * ESM loader caches a module by resolved URL at first import, so a second
 * `import()` of the same specifier returns the cached instance regardless
 * of what the parent process wrote to that file on disk in between — this
 * is the property under test.
 */

const specifier = './work/lib/providers/contract/adapters/github/index.mjs';

function markerFor(mod) {
  return typeof mod.default._apiBase === 'string' ? 'new-rest-api' : 'old-gh-cli';
}

const first = await import(specifier);
console.log(JSON.stringify({ event: 'first-import', generation: markerFor(first) }));

await new Promise((r) => setTimeout(r, Number(process.env.INFLIGHT_SLEEP_MS ?? 1500)));

const second = await import(specifier);
console.log(JSON.stringify({ event: 'second-import-same-process', generation: markerFor(second), sameModuleObject: first.default === second.default }));
