/**
 * lib/certification/team-arbitration.mjs — the live team-arbitration gate (construct-72gqn.17, L4).
 *
 * Runs the real base chain (architect->engineer->reviewer->qa) through the orchestration
 * runtime against a design request, then scores grounding deterministically: the reviewer
 * must actually reference the engineer's real output (a shared salient token) and must
 * challenge it (not rubber-stamp). Without CONSTRUCT_CERTIFY_LIVE=1 (handled by the runner)
 * or credentials (handled here) the gate is inconclusive, never pass. The hermetic proof of
 * the same collaboration is tests/functional/team-arbitration.functional.test.mjs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOrchestration } from '../orchestration/runtime.mjs';
import { resolveRealLlmProvider } from './real-llm-scenarios.mjs';

const TEAM_REQUEST = 'Design, implement, and verify a public API rate limiter; record the decision and review it for correctness.';
const CHALLENGE_MARKERS = /(disagree|concern|however|but |risk|flag|instead|recommend|missing|edge case|fails|violates|too )/i;

function tierEnvForModel(model, env) {
  return { ...process.env, ...env, CONSTRUCT_MODEL_REASONING: model, CONSTRUCT_MODEL_STANDARD: model, CONSTRUCT_MODEL_FAST: model };
}

// Grounding = the reviewer names a salient token from the engineer's output. Substantive
// words (6+ chars) shared between the two prove the reviewer read the engineer, not that it
// answered the original request in parallel.

export function reviewerReferencesEngineer(engineerOutput, reviewerOutput) {
  const salient = new Set(
    String(engineerOutput).toLowerCase().match(/[a-z][a-z0-9-]{5,}/g) ?? [],
  );
  const reviewerWords = String(reviewerOutput).toLowerCase().match(/[a-z][a-z0-9-]{5,}/g) ?? [];
  return reviewerWords.some((w) => salient.has(w));
}

export async function runTeamArbitrationLive({ env = process.env, fetchImpl = globalThis.fetch, cleanup = true } = {}) {
  const provider = resolveRealLlmProvider(env);
  if (provider.skip) return { inconclusive: true, detail: provider.skip };

  const model = provider.model ?? 'openrouter/free-auto';
  const cwd = mkdtempSync(join(tmpdir(), 'cert-team-arb-'));
  try {
    const run = await runOrchestration(
      { request: TEAM_REQUEST, requestedStrategy: 'orchestrated', hostModel: model, hostProvider: provider.provider, fileCount: 4, moduleCount: 2 },
      { env: tierEnvForModel(model, env), cwd, workerBackend: 'provider', fetchImpl },
    );
    // A run with nothing executed (awaiting-host / prepare-only) has no output to ground
    // against; a degraded run whose base tasks still produced output is fine — grounding is
    // about what the reviewer did with the engineer's real output, not the run-level honesty flag.
    if (['awaiting-host', 'completed-prepare-only'].includes(run.status)) {
      return { inconclusive: true, detail: `no executed output (${run.status})` };
    }
    const engineer = run.tasks.find((t) => t.workerProfileId === 'engineer')?.output ?? '';
    const reviewer = run.tasks.find((t) => t.workerProfileId === 'reviewer')?.output ?? '';
    if (!engineer.trim() || !reviewer.trim()) {
      return { inconclusive: true, detail: 'engineer or reviewer produced no output' };
    }

    const references = reviewerReferencesEngineer(engineer, reviewer);
    const challenges = CHALLENGE_MARKERS.test(reviewer);
    const pass = references && challenges;
    const failed = [!references && 'reviewer-did-not-reference-engineer', !challenges && 'reviewer-did-not-challenge'].filter(Boolean);
    return { pass, detail: pass ? 'reviewer grounded in and challenged the engineer' : failed.join(', '), engineerLen: engineer.length, reviewerLen: reviewer.length };
  } finally {
    if (cleanup) rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
