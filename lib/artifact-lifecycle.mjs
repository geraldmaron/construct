/**
 * lib/artifact-lifecycle.mjs — cross-artifact completion handoff vocabulary.
 *
 * Surfaces a single actionable lifecycle object on authoring and publish responses
 * so callers can tell plan-only, drafted, validated, and published apart without
 * conflating procedure invoke, release-gate evidence, and export output.
 */

export const LIFECYCLE_STATES = Object.freeze([
  'planned',
  'prepared',
  'executed',
  'drafted',
  'validated',
  'published',
]);

export function isLifecycleState(state) {
  return LIFECYCLE_STATES.includes(state);
}

function compactEvidence(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value != null && value !== ''));
}

/**
 * Procedure / workflow invoke returned a plan only (proposal-only or awaiting approval).
 */
export function buildProcedurePlanLifecycle(invokePlan = {}, { artifactType = null } = {}) {
  const selected = invokePlan.selectedWorkerProfiles
    || invokePlan.selectedRoles
    || [];
  const evidence = compactEvidence({
    artifactType,
    traceId: invokePlan.traceId ?? null,
    procedureId: invokePlan.procedureId ?? null,
    procedureStatus: invokePlan.status ?? null,
    selectedWorkerProfiles: selected.length ? selected : null,
  });
  const typeHint = artifactType ? ` --type=${artifactType}` : '';
  return {
    state: 'planned',
    evidence,
    nextAction: 'Run the returned Worker Profile sequence to author the artifact; workflow invoke returns a plan only.',
    nextCommand: artifactType
      ? `author_artifact with draft_markdown or construct artifact validate <path>${typeHint} after authoring`
      : 'author_artifact with draft_markdown after running the planned Worker Profiles',
  };
}

/**
 * Inline orchestration prepared tasks without executing Worker Profile reasoning.
 */
export function buildPreparedRunLifecycle({
  runId = null,
  executionState = 'prepared',
  artifactType = null,
  traceId = null,
} = {}) {
  return {
    state: 'prepared',
    evidence: compactEvidence({
      artifactType,
      runId,
      executionState,
      traceId,
    }),
    nextAction: 'Execute the prepared Worker Profile tasks with a host or provider backend; prepared output is not authored artifact content.',
    nextCommand: runId ? `orchestration_run resume ${runId}` : 'orchestration_run',
  };
}

/**
 * Provider or host backend recorded real Worker Profile output (not artifact gate pass).
 */
export function buildExecutedRunLifecycle({
  runId = null,
  executionState = 'executed',
  artifactType = null,
  traceId = null,
} = {}) {
  return {
    state: 'executed',
    evidence: compactEvidence({
      artifactType,
      runId,
      executionState,
      traceId,
    }),
    nextAction: 'Materialize the authored markdown and run the artifact release gate before publish.',
    nextCommand: artifactType
      ? `author_artifact with type ${artifactType} and draft_markdown, then construct artifact validate`
      : 'author_artifact with draft_markdown, then construct artifact validate',
  };
}

/**
 * Author pass result from runConstructArtifactLoop or author_artifact.
 */
export function buildAuthorArtifactLifecycle({
  invokePlan = null,
  artifactType = null,
  relPath = null,
  validation = null,
  draftMissing = false,
} = {}) {
  if (draftMissing || !relPath) {
    return buildProcedurePlanLifecycle(invokePlan || {}, { artifactType });
  }

  const gatePassed = Boolean(validation?.ok);
  const rel = relPath.startsWith('/') ? relPath : relPath;
  const typeFlag = artifactType ? ` --type=${artifactType}` : '';

  if (!gatePassed) {
    return {
      state: 'drafted',
      evidence: compactEvidence({
        artifactType,
        relPath: rel,
        traceId: invokePlan?.traceId ?? null,
        procedureId: invokePlan?.procedureId ?? null,
        gate: 'FAIL',
        gateErrors: validation?.errors?.length ?? null,
      }),
      nextAction: 'Fix release gate findings, then re-run author_artifact or construct artifact validate.',
      nextCommand: `construct artifact validate ${rel}${typeFlag}`,
    };
  }

  return {
    state: 'validated',
    evidence: compactEvidence({
      artifactType,
      relPath: rel,
      traceId: invokePlan?.traceId ?? null,
      procedureId: invokePlan?.procedureId ?? null,
      gate: 'PASS',
    }),
    nextAction: 'Release gate passed; run construct publish when distributing.',
    nextCommand: `construct publish ${rel} --strict --figures`,
  };
}

/**
 * Publish pipeline terminal state.
 */
export function buildPublishLifecycle({
  ok = false,
  inputPath = null,
  outputPath = null,
  artifactType = null,
  gateBlocked = false,
} = {}) {
  const relIn = inputPath || null;
  const relOut = outputPath || null;
  const typeFlag = artifactType ? ` --type=${artifactType}` : '';

  if (ok && relOut) {
    return {
      state: 'published',
      evidence: compactEvidence({
        artifactType,
        relPath: relIn,
        exportPath: relOut,
      }),
      nextAction: 'Artifact exported; record visual review or accessibility verdicts if your gate level requires them.',
    };
  }

  if (gateBlocked && relIn) {
    return buildAuthorArtifactLifecycle({
      artifactType,
      relPath: relIn,
      validation: { ok: false },
      draftMissing: false,
    });
  }

  return {
    state: 'validated',
    evidence: compactEvidence({
      artifactType,
      relPath: relIn,
      exportPath: relOut,
    }),
    nextAction: 'Publish failed; fix export or output validation, then re-run construct publish.',
    nextCommand: relIn ? `construct publish ${relIn} --strict --figures${typeFlag}` : 'construct publish <path> --strict --figures',
  };
}

/**
 * Attach plan-only lifecycle to an invokeProcedure result without mutating inputs.
 */
export function withInvokePlanLifecycle(invokePlan, { artifactType = null } = {}) {
  if (!invokePlan || typeof invokePlan !== 'object') return invokePlan;
  return {
    ...invokePlan,
    lifecycle: buildProcedurePlanLifecycle(invokePlan, { artifactType }),
  };
}
