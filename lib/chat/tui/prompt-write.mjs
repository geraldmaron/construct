/**
 * lib/chat/tui/prompt-write.mjs — write transcript lines without colliding with readline.
 *
 * Readline keeps the `you ▸` prompt on the active row; transcript output must start
 * on a fresh line so status and turn blocks do not stack on the input prompt.
 */

import readline from 'node:readline';

export function detachPromptLine(output, rl) {
  if (!output?.isTTY || !rl) return;
  readline.clearLine(output, 0);
  readline.cursorTo(output, 0);
  output.write('\n');
}
