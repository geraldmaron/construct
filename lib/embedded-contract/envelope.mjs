/**
 * lib/embedded-contract/envelope.mjs — common response envelope for every contract surface.
 *
 * CLI-JSON, MCP, and SDK all wrap their payload with `wrapResponse`, which
 * stamps the contract version, the installed Construct version, the active
 * deployment mode, and a generation timestamp, then runs the no-secrets guard
 * before the payload can be serialized. Routing every surface through one
 * envelope is what makes the three interfaces structurally identical and keeps
 * the redaction guard impossible to bypass.
 *
 * `generatedAt` (and any per-call traceId carried in `data`) are volatile, so
 * surface-parity tests compare envelopes with those fields excluded.
 */

import { getInstalledVersion } from '../version.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { CONTRACT_VERSION, MIN_CLIENT_CONTRACT_VERSION } from './contract-version.mjs';
import { assertNoSecrets } from './redaction.mjs';

export const CONTRACT_SURFACES = ['cli', 'mcp', 'sdk'];

/**
 * Wrap a contract payload in the standard envelope and assert it carries no
 * secrets.
 *
 * @param {object} opts
 * @param {*}        opts.data         The contract-specific payload.
 * @param {string}   opts.surface      One of CONTRACT_SURFACES.
 * @param {string[]} [opts.warnings]   Advisory messages for the caller.
 * @param {Record<string,string>} [opts.env]
 * @param {string}   [opts.cwd]
 * @param {string}   [opts.generatedAt] ISO timestamp; injectable for deterministic tests.
 * @returns {object}
 */
export function wrapResponse({ data, surface, warnings = [], env = process.env, cwd = process.cwd(), generatedAt } = {}) {
  if (!CONTRACT_SURFACES.includes(surface)) {
    throw new Error(`Unknown contract surface: ${surface}. Expected one of ${CONTRACT_SURFACES.join(', ')}`);
  }

  const { version: constructVersion } = getInstalledVersion();
  const deploymentMode = getDeploymentMode(env, { cwd });

  const envelope = {
    contractVersion: CONTRACT_VERSION,
    minClientContractVersion: MIN_CLIENT_CONTRACT_VERSION,
    constructVersion,
    deploymentMode,
    surface,
    generatedAt: generatedAt || new Date().toISOString(),
    warnings: Array.isArray(warnings) ? warnings : [],
    data,
  };

  assertNoSecrets(envelope, { env });
  return envelope;
}

/**
 * Wrap a contract-core result for a surface. The core returns its payload with a
 * `warnings` array as one field; this lifts `warnings` into the envelope and
 * keeps the rest as `data`, so CLI, MCP, and SDK produce identical envelopes.
 *
 * @param {object} result   The contract core's return value (may carry `warnings`).
 * @param {object} opts      Forwarded to wrapResponse (surface, env, cwd, generatedAt).
 * @returns {object}
 */
export function wrapContractResult(result, opts = {}) {
  const { warnings = [], ...data } = result || {};
  return wrapResponse({ ...opts, data, warnings });
}
