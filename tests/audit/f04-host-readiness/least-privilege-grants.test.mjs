/**
 * tests/audit/f04-host-readiness/least-privilege-grants.red.mjs — F04 [R35] over-grant proof.
 *
 * RED fixture (must FAIL against current code). The generated Copilot/VS Code custom
 * agent grants COPILOT_AGENT_TOOLS = a `construct-mcp/*` wildcard plus broad
 * web/search/read/edit tools (scripts/sync-worker-profiles.mjs L1371-1380), applied
 * identically to every front-door agent regardless of task. A wildcard over the whole
 * construct-mcp surface plus `edit/editFiles` + outbound `web/fetch` is not
 * least-privilege: a routing front door needs the orchestration tools
 * (orchestration_policy / orchestration_run) and read context, not write+web by
 * default.
 *
 * COPILOT_AGENT_TOOLS is module-private (not exported), so the grant list is read
 * from the source-of-truth array literal in the file under audit — deterministic and
 * hermetic, touching only the file being asserted on.
 *
 * Contract: grants must be scoped to the task — explicit
 * orchestration + read tools, no blanket `construct-mcp/*` wildcard, no edit/web in
 * the default front-door grant. Passes once grants are split by task.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYNC_SRC = path.join(HERE, '..', '..', '..', 'scripts', 'sync-worker-profiles.mjs');

// Parse the COPILOT_AGENT_TOOLS array literal out of the source. The grant set is a
// list of double-quoted string entries between the declaration and its closing `];`.

function readCopilotAgentTools() {
  const src = fs.readFileSync(SYNC_SRC, 'utf8');
  const m = src.match(/const COPILOT_AGENT_TOOLS\s*=\s*\[([\s\S]*?)\]\s*;/);
  assert.ok(m, 'COPILOT_AGENT_TOOLS array literal not found in sync-worker-profiles.mjs');
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test('[R35] Copilot/VS Code agent grants must not be a construct-mcp/* wildcard plus broad edit/web', () => {
  const tools = readCopilotAgentTools();

  assert.ok(
    !tools.includes('construct-mcp/*'),
    'grant uses a blanket construct-mcp/* wildcard instead of naming the orchestration tools it needs',
  );
  assert.ok(
    !tools.includes('edit/editFiles'),
    'a routing front door is granted edit/editFiles by default — write access is not least-privilege for dispatch',
  );
  assert.ok(
    !tools.includes('web/fetch'),
    'a routing front door is granted outbound web/fetch by default — not least-privilege for dispatch',
  );
});
