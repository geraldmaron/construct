/**
 * tests/ui-theme.test.mjs — contract for lib/ui/theme.mjs semantic palette.
 *
 * Confirms the CLI-wide palette respects the same accessibility gate as
 * term-format (NO_COLOR, non-TTY, TERM=dumb), exposes the semantic keys the
 * branded surfaces interpolate, and degrades a 24-bit code when the terminal
 * does not advertise truecolor so no unrenderable escape leaks (Terminal.app).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveUiColors, supportsTrueColor } from '../lib/ui/theme.mjs';

const TTY = { isTTY: true, columns: 120 };
const PIPE = { isTTY: false };

describe('lib/ui/theme.mjs palette', () => {
  it('exposes the semantic keys branded surfaces rely on', () => {
    const c = resolveUiColors({ enabled: true, stream: TTY, env: {} });
    for (const key of ['reset', 'bold', 'dim', 'link', 'highlight', 'muted', 'ok', 'warn', 'danger', 'border', 'brandAccent']) {
      assert.ok(key in c, `missing ${key}`);
    }
  });
  it('emits SGR codes on a color-capable TTY', () => {
    const c = resolveUiColors({ enabled: true, stream: TTY, env: {} });
    assert.ok(c.link.startsWith('\x1b['));
    assert.ok(c.reset === '\x1b[0m');
  });
});

describe('lib/ui/theme.mjs accessibility gate', () => {
  it('NO_COLOR forces empty fields even on a TTY', () => {
    const c = resolveUiColors({ enabled: true, stream: TTY, env: { NO_COLOR: '1' } });
    assert.equal(c.link, '');
    assert.equal(c.reset, '');
  });
  it('a non-TTY pipe forces empty fields', () => {
    const c = resolveUiColors({ enabled: true, stream: PIPE, env: {} });
    assert.equal(c.bold, '');
  });
  it('caller disable wins regardless of stream', () => {
    const c = resolveUiColors({ enabled: false, stream: TTY, env: {} });
    assert.equal(c.highlight, '');
  });
});

describe('lib/ui/theme.mjs truecolor detection', () => {
  it('reads COLORTERM for 24-bit capability', () => {
    assert.equal(supportsTrueColor({ COLORTERM: 'truecolor' }), true);
    assert.equal(supportsTrueColor({ COLORTERM: '24bit' }), true);
    assert.equal(supportsTrueColor({}), false);
    assert.equal(supportsTrueColor({ COLORTERM: '256' }), false);
  });
  it('the shipped semantic codes are basic 16-color, renderable on Terminal.app', () => {
    const c = resolveUiColors({ enabled: true, stream: TTY, env: {} });
    for (const key of ['link', 'highlight', 'ok', 'warn', 'danger', 'brandAccent']) {
      assert.ok(/^\x1b\[(?:[0-9];)?[0-9]{1,2}m$/.test(c[key]), `${key} is not a 16-color SGR: ${JSON.stringify(c[key])}`);
    }
  });
});
