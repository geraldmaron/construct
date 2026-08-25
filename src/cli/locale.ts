/**
 * cli/locale.ts — the resolved locale a dispatch or a render pass writes in.
 *
 * Locale rides the settings ladder settings-file.ts already builds (built-in
 * default, global file, project file, CONSTRUCT_LOCALE, a flag): this module
 * is a thin read of that ladder for the one value the voice seam needs, not a
 * second settings mechanism. It exists so a dispatch or render call site can
 * ask "what locale?" without assembling a full ResolveInputs by hand at every
 * one of them.
 */

import { homedir } from 'node:os';
import type { Store } from '../kernel/store/open.ts';
import { resolvePaths } from '../kernel/paths.ts';
import { settingsFileRatified } from '../kernel/store/ratifications.ts';
import { resolveSettings } from './settings-file.ts';
import type { ResolveInputs } from './settings-file.ts';

const LOCALE_KEY = 'locale';

/** The user's home, the same fallback settings.ts uses when nothing else names one. */
function fallbackHome(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? homedir();
}

/**
 * The locale in force for this run: the settings ladder's own winning value
 * for the `locale` key, read through {@link resolveSettings} rather than
 * reimplemented. Never throws on a malformed project or global file the
 * ladder would refuse — a locale is prose framing, not a gate a broken file
 * should be able to block a dispatch behind — and falls back to the ladder's
 * own built-in default (en-US) in that case.
 */
export function resolvedLocale(
  store: Store,
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly flags?: Record<string, string>;
  } = {},
): string {
  const env = options.env ?? process.env;
  const inputs: ResolveInputs = {
    paths: resolvePaths(),
    cwd: options.cwd ?? process.cwd(),
    env,
    flags: options.flags ?? {},
    home: fallbackHome(env),
    ratified: (repoIdentity, hash) => settingsFileRatified(store, repoIdentity, hash),
  };
  try {
    const resolved = resolveSettings(inputs);
    return resolved.find((r) => r.key === LOCALE_KEY)?.display ?? 'en-US';
  } catch {
    return 'en-US';
  }
}
