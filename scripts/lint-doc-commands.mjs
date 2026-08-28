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
 * Subcommands are checked too, against a surface measured from the CLI rather
 * than declared beside it (`lib/cli-surface.mjs`). `construct lessons list`
 * fails here, which is the line that shipped in a walkthrough and started this.
 *
 * Flags are checked against the same table `construct <verb> --help` prints
 * (`acceptedFlags` in src/cli/index.ts). A documented `--id` on a verb that
 * never accepted `--id` is the class that shipped as a live recipe in CLI
 * output. Short aliases (`-h`, `-y`, `-v`) map to the long names. `--help` is
 * always accepted. The argument after a verb is still not judged as a
 * positional value — only as a subcommand or a flag name.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptedFlags, INTERNAL_VERBS, VERBS } from '../src/cli/index.ts';
import { probeSurface } from './lib/cli-surface.mjs';

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

/**
 * The repository this lint scans, whatever directory it was invoked from. A
 * `git ls-files` run from a subdirectory sees only that subtree, so the check
 * would quietly narrow to a fraction of the corpus and still report success.
 *
 * Overridable by a first CLI argument, which exists for one reason: a test
 * that plants a fixture page has nowhere sterile to put it otherwise, since
 * discovery below goes through `git ls-files` and that has nothing to answer
 * from outside a git working tree. Pointing it at a scratch git repo lets the
 * fixture live in a tmpdir instead of the real docs/ directory, where two
 * concurrent lint runs can plant and delete the same path. The bare
 * invocation `npm run lint` calls (no argument) resolves exactly as before.
 */
const ROOT = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../', import.meta.url));

function docFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean).map((path) => join(ROOT, path));
}

/**
 * A command line, not a sentence: `construct` opens the line, optionally behind
 * a prompt marker or a runner, then the verb, then whatever it was given.
 *
 * The trailing group matches only a bare lowercase word, so a flag, a `<id>`
 * placeholder, a quoted string, and a path are all left as undefined — none of
 * them is a subcommand, and treating one as a candidate would invent failures.
 */
const COMMAND = /(?:[$>][ \t]*)?(?:npx[ \t]+\S+[ \t]+)?construct[ \t]+([A-Za-z][\w-]*)(?:[ \t]+([a-z][a-z-]*))?/;
const COMMAND_LINE = new RegExp(`^[ \\t]*${COMMAND.source}`);
const FLAG = /--([a-z][a-z0-9-]*)/g;
const SHORT = /(?:^|[\s`])-([hyv])(?:[\s`=]|$)/g;
const SHORT_TO_LONG = { h: 'help', y: 'yes', v: 'version' };

function flagsNamedIn(text) {
  const names = new Set();
  for (const match of text.matchAll(FLAG)) names.add(match[1]);
  for (const match of text.matchAll(SHORT)) {
    const long = SHORT_TO_LONG[match[1]];
    if (long) names.add(long);
  }
  return names;
}

function flagsAllowed(verb) {
  const allowed = new Set(acceptedFlags(verb));
  allowed.add('help');
  return allowed;
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
    const inFence = fences.some((f) => span.index > f.at && span.index < f.at + f.body.length);
    if (inFence) continue;
    const found = new RegExp(`^${COMMAND.source}`).exec(span[1]);
    if (found) hits.push({ at: span.index, token: found[1], rest: found[2], text: span[1].trim() });
  }
  return hits;
}

const problems = [];
/** Every documented command, gathered before probing so only used verbs cost one. */
const cited = [];

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
    const line = text.slice(0, hit.at).split('\n').length;
    if (!known.has(hit.token)) {
      if (RETIRED_VERBS.has(hit.token)) continue;
      problems.push({ file, line, text: hit.text, why: `names no CLI verb ('${hit.token}')` });
      continue;
    }
    cited.push({ file, line, verb: hit.token, rest: hit.rest, text: hit.text });
  }
}

// Only the verbs documentation actually uses with an argument are worth a
// process, and a verb is asked once however many pages cite it.
const needProbe = [...new Set(cited.filter((c) => c.rest !== undefined).map((c) => c.verb))];
const surface = needProbe.length > 0 ? probeSurface(needProbe) : new Map();

for (const use of cited) {
  if (use.rest === undefined) continue;
  const probed = surface.get(use.verb);
  if (!probed) continue;

  // A verb taking a free positional cannot judge the word after it, and one
  // whose surface never printed cannot judge anything. Both are skipped.
  if (probed.shape === 'positional' || probed.shape === 'unknown') continue;

  if (probed.shape === 'subcommands') {
    if (probed.subcommands.has(use.rest)) continue;
    problems.push({
      file: use.file,
      line: use.line,
      text: use.text,
      why:
        `'${use.verb}' has no '${use.rest}' subcommand ` +
        `(it accepts: ${[...probed.subcommands].sort().join(', ')})`,
    });
    continue;
  }

  // flags-only: the verb printed its own usage and named no subcommand at all,
  // so a bare word after it is one nobody can run.
  problems.push({
    file: use.file,
    line: use.line,
    text: use.text,
    why: `'${use.verb}' takes no subcommand, so '${use.rest}' is not a command`,
  });
}

/**
 * Historical records may name a flag a later release dropped. Checking them
 * as if they were a user guide would force a rewrite of the paper, which is
 * the opposite of what this lint is for. User-facing guides, the CLI's own
 * recipes, and any other page a reader would copy today are in scope.
 */
function flagCheckable(file) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (
    rel === 'CHANGELOG.md' ||
    rel === 'RESEARCH-DECISIONS.md' ||
    rel === 'STRATEGY.md' ||
    rel === 'GLOSSARY.md'
  ) {
    return false;
  }
  if (rel.startsWith('docs/internal/') || rel.startsWith('fixtures/')) return false;
  return true;
}

function checkFlags(file, line, verb, text) {
  if (!flagCheckable(file)) return;
  if (!known.has(verb) || RETIRED_VERBS.has(verb)) return;
  const allowed = flagsAllowed(verb);
  for (const flag of flagsNamedIn(text)) {
    if (allowed.has(flag)) continue;
    problems.push({
      file,
      line,
      text,
      why: `'${verb}' does not accept --${flag} (it accepts: ${[...allowed].sort().join(', ') || 'none'})`,
    });
  }
}

for (const use of cited) {
  checkFlags(use.file, use.line, use.verb, use.text);
}

function cliFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'src/cli/*.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean).map((path) => join(ROOT, path));
}

for (const file of cliFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes('construct ')) continue;
  let cursor = 0;
  for (const line of text.split('\n')) {
    cursor += 1;
    const found = new RegExp(COMMAND.source).exec(line);
    if (!found) continue;
    checkFlags(file, cursor, found[1], line.trim());
  }
}

if (problems.length > 0) {
  for (const p of problems) {
    process.stderr.write(`${relative(ROOT, p.file)}:${p.line}: '${p.text}' — ${p.why}\n`);
  }
  process.stderr.write(
    `\nlint-doc-commands: ${String(problems.length)} documented command(s) no reader could run.\n`,
  );
  process.exit(1);
}

const judged = [...surface.values()].filter((s) => s.shape !== "unknown" && s.shape !== "positional").length;
process.stdout.write(
  `lint-doc-commands: clean — ${String(cited.length)} documented command(s) against ` +
    `${String(known.size)} verbs, ${String(judged)} of them with a surface the CLI could state, ` +
    `flags checked against each verb's own --help table\n`,
);
