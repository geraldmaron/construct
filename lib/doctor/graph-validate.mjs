/**
 * lib/doctor/graph-validate.mjs — doctor check that runs `graph validate` (LMCP-C7).
 *
 * Wraps lib/graph/validate.mjs's validateGraph() into the doctor check shape
 * ({ ok, label, warning, errors, warnings }) used across lib/doctor/*.mjs
 * (see project-adapters.mjs for the same contract). Read-only: this module
 * never writes to the graph store or the runtime-evidence store — it only
 * classifies what validateGraph already reports, so `construct doctor` and
 * `construct graph validate` can never disagree about whether the graph is
 * clean.
 *
 * A missing graph (no `construct graph build` run yet) is reported as a
 * warning, not a hard failure — the graph is an optional living-truth layer
 * that a fresh project has not built yet, not a broken install.
 */

import { validateGraph } from '../graph/validate.mjs';

export function checkGraphValidateForDoctor({ rootDir, strict = false, deploymentMode } = {}) {
  const result = validateGraph(rootDir, { strict, deploymentMode });
  const noGraph = result.errors.some((e) => e.startsWith('no graph found'));

  if (noGraph) {
    return {
      ok: true,
      warning: true,
      label: 'Living graph: not built yet (run `construct graph build`)',
      errors: [],
      warnings: [],
      result,
    };
  }

  const ok = result.valid;
  const label = ok
    ? `Living graph valid (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`
    : `Living graph invalid: ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} (run \`construct graph validate\`)`;

  return {
    ok,
    warning: false,
    label,
    errors: result.errors,
    warnings: result.warnings,
    result,
  };
}
