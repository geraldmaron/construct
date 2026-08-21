#!/usr/bin/env node
/**
 * lint-doc-commands.mjs — a guide may not teach a command the CLI does not have.
 *
 * Documentation drifts from the surface it documents in one direction that is
 * worse than the others: a reader copies a printed command, it errors, and the
 * tool looks broken rather than the page looking old. A walkthrough has
 * described a whole verb that no release ever shipped, and the CLI itself once
 * told a stuck user to run a command only the predecessor had. Prose is checked
 * by nobody, and a plausible-looking command reads as a verified one.
 *
 * So every `construct <verb>` a reader would copy is checked against the CLI's
 * own verb table. That table is exported from `src/cli/index.ts` and is the
 * same array the usage line is built from, which is what keeps this check
 * honest: it cannot pass by agreeing with a second copy of the truth.
 *
 * Only copyable text is in scope — shell-tagged fenced blocks, and inline spans
 * that begin with the command. Prose that happens to contain the word, output
 * transcripts, and ASCII diagrams are not commands and are not checked.
 *
 * What this does not catch, stated so nobody reads a pass as more than it is:
 * the verb is checked, and nothing after it. `construct lessons list` passes
 * here because `lessons` is real, though no `list` subcommand exists and that
 * exact line shipped in a walkthrough. Subcommands and flags are not declared
 * anywhere a check could read, so covering them means giving each verb a
 * machine-readable surface first. Until then this catches an invented verb and
 * misses an invented subcommand.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { INTERNAL_VERBS, VERBS } from '../src/cli/index.ts';

/**
 * Verbs the predecessor carried and this CLI does not. They are listed so a
 * page may name one as gone, which is the opposite of the failure this lint
 * exists to catch. Declared rather than tolerated: a page inventing some other
 * missing verb still fails, and a reader who greps this file learns which
 * commands are absent on purpose.
 */
const RETIRED_VERBS = new Set(['sync', 'install']);

/** Fences whose contents a reader would paste into a shell. */
const SHELL_FENCE = /^(bash|sh|shell|zsh|console)$/i;

const known = new Set([...VERBS, ...INTERNAL_VERBS]);

function docFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.md'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/**
 * A command line, not a sentence: `construct` opens the line, optionally behind
 * a prompt marker or a runner, and a verb follows on the same line.
 */
const COMMAND_LINE = /^[ \t]*(?:[$>][ \t]*)?(?:npx[ \t]+\S+[ \t]+)?construct[ \t]+([A-Za-z][\w-]*)/;

function hitsInShellFences(text) {
  const hits = [];
  for (const fence of text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    if (!SHELL_FENCE.test((fence[1] ?? '').trim())) continue;
    const bodyAt = fence.index + fence[0].indexOf('\n') + 1;
    let cursor = bodyAt;
    for (const line of fence[2].split('\n')) {
      const found = COMMAND_LINE.exec(line);
      if (found) hits.push({ at: cursor, token: found[1], text: line.trim() });
      cursor += line.length + 1;
    }
  }
  return hits;
}

function hitsInInlineSpans(text, fences) {
  const hits = [];
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    const inFence = fences.some((f) => span.index > f.at && span.index < f.at + f.body.length);
    if (inFence) continue;
    const found = /^(?:[$>][ \t]*)?construct[ \t]+([A-Za-z][\w-]*)/.exec(span[1]);
    if (found) hits.push({ at: span.index, token: found[1], text: span[1].trim() });
  }
  return hits;
}

const problems = [];

for (const file of docFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes('construct ')) continue;

  const fences = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => ({
    at: m.index,
    body: m[0],
  }));

  for (const hit of [...hitsInShellFences(text), ...hitsInInlineSpans(text, fences)]) {
    if (known.has(hit.token) || RETIRED_VERBS.has(hit.token)) continue;
    const line = text.slice(0, hit.at).split('\n').length;
    problems.push({ file, line, token: hit.token, text: hit.text });
  }
}

if (problems.length > 0) {
  for (const p of problems) {
    process.stderr.write(`${p.file}:${p.line}: '${p.text}' names no CLI verb ('${p.token}')\n`);
  }
  process.stderr.write(
    `\nlint-doc-commands: ${String(problems.length)} documented command(s) no reader could run.\n` +
      `Known verbs: ${[...known].sort().join(', ')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `lint-doc-commands: clean — every documented command names one of ${String(known.size)} verbs\n`,
);
