/**
 * lib/oracle/daemon-entry.mjs — retired detached entrypoint for the Oracle daemon.
 *
 * No code path spawns this module (construct-b0nny.29): `construct oracle
 * start` prints a removal notice, startServices() starts no daemons, and
 * lib/legacy-cleanup.mjs kills any instance found running. The file stays
 * only until construct-b0nny.17 deletes the Oracle entity. Reads
 * root/project overrides from CONSTRUCT_ORACLE_ROOT and
 * CONSTRUCT_ORACLE_PROJECT when executed directly.
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
