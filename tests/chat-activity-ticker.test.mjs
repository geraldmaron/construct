/**
 * tests/chat-activity-ticker.test.mjs — in-turn activity zone footprint contract.
 *
 * Reproduces the flooding regression where the reserved zone walked down a full,
 * scrolling screen one row per repaint. Drives the ticker against a fixed-height
 * scrolling pseudo-terminal and pins the invariants: a live zone shows at most one
 * tool row, spinner repaints never scroll the buffer, mid-turn permanent lines land
 * above a clean zone, and finish reclaims the zone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createActivityTicker } from '../lib/chat/tui/activity-ticker.mjs';
import { resolveUiColors } from '../lib/ui/theme.mjs';

// Minimal fixed-height scrolling VT: a newline on the last row scrolls the buffer
// (the real Terminal.app/Ghostty behavior), and CSI cursor moves are clamped.
class ScreenVT {
  constructor(cols = 120, rows = 12) {
    this.isTTY = true; this.columns = cols; this.rows = rows;
    this.H = rows; this.row = rows - 1; this.col = 0;
    this.buf = Array.from({ length: rows }, () => ''); this.scrolls = 0;
  }
  nl() { if (this.row >= this.H - 1) { this.buf.shift(); this.buf.push(''); this.scrolls++; } else this.row++; this.col = 0; }
  put(ch) { const l = this.buf[this.row] || ''; this.buf[this.row] = l.padEnd(this.col, ' ').slice(0, this.col) + ch + l.slice(this.col + 1); this.col++; }
  write(s) {
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\x1b') {
        const csi = s.slice(i).match(/^\x1b\[(\d*)([ABCDGKJ])/);
        if (csi) {
          const n = csi[1] === '' ? 1 : parseInt(csi[1], 10);
          if (csi[2] === 'A') this.row = Math.max(0, this.row - n);
          else if (csi[2] === 'B') this.row = Math.min(this.H - 1, this.row + n);
          else if (csi[2] === 'G') this.col = Math.max(0, (csi[1] === '' ? 1 : n) - 1);
          else if (csi[2] === 'K') this.buf[this.row] = (this.buf[this.row] || '').slice(0, this.col);
          i += csi[0].length - 1; continue;
        }
        const osc = s.slice(i).match(/^\x1b\]8;;[^\x07]*\x07/); if (osc) { i += osc[0].length - 1; continue; }
        const sgr = s.slice(i).match(/^\x1b\[[0-9;]*m/); if (sgr) { i += sgr[0].length - 1; continue; }
        if (s[i + 1] === '7' || s[i + 1] === '8') { i += 1; continue; }
        continue;
      }
      if (c === '\n') { this.nl(); continue; }
      if (c === '\r') { this.col = 0; continue; }
      this.put(c);
    }
    return true;
  }
  arrowRows() { return this.buf.filter((l) => l.includes('▸')).length; }
  text() { return this.buf.join('\n').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); }
}

function fullScreen(vt) {
  for (let k = 0; k < vt.H - 1; k += 1) vt.write(`transcript line ${k}\n`);
}

function newTicker(vt) {
  const colors = resolveUiColors({ enabled: true, stream: vt, env: {} });
  return createActivityTicker(vt, colors, { plain: false, width: vt.columns, env: { TERM_PROGRAM: 'ghostty' } });
}

describe('activity ticker reserved-zone footprint', () => {
  it('does not stack tool rows when repainting on a full, scrolling screen', () => {
    const vt = new ScreenVT(120, 12);
    fullScreen(vt);
    const ticker = newTicker(vt);
    ticker.begin();
    ticker.onToolCall({ title: 'read', input: { path: 'README.md' } });
    ticker.onToolDone({ title: 'read', input: { path: 'README.md' } }, 'read');
    const scrollsBefore = vt.scrolls;
    for (let s = 0; s < 40; s += 1) ticker.setPhase('tools');
    assert.equal(vt.scrolls - scrollsBefore, 0, '40 spinner repaints must cause zero scrolls');
    assert.ok(vt.arrowRows() <= 1, `live zone must show at most one tool row, saw ${vt.arrowRows()}`);
  });

  it('keeps a mid-turn permanent line above a clean single-row zone', () => {
    const vt = new ScreenVT(120, 14);
    fullScreen(vt);
    const ticker = newTicker(vt);
    ticker.begin();
    ticker.onToolCall({ title: 'read', input: { path: 'README.md' } });
    ticker.onToolDone({ title: 'read', input: { path: 'README.md' } }, 'read');
    ticker.emit('[plan]\n  > do the thing');
    for (let s = 0; s < 6; s += 1) ticker.setPhase('tools');
    const screen = vt.text();
    assert.ok(screen.includes('[plan]'), 'plan line persists in the transcript');
    assert.ok(screen.includes('do the thing'), 'plan entry persists');
    assert.ok(vt.arrowRows() <= 1, 'zone stays a single live row after a mid-turn emit');
  });

  it('reclaims the zone on finish', () => {
    const vt = new ScreenVT(120, 12);
    fullScreen(vt);
    const ticker = newTicker(vt);
    ticker.begin();
    ticker.onToolCall({ title: 'glob', input: { pattern: '**/*.md' } });
    ticker.onToolDone({ title: 'glob', input: { pattern: '**/*.md' } }, 'glob');
    for (let s = 0; s < 5; s += 1) ticker.setPhase('tools');
    ticker.finish();
    assert.equal(vt.arrowRows(), 0, 'finish blanks the live zone');
  });
});
