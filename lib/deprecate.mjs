/**
 * lib/deprecate.mjs — single-warning-per-process deprecation infrastructure.
 *
 * Usage:
 *
 *   import { deprecate } from './deprecate.mjs';
 *
 *   export function oldThing() {
 *     deprecate('oldThing()', { since: '1.2.0', removeIn: '2.0.0', use: 'newThing()' });
 *     return newThing();
 *   }
 *
 * Each unique key (defaults to the symbol name) emits at most one stderr
 * warning per process. Operators that want a strict signal can run with
 * `CONSTRUCT_DEPRECATIONS=error` to make every deprecation fail-fast,
 * which is useful in CI to flush out unintended deprecation usage before
 * the next major release.
 *
 * Compat tombstone evaluation lives in lib/compat-surfaces.mjs (construct-tsyfe.1.5).
 * Owner: construct-tsyfe.8.18 — wire this helper at remaining compat call sites.
 *
 * The format is stable so it can be grepped from logs:
 *
 *   [construct] deprecated: <symbol> will be removed in v<X.0.0> — use <replacement>
 */

const SEEN = new Set();

function shouldThrow(env) {
  return env.CONSTRUCT_DEPRECATIONS === 'error';
}

export function deprecate(symbol, opts = {}) {
  const env = opts.env || process.env;
  const key = opts.key || symbol;
  if (SEEN.has(key)) return;
  SEEN.add(key);

  const since = opts.since ? ` since v${opts.since}` : '';
  const removeIn = opts.removeIn ? ` will be removed in v${opts.removeIn}` : '';
  const use = opts.use ? ` — use ${opts.use}` : '';
  const message = `[construct] deprecated: ${symbol}${since}${removeIn}${use}`;

  if (shouldThrow(env)) {
    throw new Error(message);
  }
  process.stderr.write(message + '\n');
}

export function _resetDeprecationsForTests() {
  SEEN.clear();
}

export function resultError(message) {
  return { ok: false, error: message };
}

export function resultOk(value = {}) {
  return { ok: true, ...value };
}

export {
  evaluateCompatSurface,
  formatRetiredCliMessage,
  listCompatSurfaces,
  resolveCompatSurface,
  resolveModelsRetiredSurface,
} from './compat-surfaces.mjs';
