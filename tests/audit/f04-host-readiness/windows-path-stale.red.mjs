/**
 * tests/audit/f04-host-readiness/windows-path-stale.red.mjs — F04 [R8] POSIX-only stale-path proof.
 *
 * RED fixture (must FAIL against current code). mcpEntryPointsOutsideToolkit
 * (scripts/sync-specialists.mjs L1496-1503) detects a stale construct toolkit path
 * with a POSIX-slash regex (`/\/lib\/mcp\/[a-z0-9-]+\.mjs$/`) and a POSIX-separator
 * root prefix check (`!arg.startsWith(`${root}/`)`). On Windows, VS Code writes
 * backslash-separated argv (e.g. `C:\\Users\\dev\\construct\\lib\\mcp\\server.mjs`)
 * and the toolkit root is a backslash path with a drive letter. Neither the regex nor
 * the prefix check matches, so a stale Windows toolkit path is never detected: the
 * sync preserves a server entry pointing at a deleted/old checkout and VS Code
 * launches a construct-mcp that does not exist — the orchestrator gets no tools.
 *
 * Contract (CX-AUDIT-HOST-004): stale-path detection must normalize separators and
 * compare paths platform-independently. The test asserts a foreign-root Windows path
 * is flagged stale and a current-root Windows path is not. Passes once normalization
 * lands.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mcpEntryPointsOutsideToolkit } from '../../../scripts/sync-specialists.mjs';

// Backslash drive-letter paths as VS Code on Windows records them in mcp.json argv.
// CURRENT_ROOT is the toolkit the running sync resolves to; FOREIGN points at a
// different checkout that should be treated as stale and refreshed.

const CURRENT_ROOT = 'C:\\Users\\dev\\Developer\\Projects\\construct';
const FOREIGN_SERVER = 'D:\\old\\construct\\lib\\mcp\\server.mjs';
const CURRENT_SERVER = 'C:\\Users\\dev\\Developer\\Projects\\construct\\lib\\mcp\\server.mjs';

test('[R8] a foreign-root Windows toolkit path must be detected as stale', () => {
  const entry = { command: 'node', args: [FOREIGN_SERVER] };
  assert.equal(
    mcpEntryPointsOutsideToolkit(entry, CURRENT_ROOT),
    true,
    'POSIX-only regex missed a backslash/drive-letter toolkit path under a foreign root — stale entry will be preserved',
  );
});

test('[R8] a current-root Windows toolkit path must NOT be flagged stale', () => {
  const entry = { command: 'node', args: [CURRENT_SERVER] };
  assert.equal(
    mcpEntryPointsOutsideToolkit(entry, CURRENT_ROOT),
    false,
    'a server already under the current Windows toolkit root must be preserved, not rewritten every sync',
  );
});
