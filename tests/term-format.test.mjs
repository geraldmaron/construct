/**
 * tests/term-format.test.mjs — enforcer for rules/common/neurodivergent-output.md.
 *
 * Pins the presentation-layer contract from the neurodivergent-output rule:
 * human-facing terminal output must respect NO_COLOR, non-TTY pipes, TERM=dumb,
 * and narrow widths; meaning must never ride on color alone; structure must be
 * predictable. lib/term-format.mjs is the single tested place that decides
 * color and width — the assertions below resolve the rule's `enforced_by`
 * linkage in the decision registry and guard against silent regression.
 *
 * Data-layer paths — values, keys, ordering, or tokens a downstream component
 * parses — are out of scope.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  shouldUseColor,
  palette,
  resolveColors,
  termWidth,
  wrapText,
  stripAnsi,
} from '../lib/term-format.mjs';

// A non-TTY stream is the right fake for pipe / file / CI conditions: the same
// shape (no isTTY, no columns) Node hands us when stdout is redirected.

const NON_TTY = { isTTY: false };
const TTY = { isTTY: true, columns: 120 };

describe('term-format enforces rules/common/neurodivergent-output.md', () => {
  it('NO_COLOR forces plain text even on a color-capable stream (no-color.org: present + non-empty)', () => {
    assert.equal(shouldUseColor({ stream: TTY, env: { NO_COLOR: '1' } }), false);
    assert.equal(shouldUseColor({ stream: TTY, env: { NO_COLOR: 'true' } }), false);
  });

  it('TERM=dumb forces plain text', () => {
    assert.equal(shouldUseColor({ stream: TTY, env: { TERM: 'dumb' } }), false);
  });

  it('non-TTY streams (pipe / file / CI) force plain text', () => {
    assert.equal(shouldUseColor({ stream: NON_TTY, env: {} }), false);
  });

  it('caller disable wins regardless of stream capability', () => {
    assert.equal(shouldUseColor({ enabled: false, stream: TTY, env: {} }), false);
  });

  it('palette returns the full key set even when color is off — callers interpolate unconditionally', () => {
    const off = palette(false);
    const on = palette(true);
    assert.deepEqual(Object.keys(off).sort(), Object.keys(on).sort(),
      'plain-text palette must carry every key the color palette does, so format strings never see undefined');
    for (const v of Object.values(off)) assert.equal(v, '', 'plain-text palette values must be the empty string');
    for (const v of Object.values(on)) assert.ok(v.startsWith('\x1b['), 'color palette values must be ANSI escape sequences');
  });

  it('resolveColors composes shouldUseColor + palette consistently', () => {
    const off = resolveColors({ stream: NON_TTY, env: {} });
    assert.equal(off.red, '', 'non-TTY resolveColors must produce the empty palette');
    const on = resolveColors({ stream: TTY, env: {} });
    assert.ok(on.red.startsWith('\x1b['), 'TTY resolveColors must produce the color palette');
  });

  it('termWidth falls back when the stream width is unknown and caps wide terminals', () => {
    assert.equal(termWidth(NON_TTY), 80, 'non-TTY streams must fall back to the 80-column default');
    assert.equal(termWidth({ isTTY: true, columns: 300 }), 100, 'very wide terminals must cap so lines stay scannable');
    assert.equal(termWidth({ isTTY: true, columns: 90 }), 90, 'normal widths pass through under the cap');
  });

  it('wrapText respects width and never splits a single long word', () => {
    const wrapped = wrapText('the quick brown fox jumps over the lazy dog', 20);
    for (const line of wrapped.split('\n')) {
      assert.ok(line.length <= 20, `wrapped line exceeds width: "${line}"`);
    }
    const longWord = 'supercalifragilisticexpialidocious';
    const wrappedLong = wrapText(`prefix ${longWord} suffix`, 10);
    assert.ok(wrappedLong.includes(longWord), 'a word longer than width must stay intact, even if it overflows');
  });

  it('stripAnsi removes color codes so output meant for plain-text consumers is safe', () => {
    const colored = `\x1b[31mred\x1b[0m and \x1b[1mbold\x1b[0m`;
    assert.equal(stripAnsi(colored), 'red and bold');
  });
});
