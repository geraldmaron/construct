/**
 * lib/orchestration/policy-constants.mjs — shared enums for orchestration
 * routing policy.
 *
 * Extracted from lib/orchestration-policy.mjs (construct-rf26.10) so
 * classification.mjs, gates.mjs, and flow-selection.mjs can each import the
 * enums without importing the whole policy module (avoids a cycle back
 * through orchestration-policy.mjs's re-export layer). orchestration-policy.mjs
 * re-exports these unchanged for existing callers.
 */

export const EXECUTION_TRACKS = {
  immediate: 'immediate',
  focused: 'focused',
  orchestrated: 'orchestrated',
};

export const INTENT_CLASSES = {
  research: 'research',
  implementation: 'implementation',
  investigation: 'investigation',
  evaluation: 'evaluation',
  fix: 'fix',
};

// RFC-0004 §2: each intent class maps to the team that naturally owns that work.
// The primary team drives ownership in teamRouting; specialist selection stays
// flavor-driven. Domain refinements the RFC notes (investigation/fix can fall to
// operations-group, research to product-group) layer on as the decision matrix
// grows — the base mapping is deterministic so routing is testable.

export const INTENT_TO_TEAM = Object.freeze({
  research: 'strategy-team',
  implementation: 'engineering-team',
  investigation: 'engineering-team',
  evaluation: 'quality-team',
  fix: 'engineering-team',
});

export const WORK_CATEGORIES = {
  visual: 'visual',
  deep: 'deep',
  quick: 'quick',
  writing: 'writing',
  analysis: 'analysis',
};

export const TERMINAL_STATES = ['DONE', 'BLOCKED', 'NEEDS_MAIN_INPUT'];
