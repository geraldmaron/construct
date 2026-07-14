/**
 * lib/certification/comparisons.mjs — team-vs-solo baseline comparison (construct-72gqn.18, L5).
 *
 * Multi-agent orchestration only earns its added latency and cost if it produces something a
 * single agent would not. This runs the same request two ways — the base chain
 * (architect->engineer->reviewer->qa) and one solo generalist call — and scores each on a
 * deterministic role-concern rubric (does the output actually cover architecture trade-offs,
 * implementation, review of failure modes, and testing?). The comparison, its deltas, and a
 * stated verdict are recorded so the value of orchestration is measured, not assumed.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOrchestration } from '../orchestration/runtime.mjs';
import { resolveSecret } from '../providers/secret-resolver.mjs';

// One concern per base-chain role. A single generalist tends to cover the first one or two
// and skim the rest; the point of the chain is that each concern gets an owner.

export const ROLE_CONCERNS = Object.freeze({
  architecture: /trade-off|invariant|alternativ|\bADR\b|interface contract|design decision/i,
  implementation: /implement|refactor|\bpattern\b|the existing|module|function/i,
  review: /edge case|failure mode|regression|error handling|\brisk|hidden|does not test/i,
  testing: /\btest|coverage|acceptance criteri|assert|reproduc/i,
});

export function scoreRoleConcernCoverage(text) {
  const covered = Object.entries(ROLE_CONCERNS)
    .filter(([, re]) => re.test(String(text ?? '')))
    .map(([concern]) => concern);
  return { covered, count: covered.length, total: Object.keys(ROLE_CONCERNS).length };
}

function parseProviderText(data) {
  return data?.content?.[0]?.text ?? data?.choices?.[0]?.message?.content ?? '';
}

// Resolve only a key actually present in the passed env — reaching for an absent key would
// fall through to the ambient op:// reference, which cannot materialize outside a real run.

function soloApiKey(env) {
  for (const name of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']) {
    if (env[name]) return resolveSecret(name, { env });
  }
  return '';
}

async function callSolo(request, { env, fetchImpl, model }) {
  const apiKey = soloApiKey(env);
  const system = 'You are a single generalist engineer. Produce a complete solution to the request entirely on your own — architecture, implementation, review, and testing.';
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: String(model).replace(/^anthropic\//, ''), max_tokens: 1024, messages: [{ role: 'system', content: system }, { role: 'user', content: request }] }),
  });
  return parseProviderText(await res.json());
}

export function comparisonsDir(rootDir) {
  return join(rootDir, '.construct', 'certification', 'comparisons');
}

export function writeComparison(comparison, { rootDir }) {
  const dir = comparisonsDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${comparison.id}.json`);
  writeFileSync(file, `${JSON.stringify(comparison, null, 2)}\n`);
  return file;
}

export async function runTeamVsSoloComparison({
  request,
  env = process.env,
  fetchImpl = globalThis.fetch,
  rootDir = process.cwd(),
  model = env.CX_MODEL_REASONING || 'anthropic/claude-sonnet-4-6',
  id = 'orchestration.team.base-chain',
  now = () => new Date().toISOString(),
  clock = () => Date.now(),
  cleanup = true,
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'cert-compare-'));
  try {
    const teamStart = clock();
    const teamRun = await runOrchestration(
      { request, requestedStrategy: 'orchestrated', hostModel: model, fileCount: 4, moduleCount: 2 },
      { env, cwd, workerBackend: 'provider', fetchImpl },
    );
    const teamMs = clock() - teamStart;
    const teamOutput = teamRun.tasks.map((t) => t.output || '').join('\n\n');
    const teamCoverage = scoreRoleConcernCoverage(teamOutput);

    const soloStart = clock();
    const soloOutput = await callSolo(request, { env, fetchImpl, model });
    const soloMs = clock() - soloStart;
    const soloCoverage = scoreRoleConcernCoverage(soloOutput);

    const verdict = teamCoverage.count > soloCoverage.count
      ? 'team-adds-role-concern-coverage'
      : teamCoverage.count === soloCoverage.count ? 'parity' : 'solo-sufficient';

    const comparison = {
      id,
      capabilityId: 'orchestration.team',
      request,
      generatedAt: now(),
      team: { specialists: teamRun.tasks.length, coverage: teamCoverage, outputChars: teamOutput.length, latencyMs: teamMs },
      solo: { coverage: soloCoverage, outputChars: soloOutput.length, latencyMs: soloMs },
      deltas: { concernCoverage: teamCoverage.count - soloCoverage.count, outputChars: teamOutput.length - soloOutput.length, latencyMs: teamMs - soloMs },
      verdict,
    };
    const file = writeComparison(comparison, { rootDir });
    return { comparison, file };
  } finally {
    if (cleanup) rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
