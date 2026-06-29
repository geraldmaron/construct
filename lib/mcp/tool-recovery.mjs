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

function readJsonl(rootDir, file, kind) {
  const out = [];
  try {
    for (const line of fs.readFileSync(path.join(rootDir, '.cx', 'observations', file), 'utf8').split('\n')) {
      if (!line) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.kind === kind) out.push(entry);
    }
  } catch { /* absent file = no records */ }
  return out;
}

function aggregateByKey(entries, key) {
  const counts = new Map();
  let recovered = 0;
  for (const e of entries) {
    const k = e[key] || '(unknown)';
    const c = counts.get(k) || { name: k, count: 0, recovered: 0 };
    c.count += 1;
    if (e.recovered) { c.recovered += 1; recovered += 1; }
    counts.set(k, c);
  }
  const byName = [...counts.values()].sort((a, b) => b.count - a.count);
  return { total: entries.length, recovered, byName };
}

// The read side of recordToolNameMiss: aggregate misses by name so the
// discoverability signal is acted on, not just stored. A name missed repeatedly
// is a tool agents cannot find — the candidate for a doc/alias fix.

export function summarizeToolNameMisses(rootDir, { top = 5 } = {}) {
  const agg = aggregateByKey(readJsonl(rootDir, 'tool-name-misses.jsonl', 'tool-name-miss'), 'name');
  return { ...agg, top: agg.byName.slice(0, top) };
}

// Failure capture: record a tool/command failure (timeout, error, gate denial) as
// an observation so repeated failures become a learnable anti-pattern rather than
// an invisible one-off. Best-effort, like the miss telemetry above.

export function recordToolFailure(rootDir, { tool, code = null, message = '' } = {}) {
  try {
    const dir = path.join(rootDir, '.cx', 'observations');
    fs.mkdirSync(dir, { recursive: true });
    const line = `${JSON.stringify({ at: new Date().toISOString(), kind: 'tool-failure', name: tool, code, message })}\n`;
    fs.appendFileSync(path.join(dir, 'tool-failures.jsonl'), line);
  } catch {
    /* telemetry is best-effort; never break dispatch */
  }
}

export function summarizeToolFailures(rootDir, { top = 5 } = {}) {
  const agg = aggregateByKey(readJsonl(rootDir, 'tool-failures.jsonl', 'tool-failure'), 'name');
  return { ...agg, top: agg.byName.slice(0, top) };
}
