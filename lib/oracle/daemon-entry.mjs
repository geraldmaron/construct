/**
 * lib/oracle/daemon-entry.mjs — detached entrypoint for `construct oracle start`.
 *
 * Spawns the Oracle daemon in the background. Reads root/project overrides
 * from CONSTRUCT_ORACLE_ROOT and CONSTRUCT_ORACLE_PROJECT.
 */

import { runOracleDaemon } from './index.mjs';
import { defaultRootDir } from './actions.mjs';
import { enableSecretAuditTrail } from '../providers/secret-audit-wiring.mjs';

const rootDir = process.env.CONSTRUCT_ORACLE_ROOT || defaultRootDir();
const projectDir = process.env.CONSTRUCT_ORACLE_PROJECT || process.cwd();

// A long-lived daemon in its own process: wire the audit sink at the entry so any
// credential resolution the tick performs is recorded on the shared trail rather than
// escaping it, matching the CLI entrypoint's own wiring.
enableSecretAuditTrail();

await runOracleDaemon({ rootDir, projectDir });
