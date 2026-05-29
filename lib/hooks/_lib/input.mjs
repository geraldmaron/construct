/**
 * lib/hooks/_lib/input.mjs — shared hook input parsing.
 *
 * Claude Code passes hook input as JSON on stdin. Codex and OpenCode (when
 * they ship hook support) pass via TOOL_INPUT_FILE_PATH env or argv. This
 * helper normalizes all three so a hook reads one shape regardless of the
 * host transport. Hooks should call `readHookInput()` once at startup and
 * branch on `input.tool_name` from there.
 *
 * Returns an object with at minimum `tool_name` and `tool_input` fields,
 * plus any fields present in the source payload. Empty object on parse
 * failure (the hook is then free to exit 0 silently if no useful input
 * landed — matches the existing convention).
 */

import { readFileSync } from 'node:fs';

export function readHookInput({ env = process.env, argv = process.argv } = {}) {
  const stdin = tryReadStdin();
  if (stdin) {
    const parsed = tryParseJson(stdin);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  const envPath = env.TOOL_INPUT_FILE_PATH;
  if (envPath) {
    try {
      const raw = readFileSync(envPath, 'utf8');
      const parsed = tryParseJson(raw);
      if (parsed && typeof parsed === 'object') return parsed;
      return { tool_input: { file_path: envPath } };
    } catch { /* fall through */ }
  }

  const argvJsonPos = argv.findIndex((a) => a === '--input-json');
  if (argvJsonPos >= 0 && argv[argvJsonPos + 1]) {
    const parsed = tryParseJson(argv[argvJsonPos + 1]);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  return {};
}

function tryReadStdin() {
  try { return readFileSync(0, 'utf8'); }
  catch { return null; }
}

function tryParseJson(s) {
  try { return JSON.parse(s); }
  catch { return null; }
}
