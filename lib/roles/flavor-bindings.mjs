/**
 * lib/roles/flavor-bindings.mjs — Canonical specialist ↔ role overlay bindings.
 *
 * Every cx-* specialist that receives prompt flavor injection is listed here.
 * rolePrefix matches skills/roles/{rolePrefix}[.{flavor}].md on disk.
 * classifierKey matches keys returned by classifyRoleFlavors() in orchestration-policy.
 *
 * baseOnly: classifier value "core" loads the base role file (no .flavor suffix).
 * See ADR-0047 for when to split specialists vs add flavors.
 *
 * construct-rf26.11 folded 15 of the 29 legacy specialists into 11 surviving
 * worker anchors as skill bundles rather than separate personas. rolePrefix
 * and classifierKey are unchanged (the skills/roles/*.md overlay files and
 * the classifier heuristics that detect them are untouched); only
 * specialistId is repointed to the anchor that now loads that overlay.
 */

export const SPECIALIST_FLAVOR_BINDINGS = {
  engineer: { classifierKey: 'engineer', rolePrefix: 'engineer', specialistId: 'cx-engineer' },
  'ai-engineer': { classifierKey: 'aiEngineer', rolePrefix: 'ai-engineer', specialistId: 'cx-engineer', baseOnly: true },
  'platform-engineer': { classifierKey: 'platformEngineer', rolePrefix: 'platform-engineer', specialistId: 'cx-engineer', baseOnly: true },
  'data-engineer': { classifierKey: 'dataEngineer', rolePrefix: 'data-engineer', specialistId: 'cx-engineer' },
  architect: { classifierKey: 'architect', rolePrefix: 'architect', specialistId: 'cx-architect' },
  'product-manager': { classifierKey: 'productManager', rolePrefix: 'product-manager', specialistId: 'cx-product-manager' },
  'business-strategist': { classifierKey: 'businessStrategist', rolePrefix: 'business-strategist', specialistId: 'cx-product-manager', baseOnly: true },
  qa: { classifierKey: 'qa', rolePrefix: 'qa', specialistId: 'cx-qa' },
  'test-automation': { classifierKey: 'testAutomation', rolePrefix: 'test-automation', specialistId: 'cx-qa', baseOnly: true },
  security: { classifierKey: 'security', rolePrefix: 'security', specialistId: 'cx-security' },
  'data-analyst': { classifierKey: 'dataAnalyst', rolePrefix: 'data-analyst', specialistId: 'cx-data-analyst' },
  sre: { classifierKey: 'sre', rolePrefix: 'sre', specialistId: 'cx-operations', baseOnly: true },
  operations: { classifierKey: 'operations', rolePrefix: 'operations', specialistId: 'cx-operations', baseOnly: true },
  'release-manager': { classifierKey: 'releaseManager', rolePrefix: 'release-manager', specialistId: 'cx-operations', baseOnly: true },
  'docs-keeper': { classifierKey: 'docsKeeper', rolePrefix: 'docs-keeper', specialistId: 'cx-operations', baseOnly: true },
  reviewer: { classifierKey: 'reviewer', rolePrefix: 'reviewer', specialistId: 'cx-reviewer' },
  'devil-advocate': { classifierKey: 'devilAdvocate', rolePrefix: 'devil-advocate', specialistId: 'cx-reviewer', baseOnly: true },
  evaluator: { classifierKey: 'evaluator', rolePrefix: 'evaluator', specialistId: 'cx-reviewer', baseOnly: true },
  'trace-reviewer': { classifierKey: 'traceReviewer', rolePrefix: 'trace-reviewer', specialistId: 'cx-reviewer', baseOnly: true },
  researcher: { classifierKey: 'researcher', rolePrefix: 'researcher', specialistId: 'cx-researcher' },
  'ux-researcher': { classifierKey: 'uxResearcher', rolePrefix: 'ux-researcher', specialistId: 'cx-researcher', baseOnly: true },
  explorer: { classifierKey: 'explorer', rolePrefix: 'explorer', specialistId: 'cx-researcher', baseOnly: true },
  designer: { classifierKey: 'designer', rolePrefix: 'designer', specialistId: 'cx-designer' },
  accessibility: { classifierKey: 'accessibility', rolePrefix: 'designer.accessibility', specialistId: 'cx-designer', baseOnly: true },
  debugger: { classifierKey: 'debugger', rolePrefix: 'debugger', specialistId: 'cx-debugger', baseOnly: true },
};

const BY_CLASSIFIER = Object.fromEntries(
  Object.values(SPECIALIST_FLAVOR_BINDINGS).map((b) => [b.classifierKey, b]),
);

const BY_SPECIALIST = Object.fromEntries(
  Object.entries(SPECIALIST_FLAVOR_BINDINGS).map(([name, b]) => [name, b]),
);

// Reverse index: since construct-rf26.11, several short-name keys above share
// a single specialistId (e.g. engineer/ai-engineer/platform-engineer/
// data-engineer all point at cx-engineer). bindingForSpecialist(shortName)
// only ever returns the entry whose OWN key matches the short name, so a
// caller resolving a flavor by specialistId (rather than by the historical
// short name) needs every candidate binding for that id, not just one.
const BY_SPECIALIST_ID = new Map();
for (const binding of Object.values(SPECIALIST_FLAVOR_BINDINGS)) {
  if (!BY_SPECIALIST_ID.has(binding.specialistId)) BY_SPECIALIST_ID.set(binding.specialistId, []);
  BY_SPECIALIST_ID.get(binding.specialistId).push(binding);
}

export function bindingForSpecialist(shortName) {
  return BY_SPECIALIST[shortName] ?? null;
}

export function bindingsForSpecialistId(specialistId) {
  return BY_SPECIALIST_ID.get(specialistId) ?? [];
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
  return `${binding.specialistId}: loaded ${roleId} overlay`;
}
