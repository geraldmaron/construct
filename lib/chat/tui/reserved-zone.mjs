/**
 * lib/chat/tui/reserved-zone.mjs — cursor-safe reserved row painting for chat TUI.
 *
 * Two conventions share these primitives. The slash palette paints above the
 * readline prompt and brackets every paint in DECSC/DECRC, so its cursor returns
 * to the prompt regardless of internal moves (abovePrompt: true). The in-turn
 * activity ticker paints into the transcript with no save/restore, so the cursor
 * must rest on the last zone row after every paint — never below it — otherwise a
 * trailing newline at the bottom of a full screen scrolls the buffer and the zone
 * walks down the screen one row per repaint. The transcript convention reserves
 * rowCount-1 newlines (the current line is the last zone row) and paints without a
 * trailing newline so position is stable across repaints and screen scrolls.
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

export function reserveZoneRows(output, rowCount, { plain = false, occupyCurrent = false } = {}) {
  if (plain || !output?.isTTY || rowCount < 1) return;
  const newlines = occupyCurrent ? rowCount - 1 : rowCount;
  if (newlines > 0) output.write('\n'.repeat(newlines));
}

// Repaint the whole zone in place. The abovePrompt path is bracketed by the
// caller's save/restore, so walking up rowCount from the prompt is safe. The
// transcript path enters on the last row, climbs rowCount-1 to the top, and writes
// rows joined by newlines with none after the last, so the cursor returns to the
// last row without ever scrolling.

export function paintZoneRows(output, rowCount, rows = [], { abovePrompt = false } = {}) {
  if (!output?.isTTY || rowCount < 1) return;
  const offset = rowCount - rows.length;

  if (abovePrompt) {
    withSavedCursor(output, () => {
      readline.moveCursor(output, 0, -rowCount);
      for (let i = 0; i < rowCount; i += 1) {
        readline.cursorTo(output, 0);
        readline.clearLine(output, 0);
        const row = i >= offset ? rows[i - offset] : '';
        if (row) output.write(row);
        if (i < rowCount - 1) output.write('\n');
      }
    });
    return;
  }

  readline.moveCursor(output, 0, -(rowCount - 1));
  for (let i = 0; i < rowCount; i += 1) {
    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);
    const row = i >= offset ? rows[i - offset] : '';
    if (row) output.write(row);
    if (i < rowCount - 1) output.write('\n');
  }
  readline.cursorTo(output, 0);
}

// Blank the zone. The transcript path then parks the cursor at the top of the
// reclaimed zone so the answer renders into the space the ticker occupied; the
// abovePrompt path is bracketed and returns to the prompt.

export function clearZoneRows(output, rowCount, { abovePrompt = false } = {}) {
  if (!output?.isTTY || rowCount < 1) return;

  if (abovePrompt) {
    withSavedCursor(output, () => {
      readline.moveCursor(output, 0, -rowCount);
      for (let i = 0; i < rowCount; i += 1) {
        readline.cursorTo(output, 0);
        readline.clearLine(output, 0);
        if (i < rowCount - 1) output.write('\n');
      }
    });
    return;
  }

  readline.moveCursor(output, 0, -(rowCount - 1));
  for (let i = 0; i < rowCount; i += 1) {
    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);
    if (i < rowCount - 1) output.write('\n');
  }
  readline.moveCursor(output, 0, -(rowCount - 1));
  readline.cursorTo(output, 0);
}
