/**
 * lib/install/first-run-checklist.mjs — numbered next-steps for install/postinstall surfaces.
 *
 * Canonical doc paths are stable repo-relative paths checked by docs:verify.
 * Context variants tune ordering for global npm postinstall, project postinstall,
 * install dry-run previews, and completed machine-scope setup.
 */

export const INSTALL_GUIDE_DOC = 'docs/guides/start/install.mdx';
export const FIRST_TASK_GUIDE_DOC = 'docs/guides/start/first-task.mdx';

const DOC_FOOTER = `Docs: ${INSTALL_GUIDE_DOC} · ${FIRST_TASK_GUIDE_DOC}`;

/**
 * @param {{ context?: 'install-complete'|'install-dry-run'|'project-postinstall'|'global-postinstall'|'project-footprint' }} [opts]
 * @returns {string}
 */
export function formatFirstRunChecklist({ context = 'install-complete' } = {}) {
  const lines = ['Next steps:'];

  if (context === 'global-postinstall') {
    lines.push('  1. Run `construct install --footprint=user` — machine-scope config and global adapters');
    lines.push(`  2. In your project: \`construct init\` — scaffold adapters and docs/ (${FIRST_TASK_GUIDE_DOC})`);
    lines.push('  3. Run `construct doctor` — verify installation health');
    lines.push('  4. Run `construct sync --with-<host>` — add another editor, or `construct sync` to refresh adapters for hosts detected on this machine');
  } else if (context === 'project-postinstall') {
    lines.push(`  1. Run \`construct init\` — finish scaffolding if needed (${FIRST_TASK_GUIDE_DOC})`);
    lines.push('  2. Run `construct doctor` — verify installation health');
    lines.push('  3. Run `construct workspace-preset list` then `apply <id>` — pick workspace-wide defaults');
    lines.push('  4. Run `construct sync --with-<host>` — add another editor, or `construct sync` to refresh adapters for hosts detected on this machine');
  } else if (context === 'project-footprint') {
    lines.push(`  1. In your repo: \`construct init\` — project scaffolding (${FIRST_TASK_GUIDE_DOC})`);
    lines.push('  2. Run `construct install --footprint=user` — machine-scope config on this account');
    lines.push('  3. Run `construct doctor` — verify installation health');
    lines.push('  4. Run `construct sync --with-<host>` — add another editor, or `construct sync` to refresh adapters for hosts detected on this machine');
  } else if (context === 'install-dry-run') {
    lines.push(`  1. In your project: \`construct init\` — scaffold adapters and docs/ (${FIRST_TASK_GUIDE_DOC})`);
    lines.push('  2. Run `construct doctor` — verify installation health');
    lines.push('  3. Run `construct sync --with-<host>` — add another editor, or `construct sync` to refresh adapters for hosts detected on this machine');
    lines.push('  4. Run `construct workspace-preset list` then `apply <id>` — pick workspace-wide defaults');
  } else {
    lines.push(`  1. In your project: \`construct init\` — scaffold adapters and docs/ (${FIRST_TASK_GUIDE_DOC})`);
    lines.push('  2. Run `construct doctor` — verify installation health');
    lines.push('  3. Run `construct sync --with-<host>` — add another editor, or `construct sync` to refresh adapters for hosts detected on this machine');
    lines.push('  4. Run `construct workspace-preset list` then `apply <id>` — pick workspace-wide defaults');
  }

  lines.push(`  ${DOC_FOOTER}`);
  return lines.join('\n');
}

/**
 * @param {'install-complete'|'install-dry-run'|'project-postinstall'|'global-postinstall'|'project-footprint'} context
 * @param {(line: string) => void} [println]
 */
export function printFirstRunChecklist(context, println = console.log) {
  println('');
  println(formatFirstRunChecklist({ context }));
}
