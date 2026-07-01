/**
 * lib/host-disposition.mjs — single source of truth for the disposition of
 * every artifact Construct creates in a host project (ADR-0027 §1).
 *
 * Scope model (see docs/guides/concepts/project-scopes.md):
 *   templates/, docs/  — package/repo durable sources (committed)
 *   .construct/        — per-project launcher (ignored)
 *   .cx/               — per-project runtime: intake, oracle, observations, demos (ignored)
 *   ~/.construct/      — user credentials and doctor state
 *   ~/.cx/             — user-scope telemetry fallback
 *
 * `IGNORED_PATTERNS` enumerates machine-specific, sync-regenerated artifacts
 * that must never be committed; the init `.gitignore` writer and the
 * `gitignore-coverage` reconciliation both read from here, and uninstall /
 * adapter-prune consume `ADAPTER_DIRS`. Keep this 1:1 with the host-relevant
 * subset of Construct's own repo .gitignore so forward-fix and backward-repair
 * never diverge.
 */

import fs from 'node:fs';
import path from 'node:path';

// Adapter directories `construct sync` regenerates per host platform. Each
// carries machine-specific absolute paths (MCP server paths, env-resolved
// tokens) and is recreated on demand, so none is durable repo state.

export const ADAPTER_DIRS = ['.claude', '.codex', '.cursor', '.vscode', '.opencode'];

// Every artifact whose disposition is `ignored`. A trailing slash marks a
// directory. `.construct/` is the per-project launcher (host scope only — the
// Construct repo itself tracks `.construct/version`, hence the divergence from
// the repo .gitignore for that one entry).

export const IGNORED_PATTERNS = [
  '.cx/',
  '.claude/',
  '.codex/',
  '.cursor/',
  '.vscode/',
  '.opencode/',
  '.construct/',
  '.mcp.json',
  '.github/prompts/',
  '.github/agents/',
  'config.env',
  'embed.yaml',
  'plan.md',
  'inbox/',
];

// User-owned files Construct mutates only via replaceManagedBlock (ADR-0027 §2).
// These are durable repo source, not ignored cache — they must NOT appear in
// IGNORED_PATTERNS, but they still need an explicit disposition so consumers
// know not to gitignore or delete them on uninstall.

export const MANAGED_PATTERNS = [
  '.github/copilot-instructions.md',
];

// A pattern counts as already-ignored when an existing line matches it exactly,
// matches its bare/slashed form, or is a broader `*` / `**` catch-all.

export function isPatternIgnored(pattern, presentLines) {
  const present = presentLines instanceof Set ? presentLines : new Set(presentLines);
  if (present.has('*') || present.has('**')) return true;
  const bare = pattern.replace(/\/$/, '');
  return present.has(pattern) || present.has(bare) || present.has(`${bare}/`) || present.has(`${bare}/**`);
}

// Patterns from IGNORED_PATTERNS not yet covered by `content` (a .gitignore body).

export function missingIgnorePatterns(content) {
  const present = new Set((content || '').split('\n').map((l) => l.trim()));
  return IGNORED_PATTERNS.filter((p) => !isPatternIgnored(p, present));
}

// Detection: a package.json declaring this as the `construct` package. Used
// to prevent `construct init` and `construct sync` from misapplying host
// project rules (like ignoring .construct/) to the Construct repository itself.

export function isConstructPackageRepo(dir) {
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg) return false;
    if (pkg.name === 'construct' || pkg.name === '@geraldmaron/construct') return true;
    return pkg.bin && (pkg.bin === 'bin/construct' || (typeof pkg.bin === 'object' && pkg.bin.construct === 'bin/construct'));
  } catch {
    return false;
  }
}
