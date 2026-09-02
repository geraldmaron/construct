/**
 * cli/reset.ts — reinitialize project runtime state to format v1.
 *
 * Wipes the project sqlite and recreates it. Does not migrate. Optional
 * `--wipe-config` also replaces project.json. Requires `--yes` because it
 * destroys runtime state.
 */

import { UnsupportedAlphaStoreError } from '../kernel/state-v1/format.ts';
import { resolveProjectContext } from '../kernel/project/context.ts';
import { resetProject } from '../kernel/project/reset.ts';
import { gitRoot } from './settings-file.ts';

/**
 * `construct reset --yes [--wipe-config]`
 */
export function reset(
  argv: string[] = [],
  cwd: string = process.cwd(),
): number {
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const wipeConfig = argv.includes('--wipe-config');
  if (!confirmed) {
    process.stderr.write(
      'construct reset destroys project runtime state and does not migrate it.\n' +
        'Re-run as: construct reset --yes\n',
    );
    return 2;
  }

  const ctx = resolveProjectContext({
    gitRoot: gitRoot(cwd) ?? undefined,
    cwd,
    allowCwdFallback: true,
  });

  try {
    const result = resetProject(ctx, { wipeConfig });
    process.stdout.write(`Reset Construct state at ${result.root}\n`);
    process.stdout.write(`  state: ${result.dbPath} (created)\n`);
    if (wipeConfig) {
      process.stdout.write(`  config: ${result.configPath} (recreated)\n`);
    }
    result.store.close();
    return 0;
  } catch (error) {
    if (error instanceof UnsupportedAlphaStoreError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
