/**
 * tests/audit/f01-mcp-safety/safety-envelope.red.mjs — F01 missing per-tool safety-envelope proof.
 *
 * RED fixtures (must FAIL against current code). Every tool def in the MCP catalog
 * carries an inputSchema and a description but no safety envelope: no declared
 * outputSchema, no safety class (read/write/destructive), and no filesystem/network/
 * process scope. A host therefore cannot validate tool output, cannot reason about a
 * tool's blast radius, and cannot gate destructive tools differently from read-only
 * ones — the metadata that would let it simply does not exist.
 *
 * Contract these encode (CX-AUDIT-MCP-SAFETY-001/-005): each tool def gains
 * `outputSchema` and a `safety` block ({ class, filesystem, network, process } at
 * minimum). The assertions check two representative tools from this family —
 * summarize_diff (executes git; write/exec class) and storage_reset (destructive) —
 * and pass once the envelope is present.
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
