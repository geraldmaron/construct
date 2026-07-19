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

export const WORK_CATEGORIES = {
  visual: 'visual',
  deep: 'deep',
  quick: 'quick',
  writing: 'writing',
  analysis: 'analysis',
};

export const TERMINAL_STATES = ['DONE', 'BLOCKED', 'NEEDS_MAIN_INPUT'];
