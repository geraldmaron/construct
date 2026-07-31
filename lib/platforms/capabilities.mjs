/**
 * lib/platforms/capabilities.mjs — loader for the platform capability registry.
 *
 * Single source of truth for what each host platform can do (native subagent
 * routing, hooks + their global-scope allowlist, MCP support, config format,
 * local-model provisioning, instructions-only). The host enumeration, the
 * displayName-to-id map, the hasNativeSubagents matrix, and the global hook /
 * MCP allowlists all derive from this one registry so sync and init read host
 * capabilities as data.
 *
 * Hand-rolled validation (no AJV/zod) so this loads dependency-free on the
 * bootstrap paths that run before npm install — same constraint as
 * lib/config/schema.mjs. Fails loud on a malformed or unknown-shaped registry:
 * a silent fall-through to a default would reintroduce exactly the per-host
 * guesswork this registry exists to remove.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "platforms",
  "capabilities.json",
);

const CONFIG_FORMATS = ["json", "toml", "markdown"];
const PROVISIONING = ["modelfile", "none"];

function fail(msg) {
  throw new Error(`platform capability registry: ${msg}`);
}

function validateHost(id, host) {
  if (!host || typeof host !== "object" || Array.isArray(host)) fail(`host '${id}' must be an object`);
  const bools = ["hasNativeSubagents", "instructionsOnly", "supportsMcp"];
  for (const k of bools) {
    if (typeof host[k] !== "boolean") fail(`host '${id}.${k}' must be a boolean`);
  }
  if (typeof host.displayName !== "string" || !host.displayName) fail(`host '${id}.displayName' must be a non-empty string`);
  if (!CONFIG_FORMATS.includes(host.configFormat)) fail(`host '${id}.configFormat' must be one of ${JSON.stringify(CONFIG_FORMATS)}`);
  if (!PROVISIONING.includes(host.localModelProvisioning)) fail(`host '${id}.localModelProvisioning' must be one of ${JSON.stringify(PROVISIONING)}`);
  if (!host.hooks || typeof host.hooks !== "object") fail(`host '${id}.hooks' must be an object`);
  if (typeof host.hooks.supported !== "boolean") fail(`host '${id}.hooks.supported' must be a boolean`);
  if (!Array.isArray(host.hooks.globalAllowlist)) fail(`host '${id}.hooks.globalAllowlist' must be an array`);
  if (!Array.isArray(host.globalMcpAllowlist)) fail(`host '${id}.globalMcpAllowlist' must be an array`);
}

let cached = null;

export function loadCapabilities() {
  if (cached) return cached;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    fail(`could not read/parse ${REGISTRY_PATH}: ${err.message}`);
  }
  if (raw.version !== 1) fail(`unsupported version ${raw.version}`);
  if (!raw.hosts || typeof raw.hosts !== "object") fail("missing hosts object");
  for (const [id, host] of Object.entries(raw.hosts)) validateHost(id, host);
  cached = raw;
  return raw;
}

// HOST_KEYS — the canonical host enumeration, derived from the registry so it
// has exactly one definition. Order is the registry's declaration order.

export const HOST_KEYS = Object.keys(loadCapabilities().hosts);

export function getCapability(hostKey) {
  const host = loadCapabilities().hosts[hostKey];
  if (!host) fail(`unknown host '${hostKey}' (known: ${HOST_KEYS.join(", ")})`);
  return host;
}

export function hasNativeSubagents(hostKey) {
  return getCapability(hostKey).hasNativeSubagents;
}

// displayName-to-key lookup, built from the registry — the one place sync and
// init resolve a detected host's display name to its canonical key.

export function displayNameToKey() {
  const map = {};
  for (const [key, host] of Object.entries(loadCapabilities().hosts)) {
    map[host.displayName] = key;
  }
  return map;
}

export function globalHookAllowlist(hostKey) {
  return new Set(getCapability(hostKey).hooks.globalAllowlist);
}

export function globalMcpAllowlist(hostKey) {
  return new Set(getCapability(hostKey).globalMcpAllowlist);
}
