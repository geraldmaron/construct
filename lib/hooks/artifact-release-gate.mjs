#!/usr/bin/env node
/**
 * lib/hooks/artifact-release-gate.mjs — PostToolUse advisory structure/visual gate for typed docs.
 *
 * Runs after Write/Edit/MultiEdit on docs/** and .construct/research/** markdown artifacts.
 * Surfaces manifest structure and visual violations on stderr during drafting; does not
 * block the edit (full release gate runs via `construct artifact validate` and CI).
 *
 * Notice-only: suppressed when stderr is not a TTY, CI=true, or NODE_ENV=test.
 *
 * @lifecycle PostToolUse
 * @matcher  Write|Edit|MultiEdit
 * @p95ms 80
 * @maxBlockingScope none (PostToolUse, non-blocking)
 * @exits 0 = pass
 */

import { readFileSync } from 'node:fs';
import { checkArtifactGateNotice, formatArtifactGateNotice } from '../artifact-gate-notice.mjs';

function shouldEmitNotice() {
  if (process.env.CI === 'true') return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (!process.stderr.isTTY) return false;
  return true;
}

let filePath = process.env.TOOL_INPUT_FILE_PATH;
let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!filePath) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    filePath = input?.tool_input?.file_path || input?.tool_input?.path;
    if (input?.cwd) cwd = input.cwd;
  } catch { /* no stdin */ }
}
if (!filePath) process.exit(0);

const result = checkArtifactGateNotice(filePath, { cwd });
if (!result || !shouldEmitNotice()) process.exit(0);

process.stderr.write(formatArtifactGateNotice(result));
process.exit(0);
