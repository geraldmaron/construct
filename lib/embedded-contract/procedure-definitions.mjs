/**
 * Secret-free embedded execution definitions derived from canonical Procedures.
 * `registry/procedures/` is the only built-in catalog; contributed Procedures
 * are resolved by the same loader from pack and project `procedures/` roots.
 */

import { loadAllProcedures } from '../procedures/loader.mjs';

const { procedures, errors } = loadAllProcedures();
if (errors.length > 0) {
  throw new Error(`Unable to load Procedure catalog: ${errors.join('; ')}`);
}

const DEFINITIONS = Object.fromEntries(
  procedures
    .filter((procedure) => procedure.type !== 'embed' && procedure.state !== 'removed')
    .map((procedure) => [procedure.id, {
      workerProfiles: [...procedure.workerProfiles],
      modelTier: procedure.modelTier,
      approvalMode: procedure.approvalMode,
      outputSchema: procedure.outputSchema || null,
      description: procedure.description || '',
    }]),
);

const INTAKE_TO_PROCEDURE = Object.fromEntries(
  procedures
    .filter((procedure) => procedure.intakeType && procedure.state !== 'removed')
    .map((procedure) => [procedure.intakeType, procedure.id]),
);

export const PROCEDURE_IDS = Object.freeze(Object.keys(DEFINITIONS));

export function getProcedureDefinition(id) {
  return DEFINITIONS[id] || null;
}

export function listProcedureDefinitions() {
  return Object.entries(DEFINITIONS).map(([id, definition]) => ({ id, ...definition }));
}

export function procedureIdForIntake(intakeType) {
  return INTAKE_TO_PROCEDURE[intakeType] || null;
}
