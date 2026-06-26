/**
 * lib/chat/tui/slash-palette.mjs — live slash-command palette above the chat prompt.
 *
 * Paints filtered HELP rows into a reserved zone between the tip line and readline.
 * Uses DECSC/DECRC around zone writes so readline cursor and input buffer stay intact.
 * Does not call emitKeypressEvents (createInterface terminal:true already does).
 */

import { HELP } from '../commands.mjs';
import { resolveSlashCompletions } from '../command-suggest.mjs';
import {
  clearZoneRows,
  paintZoneRows,
  reserveZoneRows,
} from './reserved-zone.mjs';

export const PALETTE_ZONE_ROWS = 8;
const MAX_ROWS = PALETTE_ZONE_ROWS;
const CMD_COL = 18;

function uniqueByCmd(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const cmd = entry.cmd;
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    out.push(entry);
  }
  return out;
}

export function paletteEntries(line, ctx = {}) {
  const trimmed = String(line || '').trimStart();
  if (!trimmed.startsWith('/')) return [];

  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();

  if (parts.length > 1) {
    const argHits = resolveSlashCompletions(trimmed, ctx);
    if (argHits.length) {
      return uniqueByCmd(argHits.map((hit) => ({ cmd: hit, desc: 'argument', arg: true })));
    }
  }

  const prefix = cmd.length > 1 ? cmd : '';
  const rows = HELP
    .filter(([name]) => name.startsWith('/'))
    .filter(([name]) => {
      const base = name.split(/\s+/)[0].toLowerCase();
      return !prefix || base.startsWith(prefix);
    })
    .map(([name, desc]) => ({
      cmd: name.split(/\s+/)[0],
      desc,
      full: name,
    }));

  return uniqueByCmd(rows).slice(0, MAX_ROWS);
}

function clipPlain(text, max) {
  const plain = String(text || '');
  if (plain.length <= max) return plain;
  if (max <= 1) return plain.slice(0, max);
  return `${plain.slice(0, max - 1)}…`;
}

export function formatPaletteLine(entry, query, colors, { width = 100 } = {}) {
  const cmd = entry.cmd || entry.full || '';
  const desc = entry.desc || '';
  const active = query && cmd.toLowerCase().startsWith(query.toLowerCase());
  const cmdColor = active ? colors.highlight : colors.link;
  const descBudget = Math.max(12, width - CMD_COL - 2);
  const descText = clipPlain(desc, descBudget);
  return `  ${cmdColor}${cmd.padEnd(CMD_COL)}${colors.reset}${colors.dim}${descText}${colors.reset}`;
}

export function renderSlashPaletteLines(line, colors, ctx = {}, opts = {}) {
  const entries = paletteEntries(line, ctx);
  if (!entries.length) return [];
  const query = line.trimStart().split(/\s+/)[0] || '/';
  return entries.map((entry) => formatPaletteLine(entry, query, colors, opts));
}

export function reservePaletteZone(output, { plain = false } = {}) {
  reserveZoneRows(output, PALETTE_ZONE_ROWS, { plain });
}

function redrawPrompt(rl) {
  if (typeof rl?.prompt === 'function') {
    rl.prompt(true);
  }
}

function clearPaletteZone(output) {
  clearZoneRows(output, PALETTE_ZONE_ROWS, { abovePrompt: true });
}

function paintPaletteZone(output, rows) {
  paintZoneRows(output, PALETTE_ZONE_ROWS, rows, { abovePrompt: true });
}

export function attachSlashPalette(rl, output, colors, ctx = {}, { plain = false, width = 100 } = {}) {
  const state = { active: false };
  const input = rl.input;
  if (!input?.isTTY || plain) return state;

  const refresh = () => {
    const line = rl.line ?? '';
    if (!line.startsWith('/')) {
      if (state.active) {
        clearPaletteZone(output);
        state.active = false;
      }
      return;
    }
    const rows = renderSlashPaletteLines(line, colors, ctx, { width });
    if (!rows.length) {
      if (state.active) {
        clearPaletteZone(output);
        state.active = false;
      }
      return;
    }
    clearPaletteZone(output);
    paintPaletteZone(output, rows);
    state.active = true;
    redrawPrompt(rl);
  };

  const scheduleRefresh = () => {
    setImmediate(() => setImmediate(refresh));
  };

  input.on('keypress', (_str, key) => {
    if (key?.name === 'return' || key?.name === 'enter') {
      if (state.active) {
        clearPaletteZone(output);
        state.active = false;
      }
      return;
    }
    scheduleRefresh();
  });

  rl.on('close', () => {
    if (state.active) {
      clearPaletteZone(output);
      state.active = false;
    }
  });

  return state;
}

export function clearSlashPalette(output, state, rl = null) {
  if (state?.active) {
    clearPaletteZone(output);
    state.active = false;
  }
  if (typeof rl?.prompt === 'function') {
    rl.prompt(true);
  }
}
