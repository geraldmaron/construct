/**
 * tests/ui-links.test.mjs — contract for lib/ui/links.mjs, the shared OSC-8 layer.
 *
 * Pins the Terminal.app-safe invariant the facelift depends on: the visible label
 * of every link is always the raw path or URL, so terminals that ignore OSC-8 can
 * still Cmd-click the printed text. Also guards the enable gate (NO_COLOR, plain,
 * non-TTY) and the URL/path linkifiers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  terminalLinksEnabled,
  formatTerminalLink,
  formatPathLink,
  formatUrlLink,
  formatTitledLink,
  linkifyUrls,
  applyLinks,
} from '../lib/ui/links.mjs';

const COLORS = { link: '\x1b[94m', dim: '\x1b[2m', reset: '\x1b[0m' };
const OSC8 = '\x1b]8;;';

function stripOsc8(s) {
  return s.replace(/\x1b\]8;;[^\x07]*\x07/g, '');
}
function visible(s) {
  return stripOsc8(s).replace(/\x1b\[[0-9;]*m/g, '');
}

describe('lib/ui/links.mjs link enablement gate', () => {
  it('enables on a TTY stream', () => {
    assert.equal(terminalLinksEnabled({}, { stream: { isTTY: true } }), true);
  });
  it('enables on vscode/cursor/Windows Terminal even off-TTY', () => {
    assert.equal(terminalLinksEnabled({ TERM_PROGRAM: 'vscode' }, { stream: { isTTY: false } }), true);
    assert.equal(terminalLinksEnabled({ WT_SESSION: '1' }, { stream: { isTTY: false } }), true);
  });
  it('disables for NO_COLOR, plain, and explicit opt-out', () => {
    assert.equal(terminalLinksEnabled({ NO_COLOR: '1' }, { stream: { isTTY: true } }), false);
    assert.equal(terminalLinksEnabled({ CX_LINKS: '0' }, { stream: { isTTY: true } }), false);
    assert.equal(terminalLinksEnabled({}, { stream: { isTTY: true }, plain: true }), false);
  });
  it('disables on a plain pipe', () => {
    assert.equal(terminalLinksEnabled({}, { stream: { isTTY: false } }), false);
  });
});

describe('lib/ui/links.mjs keeps the raw target visible (Terminal.app rule)', () => {
  it('a path link shows the path, not a friendly title', () => {
    const out = formatPathLink('docs/guides/setup.md', COLORS, { enabled: true, cwd: '/repo' });
    assert.ok(out.includes(OSC8), 'emits OSC-8');
    assert.equal(visible(out), 'docs/guides/setup.md');
    assert.ok(out.includes('file:///repo/docs/guides/setup.md'), 'href is absolute file uri');
  });
  it('a url link shows the url', () => {
    const out = formatUrlLink('https://construct.dev/docs', COLORS, { enabled: true });
    assert.equal(visible(out), 'https://construct.dev/docs');
  });
  it('a titled link keeps the destination visible alongside the title', () => {
    const out = formatTitledLink('setup guide', 'file:///repo/docs/x.md', COLORS, {
      enabled: true,
      display: 'docs/x.md',
    });
    assert.equal(visible(out), 'setup guide (docs/x.md)');
  });
  it('a titled link collapses to one token when title equals destination', () => {
    const out = formatTitledLink('docs/x.md', 'file:///repo/docs/x.md', COLORS, {
      enabled: true,
      display: 'docs/x.md',
    });
    assert.equal(visible(out), 'docs/x.md');
  });
});

describe('lib/ui/links.mjs disabled fallback', () => {
  it('formatTerminalLink returns styled text with no OSC-8 when disabled', () => {
    const out = formatTerminalLink('docs/x.md', 'file:///x', COLORS, { enabled: false });
    assert.ok(!out.includes(OSC8));
    assert.equal(visible(out), 'docs/x.md');
  });
  it('applyLinks is a no-op when disabled', () => {
    const text = 'see docs/x.md and https://a.b/c';
    assert.equal(applyLinks(text, COLORS, { enabled: false }), text);
  });
});

describe('lib/ui/links.mjs linkifiers', () => {
  it('linkifyUrls wraps every http(s) url and leaves prose intact', () => {
    const out = linkifyUrls('go to https://a.b/c then http://d.e now', COLORS, { enabled: true });
    assert.equal(visible(out), 'go to https://a.b/c then http://d.e now');
    assert.equal((out.match(/\x1b\]8;;/g) || []).length, 4, 'two opens + two closes');
  });
  it('applyLinks linkifies both urls and repo paths in one pass', () => {
    const out = applyLinks('open lib/ui/links.mjs or https://x.y', COLORS, { enabled: true, cwd: '/repo' });
    assert.equal(visible(out), 'open lib/ui/links.mjs or https://x.y');
    assert.ok(out.includes('file:///repo/lib/ui/links.mjs'));
    assert.ok(out.includes('https://x.y'));
  });
});
