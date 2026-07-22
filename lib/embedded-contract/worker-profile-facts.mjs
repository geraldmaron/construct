/** Shared Worker Profile and Capability-contract enrichment. */

import { loadRegistry } from '../registry/loader.mjs';
import { getIncomingContracts } from '../capability-contracts.mjs';

export function workerProfileMap() {
  return new Map(Object.values(loadRegistry().workerProfiles).map((profile) => [profile.id, profile]));
}

export function workerProfileRationale(workerProfileIds, map = workerProfileMap()) {
  return workerProfileIds.map((workerProfileId) => ({
    workerProfileId,
    reason: map.get(workerProfileId)?.description || 'No Worker Profile description available.',
  }));
}

export function skillsForWorkerProfiles(workerProfileIds, map = workerProfileMap()) {
  return [...new Set(workerProfileIds.flatMap((id) => map.get(id)?.skillEmphasis || []))];
}

export function contractFacts(workerProfileId) {
  const contracts = getIncomingContracts(workerProfileId) || [];
  const evidence = new Set();
  const outputs = new Set();
  for (const contract of contracts) {
    for (const item of contract.input?.mustContain || []) evidence.add(item);
    for (const precondition of contract.preconditions || []) evidence.add(precondition);
    for (const item of contract.output?.mustContain || []) outputs.add(item);
  }
  return { evidenceRequirements: [...evidence], expectedOutputs: [...outputs] };
}
