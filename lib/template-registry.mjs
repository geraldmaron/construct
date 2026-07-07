/**
 * lib/template-registry.mjs — specialist → template ownership map.
 *
 * Single source of truth for which canonical doc templates a specialist
 * authors. The prompt-surface test gates assert that each specialist's
 * prompt references `get_template(<name>)` for its native artifacts (so
 * prompts stay pointers rather than restated structure) and that every
 * named template actually resolves on disk.
 *
 * Adding a new specialist or template: extend SPECIALIST_TEMPLATES, ship the
 * template file under templates/docs/<name>.md, and wire the prompt to call
 * `get_template("<name>")` in the output-format section.
 *
 * Project overrides at .construct/templates/docs/<name>.md take precedence at fetch
 * time via the get_template MCP tool; the registry only names the canonical
 * shipped name.
 */

// construct-rf26.11 folded 15 of the 29 legacy specialists into 11 surviving
// worker anchors. Each folded specialist's template ownership below moved to
// its anchor's entry (devil-advocate/evaluator/trace-reviewer -> reviewer;
// legal-compliance -> security; sre -> operations; accessibility -> designer)
// rather than being dropped, so the reverse-coverage gate still pins these
// artifacts to a real, callable get_template() reference in the anchor's prompt.
export const SPECIALIST_TEMPLATES = {
  'cx-reviewer':        ['code-review-report', 'verdict'],
  'cx-security':        ['security-audit-report', 'verdict'],
  'cx-qa':              ['qa-report', 'test-plan', 'qa-strategy'],
  'cx-debugger':        ['debug-investigation'],

  // Already-wired specialists pinned here so the gate guards them against drift.
  'cx-architect':       ['adr', 'rfc', 'architecture-review'],
  'cx-researcher':      ['research-brief', 'evidence-brief'],
  'cx-operations':      ['runbook', 'incident-report', 'postmortem'],
  'cx-product-manager': ['prd', 'meta-prd'],
  'cx-designer':        ['accessibility-audit'],
};

// The orchestrator owns the task-packet shape and emits it at dispatch time
// rather than authoring it as a doc. Pinned here so the existence gate
// and reverse-coverage gate both pass without conflating dispatch with
// authoring.

export const SHARED_TEMPLATES = new Set([
  'task-packet',
]);

// Roles whose prompts may legitimately reference templates not in the map
// (e.g. cx-docs-keeper authors many doc types via a listing tool, not a
// single owned template). Entries here opt out of the reverse-coverage gate,
// not the per-mapping gate above.

export const TEMPLATE_OWNERSHIP_EXEMPTIONS = new Set([
  'construct_guide',
  'onboarding',
  'memo',
  'skill-artifact',
  'persona-artifact',
  'customer-profile',
  'one-pager',
  'strategy',
  'backlog-proposal',
  'changelog-entry',
  'prfaq',
  'signal-brief',
  'research-finding',
  'product-intelligence-report',
  'rfc-platform',
  'prd-platform',
  'prd-business',
  'README',
]);
