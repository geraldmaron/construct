#!/usr/bin/env node
/**
 * lint-doc-commands.mjs — a guide may not teach a command the CLI does not have.
 *
 * A reader copies a printed command; if it errors, the tool looks broken
 * rather than the page looking old. So every `construct <command>` a reader
 * would copy is checked against the CLI's own command registry — the same
 * array help, completions, and dispatch are built from, which is what keeps
 * this honest: it cannot pass by agreeing with a second copy of the truth.
 *
 * Only copyable text is in scope: shell-tagged fenced blocks, and inline
 * spans that begin with the command. Prose, output transcripts, and diagrams
 * are not commands. A command's subcommand and flags are checked against the
 * registry; a positional argument is never judged.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/cli/index.ts';
import { GLOBAL_FLAGS } from '../src/cli/commands.ts';

const SHELL_FENCE = /^(bash|sh|shell|zsh|console)$/i;
const ROOT = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));

/**
 * A directive describes the surface a program is building, not the one that
 * ships today; its commands become real as the program lands. Checking it
 * against the current registry would fail until the last phase and then
 * pass, which measures the calendar, not the document.
 */
const DIRECTIVES = new Set(['docs/internal/cutover-directive.md']);

const nouns = new Map(); // noun -> Set of subcommands ('' for a bare command)
for (const spec of COMMANDS) {
  const [noun, sub] = spec.path;
  if (!nouns.has(noun)) nouns.set(noun, new Set());
  nouns.get(noun).add(sub ?? '');
}

function flagsAllowed(noun, sub) {
  const spec = COMMANDS.find((c) => c.path[0] === noun && (c.path[1] ?? '') === (sub ?? ''));
  const allowed = new Set(GLOBAL_FLAGS.map((f) => f.name));
  for (const f of spec?.flags ?? []) allowed.add(f.name);
  allowed.add('version');
  return allowed;
}

function docFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.md'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((path) => !DIRECTIVES.has(path))
    .map((path) => join(ROOT, path));
}

const COMMAND = /(?:[$>][ \t]*)?(?:npx[ \t]+\S+[ \t]+)?construct[ \t]+([A-Za-z][\w-]*)(?:[ \t]+([a-z][a-z-]*))?/;
const COMMAND_LINE = new RegExp(`^[ \\t]*${COMMAND.source}`);
const FLAG = /--([a-z][a-z0-9-]*)/g;
const SHORT = /(?:^|[\s`])-([hv])(?:[\s`=]|$)/g;
const SHORT_TO_LONG = { h: 'help', v: 'version' };

function flagsNamedIn(text) {
  const names = new Set();
  for (const match of text.matchAll(FLAG)) names.add(match[1]);
  for (const match of text.matchAll(SHORT)) names.add(SHORT_TO_LONG[match[1]]);
  return names;
}

function hitsInShellFences(text) {
  const hits = [];
  for (const fence of text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    if (!SHELL_FENCE.test((fence[1] ?? '').trim())) continue;
    let cursor = fence.index + fence[0].indexOf('\n') + 1;
    for (const line of fence[2].split('\n')) {
      const found = COMMAND_LINE.exec(line);
      if (found) hits.push({ at: cursor, token: found[1], rest: found[2], text: line.trim() });
      cursor += line.length + 1;
    }
  }
  return hits;
}

function hitsInInlineSpans(text, fences) {
  const hits = [];
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    if (fences.some((f) => span.index > f.at && span.index < f.at + f.body.length)) continue;
    const found = new RegExp(`^${COMMAND.source}`).exec(span[1]);
    if (found) hits.push({ at: span.index, token: found[1], rest: found[2], text: span[1].trim() });
  }
  return hits;
}

/**
 * Historical records name commands a later release dropped. Checking them as
 * if they were a user guide would force a rewrite of the paper, which is the
 * opposite of what this lint is for. User-facing guides, skills, and any page
 * a reader would copy today are in scope.
 */
function checkable(file) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (['CHANGELOG.md', 'RESEARCH-DECISIONS.md', 'STRATEGY.md', 'GLOSSARY.md'].includes(rel)) return false;
  if (rel.startsWith('docs/internal/')) return false;
  return true;
}

const problems = [];
for (const file of docFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes('construct ') || !checkable(file)) continue;
  const fences = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => ({ at: m.index, body: m[0] }));
  for (const hit of [...hitsInShellFences(text), ...hitsInInlineSpans(text, fences)]) {
    const line = text.slice(0, hit.at).split('\n').length;
    const subs = nouns.get(hit.token);
    if (!subs) {
      problems.push({ file, line, text: hit.text, why: `names no CLI command ('${hit.token}')` });
      continue;
    }
    const hasSubcommands = [...subs].some((s) => s !== '');
    let sub = '';
    if (hasSubcommands) {
      if (hit.rest === undefined) {
        // `construct source` alone is how a noun is introduced; fine.
      } else if (!subs.has(hit.rest)) {
        problems.push({ file, line, text: hit.text, why: `'${hit.token}' has no '${hit.rest}' subcommand (it accepts: ${[...subs].filter(Boolean).sort().join(', ')})` });
        continue;
      } else {
        sub = hit.rest;
      }
    }
    const allowed = flagsAllowed(hit.token, sub);
    for (const flag of flagsNamedIn(hit.text)) {
      if (allowed.has(flag)) continue;
      problems.push({ file, line, text: hit.text, why: `'${[hit.token, sub].filter(Boolean).join(' ')}' does not accept --${flag} (it accepts: ${[...allowed].sort().join(', ')})` });
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) {
    process.stderr.write(`${relative(ROOT, p.file)}:${p.line}: '${p.text}' — ${p.why}\n`);
  }
  process.stderr.write(`\nlint-doc-commands: ${problems.length} documented command(s) no reader could run.\n`);
  process.exit(1);
}
process.stdout.write('lint-doc-commands: every documented command is one the CLI accepts\n');
