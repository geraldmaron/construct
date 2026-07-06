/**
 * tests/mcp-tool-output-schema-guard.test.mjs — LMCP-L10 tool output-schema guard.
 *
 * Enumerates lib/mcp/tool-safety.mjs's TOOL_SAFETY catalog — the authoritative
 * per-tool name list withSafetyEnvelope (lib/mcp/server.mjs) requires every
 * catalog tool to appear in — and asserts each tool declares an explicit
 * outputSchema in its own HARDCODED_TOOL_DEFS/CONSTRUCT_CALL_TOOL literal, or
 * (for LMCP-B5 self-registered tools under lib/mcp/tools/*.tool.mjs, none
 * exist yet) its real TOOL_DEFS export via lib/mcp/tool-registry.mjs's
 * scanToolModules(). The hardcoded-catalog check reads the pre-envelope
 * literal (not the post-withSafetyEnvelope object), so deleting a tool's
 * outputSchema field fails this guard even though withSafetyEnvelope's
 * DEFAULT_OUTPUT_SCHEMA fallback would otherwise mask the regression at
 * runtime. server.mjs composes ALL_TOOL_DEFS as
 * `[...HARDCODED_TOOL_DEFS, ...SCANNED_TOOL_DEFS]` (both spread from
 * identifiers, not a literal), so this guard reads the two source catalogs
 * directly rather than trying to eval the spread expression.
 *
 * For tools with a recorded result under tests/fixtures/mcp-tool-schemas/results/
 * (see that directory's generate.mjs — every fixture there is a real captured
 * dispatchToolByName call, never a hand-written payload), validates the captured
 * result against the tool's declared output schema using the same validator the
 * MCP SDK client applies to live tool calls (@modelcontextprotocol/sdk/validation/ajv,
 * see node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js
 * getToolOutputValidator). Un-fixtured tools are listed by name in a dedicated,
 * always-passing test so coverage gaps stay visible instead of silent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { TOOL_SAFETY, DEFAULT_OUTPUT_SCHEMA } from '../lib/mcp/tool-safety.mjs';
import { scanToolModules } from '../lib/mcp/tool-registry.mjs';
import { RAW_HARDCODED_TOOL_DEFS } from '../lib/mcp/tool-definitions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SERVER_PATH = join(ROOT, 'lib', 'mcp', 'server.mjs');
const FIXTURES_DIR = join(HERE, 'fixtures', 'mcp-tool-schemas', 'results');

function extractBalanced(src, openIndex) {
  let depth = 0;
  for (let j = openIndex; j < src.length; j++) {
    if (src[j] === '{' || src[j] === '[') depth++;
    else if (src[j] === '}' || src[j] === ']') { depth--; if (depth === 0) return j; }
  }
  throw new Error(`unbalanced literal starting at index ${openIndex}`);
}

// RAW_HARDCODED_TOOL_DEFS (lib/mcp/tool-definitions.mjs, split further into
// tool-definitions-{project,skills,memory,workflow}.mjs — construct-rf26.10)
// is a pure data array with no function calls, so it is imported directly
// rather than eval'd out of server.mjs source text: reading the hardcoded
// literal instead of the ALL_TOOL_DEFS spread expression means a locally
// deleted outputSchema field still fails this guard on the 76 hand-maintained
// tools; self-registered tools (currently none) are covered separately via
// the real scanToolModules().
//
// CONSTRUCT_CALL_TOOL still lives inline in server.mjs (its
// inputSchema.properties.tool.enum references the runtime-only LONG_TAIL_DEFS
// variable, so its literal cannot be eval'd standalone); a bounded text scan
// for the outputSchema key is enough to prove (non-)declaration.

async function readToolCatalog() {
  const src = readFileSync(SERVER_PATH, 'utf8');

  const declared = new Map(RAW_HARDCODED_TOOL_DEFS.map((d) => [d.name, d.outputSchema ?? d.output_schema]));

  const callMarker = 'const CONSTRUCT_CALL_TOOL = withSafetyEnvelope(';
  const callStart = src.indexOf(callMarker);
  assert.ok(callStart !== -1, 'could not locate CONSTRUCT_CALL_TOOL in lib/mcp/server.mjs');
  const callOpen = src.indexOf('{', callStart + callMarker.length);
  const callClose = extractBalanced(src, callOpen);
  const callLiteral = src.slice(callOpen, callClose + 1);
  declared.set('call', /outputSchema\s*:/.test(callLiteral) ? DEFAULT_OUTPUT_SCHEMA : undefined);

  const { defs: scannedDefs } = await scanToolModules();
  for (const def of scannedDefs) declared.set(def.name, def.outputSchema ?? DEFAULT_OUTPUT_SCHEMA);

  return declared;
}

// `call` is the long-tail gateway: its actual result shape is whichever wrapped
// tool it dispatched to, so a single static schema on the gateway entry itself
// cannot be more specific than DEFAULT_OUTPUT_SCHEMA. It still gets that default
// applied by withSafetyEnvelope at runtime (verified above via readToolCatalog),
// so it is exempted from the "explicit literal" requirement rather than flagged
// as a genuine gap.
//
// storage_sync/storage_reset/delete_ingested_artifacts are pure side-effecting
// acknowledgements with no parsed payload — the same exemption
// tests/audit/f14-tools/output-schema-coverage.test.mjs already carries
// (SIDE_EFFECTING_EXEMPT) for these exact three tools. Reused here rather than
// re-litigated so both guards agree on what "no structured payload" means.

const EXPLICIT_LITERAL_EXEMPT = new Set([
  'call',
  'storage_sync', 'storage_reset', 'delete_ingested_artifacts',
]);

test('[LMCP-L10] every TOOL_SAFETY-classified tool declares an output schema', async () => {
  const declared = await readToolCatalog();
  const toolNames = Object.keys(TOOL_SAFETY);
  const missing = toolNames.filter((name) => !EXPLICIT_LITERAL_EXEMPT.has(name) && declared.get(name) === undefined);

  assert.deepEqual(
    missing,
    [],
    `MCP tools classified in tool-safety.mjs with NO declared outputSchema (${missing.length}/${toolNames.length}):\n  ${missing.join('\n  ')}`,
  );
});

const FIXTURE_FILES = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.result.json')).sort();
const FIXTURED_TOOL_NAMES = new Set(FIXTURE_FILES.map((f) => f.replace(/\.result\.json$/, '')));

test('[LMCP-L10] fixture coverage is visible: un-fixtured tools are listed by name', () => {
  const toolNames = Object.keys(TOOL_SAFETY);
  const unfixtured = toolNames.filter((name) => !FIXTURED_TOOL_NAMES.has(name));

  console.log(
    `[mcp-tool-output-schema-guard] ${FIXTURED_TOOL_NAMES.size}/${toolNames.length} tools have a recorded fixture; `
    + `${unfixtured.length} without one (grow tests/fixtures/mcp-tool-schemas/results/ opportunistically):\n  ${unfixtured.join('\n  ')}`,
  );

  const READ_ONLY_CORE = [
    'get_skill', 'workflow_status', 'memory_search', 'project_context',
    'agent_health', 'summarize_diff', 'scan_file',
  ];
  const missingCore = READ_ONLY_CORE.filter((name) => !FIXTURED_TOOL_NAMES.has(name));
  assert.deepEqual(missingCore, [], `read-only core tools missing a fixture: ${missingCore.join(', ')}`);
  assert.ok(
    FIXTURED_TOOL_NAMES.size >= 15,
    `fixture coverage regressed below the 15-tool floor: only ${FIXTURED_TOOL_NAMES.size} fixtures present`,
  );
});

test('[LMCP-L10] recorded fixture results validate against their declared output schema', async (t) => {
  const declared = await readToolCatalog();
  const validatorProvider = new AjvJsonSchemaValidator();

  for (const file of FIXTURE_FILES) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));

    // eslint-disable-next-line no-await-in-loop
    await t.test(fixture.tool, () => {
      const schema = declared.get(fixture.tool) ?? DEFAULT_OUTPUT_SCHEMA;
      const validate = validatorProvider.getValidator(schema);
      const outcome = validate(fixture.result);
      assert.ok(
        outcome.valid,
        `${fixture.tool} fixture result fails its declared outputSchema: ${outcome.errorMessage}`,
      );
    });
  }
});
