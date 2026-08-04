/**
 * kernel/run/roleenv.ts — the environment seam between the coordinator and a
 * role's write-surface process.
 *
 * The bearer token must reach the process that serves a role's writes WITHOUT
 * passing through the model. The assignment text is out: the OpenCode adapter
 * hands it to the host as an argv (visible in `ps`) and the host stores it in
 * its session database — a transcript on disk — which is exactly where a
 * bearer must never appear. Environment variables of the serving process cross
 * neither surface: the model never sees them, and nothing transcribes them.
 *
 * This module owns only the names and the two directions (build for the
 * dispatcher, read for the server). Both take and return plain records — no
 * process.env here; reading the live environment is the caller's side of the
 * seam, and kernel/paths.ts stays the only module that touches it.
 *
 * Run and task ride alongside the token even though the token's payload names
 * both, because rolewrite.ts treats the pair as the caller's CLAIM and denies
 * on mismatch with the token's scope. Deriving the claim from the token would
 * turn that cross-check into a tautology.
 */

export const ROLE_TOKEN_ENV = 'CONSTRUCT_ROLE_TOKEN';
export const ROLE_RUN_ENV = 'CONSTRUCT_ROLE_RUN';
export const ROLE_TASK_ENV = 'CONSTRUCT_ROLE_TASK';

export interface RoleServeScope {
  readonly token: string;
  readonly run: string;
  readonly task: string;
}

/** The variables a dispatcher sets on the process serving this role's writes. */
export function buildRoleEnv(scope: RoleServeScope): Record<string, string> {
  return {
    [ROLE_TOKEN_ENV]: scope.token,
    [ROLE_RUN_ENV]: scope.run,
    [ROLE_TASK_ENV]: scope.task,
  };
}

/** Read the scope back out of an environment record. Null if incomplete. */
export function readRoleEnv(env: Record<string, string | undefined>): RoleServeScope | null {
  const token = env[ROLE_TOKEN_ENV];
  const run = env[ROLE_RUN_ENV];
  const task = env[ROLE_TASK_ENV];
  if (!token || !run || !task) return null;
  return { token, run, task };
}
