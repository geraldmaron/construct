/**
 * tests/audit/f04-host-readiness/readiness-state-machine.red.mjs — F04 host-readiness state proof (OUTLINE).
 *
 * RED fixture (must FAIL against current code). Host readiness for VS Code/Copilot is
 * measured today as generated-file presence, not as host behavior. The closest
 * existing module — lib/orchestration/readiness.mjs (buildOrchestrationReadiness) —
 * reports RUNTIME MCP-tool attachment for an already-running host session
 * (host_not_attached / server_unreachable / tool_unlisted / version_mismatch / …). It
 * does NOT classify the HOST-CONFIG states that determine whether the host will ever
 * reach that runtime: missing-config, stale-path, JSONC-unpatched, wrong-key,
 * untrusted, disabled, server-start-failure, missing-tool, sandbox-disabled, healthy.
 * Those collapse to a binary "file exists / doesn't" today.
 *
 * OUTLINE — the corrected design needs a dedicated host-config readiness classifier
 * plus a `construct doctor` lane that surfaces it (CX-AUDIT-HOST-003). This fixture
 * imports that not-yet-existing classifier so it fails at import today; the per-state
 * cases below are the acceptance shape it must satisfy. It turns GREEN once the
 * classifier exists and distinguishes the states (no collapse to a binary).
 *
 * Implementation pointer for the fix phase:
 *   - new export e.g. classifyHostReadiness({ host, settingsPath, mcpPath, root, ... })
 *     returning a discrete reasonCode from the state set above
 *   - reuse the ORCHESTRATION_READINESS_REASONS pattern (frozen enum + NEXT_STEPS map)
 *   - wire a `construct doctor` lane to render per-host config readiness
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// Imported from the not-yet-existing host-config readiness module. Today this import
// rejects (module/exports absent), failing the fixture by design until the state
// machine lands. Fix phase: create lib/host/readiness.mjs (or equivalent) exporting
// these and flip this comment.

const mod = await import('../../../lib/host/readiness.mjs').catch((err) => ({ __importError: err }));

const HOST_READINESS_STATES = [
  'missing_config',
  'stale_path',
  'jsonc_unpatched',
  'wrong_key',
  'untrusted',
  'disabled',
  'server_start_failure',
  'missing_tool',
  'sandbox_disabled',
  'healthy',
];

test('[F04] a host-config readiness classifier must exist (not collapse to file-presence)', () => {
  assert.ok(
    !mod.__importError,
    `lib/host/readiness.mjs is absent — host readiness is still measured as generated-file presence, ` +
      `not host behavior: ${mod.__importError?.message ?? ''}`,
  );
  assert.equal(
    typeof mod.classifyHostReadiness,
    'function',
    'classifyHostReadiness export is required to distinguish host-config readiness states',
  );
});

test('[F04] readiness must enumerate the distinct host-config states, not a binary', () => {
  assert.ok(Array.isArray(mod.HOST_READINESS_REASONS), 'HOST_READINESS_REASONS enum is required');
  for (const state of HOST_READINESS_STATES) {
    assert.ok(
      mod.HOST_READINESS_REASONS.includes(state),
      `readiness state "${state}" is not represented — distinct failure modes are still collapsed`,
    );
  }
});

// The four runtime-only states (untrusted/server_start_failure/missing_tool/
// sandbox_disabled) had no direct coverage anywhere in the suite before
// construct-tsyfe.9.4 — every prior case only ever supplied static
// settingsPath/mcpPath inputs. These confirm classifyHostReadiness actually
// resolves a caller-supplied runtimeState once no earlier static check fires.

for (const runtimeState of ['untrusted', 'server_start_failure', 'missing_tool', 'sandbox_disabled']) {
  test(`[F04] classifyHostReadiness resolves the runtime-only state "${runtimeState}" when no static check fires first`, () => {
    assert.equal(mod.classifyHostReadiness({ host: 'vscode', runtimeState }), runtimeState);
  });
}

test('[F04] a static blocking condition still wins over a supplied runtimeState — resolution order is missing_config first', () => {
  assert.equal(
    mod.classifyHostReadiness({ host: 'vscode', mcpPath: '/nonexistent/mcp.json', runtimeState: 'untrusted' }),
    'missing_config',
  );
});

test('[F04] no runtimeState and no static blocker resolves to healthy', () => {
  assert.equal(mod.classifyHostReadiness({ host: 'vscode' }), 'healthy');
});
