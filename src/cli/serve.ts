/**
 * cli/serve.ts — MCP stdio servers launched by host configuration.
 *
 * `serve --client=… --project=…` binds interactive session identity structurally.
 * Missing client still remains interactive with client=unknown — never headless.
 */

import { openStore } from '../kernel/store/open.ts';
import { loadOrCreateSecret, loadSecret } from '../kernel/capabilities/secretfile.ts';
import { readRoleEnv } from '../kernel/run/roleenv.ts';
import { serveProjection } from '../hosts/mcp/projection.ts';
import {
  openInteractiveProject,
  projectHasV1State,
  serveInteractive,
  sessionFromBinding,
} from '../hosts/mcp/interactive.ts';
import { serveHostPull, hostPullEnabled, HOST_PULL_FLAG_ENV } from '../hosts/mcp/hostpull.ts';
import { parseSessionBinding } from '../kernel/session/binding.ts';
import { resolveProjectContext } from '../kernel/project/context.ts';
import { normalizeProjectRoot } from '../kernel/project/context.ts';
import { serveRole } from './roleserve.ts';
import { resolveStoreLocation } from './local-state.ts';
import { now, packageVersion, secretFile, withStoreAsync } from './runtime.ts';

/**
 * Serve one role's write surface over MCP stdio. Not in USAGE on purpose:
 * a host's MCP configuration launches this with the role environment set by
 * the dispatcher (see kernel/run/roleenv.ts); it is plumbing a person never
 * types. The secret is load-only here — a serving process that invented a
 * fresh secret would deny every honestly-minted token as a forgery, and that
 * misconfiguration should read as this one line instead.
 */
export async function roleServe(): Promise<number> {
  const scope = readRoleEnv(process.env);
  if (!scope) {
    process.stderr.write(
      'role-serve: missing CONSTRUCT_ROLE_TOKEN / CONSTRUCT_ROLE_RUN / CONSTRUCT_ROLE_TASK — ' +
        'this command is launched by a host with the dispatcher-set role environment.\n',
    );
    return 2;
  }
  const secret = loadSecret(secretFile());
  if (secret === null) {
    process.stderr.write(
      'role-serve: no capability secret exists yet — it is established the first time "construct work" dispatches.\n',
    );
    return 1;
  }
  const store = openStore(resolveStoreLocation(process.cwd(), process.env).path);
  try {
    await serveRole(
      {
        store,
        secret,
        token: scope.token,
        run: scope.run,
        task: scope.task,
        clock: now,
        serverVersion: packageVersion(),
      },
      process.stdin,
      process.stdout,
    );
  } finally {
    store.close();
  }
  return 0;
}

/**
 * Serve the flagged host-pull execution surface over MCP stdio: an ambient host
 * (Bob, goose, nanobot) claims a ready task and submits a draft for it on its
 * own capacity. Off unless a deployment set the flag, refusing plainly when it
 * did not — a prototype behind a gate is not reachable by accident. It loads the
 * capability secret to mint task-scoped tokens, exactly as role-serve does and
 * unlike the presence projection, which holds no secret and is left untouched.
 */
export async function hostPullServe(): Promise<number> {
  if (!hostPullEnabled(process.env)) {
    process.stderr.write(
      `host-pull-serve: the host-pull execution prototype is off. Set ${HOST_PULL_FLAG_ENV}=1 to enable it.\n`,
    );
    return 2;
  }
  const secret = loadSecret(secretFile());
  if (secret === null) {
    process.stderr.write(
      'host-pull-serve: no capability secret exists yet — it is established the first time "construct work" dispatches.\n',
    );
    return 1;
  }
  const store = openStore(resolveStoreLocation(process.cwd(), process.env).path);
  try {
    await serveHostPull(
      { store, secret, clock: now, serverVersion: packageVersion() },
      process.stdin,
      process.stdout,
    );
  } finally {
    store.close();
  }
  return 0;
}

/**
 * Serve the spine over MCP stdio with structural session binding.
 *
 * Prefer `--client` / `--project` from the host MCP launch config over ambient
 * env detection for interactive routing identity.
 *
 * When the project has been `construct init`'d (format-v1 state present),
 * serve the semantic interactive control plane. Otherwise keep the legacy
 * projection until Phase G deletes it.
 */
export async function serve(argv: string[] = []): Promise<number> {
  const binding = parseSessionBinding(argv, process.cwd());
  const projectRoot =
    binding.projectRoot !== null ? normalizeProjectRoot(binding.projectRoot) : process.cwd();
  const ctx = resolveProjectContext({
    hostProjectRoot: binding.projectSource === 'flag' ? projectRoot : undefined,
    cwd: process.cwd(),
    allowCwdFallback: true,
  });

  if (projectHasV1State(ctx.root)) {
    const state = openInteractiveProject(ctx.root);
    try {
      await serveInteractive(
        {
          store: state,
          projectRoot: ctx.root,
          clock: now,
          serverVersion: packageVersion(),
          session: sessionFromBinding({
            client: binding.client,
            projectRoot: ctx.root,
            host: binding.client,
          }),
        },
        process.stdin,
        process.stdout,
      );
      return 0;
    } finally {
      state.close();
    }
  }

  return withStoreAsync(async (store) => {
    const secret = loadOrCreateSecret(secretFile());
    await serveProjection(
      {
        store,
        clock: now,
        serverVersion: packageVersion(),
        secret,
        session: {
          ...binding,
          projectRoot: ctx.root,
        },
      },
      process.stdin,
      process.stdout,
    );
    return 0;
  });
}
