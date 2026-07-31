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
import { lintFile, formatResults } from '../comment-lint.mjs';
import { resolveProjectRoot } from '../roots.mjs';

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

// Every path-scoped check resolves its glob against the root it is handed, and
// the tracker prefix is read from that root's beads config. The Construct
// install answers neither question about a consumer's file: the relative path
// comes back as a `../../..` escape that no glob matches, and the install has
// no tracker of its own. Resolving from the edited file finds the project the
// file actually belongs to. Content arriving here was written by a tool call,
// so it is Construct's to keep clean — a person's own comments reach the lint
// through the CLI instead, where that claim is not made for them.

const rootDir = resolveProjectRoot(path.dirname(path.resolve(filePath)));

const result = lintFile(filePath, { rootDir, constructAuthored: true });
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
