/**
 * hosts/environment.ts — the environment a host binary is spawned with
 *.
 *
 * Construct resolves its own directories from the XDG variables, which is
 * correct: they are the standard, and `kernel/paths.ts` is right to honor them.
 * The defect is what happens next. Both adapters spawned their host by
 * inheriting `process.env` wholesale, and the hosts are XDG-respecting programs
 * too — so a user isolating CONSTRUCT's state also silently re-pointed the
 * HOST's configuration at the same empty scratch directory.
 *
 * Measured, not theorized: with XDG_CONFIG_HOME pointed at a scratch dir,
 * `construct work --host=opencode --model=ollama/qwen3.5:4b` failed every task
 * with "Model not found: ollama/qwen3.5:4b" while `opencode models` listed six
 * ollama models under the ambient environment and zero under the scratch one.
 * OpenCode reads ~/.config/opencode/opencode.json for its provider
 * registrations. The failure was legible — the task failed with the host's own
 * message and the coordinator recorded it — but the message named the model,
 * which was correct, rather than the environment, which was the cause.
 *
 * Two things were sharing one namespace: construct's state and the host's
 * configuration. So the adapter now hands the host a deliberately-chosen
 * environment rather than inheriting one, which is the same discipline
 * hosts/claude/mcpconfig.ts already applies to the role environment
 *: decide what crosses the boundary instead of letting
 * everything cross by default.
 *
 * All four XDG variables are dropped, not just CONFIG. Credentials are the
 * reason: OpenCode keeps provider auth under XDG_DATA_HOME, so isolating
 * construct's data dir would silently un-authenticate every paid provider the
 * same way isolating its config dir un-registered the local ones. Only ollama
 * needs no auth, which is exactly why the original measurement — taken on a
 * local model — showed XDG_DATA_HOME isolation as harmless when it is not.
 *
 * The escape hatch is real and deliberate. Someone whose whole shell genuinely
 * runs under a custom XDG root is not isolating construct, and for them
 * dropping these would be the bug rather than the fix. `CONSTRUCT_HOST_INHERIT_XDG`
 * turns the inheritance back on and is the supported way to say "the host
 * belongs under this root too".
 */

/** The variables construct and its hosts both resolve directories from. */
export const SHARED_XDG_VARS = [
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
] as const;

/** Set this to keep the host under construct's isolation deliberately. */
export const INHERIT_XDG_VAR = 'CONSTRUCT_HOST_INHERIT_XDG';

/**
 * Set on every host Construct itself spawns. The prompt-submit hook must
 * not treat a namer or work dispatch as the user's Send — that would
 * recurse and record the namer prompt as a run.
 */
export const SKIP_HEAR_VAR = 'CONSTRUCT_SKIP_HEAR';

export type Environment = Record<string, string | undefined>;

/** Unset, empty, "0", and "false" all mean "do not inherit". */
function wantsInheritance(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

/**
 * The environment to spawn a host binary with: the ambient one, minus the XDG
 * variables construct may have had pointed at its own state.
 *
 * Dropping rather than rewriting is the honest operation. If construct was
 * launched with XDG_CONFIG_HOME already set, it cannot recover what the value
 * "should" have been — nobody recorded it. Dropping makes the host fall back to
 * its $HOME-based default, which is precisely the configuration it would have
 * read had construct never been isolated, and that is the property the bead
 * asks for.
 */
export function hostEnvironment(ambient: Environment = process.env): Environment {
  const chosen: Environment = wantsInheritance(ambient[INHERIT_XDG_VAR])
    ? { ...ambient }
    : (() => {
        const next: Environment = { ...ambient };
        for (const variable of SHARED_XDG_VARS) delete next[variable];
        return next;
      })();
  chosen[SKIP_HEAR_VAR] = '1';
  return chosen;
}

/**
 * Which variables `hostEnvironment` would actually drop for this environment.
 * Empty when nothing was isolated, which is the common case — so a caller can
 * report the adjustment only when one was made, rather than narrating a no-op
 * on every run.
 */
export function droppedForHost(ambient: Environment = process.env): readonly string[] {
  if (wantsInheritance(ambient[INHERIT_XDG_VAR])) return [];
  return SHARED_XDG_VARS.filter((variable) => ambient[variable] !== undefined);
}

/**
 * The variables the role-serve process needs to open the SAME store construct
 * is using.
 *
 * This exists because of an interaction between two correct decisions. A role's
 * MCP server resolves the store through kernel/paths.ts, which reads the XDG
 * variables — and `hostEnvironment` deliberately drops those on their way to the
 * host, so the host reads its own configuration rather than construct's scratch
 * one. The MCP server is launched BY the host, so it inherits the stripped
 * environment and resolves to the default store, not the isolated one the run
 * actually lives in. Under isolation the write surface is registered, connects,
 * and writes to the wrong database.
 *
 * So the variables are put back for this one process, explicitly. The role
 * server is construct's own code and belongs under construct's directories; the
 * host is a foreign program and does not. Dropping them wholesale was never
 * about the server, only about the host.
 *
 * Returned as an env fragment rather than applied, so it stays merged UNDER the
 * role env: nothing here can overwrite the run, task or bearer.
 */
export function roleServeEnvironment(ambient: Environment = process.env): Record<string, string> {
  const carried: Record<string, string> = {};
  for (const variable of [...SHARED_XDG_VARS, 'HOME'] as const) {
    const value = ambient[variable];
    if (value !== undefined) carried[variable] = value;
  }
  return carried;
}
