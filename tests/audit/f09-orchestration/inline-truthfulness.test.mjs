/**
 * tests/audit/f09-orchestration/inline-truthfulness.red.mjs — F09 [R17] prepared-vs-executed proof.
 *
 * RED fixtures (must FAIL against current code). The inline worker backend
 * (lib/orchestration/runtime.mjs prepareTaskInline L212-216) PREPARES a specialist
 * task and stops short of model reasoning: task.status='prepared', task.output=null,
 * executor='inline:prepared'. The runtime is honest at its own boundary — it attaches
 * a prepare-only disclaimer string on run.semantics (RUNTIME_SEMANTICS L49). But the
 * MCP envelope (lib/mcp/tools/orchestration-run.mjs shapeRun L19-36) DROPS run.semantics
 * and reports a top-level status='completed' for a run in which ZERO specialist LLM
 * reasoning ran. A host reading the MCP tool result sees `completed` with no field that
 * states "this run only prepared work; no specialist reasoning was executed."
 *
 * Contract these encode (CX-AUDIT-ORCH-001): an inline (prepare-only) run must carry a
 * machine-readable signal — through the MCP surface a host actually consumes — that the
 * work was PREPARED, not executed, so prepared output is never presented as executed
 * specialist reasoning. No provider/network is touched: the inline backend performs no
 * model call, and the execution model id is injected through env so resolution is
 * deterministic and hermetic.
 *
 * Each fixture passes once the MCP run envelope distinguishes prepared from executed
 * work (e.g. a prepareOnly flag or a surfaced disclaimer), instead of reporting bare
 * `completed`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { orchestrationRun } from '../../../lib/mcp/tools/orchestration-run.mjs';
import { runOrchestration } from '../../../lib/orchestration/runtime.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f09-truth-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

// worker_backend pinned explicitly: these fixtures pin inline prepare-only
// truthfulness specifically. An MCP-originated run with no explicit backend
// defaults to 'host' (see orchestration-mcp-host-default tests), a default
// that would fail the "every task prepared" preconditions below for the
// wrong reason.

const ORCH_REQUEST = {
  request: 'Refactor the auth module and add a migration; review for security',
  requested_strategy: 'orchestrated',
  host_model: MODEL,
  file_count: 4,
  module_count: 2,
  worker_backend: 'inline',
};

// A field that, present and truthy, would let a host know the run only PREPARED work.
// None of these exist on the MCP envelope today, so the truthfulness signal is absent.

function carriesPreparedOnlySignal(envelope) {
  if (envelope.prepareOnly === true) return true;
  if (envelope.executed === false) return true;
  if (typeof envelope.disclaimer === 'string' && /prepar/i.test(envelope.disclaimer)) return true;
  if (typeof envelope.semantics === 'string' && /prepar/i.test(envelope.semantics)) return true;
  return false;
}

test('[R17] MCP inline run envelope distinguishes PREPARED work from executed specialist reasoning', async () => {
  const cwd = project();
  const envelope = await orchestrationRun(ORCH_REQUEST, { env: ENV, cwd });

  assert.ok(
    Array.isArray(envelope.tasks) && envelope.tasks.every((t) => t.status === 'prepared'),
    `precondition: inline backend prepares every task. tasks=${JSON.stringify(envelope.tasks)}`,
  );
  assert.ok(
    envelope.tasks.every((t) => t.output === null),
    'precondition: no task carries executed output (inline performs no model reasoning)',
  );

  assert.ok(
    carriesPreparedOnlySignal(envelope),
    `MCP envelope reports status='${envelope.status}' for a run that executed ZERO specialist reasoning, `
      + `yet exposes no machine-readable prepared-vs-executed signal (prepareOnly/executed/disclaimer/semantics). `
      + `A host cannot tell prepared work from executed specialist output. envelopeKeys=${Object.keys(envelope).join(',')}`,
  );
});

test('[R17] an inline run does not report a top-level status that reads as executed', async () => {
  const cwd = project();
  const envelope = await orchestrationRun(ORCH_REQUEST, { env: ENV, cwd });

  assert.notEqual(
    envelope.status,
    'completed',
    `MCP envelope reports bare status='completed' for an inline (prepare-only) run; "completed" reads as `
      + `"the orchestration executed", but no specialist reasoning ran. The terminal status (or an adjacent `
      + `field) must mark the run as prepared-only. envelope=${JSON.stringify(envelope)}`,
  );
});

test('[R17] the runtime-level prepare-only disclaimer survives to the host surface', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: ORCH_REQUEST.request, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  const envelope = await orchestrationRun(ORCH_REQUEST, { env: ENV, cwd });

  assert.ok(
    typeof run.semantics === 'string' && /prepar/i.test(run.semantics),
    'precondition: the runtime attaches a prepare-only disclaimer on run.semantics',
  );
  assert.ok(
    JSON.stringify(envelope).toLowerCase().includes('prepar') && carriesPreparedOnlySignal(envelope),
    `the runtime carries a prepare-only disclaimer (run.semantics) but the MCP shapeRun strips it; `
      + `the host-facing envelope must preserve a truthful prepared-only disclaimer. `
      + `runSemantics=${JSON.stringify(run.semantics)} envelopeKeys=${Object.keys(envelope).join(',')}`,
  );
});
