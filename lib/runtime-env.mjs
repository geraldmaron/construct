/**
 * lib/runtime-env.mjs — Construct runtime environment with credential bootstrap.
 *
 * prepareConstructEnv merges ~/.construct/config.env into the process environment.
 * Credential auto-link from 1Password runs only when autoLink:true (setup-credentials).
 */

import { loadConstructEnv } from './env-config.mjs';
import { ensureConstructCredentials } from './providers/credential-bootstrap.mjs';

export { loadConstructEnv } from './env-config.mjs';

export function prepareConstructEnv({
  rootDir, homeDir, env = process.env, warn = true, cwd, autoLink = false,
} = {}) {
  ensureConstructCredentials({
    env,
    cwd: cwd || rootDir || process.cwd(),
    home: homeDir,
    autoLink,
  });
  return loadConstructEnv({ rootDir, homeDir, env, warn });
}
