/**
 * tests/fixtures/mcp-tool-schemas/results/generate.mjs — regenerates the recorded
 * MCP tool-result fixtures consumed by tests/mcp-tool-output-schema-guard.test.mjs.
 *
 * Each fixture is a real captured result from dispatchToolByName (lib/mcp/server.mjs)
 * run against this repo's own working tree — never a hand-written/fabricated
 * payload. Re-run this script (`node tests/fixtures/mcp-tool-schemas/results/generate.mjs`)
 * to refresh a fixture after a tool's result shape changes; the guard test then
 * re-validates the refreshed capture against the tool's declared outputSchema.
 * Not a test file itself (no test() registrations) — scripts/run-tests.mjs and
 * `node --test` both skip the fixtures/ directory by name, so this never runs as
 * part of the suite.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchToolByName } from '../../../../lib/mcp/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const CASES = [
  ['get_skill', { path: 'perspectives/engineer' }],
  ['workflow_status', {}],
  ['memory_search', { query: 'lmcp' }],
  ['project_context', {}],
  ['agent_health', {}],
  ['summarize_diff', {}],
  ['scan_file', { file_path: 'package.json' }],
  ['list_skills', {}],
  ['list_templates', {}],
  ['get_template', { name: 'adr' }],
  ['search_skills', { pattern: 'engineer' }],
  ['workspace_preset_list', {}],
  ['orchestration_readiness', {}],
  ['capability_describe', {}],
  ['model_resolve', {}],
  ['learning_status', {}],
  ['knowledge_search', { query: 'lmcp' }],
  ['efficiency_snapshot', {}],
  ['sandbox_list', {}],
  ['workflow_validate', {}],
  ['provider_write', { provider: 'jira', item: { type: 'issue', project: 'DEMO', summary: 'fixture capture' }, dry_run: true }],
];

for (const [name, args] of CASES) {
  const result = await dispatchToolByName(name, args);
  const fixture = { capturedAt: new Date().toISOString(), tool: name, args, result };
  writeFileSync(join(HERE, `${name}.result.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${name}.result.json`);
}
