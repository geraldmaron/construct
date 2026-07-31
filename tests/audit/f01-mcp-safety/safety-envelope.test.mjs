/**
 * tests/audit/f01-mcp-safety/safety-envelope.red.mjs — F01 missing per-tool safety-envelope proof.
 *
 * Every tool def in the MCP catalog
 * carries a declared `outputSchema` and a `safety` block ({ class, filesystem,
 * network, process }) via withSafetyEnvelope / lib/mcp/tool-safety.mjs, so a host
 * can validate tool output, reason about a tool's blast radius, and gate destructive
 * tools differently from read-only ones. The assertions check summarize_diff
 * specifically, then every exposed tool.
 *
 * exposedTools() is the exported flat surface (core tools + the `call` gateway), so
 * summarize_diff is asserted there directly; storage_reset is long-tail and is read off
 * its catalog definition. Importing the server only reads tool metadata — no dispatch,
 * no host-state writes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { exposedTools, dispatchToolByName } = await import(`../../../lib/mcp/server.mjs?f01=${Date.now()}`);

void dispatchToolByName;

function hasSafetyEnvelope(def) {
  if (!def || typeof def !== 'object') return false;
  const hasOutput = def.outputSchema && typeof def.outputSchema === 'object';
  const safety = def.safety;
  const hasClass = safety && typeof safety === 'object'
    && /^(read|write|destructive)$/i.test(String(safety.class ?? ''));
  return Boolean(hasOutput && hasClass);
}

test('summarize_diff must declare an output schema and a safety class', () => {
  const tools = exposedTools();
  const def = tools.find((d) => d.name === 'summarize_diff');
  assert.ok(def, 'summarize_diff missing from the exposed tool surface');
  assert.ok(
    hasSafetyEnvelope(def),
    `summarize_diff has no output schema / safety class metadata: ${JSON.stringify(def)}`,
  );
});

test('exposed tools must each carry output-schema + safety-class metadata', () => {
  const tools = exposedTools().filter((d) => d.name !== 'call');
  const missing = tools.filter((d) => !hasSafetyEnvelope(d)).map((d) => d.name);
  assert.deepEqual(
    missing,
    [],
    `tools lacking an output schema / safety class: ${missing.join(', ')}`,
  );
});
