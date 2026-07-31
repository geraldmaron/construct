/**
 * lib/workplace-loop/detect.mjs — the production workplace loop's `detect`
 * entrypoint, generalizing spike D's detect() (docs/
 * notes/research/workspace-control-plane/spikes/d-daily-workplace-loop/loop/
 * run-loop.mjs) into: fetch a real source → fingerprint → short-circuit to
 * "nothing new" on an unchanged fingerprint (the no-fabrication proof,
 * §2.13 of spike D's report, now against live data) → detect signals →
 * align against real Workspace strategy → propose → persist.
 *
 * `repo` defaults to the project's own GitHub origin remote
 * (sources/github-source.mjs's resolveDefaultGithubRepo) so a fresh checkout
 * runs against its own real issue tracker with no configuration — when
 * neither an explicit `repo` nor a resolvable origin remote exists, this
 * returns `NO_SOURCE_CONFIGURED` rather than fabricating a demo repo.
 */

import { fetchGithubOpenIssues, resolveDefaultGithubRepo } from './sources/github-source.mjs';
import { fingerprintSignalInputs } from './fingerprint.mjs';
import { detectSignals } from './signals.mjs';
import { alignSignals } from './align.mjs';
import { buildProposal } from './propose.mjs';
import { loadLoopState, saveLoopState, saveProposal } from './state-store.mjs';

/**
 * @param {string} rootDir
 * @param {object} [opts]
 * @param {string} [opts.repo] - "owner/name"; defaults to the project's git origin remote
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {Function} [opts.providerFactory] - injectable GitHub read provider factory (tests)
 * @returns {Promise<object>} a detect report (run_kind/result/... — see below)
 */
export async function runDetect(rootDir, { repo, env = process.env, providerFactory } = {}) {
  const resolvedRepo = repo ?? resolveDefaultGithubRepo(rootDir);
  if (!resolvedRepo) {
    return {
      runKind: 'detect',
      result: 'NO_SOURCE_CONFIGURED',
      message: 'No GitHub repo configured and no resolvable git origin remote — nothing to detect against.',
    };
  }

  const prevState = loadLoopState(rootDir);
  const { issues, fetchedAt } = await fetchGithubOpenIssues({ repo: resolvedRepo, env, providerFactory });
  const fingerprint = fingerprintSignalInputs(issues);

  if (prevState && prevState.fingerprint === fingerprint) {
    return {
      runKind: 'detect',
      result: 'NOTHING_NEW',
      repo: resolvedRepo,
      asOf: fetchedAt,
      fingerprint,
      message: `Source unchanged since previous run at ${prevState.lastRunAt} (run #${prevState.runNumber}). `
        + `Re-confirming the same ${prevState.signalIds.length} signal(s) already on record; 0 new signals detected. `
        + 'No new proposal generated.',
      previousRun: { runNumber: prevState.runNumber, lastRunAt: prevState.lastRunAt, signalIds: prevState.signalIds },
    };
  }

  const { meaningful, noise } = detectSignals(issues, { asOf: fetchedAt });
  const aligned = alignSignals(rootDir, meaningful);
  const runNumber = (prevState?.runNumber ?? 0) + 1;
  const proposal = buildProposal({ signals: aligned, runNumber, asOf: fetchedAt });
  if (proposal) saveProposal(rootDir, proposal);

  saveLoopState(rootDir, {
    fingerprint,
    runNumber,
    lastRunAt: fetchedAt,
    signalIds: aligned.map((s) => s.id),
    lastProposalId: proposal?.proposalId ?? null,
  });

  return {
    runKind: 'detect',
    result: 'NEW_FINDINGS',
    repo: resolvedRepo,
    asOf: fetchedAt,
    fingerprint,
    runNumber,
    issuesScanned: issues.length,
    meaningfulSignals: aligned,
    noiseFilteredOut: noise,
    proposalId: proposal?.proposalId ?? null,
  };
}
