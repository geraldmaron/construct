#!/usr/bin/env node
/**
 * scripts/migrate-oracle-state.mjs — runnable wrapper over
 * lib/oracle/migrate-state.mjs's migrateOracleState (construct-b0nny.17,
 * requirement 6).
 *
 * Reconciles a project's retired `.construct/oracle/` state into the E5
 * workplace-loop archive and the surviving overseer's observation memory,
 * non-destructively and idempotently. Prints a JSON summary. Pass --dry-run to
 * compute the plan without writing. CONSTRUCT_ORACLE_MIGRATE_PROJECT overrides
 * the project dir; CONSTRUCT_ORACLE_MIGRATE_ROOT overrides the state root
 * (defaults to the project dir).
 */

import { migrateOracleState } from '../lib/oracle/migrate-state.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectDir = process.env.CONSTRUCT_ORACLE_MIGRATE_PROJECT || process.cwd();
const rootDir = process.env.CONSTRUCT_ORACLE_MIGRATE_ROOT || projectDir;

const result = await migrateOracleState({ projectDir, rootDir, dryRun });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(0);
