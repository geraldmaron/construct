/**
 * lib/planning/work-spec.mjs — Work spec schema (target-
 * model.md concept 6 "Work Specification" / concept 7 "Plan" / concept 9
 * "Assignment"), plus the pure validate/create surface.
 *
 * A Work spec is one flat, graph-checkable object combining the *what/why*
 * (target-model.md concept 6's field list) and the *how* (concept 7's
 * decomposition/parallelization fields), scoped so it doubles as `bd create`
 * input (bead's Integration contract) — this bead does not build the
 * two-table append-only work_spec_versions/plan_versions store concept 6/7
 * describe as the eventual target; it builds the schema + graph-informed
 * check those tables will eventually persist.
 *
 * The field list mirrors this program's own bead quality-field discipline —
 * the same section headers a bead detail view prints (Objective,
 * Desired outcome, Requirements, Acceptance criteria, Dependency rationale,
 * File ownership, Graph nodes created/modified/deprecated/deleted, Expected
 * edge changes, Impacted dependents, and so on) — because a Work spec IS a
 * bead at execution time (bead requirement 1). `validateWorkSpec`/
 * `validateAssignment` never throw, returning an error-string array, mirroring
 * lib/directives/directive-config.mjs's validateDirective convention.
 */

export const ASSIGNMENT_KINDS = Object.freeze(['execute', 'review', 'critic', 'synthesis', 'integration']);
export const WORK_SPEC_STATES = Object.freeze(['draft', 'checked']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validate one Assignment (decomposition entry). Returns an array of error
 * strings, empty when valid.
 *
 * @param {object} assignment
 * @param {number} index
 * @returns {string[]}
 */
export function validateAssignment(assignment, index = 0) {
  const errors = [];
  const at = `decomposition[${index}]`;

  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
    return [`${at}: must be an object`];
  }

  if (!isNonEmptyString(assignment.id)) {
    errors.push(`${at}.id: required non-empty string, unique within the decomposition`);
  }

  if (assignment.kind !== undefined && !ASSIGNMENT_KINDS.includes(assignment.kind)) {
    errors.push(`${at}.kind: must be one of ${ASSIGNMENT_KINDS.join(', ')}`);
  }

  if (!Array.isArray(assignment.touches)) {
    errors.push(`${at}.touches: required array of graph node ids this assignment reads or mutates (may be empty)`);
  } else if (!isStringArray(assignment.touches)) {
    errors.push(`${at}.touches: every entry must be a graph node id string`);
  }

  if (assignment.dependsOn !== undefined && !isStringArray(assignment.dependsOn)) {
    errors.push(`${at}.dependsOn: must be an array of assignment id strings`);
  }

  if (!assignment.ownership || typeof assignment.ownership !== 'object') {
    errors.push(`${at}.ownership: required object with a 'files' glob array`);
  } else if (!Array.isArray(assignment.ownership.files)) {
    errors.push(`${at}.ownership.files: required array of file globs`);
  }

  return errors;
}

/**
 * Validate a full Work spec, including its decomposition. Returns an array
 * of error strings, empty when valid. Referential checks here are
 * schema-level (do dependsOn ids resolve within this spec's own
 * decomposition) — whether a declared dependency is graph-verifiable is
 * decomposition-check.mjs's job, not this module's.
 *
 * @param {object} spec
 * @returns {string[]}
 */
export function validateWorkSpec(spec) {
  const errors = [];

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['work spec: must be an object'];
  }

  if (!isNonEmptyString(spec.objective)) errors.push('objective: required non-empty string');
  if (!isNonEmptyString(spec.desiredOutcome)) errors.push('desiredOutcome: required non-empty string');
  if (!isNonEmptyString(spec.dependencyRationale)) errors.push('dependencyRationale: required non-empty string');

  if (!spec.ownership || typeof spec.ownership !== 'object') {
    errors.push('ownership: required object with a \'files\' glob array');
  } else if (!Array.isArray(spec.ownership.files)) {
    errors.push('ownership.files: required array of file globs');
  }

  if (!Array.isArray(spec.decomposition) || spec.decomposition.length === 0) {
    errors.push('decomposition: required non-empty array of Assignments');
    return errors;
  }

  const seenIds = new Set();
  spec.decomposition.forEach((assignment, index) => {
    errors.push(...validateAssignment(assignment, index));
    const id = assignment?.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) errors.push(`decomposition[${index}].id: duplicate assignment id "${id}"`);
      seenIds.add(id);
    }
  });

  spec.decomposition.forEach((assignment, index) => {
    for (const dep of assignment?.dependsOn ?? []) {
      if (!seenIds.has(dep)) {
        errors.push(`decomposition[${index}].dependsOn: references unknown assignment id "${dep}"`);
      }
      if (dep === assignment.id) {
        errors.push(`decomposition[${index}].dependsOn: an assignment cannot depend on itself ("${dep}")`);
      }
    }
  });

  if (spec.state !== undefined && !WORK_SPEC_STATES.includes(spec.state)) {
    errors.push(`state: must be one of ${WORK_SPEC_STATES.join(', ')}`);
  }

  return errors;
}

/**
 * Build a Work spec object from caller input, applying defaults for the
 * optional bead-style fields. Pure — no I/O, no graph access, no workspace
 * resolution (buildWorkSpec.mjs wires those). Does not validate; callers
 * that need validation errors call validateWorkSpec on the result.
 *
 * @param {object} input
 * @returns {object}
 */
export function createWorkSpec(input = {}) {
  return {
    id: input.id,
    workspace: input.workspace ?? null,
    title: input.title ?? '',
    objective: input.objective ?? '',
    desiredOutcome: input.desiredOutcome ?? '',
    context: input.context ?? '',
    requirements: input.requirements ?? [],
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    nonGoals: input.nonGoals ?? [],
    risks: input.risks ?? [],
    security: input.security ?? '',
    authorityRequirements: input.authorityRequirements ?? '',
    sourceEvidence: input.sourceEvidence ?? [],
    dependencyRationale: input.dependencyRationale ?? '',
    ownership: input.ownership ?? { files: [], worktree: null },
    decomposition: input.decomposition ?? [],
    impactedDependents: input.impactedDependents ?? [],
    expectedGraphChanges: input.expectedGraphChanges ?? { nodesCreated: [], nodesModified: [], nodesDeprecated: [], nodesDeleted: [], edgesExpected: [] },
    integrationContract: input.integrationContract ?? {},
    validation: input.validation ?? '',
    migration: input.migration ?? '',
    rollback: input.rollback ?? '',
    completionEvidence: input.completionEvidence ?? '',
    state: input.state ?? 'draft',
    graphValidation: input.graphValidation ?? null,
    sourcesContext: input.sourcesContext ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
