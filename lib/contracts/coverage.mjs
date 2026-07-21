/**
 * lib/contracts/coverage.mjs — executable-postcondition coverage for
 * capability-owned contracts in the canonical registry.
 *
 * A contract's postconditions are pure prose unless something mechanical
 * evaluates them. This module measures the split: how many postconditions,
 * across the full contract set, are tagged `postconditionType: 'executable'`
 * (backed by a real check — see lib/contracts/validate.mjs's file header for
 * the four enforcement mechanisms) versus `'advisory'` (documented, not
 * mechanically checked). A legacy bare-string postcondition counts as
 * neither classified kind and is reported separately — it should not occur
 * in the shipped contract set after the rf26.12 migration, so a nonzero
 * count here is itself a drift signal.
 *
 * Pure and deterministic: same registry -> same report. Consumed by
 * `construct doctor consistency` (lib/doctor/watchers/consistency.mjs) and
 * by tests/contracts-coverage.test.mjs as the durable coverage assertion.
 */

import { loadRegistry } from '../registry/loader.mjs';

/**
 * Compute postcondition coverage across every contract in the unified
 * registry. Returns per-contract counts plus an aggregate summary.
 */
export function computePostconditionCoverage({ repoRoot } = {}) {
  const registry = loadRegistry(repoRoot ? { rootDir: repoRoot } : undefined);
  const contractsById = new Map();
  for (const capability of Object.values(registry.capabilities || {})) {
    for (const contract of Object.values(capability.contracts || {})) {
      if (contract?.id && !contractsById.has(contract.id)) contractsById.set(contract.id, contract);
    }
  }
  const contracts = [...contractsById.values()];

  const perContract = [];
  let executable = 0;
  let advisory = 0;
  let unclassified = 0;

  for (const contract of contracts) {
    let cExecutable = 0;
    let cAdvisory = 0;
    let cUnclassified = 0;
    for (const pc of contract.postconditions || []) {
      if (typeof pc !== 'object' || pc === null) { cUnclassified += 1; continue; }
      if (pc.postconditionType === 'executable') cExecutable += 1;
      else if (pc.postconditionType === 'advisory') cAdvisory += 1;
      else cUnclassified += 1;
    }
    const total = cExecutable + cAdvisory + cUnclassified;
    executable += cExecutable;
    advisory += cAdvisory;
    unclassified += cUnclassified;
    perContract.push({
      id: contract.id,
      total,
      executable: cExecutable,
      advisory: cAdvisory,
      unclassified: cUnclassified,
      coveragePct: total === 0 ? null : Math.round((cExecutable / total) * 1000) / 10,
    });
  }

  const total = executable + advisory + unclassified;
  return {
    contractCount: contracts.length,
    total,
    executable,
    advisory,
    unclassified,
    coveragePct: total === 0 ? 0 : Math.round((executable / total) * 1000) / 10,
    perContract: perContract.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/**
 * One-line human summary, matching the style of `construct decisions`
 * (lib/decisions/registry.mjs's `Decisions: N (M enforced, K advisory)`).
 */
export function formatCoverageSummary(coverage) {
  return `contract postconditions: ${coverage.total} (${coverage.executable} executable, ${coverage.advisory} advisory, ${coverage.coveragePct}% executable)`;
}
