/**
 * tests/kernel/render/terminal.test.ts — the terminal boundary's own rule.
 *
 * What is held here: every byte a terminal reads as a command comes out
 * visible, the two a printed layout needs come out intact, and text carrying
 * neither is returned unchanged so Construct's own lines are never reshaped by
 * passing through.
 *
 * Every control character is built from its codepoint rather than typed into
 * the source. A test whose subject is invisible bytes must not keep them as
 * invisible bytes of its own, where one dropped in an edit leaves the test
 * passing over text that no longer carries what it names.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeForTerminal } from '../../../src/kernel/render/terminal.ts';

const ESC = String.fromCodePoint(0x1b);
/** The eight-bit CSI and OSC: introducers that are not U+001B. */
const CSI_8BIT = String.fromCodePoint(0x9b);
const OSC_8BIT = String.fromCodePoint(0x9d);
const BEL = String.fromCodePoint(0x07);
const BACKSPACE = String.fromCodePoint(0x08);
const DEL = String.fromCodePoint(0x7f);

test('text with nothing a terminal reads as a command comes back unchanged', () => {
  assert.equal(escapeForTerminal('the pilot ships in Q4'), 'the pilot ships in Q4');
  assert.equal(escapeForTerminal('## What Construct makes of this'), '## What Construct makes of this');
  assert.equal(escapeForTerminal('émigré — «quoted» 🚩'), 'émigré — «quoted» 🚩');
});

test('newline and tab survive, because a printed layout is made of them', () => {
  assert.equal(escapeForTerminal('one\ntwo\n\tthree'), 'one\ntwo\n\tthree');
});

test('an escape sequence comes out readable instead of executable', () => {
  const coloured = escapeForTerminal(`${ESC}[31mred${ESC}[0m`);
  assert.ok(!coloured.includes(ESC));
  assert.equal(coloured, '\\x1b[31mred\\x1b[0m');

  // Cursor-up then erase-line: the pair that rewrites the line already printed.
  const overwrite = escapeForTerminal(`safe${ESC}[1A${ESC}[2Kforged`);
  assert.ok(!overwrite.includes(ESC));
  assert.equal(overwrite, 'safe\\x1b[1A\\x1b[2Kforged');

  // OSC 8: words that link somewhere they do not name.
  const link = escapeForTerminal(`${ESC}]8;;https://example.invalid${ESC}\\click${ESC}]8;;${ESC}\\`);
  assert.ok(!link.includes(ESC));
  assert.match(link, /^\\x1b\]8;;https:\/\/example\.invalid\\x1b/);
});

test('carriage return is neutralized, because overwriting a printed line is the cheapest forgery', () => {
  const escaped = escapeForTerminal('all claims supported\rall claims refused');
  assert.ok(!escaped.includes('\r'));
  assert.equal(escaped, 'all claims supported\\rall claims refused');
});

test('the whole control range is covered, C1 and delete included', () => {
  assert.equal(escapeForTerminal(`${CSI_8BIT}31m`), '\\x9b31m');
  assert.equal(escapeForTerminal(`${OSC_8BIT}8;;x`), '\\x9d8;;x');
  assert.equal(escapeForTerminal(`back${BACKSPACE}space`), 'back\\x08space');
  assert.equal(escapeForTerminal(`del${DEL}`), 'del\\x7f');
  assert.equal(escapeForTerminal(`bell${BEL}`), 'bell\\x07');
  for (let code = 0; code <= 0x9f; code += 1) {
    if (code === 0x0a || code === 0x09) continue;
    if (code > 0x1f && code < 0x7f) continue;
    const character = String.fromCodePoint(code);
    const out = escapeForTerminal(character);
    assert.ok(!out.includes(character), `codepoint ${code.toString(16)} reached the output as itself`);
  }
});
