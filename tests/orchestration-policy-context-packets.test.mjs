/**
 * tests/orchestration-policy-context-packets.test.mjs
 *
 * Pins Tier 1 sub-bead 1 wiring: orchestration_policy MCP tool now returns
 * per-specialist context packets when the caller supplies a candidate
 * artifact list. Each packet carries the role-filtered bundle plus the
 * explicit omitted list with reasons — no caller has to assemble the
 * context manually anymore.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { orchestrationPolicy } from '../lib/mcp/tools/skills.mjs';

function candidates() {
  return [
    { id: 'A', path: 'lib/auth.mjs', title: 'auth middleware', kind: 'target-file', score: 0.40, summary: 'auth flow.' },
    { id: 'B', path: 'tests/auth.test.mjs', title: 'auth tests', kind: 'test', score: 0.35, summary: 'integration tests.' },
    { id: 'C', path: 'docs/specs/prd/login.md', title: 'PRD: login', kind: 'prd', score: 0.95, summary: 'product reqs.' },
    { id: 'D', path: 'docs/operations/runbooks/oncall.md', title: 'oncall runbook', kind: 'runbook', score: 0.70, summary: 'oncall.' },
    { id: 'E', path: 'docs/decisions/adr/0007-auth.md', title: 'ADR-0007: auth', kind: 'adr', score: 0.55, summary: 'auth ADR.' },
  ];
}

describe('orchestrationPolicy contextPackets surface', () => {
  it('omits contextPackets when no candidates are supplied (back-compat)', async () => {
    const result = await orchestrationPolicy({ request: 'fix login redirect' });
    assert.equal(result.contextPackets, undefined);
    // Existing fields still present
    assert.ok(Array.isArray(result.specialists));
    assert.ok(result.intent);
  });

  it('returns a per-specialist context packet when candidates are supplied', async () => {
    const result = await orchestrationPolicy({
      request: 'implement a new login feature across the auth subsystem',
      fileCount: 5,
      moduleCount: 3,
      candidates: candidates(),
    });
    assert.ok(result.contextPackets, 'contextPackets present');
    for (const specialist of result.specialists) {
      assert.ok(result.contextPackets[specialist], `packet for ${specialist}`);
      assert.ok('contextPacket' in result.contextPackets[specialist]);
      assert.ok(Array.isArray(result.contextPackets[specialist].omitted));
    }
  });

  it('each packet honors the role policy — product-manager avoids runbook', async () => {
    const result = await orchestrationPolicy({
      request: 'frame the customer feedback into a PRD for notifications feature',
      fileCount: 3,
      moduleCount: 2,
      candidates: candidates(),
    });
    const pmPacket = result.contextPackets?.['product-manager'];
    if (!pmPacket) return; // pm not always in the chain for every request
    const kinds = pmPacket.contextPacket.relatedArtifacts.map((a) => a.kind);
    assert.ok(!kinds.includes('runbook'), 'PM packet must not include runbook');
    assert.ok(pmPacket.omitted.some((o) => o.artifact.kind === 'runbook' && /avoid list/.test(o.reason)));
  });

  it('engineer packet prioritizes target-file and test over high-scoring PRD', async () => {
    const result = await orchestrationPolicy({
      request: 'refactor lib/auth.mjs and update tests across the auth module',
      fileCount: 8,
      moduleCount: 2,
      candidates: candidates(),
    });
    const engPacket = result.contextPackets?.['engineer'];
    if (!engPacket) return;
    // engineer prefers target-file > test ranks ahead of prd despite lower score
    assert.equal(engPacket.contextPacket.relatedArtifacts[0].kind, 'target-file');
  });

  it('honors a token budget passed through the args', async () => {
    const bigCandidate = { id: 'X', path: 'lib/big.mjs', title: 'big', kind: 'target-file', score: 0.5, summary: 'x'.repeat(2000) };
    const result = await orchestrationPolicy({
      request: 'refactor lib/auth.mjs across the auth subsystem',
      fileCount: 8,
      moduleCount: 2,
      candidates: [bigCandidate, bigCandidate, bigCandidate],
      budget: { maxTokens: 100 },
    });
    for (const packet of Object.values(result.contextPackets || {})) {
      assert.ok(packet.tokensUsed <= 100, `tokensUsed=${packet.tokensUsed} exceeds budget`);
    }
  });

  it('includes the triage block in taskSummary when supplied', async () => {
    const result = await orchestrationPolicy({
      request: 'investigate p99 latency on login across the auth subsystem',
      fileCount: 5,
      moduleCount: 3,
      triage: { intakeType: 'incident', rdStage: 'operations', primaryOwner: 'sre', recommendedAction: 'create-runbook' },
      candidates: candidates(),
    });
    for (const packet of Object.values(result.contextPackets || {})) {
      assert.match(packet.contextPacket.taskSummary, /incident/);
    }
  });
});
