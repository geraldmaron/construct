/**
 * Validate that canonical Procedures can be executed with the installed
 * Worker Profiles and exposed entry points.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../registry/loader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');

function hasAssignmentCycle(workerProfiles) {
  const seen = new Set();
  for (const id of workerProfiles) {
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

export function checkProcedureLiveness(procedures, opts = {}) {
  const violations = [];
  const registry = loadRegistry({ rootDir: opts.packageRoot || PACKAGE_ROOT });
  const profiles = registry.workerProfiles;
  const packageRoot = opts.packageRoot || PACKAGE_ROOT;

  for (const procedure of procedures) {
    if (procedure.type === 'embed') continue;

    const label = procedure._filePath || procedure.id || '(unknown Procedure)';
    const workerProfiles = Array.isArray(procedure.workerProfiles) ? procedure.workerProfiles : [];

    for (const profileId of workerProfiles) {
      const profile = profiles[profileId];
      if (!profile) {
        violations.push(`${label}: Worker Profile '${profileId}' is not installed`);
        continue;
      }
      for (const skillId of profile.skillEmphasis || []) {
        const skillPath = join(packageRoot, 'skills', `${skillId}.md`);
        if (!existsSync(skillPath)) {
          violations.push(`${label}: Worker Profile '${profileId}' emphasizes Skill '${skillId}' with no matching file at skills/${skillId}.md`);
        }
      }
    }

    if (workerProfiles.length > 1 && hasAssignmentCycle(workerProfiles)) {
      violations.push(`${label}: workerProfiles repeats a Worker Profile (${workerProfiles.join(' -> ')})`);
    }

    const surfaces = Array.isArray(procedure.surfaces) ? procedure.surfaces : [];
    const modes = Array.isArray(procedure.modes) ? procedure.modes : [];
    if (surfaces.length === 0 || modes.length === 0) {
      violations.push(`${label}: Procedure '${procedure.id}' is unreachable — declares ${surfaces.length === 0 ? 'no surfaces' : `surfaces [${surfaces.join(', ')}]`} and ${modes.length === 0 ? 'no modes' : `modes [${modes.join(', ')}]`}`);
    }
  }

  return { violations };
}
