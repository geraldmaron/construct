/**
 * lib/reconcile/gitignore-coverage.mjs — repair a project `.gitignore` that
 * predates the full Construct ignore set (ADR-0027 §1).
 *
 * The init writer seeds every machine-specific, sync-regenerated artifact into
 * `.gitignore` so adapter dirs, the launcher, and runtime state never enter
 * source control. A project initialized before a pattern was added carries a
 * partial set; this task appends the missing patterns under the same comment
 * header the init writer uses, leaving all user-authored lines untouched.
 *
 * Scope: a Construct project directory (cwd has `.cx/` or `.construct/`) that
 * already has a `.gitignore`. Absent either, there is nothing to repair — init
 * owns creation. Safety: `auto`. detect() reads only; apply() appends and is
 * idempotent because missingIgnorePatterns() drains to empty once the patterns
 * are present.
 */

import fs from 'node:fs';
import path from 'node:path';

import { missingIgnorePatterns, isConstructPackageRepo } from '../host-disposition.mjs';
import { PROJECT_MARKERS } from '../config-dir.mjs';

const HEADER = '# Construct — generated adapters, launcher, and runtime state.';
const SUBHEADER = '# Machine-specific, recreated by `construct sync`; never source (ADR-0027).';

function isConstructProject(dir) {
  return PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
}

function gitignorePath(dir) {
  return path.join(dir, '.gitignore');
}

async function detect() {
  const dir = process.cwd();
  if (!isConstructProject(dir)) {
    return { needsRepair: false, summary: 'Not a Construct project directory.' };
  }
  if (isConstructPackageRepo(dir)) {
    return { needsRepair: false, summary: 'Construct package repo — .construct/ holds shipped templates, not a staged launcher.' };
  }
  const giPath = gitignorePath(dir);
  if (!fs.existsSync(giPath)) {
    return { needsRepair: false, summary: 'No .gitignore present (init owns creation).' };
  }
  let content = '';
  try {
    content = fs.readFileSync(giPath, 'utf8');
  } catch (err) {
    return { needsRepair: false, summary: `Could not read .gitignore: ${err.message}` };
  }
  const missing = missingIgnorePatterns(content);
  if (missing.length === 0) {
    return { needsRepair: false, summary: '.gitignore covers the full Construct ignore set.' };
  }
  return {
    needsRepair: true,
    summary: `${missing.length} Construct ignore pattern${missing.length === 1 ? '' : 's'} missing from .gitignore.`,
    details: { missing },
  };
}

async function apply() {
  const dir = process.cwd();
  const giPath = gitignorePath(dir);
  if (!fs.existsSync(giPath)) return { summary: 'No .gitignore to repair.' };
  const existing = fs.readFileSync(giPath, 'utf8');
  const missing = missingIgnorePatterns(existing);
  if (missing.length === 0) return { summary: 'Already covered.' };

  // Mirror the init writer's separator and header so forward-fix and
  // backward-repair produce byte-identical blocks.

  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const block = `${prefix}\n${HEADER}\n${SUBHEADER}\n${missing.join('\n')}\n`;
  fs.writeFileSync(giPath, existing + block, 'utf8');
  return {
    summary: `Appended ${missing.length} Construct ignore pattern${missing.length === 1 ? '' : 's'} to .gitignore.`,
  };
}

export default {
  id: 'gitignore-coverage',
  description: 'Append missing Construct ignore patterns to a project .gitignore that predates the full set.',
  safety: 'auto',
  detect,
  apply,
};
