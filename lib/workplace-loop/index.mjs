/**
 * lib/workplace-loop/index.mjs — public API surface for the production
 * sources/directives/workplace loop (construct-b0nny.25). Re-exports the
 * pipeline stages so a future overseer (construct-b0nny.17's consolidated
 * embed daemon) can wire this loop in without reaching into individual
 * files. This module intentionally does not build or register a daemon tick
 * itself — replacing Oracle's daemon wiring is construct-b0nny.17's job
 * (this bead's own non-goals: "does not replace the Oracle daemon itself —
 * only proves it can be replaced").
 */

export { runDetect } from './detect.mjs';
export { requestApproval, approveAll, applyProposal, recordsForApprovalIds } from './gate.mjs';
export { verifyProposalExecution } from './verify.mjs';
export { executeDirective, workplaceLoopExecuteDirectivesEnabled } from './directive-executor.mjs';
export { loadLoopState, loadProposal, listProposals } from './state-store.mjs';
export { resolveDefaultGithubRepo } from './sources/github-source.mjs';
