/**
 * tests/audit/f08-prompt-injection/excessive-agency-grants.red.mjs —
 * F08 [R35] excessive-agency proof for the generated VS Code / Copilot front-door agent.
 *
 * @owasp LLM06
 *
 * RED fixture (must FAIL against current code). scripts/sync-worker-profiles.mjs
 * generates the VS Code custom agent (.github/agents/construct.agent.md) with a
 * fixed COPILOT_AGENT_TOOLS grant of `construct-mcp/*` (a wildcard over every MCP
 * tool) plus `web/fetch`, `web/githubRepo`, `search/*`, and `edit/editFiles`. That
 * is the maximal agency surface on one agent. Combined with the ingest boundary
 * (see untrusted-ingest-labeling.red.mjs), an injection payload that reaches the
 * orchestrator's context sits in front of an agent that can call any MCP tool,
 * reach the public web, and edit files — the blast radius OWASP LLM01 warns against
 * when external content can influence tool-use ([S12][S13]).
 *
 * Asserts the generated grant is scoped — no MCP wildcard, and not the broad
 * web+search+edit bundle. The committed artifact carries the wildcard today, so the
 * assertion fails — proving the over-grant.
 *
 * Turns GREEN once the generator scopes the front-door grant to the specific
 * orchestration tools it needs (cross-ref F04): the agent
 * file then enumerates concrete tool ids instead of `<server>/*` + broad bundles.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { COPILOT_AGENT_TOOLS } from '../../../scripts/sync-worker-profiles.mjs';

const AGENT_FILE = path.resolve(import.meta.dirname, '../../../.github/agents/construct.agent.md');

// Tool ids whose presence in a single agent's grant constitutes excessive agency:
// an MCP server wildcard, outbound web, and file-edit — the trio that lets
// injected text drive real-world side effects.

const WILDCARD_PATTERN = /\/\*$/;
const HIGH_AGENCY_IDS = new Set(['web/fetch', 'web/githubRepo', 'edit/editFiles']);

function parseToolsGrant(markdown) {
  const m = markdown.match(/^tools:\s*(\[[^\n]*\])\s*$/m);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

test('[R35] generated front-door agent grant must be scoped, not an MCP wildcard + broad web/search/edit bundle', () => {
  // Audit the grant SOURCE (COPILOT_AGENT_TOOLS), which copilotAgentFile emits verbatim as the
  // agent's `tools:`. The committed .github/agents/construct.agent.md is regenerated/pruned by
  // concurrent repo-root syncs (including the tool-repo postinstall on a host without Copilot),
  // so reading that shared file races; host-config-parity separately verifies the file matches.
  const tools = COPILOT_AGENT_TOOLS;
  assert.ok(Array.isArray(tools) && tools.length > 0, 'COPILOT_AGENT_TOOLS must be a non-empty grant array');

  const wildcardGrants = tools.filter((t) => WILDCARD_PATTERN.test(String(t)));
  const highAgencyGrants = tools.filter((t) => HIGH_AGENCY_IDS.has(String(t)));

  // Wildcard MCP grant: the agent can call every tool the construct-mcp server
  // exposes, present and future, with no per-task scoping.

  assert.deepEqual(
    wildcardGrants,
    [],
    `front-door agent grants MCP wildcard(s) ${JSON.stringify(wildcardGrants)} — every server tool is reachable, so injected content has the full toolset as blast radius`,
  );

  // Broad web + edit bundle on the same agent: outbound network plus file
  // mutation is the high-risk combination injection most wants to reach.

  assert.deepEqual(
    highAgencyGrants,
    [],
    `front-door agent grants broad agency ${JSON.stringify(highAgencyGrants)} alongside MCP access — scope these per task instead`,
  );

  // Defense in depth: when the generated file is present and fully written, it must match the
  // source grant. Guarded on presence + parseability so a concurrent regeneration never flakes.
  if (fs.existsSync(AGENT_FILE)) {
    const parsed = parseToolsGrant(fs.readFileSync(AGENT_FILE, 'utf8'));
    if (Array.isArray(parsed)) {
      assert.deepEqual(parsed, tools, 'generated agent file tools grant drifted from COPILOT_AGENT_TOOLS');
    }
  }
});
