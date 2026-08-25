#!/usr/bin/env node
/**
 * lint-connector-gate.mjs — the structural half of the connector use/build
 * gate (docs/internal/connector-seam-design.md, "The forbidden-import rule").
 * `src/connectors/` is the canonical home for adapter-tier API connectors
 * (Jira, GitHub, and whatever follows); nothing lives there yet, so this
 * gate is wired ahead of the first connector rather than after — the same
 * as fitting a lock to a door before anyone tries the handle.
 *
 * The forbidden edges:
 *
 *   - src/kernel/** may not import src/connectors/** — a connector is
 *     adapter-tier, never a kernel concern, and the kernel stays
 *     zero-dependency and host-agnostic either way.
 *   - src/hosts/** may not import src/connectors/** — a host and a
 *     connector are separate answers to "how does work reach the outside
 *     world"; a host reaching for a connector is the tool-broker Construct
 *     has already refused, reappearing sideways.
 *   - scripts/** and bin/** may not import src/connectors/** — Construct's
 *     own build and its CLI entry point stay connector-free: using
 *     Construct is not building Construct.
 *   - src/connectors/** may import only src/kernel/**, its own connector's
 *     own modules, and Node builtins — never a host adapter, never another
 *     connector, never anything else. This direction is an allow-list rather
 *     than a forbidden edge, so a future connector cannot quietly grow a
 *     dependency none of the three rules above happened to name. The
 *     own-modules half is what the rule always meant by "never ANOTHER
 *     connector": a vendor's pin, its wire, and the module that reads them
 *     are one connector, and forbidding them each other would make every
 *     connector a single file — which the adapter tier next door is not
 *     either. A sibling vendor directory is still another connector and
 *     still forbidden.
 *
 * src/cli/** is deliberately not checked. The gate governs what the kernel
 * and the build depend on, not what the CLI surface offers a user who has
 * explicitly opted into a connector.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CONNECTORS = 'src/connectors';
const KERNEL = 'src/kernel';

/**
 * The only files licensed to build a dynamic import argument instead of
 * writing it as a string literal — each reviewed by hand and named here
 * rather than silenced by a comment convention, matching how the sibling
 * bead-reference lint excludes files it has already checked. Every one of
 * these builds its argument from a local, already-resolved path (the
 * checkout's own dist/src selector, or a legacy-checkout directory a helper
 * resolves), never from anything that could carry a connector specifier.
 * Widening this list is the one thing a reviewer should look at twice.
 */
const COMPUTED_IMPORT_EXEMPT = [
  'bin/construct.mjs',
  'scripts/capture-legacy-dispatcher-golden.mjs',
  'scripts/capture-legacy-ladder-golden.mjs',
  'scripts/capture-legacy-tracker-golden.mjs',
];

// ---------------------------------------------------------------------------
// Pure logic — exported so the self-test can exercise resolution directly,
// without spawning a subprocess for every case.
// ---------------------------------------------------------------------------

/**
 * Every `from '...'` (covers both `import ... from` and `export ... from`),
 * bare `import '...'`, and dynamic `import('...')` specifier in `text`, each
 * with its 1-based line number. A regex scan, not a parser — the same
 * pragmatic level the sibling lint scripts in this directory use.
 */
export function extractImportSpecifiers(text) {
  const found = [];
  const push = (specifier, index) => {
    found.push({ specifier, line: text.slice(0, index).split('\n').length });
  };
  for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) push(m[1], m.index);
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) push(m[1], m.index);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], m.index);
  return found;
}

/**
 * `text` with every `//` comment, `/* *\/` comment, and string or template
 * literal blanked to spaces — newlines inside any of them are kept, so every
 * remaining character sits at the same line number and the same offset it
 * started at. What is left is code with every quoted or commented-out
 * character replaced by a space: the only place the word `import` can still
 * appear is an actual keyword.
 *
 * Without this, a comment that talks about the shape of a dynamic import
 * call — this file's own docstrings do — or an unrelated string that happens
 * to contain the same text reads as a real call to the plain substring scan
 * computedDynamicImports runs beneath it.
 */
function blankNonCode(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? text.length : close + 2;
      // A non-whitespace filler: the caller's own `\s*` after `import(`
      // must never be able to eat through a blanked span the way it eats
      // through real whitespace, or the offset math past it breaks.
      out += text.slice(i, stop).replace(/[^\n]/g, '#');
      i = stop;
      continue;
    }
    if (text[i] === "'" || text[i] === '"' || text[i] === '`') {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, text.length);
      // A non-whitespace filler: the caller's own `\s*` after `import(`
      // must never be able to eat through a blanked span the way it eats
      // through real whitespace, or the offset math past it breaks.
      out += text.slice(i, stop).replace(/[^\n]/g, '#');
      i = stop;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * Every dynamic `import(...)` call in `text` whose argument is not a plain
 * string literal — a call built with concatenation, a variable, or a
 * template literal carrying a substitution — each with its 1-based line
 * number.
 *
 * extractImportSpecifiers can only see a specifier when it is written as a
 * literal string; a computed one resolves to nothing this gate can check,
 * which is the blind spot that let a computed import cross the connector
 * boundary invisibly. Rather than try to evaluate what a computed specifier
 * resolves to, every dynamic import call that extractImportSpecifiers' own
 * literal pattern did not also match is treated as unverifiable and reported
 * in its own right.
 *
 * blankNonCode finds where the real `import(` keywords sit — comments and
 * unrelated strings never produce one — and the argument itself is then read
 * back out of the original, unblanked text, since that argument's own quoted
 * content is exactly what isLiteralArgument needs to see.
 */
export function computedDynamicImports(text) {
  const code = blankNonCode(text);
  const found = [];
  for (const m of code.matchAll(/\bimport\s*\(\s*/g)) {
    if (isLiteralArgument(text.slice(m.index + m[0].length))) continue;
    found.push({ line: code.slice(0, m.index).split('\n').length });
  }
  return found;
}

/**
 * Whether `rest` — the text right after `import(`'s opening whitespace —
 * starts with a single quoted, double quoted, or backtick argument that is
 * immediately followed by the closing `)`, with nothing else read as code. A
 * backtick argument only counts when it carries no `${` substitution: a
 * template literal that interpolates a variable is exactly as computed as
 * string concatenation is.
 */
function isLiteralArgument(rest) {
  const quote = rest[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') return false;
  let j = 1;
  while (j < rest.length && rest[j] !== quote) j += rest[j] === '\\' ? 2 : 1;
  if (j >= rest.length) return false;
  const body = rest.slice(1, j);
  if (quote === '`' && body.includes('${')) return false;
  return /^\s*\)/.test(rest.slice(j + 1));
}

/**
 * `specifier` resolved against `importerRelPath` (posix, repo-root-relative)
 * — null when `specifier` is not a relative import, since a bare specifier
 * (a Node builtin or an npm package name) has no repo path to resolve to.
 * Every internal cross-file import in this repo is relative-with-extension
 * (`'../store/open.ts'`), so this is the one resolution rule that matters.
 */
export function resolveRelativeImport(importerRelPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(importerRelPath), specifier));
}

/**
 * Whether `resolvedPath` sits inside the tree rooted at `treePrefix`, as a
 * path segment — `src/connectors-legacy/x` is not inside `src/connectors`.
 */
export function isUnderTree(resolvedPath, treePrefix) {
  return resolvedPath === treePrefix || resolvedPath.startsWith(`${treePrefix}/`);
}

/**
 * The one connector a file belongs to — `src/connectors/<vendor>` — or null
 * when it sits at the top of the connectors tree and belongs to no vendor.
 * A top-level file has no own-modules license: shared connector code nobody
 * has licensed is exactly the second tool broker the gate exists to refuse.
 */
export function connectorRootOf(relPath) {
  const parts = relPath.split('/');
  if (parts.length < 4) return null;
  return `${parts[0]}/${parts[1]}` === CONNECTORS ? `${parts[0]}/${parts[1]}/${parts[2]}` : null;
}

/**
 * Every connector-gate violation in one file. `role` is `'importer'` for a
 * kernel/host/script/bin file (must not resolve into CONNECTORS) or
 * `'connector'` for a file already inside CONNECTORS (may resolve into
 * KERNEL or into its own connector's directory, or be a Node builtin).
 */
export function violationsIn(relPath, text, role) {
  const violations = [];
  const ownConnector = role === 'connector' ? connectorRootOf(relPath) : null;
  for (const { specifier, line } of extractImportSpecifiers(text)) {
    const resolved = resolveRelativeImport(relPath, specifier);
    if (role === 'importer') {
      if (resolved !== null && isUnderTree(resolved, CONNECTORS)) {
        violations.push({ relPath, line, specifier, kind: 'resolved' });
      }
    } else {
      const allowed =
        (resolved !== null && isUnderTree(resolved, KERNEL)) ||
        (resolved !== null && ownConnector !== null && isUnderTree(resolved, ownConnector)) ||
        (resolved === null && isBuiltin(specifier));
      if (!allowed) violations.push({ relPath, line, specifier, kind: 'resolved' });
    }
  }
  // A computed dynamic-import argument resolves to nothing
  // extractImportSpecifiers can see, in either role: an importer tree could
  // reach a connector this way with no string literal ever naming it, and a
  // connector could reach anything at all the same way. Both fail outright
  // rather than pass by default because nothing was matched — except the
  // handful of reviewed call sites named in COMPUTED_IMPORT_EXEMPT.
  if (!COMPUTED_IMPORT_EXEMPT.includes(relPath)) {
    for (const { line } of computedDynamicImports(text)) {
      violations.push({ relPath, line, specifier: null, kind: 'computed' });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// File discovery and CLI wiring.
// ---------------------------------------------------------------------------

/**
 * Every tracked-or-untracked-but-not-ignored file under `dir` whose name ends
 * in `extension`. A trailing-slash pathspec (rather than a double-star glob
 * suffix) is deliberate: this git's default pathspec matching does not treat
 * a double-star segment as matching zero directories, so a pattern rooted at
 * `bin` misses `bin/construct.mjs` itself, and the equivalent pattern rooted
 * at `src/kernel` misses `src/kernel/paths.ts` — a gate that silently skips
 * a tree's own top-level files is the exact defect class
 * `lint-glossary-parity.mjs` was fixed for. A bare trailing slash has no such
 * gap: it recurses from `dir` itself, top-level files included. `existsSync`
 * first avoids a `git ls-files` warning on `src/connectors/`, which does not
 * exist yet.
 */
function filesUnder(dir, extension) {
  if (!existsSync(dir)) return [];
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', `${dir}/`],
    { encoding: 'utf8' },
  );
  return out.split('\n').filter((f) => f.endsWith(extension));
}

/**
 * The line reported for a computed `import(...)` argument, shared by every
 * tree: the reason is the same regardless of which side of the boundary the
 * call sits on — the gate cannot see through it, so it cannot clear it.
 */
function computedImportMessage(v, subject) {
  return (
    `connector gate: ${v.relPath}:${v.line}: ${subject} a computed dynamic-import argument — ` +
    'the connector gate can only check a specifier written as a string literal, so what this ' +
    'call actually loads cannot be verified against it. Use a literal specifier, or move the ' +
    'call somewhere this gate does not cover.'
  );
}

const IMPORTER_TREES = [
  {
    dir: 'src/kernel',
    extension: '.ts',
    describe: (v) =>
      v.kind === 'computed'
        ? computedImportMessage(v, 'kernel calls')
        : `connector gate: ${v.relPath}:${v.line}: kernel imports a connector ("${v.specifier}") — ` +
          'the kernel stays zero-dependency and connector-free; a connector is adapter-tier, never a kernel concern.',
  },
  {
    dir: 'src/hosts',
    extension: '.ts',
    describe: (v) =>
      v.kind === 'computed'
        ? computedImportMessage(v, 'a host calls')
        : `connector gate: ${v.relPath}:${v.line}: a host imports a connector ("${v.specifier}") — ` +
          'a host and a connector are separate answers to reaching the outside world; a host reaching for a connector is the tool-broker Construct has already refused.',
  },
  {
    dir: 'scripts',
    extension: '.mjs',
    describe: (v) =>
      v.kind === 'computed'
        ? computedImportMessage(v, "Construct's own build tooling calls")
        : `connector gate: ${v.relPath}:${v.line}: Construct's own build tooling imports a connector ("${v.specifier}") — ` +
          'using Construct is not building Construct.',
  },
  {
    dir: 'bin',
    extension: '.mjs',
    describe: (v) =>
      v.kind === 'computed'
        ? computedImportMessage(v, "Construct's own CLI entry point calls")
        : `connector gate: ${v.relPath}:${v.line}: Construct's own CLI entry point imports a connector ("${v.specifier}") — ` +
          'using Construct is not building Construct.',
  },
];

function main() {
  let violations = 0;

  for (const tree of IMPORTER_TREES) {
    for (const relPath of filesUnder(tree.dir, tree.extension)) {
      const text = readFileSync(relPath, 'utf8');
      for (const v of violationsIn(relPath, text, 'importer')) {
        violations += 1;
        console.error(tree.describe(v));
      }
    }
  }

  for (const relPath of filesUnder(CONNECTORS, '.ts')) {
    const text = readFileSync(relPath, 'utf8');
    for (const v of violationsIn(relPath, text, 'connector')) {
      violations += 1;
      console.error(
        v.kind === 'computed'
          ? computedImportMessage(v, 'a connector calls')
          : `connector gate: ${v.relPath}:${v.line}: a connector imports outside its licensed set ("${v.specifier}") — ` +
            'src/connectors/** may import only src/kernel/**, its own connector\'s modules, and Node builtins, ' +
            'never a host adapter and never another connector.',
      );
    }
  }

  if (violations > 0) {
    console.error(
      `\n${violations} connector-gate violation(s). Connectors are adapter-tier: the kernel, the hosts, and Construct's own build stay connector-free.`,
    );
    process.exit(1);
  }
  console.log('lint-connector-gate: clean');
}

// Only when run as a script. Importing this file (the self-test does) must
// not walk the repo or exit the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
