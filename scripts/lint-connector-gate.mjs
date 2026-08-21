#!/usr/bin/env node
/**
 * lint-connector-gate.mjs — the structural half of the connector use/build
 * gate (docs/connector-seam-design.md, "The forbidden-import rule").
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
 *   - src/connectors/** may import only src/kernel/** and Node builtins —
 *     never a host adapter, never another connector, never anything else.
 *     This direction is an allow-list rather than a forbidden edge, so a
 *     future connector cannot quietly grow a dependency none of the three
 *     rules above happened to name.
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
 * Every connector-gate violation in one file. `role` is `'importer'` for a
 * kernel/host/script/bin file (must not resolve into CONNECTORS) or
 * `'connector'` for a file already inside CONNECTORS (may resolve only into
 * KERNEL, or be a Node builtin).
 */
export function violationsIn(relPath, text, role) {
  const violations = [];
  for (const { specifier, line } of extractImportSpecifiers(text)) {
    const resolved = resolveRelativeImport(relPath, specifier);
    if (role === 'importer') {
      if (resolved !== null && isUnderTree(resolved, CONNECTORS)) {
        violations.push({ relPath, line, specifier });
      }
    } else {
      const allowed =
        (resolved !== null && isUnderTree(resolved, KERNEL)) ||
        (resolved === null && isBuiltin(specifier));
      if (!allowed) violations.push({ relPath, line, specifier });
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

const IMPORTER_TREES = [
  {
    dir: 'src/kernel',
    extension: '.ts',
    describe: (v) =>
      `connector gate: ${v.relPath}:${v.line}: kernel imports a connector ("${v.specifier}") — ` +
      'the kernel stays zero-dependency and connector-free; a connector is adapter-tier, never a kernel concern.',
  },
  {
    dir: 'src/hosts',
    extension: '.ts',
    describe: (v) =>
      `connector gate: ${v.relPath}:${v.line}: a host imports a connector ("${v.specifier}") — ` +
      'a host and a connector are separate answers to reaching the outside world; a host reaching for a connector is the tool-broker Construct has already refused.',
  },
  {
    dir: 'scripts',
    extension: '.mjs',
    describe: (v) =>
      `connector gate: ${v.relPath}:${v.line}: Construct's own build tooling imports a connector ("${v.specifier}") — ` +
      'using Construct is not building Construct.',
  },
  {
    dir: 'bin',
    extension: '.mjs',
    describe: (v) =>
      `connector gate: ${v.relPath}:${v.line}: Construct's own CLI entry point imports a connector ("${v.specifier}") — ` +
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
        `connector gate: ${v.relPath}:${v.line}: a connector imports outside its licensed set ("${v.specifier}") — ` +
          'src/connectors/** may import only src/kernel/** and Node builtins, never a host adapter and never another connector.',
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
