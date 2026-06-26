/**
 * lib/chat/tui/reserved-zone.mjs — cursor-safe reserved row painting for chat TUI.
 *
 * Shared by the slash palette (above readline) and the in-turn activity ticker.
 * Uses DECSC/DECRC so readline cursor and input buffer stay intact when painting
 * above the prompt; transcript zones use move-up/clear without save cursor.
 */

import readline from 'node:readline';

export const SAVE_CURSOR = '\x1b7';
export const RESTORE_CURSOR = '\x1b8';

export function withSavedCursor(output, fn) {
  output.write(SAVE_CURSOR);
  try {
    fn();
  } finally {
    output.write(RESTORE_CURSOR);
  }
}

export function reserveZoneRows(output, rowCount, { plain = false } = {}) {
  if (plain || !output?.isTTY || rowCount < 1) return;
  output.write('\n'.repeat(rowCount));
}

export function paintZoneRows(output, rowCount, rows = [], { abovePrompt = false } = {}) {
  if (!output?.isTTY || rowCount < 1) return;
  const paint = () => {
    readline.moveCursor(output, 0, -rowCount);
    const offset = rowCount - rows.length;
    for (let i = 0; i < rowCount; i += 1) {
      readline.cursorTo(output, 0);
      readline.clearLine(output, 2);
      const row = i >= offset ? rows[i - offset] : '';
      if (row) output.write(row);
      if (i < rowCount - 1) output.write('\n');
    }
  };
  if (abovePrompt) withSavedCursor(output, paint);
  else paint();
}

export function clearZoneRows(output, rowCount, { abovePrompt = false } = {}) {
  if (!output?.isTTY || rowCount < 1) return;
  const clear = () => {
    readline.moveCursor(output, 0, -rowCount);
    for (let i = 0; i < rowCount; i += 1) {
      readline.cursorTo(output, 0);
      readline.clearLine(output, 2);
      if (i < rowCount - 1) output.write('\n');
    }
  };
  if (abovePrompt) withSavedCursor(output, clear);
  else clear();
}
