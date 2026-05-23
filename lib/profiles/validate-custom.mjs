/**
 * lib/profiles/validate-custom.mjs — Schema validator for user-defined profiles.
 *
 * Custom profiles live at `<project>/.cx/profile.json` with `custom: true`.
 * They are validated on `construct sync` and via the pre-push gate. Rejected
 * profiles never get loaded; resolveActiveProfile falls back to the default
 * so a malformed escape-hatch file never breaks a project.
 *
 * Hard limits the validator enforces (kept in sync with schemas/profile.schema.json
 * and scripts/lint-profiles.mjs):
 *   - max 12 stages
 *   - max 24 intake types
 *   - max 80 roles per profile
 *   - max 12 departments per profile
 *   - max 20 roles per department
 *   - classificationTable path must stay inside .cx/ (no repo escapes)
 *
 * Rationale for each cap lives in docs/concepts/persona-research.md.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_STAGES = 12;
const MAX_INTAKE_TYPES = 24;
const MAX_ROLES = 80;
const MAX_DEPARTMENTS = 12;
const MAX_ROLES_PER_DEPARTMENT = 20;

/**
 * @returns {string[]} array of error strings; empty means valid.
 */
export function validateCustomProfile(profile, { cwd } = {}) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return ['profile is not an object'];
  if (profile.custom !== true) errors.push('custom profiles must set custom: true');

  if (!profile.id || !/^[a-z][a-z0-9-]{1,30}$/.test(profile.id)) {
    errors.push('id must match ^[a-z][a-z0-9-]{1,30}$');
  }
  if (!profile.displayName || typeof profile.displayName !== 'string') {
    errors.push('displayName is required');
  }
  if (!Array.isArray(profile.roles) || profile.roles.length === 0) {
    errors.push('roles must be a non-empty array');
  } else if (profile.roles.length > MAX_ROLES) {
    errors.push(`roles exceeds max of ${MAX_ROLES}`);
  }
  if (!profile.intake || typeof profile.intake !== 'object') {
    errors.push('intake is required');
  } else {
    if (!Array.isArray(profile.intake.types) || profile.intake.types.length === 0) {
      errors.push('intake.types must be a non-empty array');
    } else if (profile.intake.types.length > MAX_INTAKE_TYPES) {
      errors.push(`intake.types exceeds max of ${MAX_INTAKE_TYPES}`);
    }
    if (!Array.isArray(profile.intake.stages) || profile.intake.stages.length === 0) {
      errors.push('intake.stages must be a non-empty array');
    } else if (profile.intake.stages.length > MAX_STAGES) {
      errors.push(`intake.stages exceeds max of ${MAX_STAGES}`);
    }
    if (typeof profile.intake.classificationTable === 'string') {
      const t = profile.intake.classificationTable;
      if (path.isAbsolute(t)) {
        errors.push('intake.classificationTable must be a relative path');
      } else if (cwd && !t.startsWith('.cx/')) {
        errors.push('intake.classificationTable must live under .cx/ for custom profiles');
      }
    }
  }
  if (profile.departments !== undefined) {
    if (!Array.isArray(profile.departments)) {
      errors.push('departments must be an array');
    } else {
      if (profile.departments.length > MAX_DEPARTMENTS) {
        errors.push(`departments exceeds max of ${MAX_DEPARTMENTS}`);
      }
      for (const [i, dept] of profile.departments.entries()) {
        if (!dept || typeof dept !== 'object') {
          errors.push(`departments[${i}] must be an object`);
          continue;
        }
        if (!dept.id || !/^[a-z][a-z0-9-]{1,40}$/.test(dept.id)) {
          errors.push(`departments[${i}].id is missing or malformed`);
        }
        if (!dept.charter || dept.charter.length < 20) {
          errors.push(`departments[${i}].charter must be at least 20 chars (mission statement, not a label)`);
        }
        if (!Array.isArray(dept.roles) || dept.roles.length === 0) {
          errors.push(`departments[${i}].roles must be a non-empty array`);
        } else if (dept.roles.length > MAX_ROLES_PER_DEPARTMENT) {
          errors.push(`departments[${i}].roles exceeds max of ${MAX_ROLES_PER_DEPARTMENT}`);
        }
      }
    }
  }
  return errors;
}

/**
 * Read and validate `<cwd>/.cx/profile.json`. Returns:
 *   { status: 'absent' }                 if the file does not exist
 *   { status: 'invalid', errors: [...] } if validation failed
 *   { status: 'ok', profile }            if the file is a valid custom profile
 */
export function validateCustomProfileFile(cwd) {
  const p = path.join(cwd, '.cx', 'profile.json');
  if (!fs.existsSync(p)) return { status: 'absent' };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) { return { status: 'invalid', errors: [`malformed JSON: ${err.message}`] }; }
  const errors = validateCustomProfile(raw, { cwd });
  if (errors.length > 0) return { status: 'invalid', errors };
  return { status: 'ok', profile: raw };
}
