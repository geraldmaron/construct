/**
 * lib/hooks/_lib/output-mode.mjs — capability-aware SessionStart output routing.
 *
 * A SessionStart hook's stdout is injected into the model's context. In a
 * non-interactive / SDK / `claude -p` one-shot, that verbose context pollutes a
 * caller's machine-oriented stdout and can spill startup payloads into editors
 * and logs. This resolver picks the channel the payload should use so stdout
 * stays reserved for the caller's output contract while diagnostics remain
 * recoverable.
 *
 * Modes (`CONSTRUCT_HOOK_OUTPUT_MODE` env or `hooks.outputMode` config, env >
 * config > default): `stdout` injects as context (interactive default),
 * `stderr` writes to stderr, `silent` writes only to a debug log, and `auto`
 * resolves to stdout when interactive and silent when not.
 *
 * Honest limitation: Claude Code exposes no reliable in-hook signal for
 * interactive vs print/SDK mode (`CLAUDECODE=1` is set in both; `isTTY` is false
 * even interactively because hooks run without a controlling terminal). So
 * `auto` detects non-interactive only from signals that ARE reliable — `CI`,
 * `NODE_ENV=test`, and an explicit `CONSTRUCT_NONINTERACTIVE` flag — and SDK /
 * host adapters set `CONSTRUCT_HOOK_OUTPUT_MODE` explicitly. `auto` never
 * suppresses on an ambiguous signal, so real interactive sessions keep their
 * rich startup context.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { resolveSetting, loadProjectConfig } from '../../config/project-config.mjs';
import { HOOK_OUTPUT_MODES } from '../../config/schema.mjs';

export { HOOK_OUTPUT_MODES };

function truthyFlag(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Whether the invocation is non-interactive, using only reliable signals.
 * @param {Record<string,string>} [env]
 * @returns {boolean}
 */
export function isNonInteractive(env = process.env) {
  if (env.CI === 'true') return true;
  if (env.NODE_ENV === 'test') return true;
  if (truthyFlag(env.CONSTRUCT_NONINTERACTIVE)) return true;
  return false;
}

function normalizeMode(value) {
  const m = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return HOOK_OUTPUT_MODES.includes(m) ? m : null;
}

/**
 * Resolve the concrete output channel for the SessionStart payload.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {Record<string,string>} [opts.env]
 * @param {object} [opts.config]   loaded project config; read from cwd when omitted
 * @returns {{mode:('stdout'|'stderr'|'silent'), requested:string, source:string, nonInteractive:boolean}}
 */
export function resolveHookOutputMode({ cwd = process.cwd(), env = process.env, config } = {}) {
  let cfg = config;
  if (cfg === undefined) {
    try { cfg = loadProjectConfig(cwd, env).config; } catch { cfg = null; }
  }
  const setting = resolveSetting({ config: cfg, jsonPath: 'hooks.outputMode', env, envKey: 'CONSTRUCT_HOOK_OUTPUT_MODE', defaultValue: 'auto' });
  const requested = normalizeMode(setting.value) || 'auto';
  const nonInteractive = isNonInteractive(env);
  const mode = requested !== 'auto' ? requested : (nonInteractive ? 'silent' : 'stdout');
  return { mode, requested, source: setting.source, nonInteractive };
}

/**
 * Route the SessionStart payload to the resolved channel. `silent` preserves the
 * payload in a debug log so diagnostics stay available without touching the
 * caller's stdout/stderr. Returns the channel actually used.
 *
 * @param {object} opts
 * @param {string} opts.payload
 * @param {string} opts.mode      one of stdout|stderr|silent
 * @param {string} [opts.homeDir]
 * @param {{write:Function}} [opts.stdout]
 * @param {{write:Function}} [opts.stderr]
 * @returns {string} the channel used
 */
export function writeHookContext({ payload, mode, homeDir = homedir(), stdout = process.stdout, stderr = process.stderr } = {}) {
  if (mode === 'stdout') { stdout.write(payload); return 'stdout'; }
  if (mode === 'stderr') { stderr.write(payload); return 'stderr'; }
  try {
    const dir = join(homeDir, '.cx');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session-start-last.log'), payload);
  } catch { /* best effort — never block the session on a debug-log write */ }
  return 'silent';
}
