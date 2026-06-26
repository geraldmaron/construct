/**
 * lib/embedded-contract/contract-version.mjs — version of the Embedded Contract Layer (ECL).
 *
 * The ECL is Construct's app-facing surface exposed over CLI-JSON, MCP, and
 * SDK. Its schema evolves independently of the Construct
 * package version, so it carries its own semver: additive changes bump the
 * minor, breaking changes bump the major. Every contract envelope embeds
 * CONTRACT_VERSION so an embedding application can negotiate compatibility
 * without reading internal registries.
 *
 * Distinct from specialists/org `version` (handoff contracts) and
 * lib/plugin-registry.mjs `MANIFEST_VERSION` (plugin manifests); those version
 * unrelated internal surfaces.
 */

import { parseSemver, compareSemver } from '../version.mjs';

export const CONTRACT_VERSION = '1.1.0';

// A client built against an older minor of the same major still works, because
// minor bumps are additive-only; a different major is incompatible either way.

export const MIN_CLIENT_CONTRACT_VERSION = '1.0.0';

/**
 * Whether a client built against `clientVersion` can talk to a server speaking
 * `contractVersion`. Same major required; client minor must not exceed server.
 *
 * @param {string} clientVersion
 * @param {string} [contractVersion]
 * @returns {boolean}
 */
export function isClientCompatible(clientVersion, contractVersion = CONTRACT_VERSION) {
  const client = parseSemver(clientVersion);
  const server = parseSemver(contractVersion);
  if (!client || !server) return false;
  if (client.major !== server.major) return false;
  return compareSemver(clientVersion, contractVersion) <= 0;
}
