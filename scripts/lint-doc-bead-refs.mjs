#!/usr/bin/env node
/**
 * lint-doc-bead-refs.mjs: a bead id cited in documentation names a bead
 * that exists.
 *
 * Docs are part of the tracker's own drift chain. A walkthrough, a CHANGELOG
 * entry, or a GLOSSARY note that says "see construct-<id>" is a claim the
 * tracker can check, the same way lint-doc-commands.mjs checks a printed
 * command against the CLI's own verb table. An invented id has already once
 * reached prose and a commit trailer; nothing caught it because nothing
 * asked the tracker whether the id it named was real.
 *
 * Existence only, never status. A closed bead is legitimate lineage (CHANGELOG
 * and STRATEGY cite settled work by id on purpose), so this lint asks one
 * question only: does `.beads/issues.jsonl`, the tracker export this repo
 * already tracks in-repo, carry a record for this id at all. Whether that
 * record is open, closed, or claimed is somebody else's question.
 *
 * Scope is docs/** and the five root records the house style names as the
 * drift record (README, STRATEGY, CHANGELOG, RESEARCH-DECISIONS, GLOSSARY),
 * not the whole repository. A bead id in a source comment is a different
 * lint's problem: lint-no-bead-refs.mjs forbids it there outright, on the
 * opposite theory that code should not cite the tracker at all.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository this lint scans. Overridable by a first CLI argument, the
 * same seam lint-doc-commands.mjs carries and for the same reason: a test
 * needs somewhere sterile to plant a fixture doc and a fixture tracker
 * export, instead of writing into the real docs/ and .beads/issues.jsonl
 * that every other session and gate run on this machine shares. The bare
 * invocation `npm run lint` calls (no argument) resolves exactly as before.
 */
const ROOT = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../', import.meta.url));

/**
 * A bead id, shaped the way the tracker mints them: three or four lowercase
 * alphanumerics after the prefix, an optional dotted child index, and
 * nothing else stuck to the end. `construct-mcp` is excluded outright (the
 * MCP server's key in host config, not lineage), mirroring lint-skill-spec.mjs's
 * BEAD pattern, which this one copies rather than redefines. A longer word
 * that merely starts with "construct-" ("construct-engine", "construct-shaped")
 * fails the trailing boundary on its own and needs no separate exclusion.
 */
const BEAD = /construct-(?!mcp)[a-z0-9]{3,4}(?:\.\d+)?(?![a-z0-9_-])/g;

/** The root records the house style treats as the drift record, cited by name. */
const ROOT_RECORDS = [
  'README.md',
  'STRATEGY.md',
  'CHANGELOG.md',
  'RESEARCH-DECISIONS.md',
  'GLOSSARY.md',
];

/**
 * Every markdown file under docs/, plus whichever root records exist. A
 * trailing-slash pathspec recurses the whole tree and includes docs/'s own
 * direct children, which a `docs/**` double-star suffix would silently miss:
 * this git's pathspec matching does not treat a double-star segment as
 * matching zero directories, the same gap lint-connector-gate.mjs works
 * around for src/kernel and bin.
 */
function docFiles() {
  const inDocs = existsSync(join(ROOT, 'docs'))
    ? execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'docs/'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
        .split('\n')
        .filter((f) => f.endsWith('.md'))
    : [];
  const roots = ROOT_RECORDS.filter((f) => existsSync(join(ROOT, f)));
  return [...inDocs, ...roots].map((f) => join(ROOT, f));
}

/**
 * Every id the tracker export carries. A missing export is a fatal,
 * loud-fail condition (it means nothing here is checkable, not that every
 * citation is rot), and a malformed line is skipped rather than failing the
 * whole lint: a memory record (`_type: "memory"`) carries no `id` at all,
 * and validating the export's own shape is reconcile-tracker's job, not
 * this one's.
 */
function trackerIds() {
  const path = join(ROOT, '.beads', 'issues.jsonl');
  if (!existsSync(path)) {
    process.stderr.write(`lint-doc-bead-refs: no tracker export at ${relative(ROOT, path)}\n`);
    process.exit(1);
  }
  const ids = new Set();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (typeof record.id === 'string') ids.add(record.id);
    } catch {
      continue;
    }
  }
  return ids;
}

const ids = trackerIds();
const problems = [];

for (const file of docFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const match of text.matchAll(BEAD)) {
    const token = match[0];
    if (ids.has(token)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    problems.push({ file, line, token });
  }
}

if (problems.length > 0) {
  for (const p of problems) {
    process.stderr.write(
      `${relative(ROOT, p.file)}:${p.line}: cites '${p.token}', which .beads/issues.jsonl has no record of\n`,
    );
  }
  process.stderr.write(
    `\nlint-doc-bead-refs: ${String(problems.length)} cited bead id(s) not in the tracker export.\n`,
  );
  process.exit(1);
}

process.stdout.write('lint-doc-bead-refs: clean, every cited bead id exists in the tracker export\n');
