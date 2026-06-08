/**
 * lib/reconcile/legacy-guide-decommit.mjs — relocate a legacy root-level
 * construct_guide.md into the ignored .cx/ tree (ADR-0027 §1 backward-repair).
 *
 * An earlier `construct init` copied the "Welcome to Construct" orientation guide
 * to the host repo root, where it reads as project content and is git-eligible.
 * The canonical home is `.cx/construct_guide.md` (ignored). This task ensures the
 * content survives under .cx/ and removes the root copy; when the root copy was
 * committed, the summary names the `git rm --cached` follow-up (the reconcile
 * framework runs no git on the host).
 *
 * Safety: `ask` — editing the working tree of a possibly-committed file requires
 * explicit consent, so the auto sync path skips this task; only
 * `construct sync --reconcile=<id>` applies it. detect() reads only; apply() is
 * idempotent: a moved guide leaves no root-level file for the next detect().
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_NAME = 'construct_guide.md';

function paths() {
  const dir = process.cwd();
  return {
    root: path.join(dir, ROOT_NAME),
    dest: path.join(dir, '.cx', ROOT_NAME),
  };
}

async function detect() {
  const { root } = paths();
  if (!fs.existsSync(root)) {
    return { needsRepair: false, summary: 'No root-level construct_guide.md.' };
  }
  return {
    needsRepair: true,
    summary: 'Root-level construct_guide.md presents Construct tooling as project content; relocate to .cx/ (ignored).',
    details: { path: ROOT_NAME },
  };
}

async function apply() {
  const { root, dest } = paths();
  if (!fs.existsSync(root)) return { summary: 'Nothing to relocate.' };

  // Preserve content under the ignored canonical home, then drop the root copy.
  // An existing .cx/ guide is the canonical one and is left intact.

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(root, dest);
  }
  fs.rmSync(root);

  return {
    summary: `Relocated ${ROOT_NAME} to .cx/${ROOT_NAME} (ignored). If it was committed, run: git rm --cached ${ROOT_NAME}`,
  };
}

export default {
  id: 'legacy-guide-decommit',
  description: 'Relocate a legacy root-level construct_guide.md into the ignored .cx/ tree.',
  safety: 'ask',
  detect,
  apply,
};
