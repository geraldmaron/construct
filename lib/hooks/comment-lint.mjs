#!/usr/bin/env node
/**
 * lib/hooks/comment-lint.mjs — PostToolUse hook: enforce the comment policy at write time.
 *
 * Runs after Write/Edit/MultiEdit on scoped paths. Blocks the edit (exit 2)
 * if the file violates the policy — missing required header, banned patterns,
 * narrative voice, point-in-time notes, noise sentinels. The agent sees the
 * block reason and is expected to fix the comment before continuing.
 *
 * No bypass. If the policy fires on a legitimate comment, the policy is wrong
 * — fix the policy in lib/comment-lint.mjs, not the call site.
 *
 * Input: reads tool_input.file_path from either the legacy TOOL_INPUT_FILE_PATH
 * env var or modern stdin JSON ({ tool_input: { file_path } }).
 *
 * @lifecycle PostToolUse
 * @matcher  Write|Edit|MultiEdit
 * @p95ms 60
 * @maxBlockingScope PostToolUse
 * @exits 0 = pass | 2 = block tool call
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFile, formatResults } from '../comment-lint.mjs';

let filePath = process.env.TOOL_INPUT_FILE_PATH;
if (!filePath) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    filePath = input?.tool_input?.file_path || input?.tool_input?.path;
  } catch {}
}
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();
if (!['.mjs', '.md', '.sh', '.js'].includes(ext)) process.exit(0);

const rootDir = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

const result = lintFile(filePath, { rootDir });
if (!result.errors.length && !result.warnings.length) process.exit(0);

// Artifact-prose violations are advisory at write-time (no-fabrication policy
// enforces them at CI/release-gate time via CONSTRUCT_ARTIFACT_LINT_MODE=block).
// Surface them on stderr but do not block the edit.
const artifactOnly = (
  result.errors.length === 0 &&
  result.warnings.every((w) => w.kind === 'artifact')
);

const { output } = formatResults([result]);
process.stderr.write(output);

if (artifactOnly) {
  process.stderr.write(
    '\nArtifact-lint advisory (no-fabrication). The edit is not blocked, but these will fail the release gate. Fix before push.\n',
  );
  process.exit(0);
}

process.stderr.write(
  '\nComment policy blocked this edit. Remove the violations before continuing.\n',
);
process.exit(2);
