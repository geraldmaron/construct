/**
 * lib/planning/build-work-spec.mjs — produce a Work spec from a Workspace's
 * real inputs (construct-b0nny.23 requirement 3).
 *
 * `Sources, Directives` (target-model.md concepts 2/4) have no dedicated
 * domain store yet — that consolidation is E5's job (disposition-matrix.md);
 * today's live surfaces are the pre-consolidation lib/config/source-targets.mjs
 * and lib/directives/directive-config.mjs readers lib/embed/daemon.mjs and
 * lib/graph/cli.mjs already use. buildWorkSpec reads those two plus the E2
 * Workspace domain store (lib/workspace/store.mjs, construct-b0nny.22) — the
 * only domain-model store this bead's dependency chain has available — and
 * attaches both as advisory `sourcesContext`, never as an authoritative field
 * a caller edits directly. The Work spec's own decomposition is caller-
 * supplied `input`; this module's job is scoping + the graph-checked report,
 * not generating a decomposition from those inputs.
 */

import { loadProjectConfig } from '../config/project-config.mjs';
import { resolveEffectiveSourceTargetsFromConfig } from '../config/source-targets.mjs';
import { resolveEffectiveDirectivesFromConfig } from '../directives/directive-config.mjs';
import { ensureWorkspace } from '../workspace/store.mjs';
import { createWorkSpec } from './work-spec.mjs';
import { checkDecomposition } from './decomposition-check.mjs';

function summarizeSource(target) {
  return { id: target.id, provider: target.provider };
}

function summarizeDirective(directive) {
  return { id: directive.id, provider: directive.provider, instruction: directive.instruction };
}

/**
 * Resolve the Workspace + Sources + Directives context for `rootDir` without
 * assembling a Work spec — exposed separately so a caller (or the CLI's
 * `check` subcommand) can inspect the raw inputs before committing to a
 * decomposition.
 *
 * @param {string} rootDir
 * @returns {{ workspace: object, sources: object[], directives: object[] }}
 */
export function resolveWorkspaceInputs(rootDir) {
  const workspace = ensureWorkspace(rootDir);
  const { config } = loadProjectConfig(rootDir);
  const sources = resolveEffectiveSourceTargetsFromConfig(config).map(summarizeSource);
  const directives = resolveEffectiveDirectivesFromConfig(config).map(summarizeDirective);
  return { workspace, sources, directives };
}

/**
 * Produce a Work spec scoped to `rootDir`'s Workspace, stamped with advisory
 * Sources/Directives context, and graph-checked against its own declared
 * decomposition. `input` carries the caller-authored fields (objective,
 * desiredOutcome, decomposition, ownership, dependencyRationale, ...) per
 * work-spec.mjs's schema.
 *
 * @param {string} rootDir
 * @param {object} [input]
 * @param {{ rels?: string[], maxDepth?: number }} [checkOpts]
 * @returns {object} the assembled Work spec, with `graphValidation` and
 *   `sourcesContext` attached
 */
export function buildWorkSpec(rootDir, input = {}, checkOpts = {}) {
  const { workspace, sources, directives } = resolveWorkspaceInputs(rootDir);

  const spec = createWorkSpec({ ...input, workspace: workspace.id });
  spec.sourcesContext = { sources, directives };
  spec.graphValidation = checkDecomposition(rootDir, spec, checkOpts);
  spec.state = spec.graphValidation.ok ? 'checked' : 'draft';

  return spec;
}
