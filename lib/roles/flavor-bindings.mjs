/**
 * lib/roles/flavor-bindings.mjs — Canonical Worker Profile ↔ role overlay bindings.
 *
 * Every Worker Profile that receives prompt flavor injection is listed here.
 * rolePrefix matches skills/perspectives/{rolePrefix}[.{flavor}].md on disk.
 * classifierKey matches keys returned by classifyRoleFlavors() in orchestration-policy.
 *
 * baseOnly: classifier value "core" loads the base role file (no .flavor suffix).
 * for when to split Worker Profiles vs add flavors.
 *
 * A consolidation folded 15 of the 29 legacy Worker Profiles into 11 surviving
 * worker anchors as skill bundles rather than separate Worker Profiles. rolePrefix
 * and classifierKey are unchanged (the skills/perspectives/*.md overlay files and
 * the classifier heuristics that detect them are untouched); only
 * workerProfileId is repointed to the anchor that now loads that overlay.
 */

export const WORKER_PROFILE_FLAVOR_BINDINGS = {
  engineer: { classifierKey: 'engineer', rolePrefix: 'engineer', workerProfileId: 'engineer' },
  'ai-engineer': { classifierKey: 'aiEngineer', rolePrefix: 'ai-engineer', workerProfileId: 'engineer', baseOnly: true },
  'platform-engineer': { classifierKey: 'platformEngineer', rolePrefix: 'platform-engineer', workerProfileId: 'engineer', baseOnly: true },
  'data-engineer': { classifierKey: 'dataEngineer', rolePrefix: 'data-engineer', workerProfileId: 'engineer' },
  architect: { classifierKey: 'architect', rolePrefix: 'architect', workerProfileId: 'architect' },
  'product-manager': { classifierKey: 'productManager', rolePrefix: 'product-manager', workerProfileId: 'product-manager' },
  'business-strategist': { classifierKey: 'businessStrategist', rolePrefix: 'business-strategist', workerProfileId: 'product-manager', baseOnly: true },
  qa: { classifierKey: 'qa', rolePrefix: 'qa', workerProfileId: 'qa' },
  'test-automation': { classifierKey: 'testAutomation', rolePrefix: 'test-automation', workerProfileId: 'qa', baseOnly: true },
  security: { classifierKey: 'security', rolePrefix: 'security', workerProfileId: 'security' },
  'data-analyst': { classifierKey: 'dataAnalyst', rolePrefix: 'data-analyst', workerProfileId: 'data-analyst' },
  sre: { classifierKey: 'sre', rolePrefix: 'sre', workerProfileId: 'operations', baseOnly: true },
  operations: { classifierKey: 'operations', rolePrefix: 'operations', workerProfileId: 'operations', baseOnly: true },
  'release-manager': { classifierKey: 'releaseManager', rolePrefix: 'release-manager', workerProfileId: 'operations', baseOnly: true },
  'docs-keeper': { classifierKey: 'docsKeeper', rolePrefix: 'docs-keeper', workerProfileId: 'operations', baseOnly: true },
  reviewer: { classifierKey: 'reviewer', rolePrefix: 'reviewer', workerProfileId: 'reviewer' },
  'devil-advocate': { classifierKey: 'devilAdvocate', rolePrefix: 'devil-advocate', workerProfileId: 'reviewer', baseOnly: true },
  evaluator: { classifierKey: 'evaluator', rolePrefix: 'evaluator', workerProfileId: 'reviewer', baseOnly: true },
  'trace-reviewer': { classifierKey: 'traceReviewer', rolePrefix: 'trace-reviewer', workerProfileId: 'reviewer', baseOnly: true },
  researcher: { classifierKey: 'researcher', rolePrefix: 'researcher', workerProfileId: 'researcher' },
  'ux-researcher': { classifierKey: 'uxResearcher', rolePrefix: 'ux-researcher', workerProfileId: 'researcher', baseOnly: true },
  explorer: { classifierKey: 'explorer', rolePrefix: 'explorer', workerProfileId: 'researcher', baseOnly: true },
  designer: { classifierKey: 'designer', rolePrefix: 'designer', workerProfileId: 'designer' },
  accessibility: { classifierKey: 'accessibility', rolePrefix: 'designer.accessibility', workerProfileId: 'designer', baseOnly: true },
  debugger: { classifierKey: 'debugger', rolePrefix: 'debugger', workerProfileId: 'debugger', baseOnly: true },
};

const BY_CLASSIFIER = Object.fromEntries(
  Object.values(WORKER_PROFILE_FLAVOR_BINDINGS).map((b) => [b.classifierKey, b]),
);

const BY_SHORT_NAME = Object.fromEntries(
  Object.entries(WORKER_PROFILE_FLAVOR_BINDINGS).map(([name, b]) => [name, b]),
);

// Reverse index: several short-name keys above share
// a single workerProfileId (e.g. engineer/ai-engineer/platform-engineer/
// data-engineer all point at engineer). bindingForWorkerProfile(shortName)
// only ever returns the entry whose OWN key matches the short name, so a
// caller resolving a flavor by workerProfileId (rather than by the historical
// short name) needs every candidate binding for that id, not just one.
const BY_WORKER_PROFILE_ID = new Map();
for (const binding of Object.values(WORKER_PROFILE_FLAVOR_BINDINGS)) {
  if (!BY_WORKER_PROFILE_ID.has(binding.workerProfileId)) BY_WORKER_PROFILE_ID.set(binding.workerProfileId, []);
  BY_WORKER_PROFILE_ID.get(binding.workerProfileId).push(binding);
}

export function bindingForWorkerProfile(shortName) {
  return BY_SHORT_NAME[shortName] ?? null;
}

export function bindingsForWorkerProfileId(workerProfileId) {
  return BY_WORKER_PROFILE_ID.get(workerProfileId) ?? [];
}

export function bindingForClassifier(classifierKey) {
  return BY_CLASSIFIER[classifierKey] ?? null;
}

export function resolveRoleOverlayId(binding, flavor) {
  if (!binding || !flavor) return null;
  if (binding.baseOnly || flavor === 'core') return binding.rolePrefix;
  return `${binding.rolePrefix}.${flavor}`;
}

export function formatOverlayLine(classifierKey, flavor) {
  const binding = bindingForClassifier(classifierKey);
  if (!binding || !flavor) return null;
  const roleId = resolveRoleOverlayId(binding, flavor);
  if (!roleId) return null;
  return `${binding.workerProfileId}: loaded ${roleId} overlay`;
}
