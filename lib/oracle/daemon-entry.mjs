/**
 * lib/oracle/daemon-entry.mjs — detached entrypoint for `construct oracle start`.
 *
 * Spawns the Oracle daemon in the background. Reads root/project overrides
 * from CONSTRUCT_ORACLE_ROOT and CONSTRUCT_ORACLE_PROJECT.
 */

import { runOracleDaemon } from './index.mjs';
import { defaultRootDir } from './actions.mjs';

const rootDir = process.env.CONSTRUCT_ORACLE_ROOT || defaultRootDir();
const projectDir = process.env.CONSTRUCT_ORACLE_PROJECT || process.cwd();

await runOracleDaemon({ rootDir, projectDir });
