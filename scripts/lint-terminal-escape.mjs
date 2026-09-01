#!/usr/bin/env node
/**
 * lint-terminal-escape.mjs — a print site under src/cli/ does not get to skip
 * escapeForTerminal (src/kernel/render/terminal.ts). Every one of that
 * function's ~140 real call sites was checked by hand when the terminal
 * boundary was built; nothing stopped call site 141 from leaving a field out.
 *
 * The check is a known-field heuristic, not data-flow analysis: KNOWN_FIELDS
 * is property names whose every appearance in a src/cli/index.ts write call,
 * at the time this lint was written, was already escaped — no exceptions, so
 * adding the name here cannot make the current tree fail. A property access
 * to one of those names, found in printed-value position inside a
 * `process.stdout.write(...)` / `process.stderr.write(...)` call under
 * src/cli/ and not itself inside an escapeForTerminal(...) call, is a
 * model-derived field with nothing between it and the reader's screen.
 *
 * The list is deliberately shorter than "every property terminal.ts's
 * callers ever pass it" (the header of an earlier draft of this file listed
 * ~40; several had to come back out). This codebase reuses ordinary words —
 * `detail`, `reason`, `outcome`, `message`, `label`, `question`, `locator`,
 * `source`, `text` — for two different things: model- or host-derived prose
 * (needs escaping) and Construct's own closed vocabulary or the operator's
 * own CLI input (`args.question`, a source's declared `--locator`, a cleanup
 * item's `label`, a work-log `action`) — printed bare on purpose. A
 * property-name lint cannot see which object it landed on, so a name used
 * for both is worse than useless: it would fail the clean tree the day it
 * was added. Every name actually in KNOWN_FIELDS was checked against every
 * write call in src/cli/index.ts and had no bare counterexample. A name that
 * starts carrying model text and needs this lint's protection is added here
 * only once every current bare use of it has been confirmed safe or fixed —
 * the same bar GLOSSARY.md's retired-term list holds new entries to.
 *
 * `(x as Error).message` was tried and dropped as a further pattern: a cast
 * to `Error` looked like a reliable tell that a catch site does not
 * statically know what it caught, until checking every call site found it
 * escaped at barely half of them and bare at the rest, with no textual
 * feature telling the two apart. That split is a real, separate finding —
 * left for whoever owns that call graph, not papered over with a heuristic
 * this lint cannot back up on the current tree.
 *
 * A property access only counts if it can actually reach the reader. Inside a
 * call that builds its text with template literals, that means sitting
 * inside one's `${...}` substitution (printed-value position) rather than in
 * a condition guarding whether that branch runs at all —
 * `flag.wording.length > 0 ? ...escapeForTerminal(flag.wording)... : ''` reads
 * `flag.wording` twice, and only the second is content; templateSubSpans
 * finds every substitution, recursively, since one can nest another template
 * inside it. A call with no template literal anywhere has no such
 * condition/branch shape to rule out, so every property access in it counts
 * outright — otherwise the plainest possible new print site,
 * `process.stdout.write(result.claim)`, would slip past unseen. matchBracket
 * finds the matching close for the write call itself and for every
 * escapeForTerminal(...) inside it. Real bracket matching earns its keep
 * here — these calls nest (`escapeForTerminal((error as Error).message)`)
 * and often run several lines as concatenated template literals — so string
 * and template-literal text (with substitutions recursing back into code)
 * and comments are walked without contributing their own bracket characters,
 * and a stray paren inside a quoted message never miscounts the depth.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SCOPE = 'src/cli/';

const KNOWN_FIELDS = [
  'answer',
  'body',
  'change',
  'citation',
  'claim',
  'concern',
  'document',
  'gap',
  'lesson',
  'namerFailure',
  'namerRetriedAfter',
  'quote',
  'record',
  'remediation',
  'restated',
  'retriedAfter',
  'signals',
  'stance',
  'summary',
  'underspecified',
  'unverifiedSupport',
  'value',
  'wording',
];

const FIELD_RE = new RegExp(`\\.(?:${KNOWN_FIELDS.join('|')})\\b`, 'g');
const WRITE_CALLS = ['process.stdout.write(', 'process.stderr.write('];
const ESCAPE_CALL = 'escapeForTerminal(';
const BRACKET_CLOSER = { '(': ')', '[': ']', '{': '}' };

/**
 * Index of the closing bracket matching the opener at text[openIdx] — one of
 * `( [ {` — scanning as source code: string and template literals (template
 * substitutions recurse back into code) and comments never contribute their
 * own bracket characters to the count.
 */
function matchBracket(text, openIdx) {
  const closer = BRACKET_CLOSER[text[openIdx]];
  let i = openIdx + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === closer) return i;
    if (ch === '(' || ch === '[' || ch === '{') {
      i = matchBracket(text, i) + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = skipQuoted(text, i) + 1;
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(text, i, null) + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    i += 1;
  }
  return text.length;
}

/** Index of the closing quote matching text[openIdx] (a ' or "). */
function skipQuoted(text, openIdx) {
  const quote = text[openIdx];
  let i = openIdx + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i;
    i += 1;
  }
  return text.length;
}

/**
 * Index of the closing backtick matching text[openIdx]. A `${` inside is a
 * template substitution — printed-value position, not literal text — so its
 * inner span [start, end) of code is pushed onto `subSpans` (when given) and
 * walked recursively for any template literal nested inside it, before
 * scanning resumes as template text after the matching `}`.
 */
function skipTemplate(text, openIdx, subSpans) {
  let i = openIdx + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '`') return i;
    if (text[i] === '$' && text[i + 1] === '{') {
      const innerStart = i + 2;
      const closeBrace = matchBracket(text, i + 1);
      if (subSpans) {
        subSpans.push([innerStart, closeBrace]);
        collectNestedTemplates(text, innerStart, closeBrace, subSpans);
      }
      i = closeBrace + 1;
      continue;
    }
    i += 1;
  }
  return text.length;
}

/** Template literals nested inside the code span [from, to) — recurses via skipTemplate. */
function collectNestedTemplates(text, from, to, subSpans) {
  let i = from;
  while (i < to) {
    const ch = text[i];
    if (ch === '`') {
      i = skipTemplate(text, i, subSpans) + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = skipQuoted(text, i) + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 || nl > to ? to : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 || end > to ? to : end + 2;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      i = matchBracket(text, i) + 1;
      continue;
    }
    i += 1;
  }
}

/** Every `${...}` substitution's inner [start, end) span in `text`, at any nesting depth. */
function templateSubSpans(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      i = skipTemplate(text, i, spans) + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = skipQuoted(text, i) + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    i += 1;
  }
  return spans;
}

/** Every escapeForTerminal(...) span in `text`, as [start, end) character offsets. */
function escapeSpans(text) {
  const spans = [];
  let i = 0;
  while (true) {
    const at = text.indexOf(ESCAPE_CALL, i);
    if (at === -1) break;
    const openParen = at + ESCAPE_CALL.length - 1;
    const close = matchBracket(text, openParen);
    spans.push([at, close + 1]);
    i = close + 1;
  }
  return spans;
}

/**
 * Every KNOWN_FIELDS property access in printed-value position inside a
 * process.stdout.write(...) / process.stderr.write(...) call in `text`, that
 * no escapeForTerminal(...) span covers — a model-derived field reaching the
 * terminal with nothing standing between it and the reader's screen.
 */
export function violationsIn(relPath, text) {
  const violations = [];
  for (const call of WRITE_CALLS) {
    let i = 0;
    while (true) {
      const at = text.indexOf(call, i);
      if (at === -1) break;
      const openParen = at + call.length - 1;
      const close = matchBracket(text, openParen);
      const argText = text.slice(openParen + 1, close);
      const escaped = escapeSpans(argText);
      const substitutions = templateSubSpans(argText);
      // A call with no template literal at all has no condition/branch shape
      // to worry about — string concatenation and a bare property access are
      // both printed-value position outright. A call that does use template
      // literals relies on `substitutions` instead, so a ternary's condition
      // (bare code before the branches, never itself printed) stays excluded.
      const noTemplateLiteral = !argText.includes('`');
      FIELD_RE.lastIndex = 0;
      let m;
      while ((m = FIELD_RE.exec(argText))) {
        const inPrintedPosition =
          noTemplateLiteral || substitutions.some(([s, e]) => m.index >= s && m.index < e);
        if (!inPrintedPosition) continue;
        const coveredByEscape = escaped.some(([s, e]) => m.index >= s && m.index < e);
        if (coveredByEscape) continue;
        const field = m[0].slice(1);
        const absoluteIndex = openParen + 1 + m.index;
        const line = text.slice(0, absoluteIndex).split('\n').length;
        violations.push({ relPath, line, field });
      }
      i = close + 1;
    }
  }
  return violations;
}

/**
 * Every tracked-or-untracked-but-not-ignored .ts file under SCOPE — plain
 * `git ls-files` alone leaves a brand-new file invisible until `git add`,
 * which is exactly the gap `lint-glossary-parity.mjs` was fixed for and
 * exactly the gap this lint exists to close for a new print site.
 */
function lintableFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', SCOPE],
    { encoding: 'utf8' },
  );
  return [...new Set(out.split('\n').filter(Boolean))]
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => existsSync(f));
}

function main() {
  let violations = 0;
  for (const relPath of lintableFiles()) {
    const text = readFileSync(relPath, 'utf8');
    for (const v of violationsIn(relPath, text)) {
      violations += 1;
      process.stderr.write(
        `terminal-escape: ${v.relPath}:${v.line}: ".${v.field}" reaches a stdout/stderr write unescaped — wrap it in escapeForTerminal(...)\n`,
      );
    }
  }
  if (violations > 0) {
    process.stderr.write(
      `\n${violations} terminal-escape violation(s). Model-derived text printed unescaped can rewrite the terminal it is printed to.\n`,
    );
    process.exit(1);
  }
  process.stdout.write('lint-terminal-escape: clean\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
