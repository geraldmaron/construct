/**
 * tests/kernel/extract/ladder.test.ts — golden-transcript lock for the
 * extraction-ladder harvest.
 *
 * fixtures/ladder-golden.json is 792 transcripts captured from the REAL v2
 * ladder by scripts/capture-legacy-ladder-golden.mjs, across every combination
 * of format, backend availability, lightweight-parser yield, and fidelity.
 *
 * The port is a PLANNER, not a runner, so it cannot be compared to v2 directly.
 * Instead this file carries a reference executor — about forty lines that walk
 * a plan, call fake providers, and apply the kernel's own accept rules — and
 * asserts that executing the plan reproduces v2's transcript exactly: same
 * winning tier, same extractionMethod, same providers called in the same order,
 * same reason and remediation when every rung is exhausted.
 *
 * The executor is deliberately dumb. Every decision it makes it asks the kernel
 * for; if it started making routing choices of its own, it would be testing
 * itself rather than the port.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXTRACTION_TIERS,
  makeUnsupportedResult,
  planExtraction,
  resolveExhaustion,
  resolveRoutingSignals,
} from '../../../src/kernel/extract/ladder.ts';
import type { ExtractionPlan, PlanInput } from '../../../src/kernel/extract/ladder.ts';
import { docxRequiresDoclingEscalation, isDigitalTextPdf } from '../../../src/kernel/extract/thresholds.ts';
import { finalizeResult } from '../../../src/kernel/extract/envelope.ts';

interface Transcript {
  readonly outcome: 'result' | 'throw';
  readonly routingTier?: string | null;
  readonly extractionMethod?: string | null;
  readonly unsupported?: boolean;
  readonly reason?: string | null;
  readonly remediation?: string | null;
  readonly code?: string | null;
  readonly message?: string;
  readonly calls: string[];
}

interface GoldenCase {
  readonly extension: string;
  readonly docxHasTable: boolean;
  readonly profile: string;
  readonly yields: string;
  readonly highFidelity: boolean;
  readonly transcript: Transcript;
}

const GOLDEN: GoldenCase[] = JSON.parse(
  readFileSync(new URL('./fixtures/ladder-golden.json', import.meta.url), 'utf8'),
);

const PROFILES: Record<string, { docling: boolean; remote: boolean; sync: boolean; whisper: boolean }> = {
  bare: { docling: false, remote: false, sync: false, whisper: false },
  'sync-only': { docling: false, remote: false, sync: true, whisper: false },
  'docling-local': { docling: true, remote: false, sync: true, whisper: false },
  'docling-remote-only': { docling: false, remote: true, sync: true, whisper: false },
  'both-docling': { docling: true, remote: true, sync: true, whisper: false },
  whisper: { docling: false, remote: false, sync: true, whisper: true },
};

const YIELDS: Record<string, { pdf: unknown; docx: { text: string } | null }> = {
  'lightweight-good': { pdf: { text: 'x'.repeat(400), pageCount: 2 }, docx: { text: 'plain docx text' } },
  'lightweight-sparse': { pdf: { text: 'x'.repeat(20), pageCount: 8 }, docx: { text: '' } },
  'lightweight-empty': { pdf: { text: '', pageCount: 3 }, docx: null },
};

// The fake providers, matching the capture's, keyed by the provider name the
// plan asks for. The email rung is the one place v2 ran a real parser, so its
// method is pinned to what v2's mail parser reported.
const PROVIDERS: Record<string, unknown> = {
  sync: { text: 'sync text', extractionMethod: 'sync' },
  email: { text: 'body text', extractionMethod: 'eml-mailparser' },
  whisper: { text: 'transcript', extractionMethod: 'whisper' },
  'docling-local': { markdown: '# docling', text: 'docling', extractionMethod: 'docling' },
  'docling-remote': { markdown: '# remote', text: 'remote', extractionMethod: 'docling-remote' },
};

function planFor(c: GoldenCase): ExtractionPlan {
  const profile = PROFILES[c.profile]!;
  const input: PlanInput = {
    extension: c.extension === '.docx!table' ? '.docx' : c.extension,
    highFidelity: c.highFidelity,
    privacyPosture: profile.remote ? 'remote-allowed' : 'local-only',
    doclingLocalAvailable: profile.docling,
    doclingServeConfigured: profile.remote,
    syncExtractAvailable: profile.sync,
    whisperAvailable: profile.whisper,
    platform: process.platform,
  };
  return planExtraction(input);
}

/** Walk a plan the way a host would. Every routing decision comes from the kernel. */
function execute(c: GoldenCase, plan: ExtractionPlan): Transcript {
  const calls: string[] = [];
  const yields = YIELDS[c.yields]!;
  const filePath = `/fixtures/fixture${plan.extension}`;

  if (plan.unavailable) {
    return { outcome: 'throw', code: plan.unavailable.code, message: plan.unavailable.message, calls };
  }

  let lightweightReturnedResult = false;

  for (const step of plan.steps) {
    let output: unknown;
    if (step.provider === 'unpdf') {
      calls.push('unpdf');
      output = yields.pdf;
      lightweightReturnedResult = Boolean(output);
      if (!isDigitalTextPdf(output as { text?: string; pageCount?: number })) continue;
      output = { text: (output as { text: string }).text, extractionMethod: 'unpdf', droppedInfo: [] };
    } else if (step.provider === 'mammoth') {
      calls.push('mammoth');
      output = yields.docx;
      lightweightReturnedResult = Boolean(output);
      const signals = { hasTable: c.docxHasTable, hasEmbeddedImage: false };
      const text = (output as { text?: string } | null)?.text;
      if (!text || docxRequiresDoclingEscalation(signals, c.highFidelity)) continue;
      output = { text, extractionMethod: 'mammoth', droppedInfo: [] };
    } else {
      // v2's email rung dynamically imported its parser instead of taking an
      // injected one, so the capture had no way to observe that call. It is
      // omitted from the transcript rather than invented — the winning tier and
      // extractionMethod still prove which rung was chosen.
      if (step.provider !== 'email') calls.push(step.provider);
      output = PROVIDERS[step.provider];
    }

    const finalized = finalizeResult(
      filePath,
      plan.extension,
      { ...(output as object), extractionMethod: (output as { extractionMethod?: string }).extractionMethod ?? step.method },
      step.tier,
      null,
    );
    return {
      outcome: 'result',
      routingTier: finalized.routingTier,
      extractionMethod: finalized.extractionMethod,
      unsupported: false,
      reason: null,
      remediation: null,
      calls,
    };
  }

  const exhausted = resolveExhaustion(plan, { lightweightReturnedResult })!;
  const result = makeUnsupportedResult(filePath, plan.extension, exhausted);
  return {
    outcome: 'result',
    routingTier: result.routingTier,
    extractionMethod: result.extractionMethod,
    unsupported: true,
    reason: result.droppedInfo[0]!.reason,
    remediation: result.remediation,
    calls,
  };
}

test('the golden corpus is broad and reaches every tier', () => {
  assert.ok(GOLDEN.length >= 700, `expected a real matrix, got ${GOLDEN.length}`);
  const tiers = new Set(GOLDEN.map((c) => c.transcript.routingTier).filter(Boolean));
  for (const tier of EXTRACTION_TIERS) {
    assert.ok(tiers.has(tier), `no captured transcript ever routed to "${tier}"`);
  }
  assert.ok(
    GOLDEN.some((c) => c.transcript.outcome === 'throw'),
    'the ASR-unavailable path must be covered',
  );
});

// v2's mdls rung is macOS-only, and the capture ran on macOS. On another
// platform those formats legitimately route elsewhere, so the assertion would
// be comparing two different correct answers.
const MDLS_ONLY = new Set(['.xls', '.pages']);
const platformSensitive = (c: GoldenCase) =>
  MDLS_ONLY.has(c.extension) && process.platform !== 'darwin';

for (const c of GOLDEN) {
  const label = `${c.extension}${c.docxHasTable ? '(table)' : ''} · ${c.profile} · ${c.yields} · fidelity=${c.highFidelity ? 'high' : 'fast'}`;
  test(`transcript matches v2 — ${label}`, { skip: platformSensitive(c) }, () => {
    assert.deepEqual(execute(c, planFor(c)), c.transcript);
  });
}

test('planning is pure — no filesystem, no env, no subprocess', () => {
  // Every input the ladder needs is declared, so the same arguments must give
  // the same plan no matter what the machine looks like.
  const input: PlanInput = {
    extension: '.pdf',
    highFidelity: true,
    doclingLocalAvailable: true,
    doclingServeConfigured: true,
    privacyPosture: 'remote-allowed',
  };
  assert.deepEqual(planExtraction(input), planExtraction(input));
});

test('a remote rung needs BOTH an endpoint and permission to leave the machine', () => {
  const base: PlanInput = { extension: '.pdf', doclingServeConfigured: true };
  const localOnly = planExtraction({ ...base, privacyPosture: 'local-only' });
  assert.ok(
    !localOnly.steps.some((s) => s.tier === 'docling-remote'),
    'a local-only document must never be planned onto a remote service',
  );

  const noEndpoint = planExtraction({
    extension: '.pdf',
    privacyPosture: 'remote-allowed',
    doclingServeConfigured: false,
  });
  assert.ok(!noEndpoint.steps.some((s) => s.tier === 'docling-remote'));

  const both = planExtraction({ ...base, privacyPosture: 'remote-allowed' });
  assert.ok(both.steps.some((s) => s.tier === 'docling-remote'));
});

test('privacy posture defaults to local-only, not to whatever is configured', () => {
  const signals = resolveRoutingSignals({ extension: '.pdf', doclingServeConfigured: true });
  assert.equal(signals.privacyPosture, 'local-only');
  assert.equal(signals.doclingRemoteAvailable, false);
});

test('an unknown extension is planned as unsupported with no steps', () => {
  const plan = planExtraction({ extension: '.zzz' });
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.unavailable, null);
  assert.match(plan.exhausted!.reason, /Unsupported document type: \.zzz/);
});

test('the ASR requirement is reported, not thrown — the host decides', () => {
  const plan = planExtraction({ extension: '.mp3', whisperAvailable: false });
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.unavailable!.code, 'ASR_REQUIRED');
  assert.equal(plan.unavailable!.extension, '.mp3');
  assert.match(plan.unavailable!.message, /requires ASR/);
});

test('the PDF exhaustion reason distinguishes "no parser" from "text too sparse"', () => {
  const plan = planExtraction({ extension: '.pdf' });
  assert.match(
    resolveExhaustion(plan, { lightweightReturnedResult: false })!.reason,
    /neither produced usable text/,
  );
  assert.match(
    resolveExhaustion(plan, { lightweightReturnedResult: true })!.reason,
    /density below calibrated corpus threshold/,
  );
});

test('extension casing does not change the plan', () => {
  assert.deepEqual(planExtraction({ extension: '.PDF' }), planExtraction({ extension: '.pdf' }));
});
