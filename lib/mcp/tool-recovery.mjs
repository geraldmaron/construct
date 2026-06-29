/**
 * lib/mcp/tool-recovery.mjs — Tolerant dispatch fallback + tool-name-miss telemetry.
 *
 * Hosts and models routinely mis-name Construct tools: the `call` gateway under
 * its former `construct_call` name, a long-tail tool invoked directly, or a name
 * carrying a stray `construct-mcp_` host prefix. Recovering the intent when it is
 * unambiguous keeps work flowing; recording every miss closes a discoverability
 * blind spot — calls rejected at the host's tool-validation layer never reach the
 * server, so without this record those failures stay invisible to Construct.
 */
import fs from 'node:fs';
import path from 'node:path';

const GATEWAY_NAMES = new Set(['call', 'construct_call']);

function stripHostPrefix(name) {
  return String(name || '').replace(/^construct[-_]mcp[-_]/i, '');
}

export function isGatewayName(name) {
  return GATEWAY_NAMES.has(name) || GATEWAY_NAMES.has(stripHostPrefix(name));
}

// Resolve an unrecognized name to a real target when the intent is unambiguous:
// a gateway alias, or a known tool wearing the host prefix. Anything else is a
// genuine miss with no safe recovery.

export function recoverToolName(name, knownNames) {
  if (isGatewayName(name)) return { gateway: true };
  const stripped = stripHostPrefix(name);
  if (stripped !== name && knownNames.has(stripped)) return { name: stripped };
  return null;
}

export function recordToolNameMiss(rootDir, { name, recovered = null } = {}) {
  try {
    const dir = path.join(rootDir, '.cx', 'observations');
    fs.mkdirSync(dir, { recursive: true });
    const line = `${JSON.stringify({ at: new Date().toISOString(), kind: 'tool-name-miss', name, recovered })}\n`;
    fs.appendFileSync(path.join(dir, 'tool-name-misses.jsonl'), line);
  } catch {
    /* telemetry is best-effort; never break dispatch */
  }
}
