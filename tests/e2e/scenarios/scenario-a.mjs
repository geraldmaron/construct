/**
 * tests/e2e/scenarios/scenario-a.mjs — Greenfield Next.js scenario executor.
 *
 * Builds a sterile env, scaffolds a real Next.js app via create-next-app, then
 * drives the seven validation tiers and returns a structured result the runner
 * renders into tests/e2e/reports/scenario-a-greenfield-nextjs.md.
 *
 * Tier 3 reality: Construct's cx-* specialists are host (Claude Code) subagents,
 * and `construct ask` is RAG over the knowledge corpus, not persona dispatch.
 * With no Construct-managed model credential in the env, the executor does not
 * fabricate an artifact — it records the dispatch mechanism and leaves the ADR
 * body to be produced by the host driving real architect / reviewer
 * subagents, then validates whatever artifact lands. The tier result carries a
 * `requiresHostDispatch` flag so the runner reports the mechanism honestly.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSterileEnv, timedRun, gitInit } from '../lib/sterile-env.mjs';
import { enumerateCommands, sweepOne } from '../lib/command-sweeper.mjs';
import { probeCliJson, assertEnvelope } from '../lib/embed-probes.mjs';

const CREATE_NEXT_APP_ARGS = (target) => ([
  'create-next-app@latest', target,
  '--typescript', '--tailwind', '--eslint', '--app', '--src-dir',
  '--use-npm', '--no-import-alias', '--yes',
]);

// Tier 1 — install + init UX. Time on clock from a fresh tmpdir to the first
// working construct command, with every stdout/stderr line preserved.

export function tierInstallInit({ env, project, launcher, repoRoot }) {
  const steps = [];
  const install = timedRun({ bin: process.execPath, args: [launcher, 'install', '--scope=user', '--yes'], cwd: project, env });
  steps.push({ label: 'construct install --scope=user --yes', ...install });

  const init = timedRun({ bin: process.execPath, args: [launcher, 'init', '--yes'], cwd: project, env });
  steps.push({ label: 'construct init --yes', ...init });

  const firstCmd = timedRun({ bin: process.execPath, args: [launcher, 'status'], cwd: project, env });
  steps.push({ label: 'construct status (first command after init)', ...firstCmd });

  const totalMs = steps.reduce((a, s) => a + s.elapsedMs, 0);
  return { steps, totalMs, ok: install.status === 0 && init.status === 0 };
}

// Tier 2 — command sweep over every public + internal command in the catalog.

export function tierCommandSweep({ env, project, launcher }) {
  const { public: pub, internal } = enumerateCommands();
  const rows = [];
  for (const cmd of [...pub, ...internal]) {
    rows.push(sweepOne({ launcher, cmd, cwd: project, env, projectDir: project }));
  }
  return { rows, publicCount: pub.length, internalCount: internal.length };
}

// Tier 7 — invocable by other applications (the credential-free surfaces:
// CLI-JSON and a bare capability-describe envelope). MCP / HTTP+SSE / SDK probes
// land with the dedicated host scripts in a later step.

export function tierEmbedProbes({ env, project, launcher }) {
  const cliJson = probeCliJson({ launcher, cwd: project, env });
  const describe = timedRun({ bin: process.execPath, args: [launcher, 'capability', 'describe', '--json'], cwd: project, env });
  let envelope = null;
  try { envelope = assertEnvelope(JSON.parse(describe.stdout || 'null')); } catch { envelope = { ok: false, problems: ['unparseable'] }; }
  return { cliJson, capabilityDescribe: { status: describe.status, envelope } };
}

export function setup({ repoRoot }) {
  const sterile = makeSterileEnv({ repoRoot, prefix: 'cx-e2e-a-' });
  const fixture = timedRun({
    bin: 'npx', args: CREATE_NEXT_APP_ARGS(sterile.project), cwd: sterile.root, env: sterile.env, timeoutMs: 600_000,
  });
  gitInit({ cwd: sterile.project, env: sterile.env });
  const files = existsSync(sterile.project) ? readdirSync(sterile.project) : [];
  return { sterile, fixture, files };
}

export function runTiers({ sterile }) {
  const { env, project, launcher, root } = sterile;
  const repoRoot = env.CONSTRUCT_DEV_PATH;
  return {
    tier1: tierInstallInit({ env, project, launcher, repoRoot }),
    tier2: tierCommandSweep({ env, project, launcher }),
    tier7: tierEmbedProbes({ env, project, launcher }),
    root,
  };
}

// Persist the raw evidence next to the report so a reviewer can re-verify any
// number without re-running the scenario.

export function writeEvidence({ outDir, evidence }) {
  const path = join(outDir, 'scenario-a-evidence.json');
  writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n');
  return path;
}
