/**
 * tests/chat-markdown-render.test.mjs — chat markdown facelift contract.
 *
 * Guards the renderer contract: code fences render their content, ordered lists
 * keep their numbering, titled links keep the destination visible (Terminal.app
 * rule), and a markdown link preserves the prose around it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markdownToAnsi, ansiVisibleWidth } from '../lib/chat/tui/markdown.mjs';
import { resolveUiColors } from '../lib/ui/theme.mjs';

const COLORS = resolveUiColors({ enabled: true, stream: { isTTY: true }, env: {} });
const OPTS = { colors: COLORS, cwd: '/repo', stream: { isTTY: true }, env: {} };

function visible(s) {
  return s.replace(/\x1b\]8;;[^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*m/g, '');
}

describe('chat markdown renderer facelift', () => {
  it('renders code fences instead of omitting them', () => {
    const out = markdownToAnsi('```json\n{ "a": 1 }\n```', OPTS);
    assert.ok(visible(out).includes('{ "a": 1 }'));
    assert.ok(!out.includes('omitted from chat display'));
  });

  it('numbers ordered lists', () => {
    const out = visible(markdownToAnsi('1. first\n2. second', OPTS));
    assert.ok(out.includes('1. first'));
    assert.ok(out.includes('2. second'));
  });

  it('keeps both the title and the destination visible for a markdown link', () => {
    const out = visible(markdownToAnsi('See [setup guide](docs/x.md) here.', OPTS));
    assert.equal(out, 'See setup guide (docs/x.md) here.');
  });

  it('does not swallow surrounding prose when linkifying (regression)', () => {
    const out = visible(markdownToAnsi('Read the docs/x.md file now.', OPTS));
    assert.equal(out, 'Read the docs/x.md file now.');
  });

  it('keeps a bare url visible and clickable', () => {
    const out = markdownToAnsi('visit https://construct.dev/docs ok', OPTS);
    assert.ok(visible(out).includes('https://construct.dev/docs'));
  });
});

describe('chat markdown wraps to width without corrupting markup', () => {
  const W = 60;
  const wrapOpts = { ...OPTS, width: W };

  it('wraps a long paragraph so every visible line fits the width', () => {
    const long = 'Construct is a transparent terminal-first coding agent system you install locally that orchestrates a team of specialists to build review and operate software inside your own repository.';
    const lines = markdownToAnsi(long, wrapOpts).split('\n');
    assert.ok(lines.length > 1, 'long prose must wrap to multiple lines');
    for (const line of lines) assert.ok(ansiVisibleWidth(line) <= W, `line exceeds width: ${ansiVisibleWidth(line)}`);
  });

  it('preserves a clickable link intact across wrapping', () => {
    const md = 'Some leading prose that is long enough to force wrapping before we reach the [setup guide](docs/guides/setup.md) link near the end of the line.';
    const out = markdownToAnsi(md, wrapOpts);
    const envelopes = (out.match(/\x1b\]8;;[^\x07]*\x07/g) || []).length;
    assert.equal(envelopes, 2, 'one intact OSC-8 link (open + close) survives wrapping');
    assert.ok(out.includes('file://') && out.includes('docs/guides/setup.md'), 'link href and destination survive');
    assert.ok(visible(out).includes('setup guide'), 'link label stays visible');
  });

  it('closes and reopens bold across a wrap boundary so styling never bleeds', () => {
    const out = markdownToAnsi('xxxx **alpha beta gamma delta epsilon** yyyy', { ...OPTS, width: 30 });
    for (const line of out.split('\n')) {
      const opens = line.split('\x1b[1m').length - 1;
      const resets = line.split('\x1b[0m').length - 1;
      assert.ok(opens <= resets, 'every bold open on a line is matched by a reset');
    }
  });

  it('hangs list continuations under the text, not the marker', () => {
    const md = '- a list item long enough that it must wrap onto a second visual line for sure';
    const lines = markdownToAnsi(md, wrapOpts).split('\n');
    assert.ok(lines.length >= 2, 'bullet wraps');
    assert.ok(/^\s*•\s/.test(visible(lines[0])), 'first line carries the bullet');
    assert.ok(/^\s{2,}\S/.test(visible(lines[1])) && !visible(lines[1]).includes('•'), 'continuation is indented with no marker');
  });
});
