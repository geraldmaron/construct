#!/usr/bin/env node
/**
 * lib/hooks/registry-sync.mjs — Registry-change reminder hook.
 *
 * PostToolUse on Write|Edit. Fires only when the edited file is
 * specialists/org/ (the construct repo) or an installed
 * agents/registry.json mirror. Emits a one-line reminder on stderr telling
 * the developer to run `construct sync` when they're ready. Does NOT
 * auto-execute sync — auto-execution during tests (which legitimately
 * mutate the registry) races test cleanup and regenerates platform state
 * mid-suite. The dev decides when to sync, the same way ordinary code
 * changes don't auto-build.
 *
 * The reminder is suppressed automatically when CI=true or NODE_ENV=test.
 * Stderr is not used as an interactivity signal: Claude Code captures hook
 * stderr rather than passing it through to a TTY, so a TTY check would
 * silently suppress the reminder in real usage. No skip env var — broaden
 * the detection here if the reminder fires in a context where it shouldn't.
 *
 * @lifecycle PostToolUse
 * @matcher  Write|Edit
 * @p95ms 50
 * @maxBlockingScope none
 * @exits 0 = pass
 */
import path from 'node:path';
import { readHookInput } from './_lib/input.mjs';

const input = readHookInput();
const filePath = input?.tool_input?.file_path || process.env.TOOL_INPUT_FILE_PATH || '';
const matchesRegistry =
  filePath.endsWith(path.join('agents', 'registry.json')) ||
  filePath.includes(`${path.sep}specialists${path.sep}org${path.sep}`);
if (!matchesRegistry) process.exit(0);

const isNonInteractive =
  process.env.CI === 'true' ||
  process.env.NODE_ENV === 'test';

if (!isNonInteractive) {
  process.stderr.write(
    `[registry-sync] registry.json changed — run \`construct sync\` to regenerate platform adapters when ready.\n`,
  );
}
process.exit(0);
