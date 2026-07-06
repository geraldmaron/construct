#!/usr/bin/env node
/**
 * scripts/build-binary.mjs — compile the Construct CLI to standalone binaries with Bun.
 *
 * Distribution primary path per the language-runtime strategy: `bun build --compile`
 * cross-compiles from a single host to macOS arm64/x64 and Linux x64/arm64 without
 * needing four physical machines. Requires Bun on PATH (`curl -fsSL https://bun.sh/install
 * | bash`) — this script does not install Bun itself.
 *
 * Two Bun-compile-specific gaps were found and fixed (construct-qvou), both empirically
 * verified with `bun build --compile`, not assumed from docs:
 *
 * 1. Bun's `--compile` bundler only traverses an entry file's imports when the entry
 *    has a recognized JS/ESM extension. `bin/construct` is an extensionless shebang
 *    script — passed directly, Bun reports "bundle 1 modules" (it never resolves any
 *    of bin/construct's ~60 imports) and produces a binary that silently exits 0 with
 *    no output for every command. This script compiles from a temporary `.mjs`-suffixed
 *    copy placed next to the real entry (same directory, so its relative `../lib/...`
 *    imports still resolve) and removes the copy afterward.
 *
 * 2. Every bundled module's import.meta.url/dirname resolves to the same virtual
 *    `/$bunfs/root` path rather than a real on-disk path, and process.argv[1] is that
 *    same virtual path too. This broke two independent things, both fixed at the
 *    source rather than worked around here: (a) install-root resolution derived from
 *    import.meta.dirname (bin/construct's ROOT_DIR, and ~4 lib/*.mjs modules with their
 *    own local PACKAGE_ROOT/HERE constants) now falls back to process.execPath's real
 *    directory via lib/roots.mjs's resolveInstallRoot; (b) the standard Node "was I run
 *    directly" idiom (`import.meta.url === file://${process.argv[1]}`) appears in ~19
 *    lib/*.mjs files that double as standalone scripts, evaluated true for every one of
 *    them simultaneously (they all collapse to the same comparison), so each ran its own
 *    top-level CLI logic as a side effect of merely being imported — lib/headhunt.mjs's
 *    bare invocation (no --for) crashed the whole binary before bin/construct's real
 *    command dispatch ever ran. lib/roots.mjs's isMainModule() now always resolves false
 *    under a Bun-compiled binary (there is exactly one legitimate entry point inside one:
 *    bin/construct itself).
 *
 * Both fixes assume the data directories ship next to the binary (true for this
 * script's own dist/<binary> layout, one level below the checkout root — the same
 * depth bin/construct and lib/roots.mjs assume); a fully standalone end-user install
 * still needs its own asset story (embedded assets or a co-installed data tree),
 * tracked as follow-up, not attempted here.
 *
 * Usage:
 *   node scripts/build-binary.mjs                  — build all four targets
 *   node scripts/build-binary.mjs darwin-arm64      — build one target
 *   node scripts/build-binary.mjs --list            — print target table and exit
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = resolve(ROOT, 'dist');
const ENTRY = resolve(ROOT, 'bin', 'construct');

// Bun's --compile bundler resolves an entry's loader (and therefore whether it
// traverses that entry's imports at all) from its file extension; bin/construct
// has none. The copy must live in bin/ itself so its `../lib/...` imports still
// resolve to the real tree.

const BUILD_ENTRY = resolve(ROOT, 'bin', '.construct-build-entry.mjs');

const TARGETS = [
  { id: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', outName: 'construct-darwin-arm64' },
  { id: 'darwin-x64', bunTarget: 'bun-darwin-x64', outName: 'construct-darwin-x64' },
  { id: 'linux-x64', bunTarget: 'bun-linux-x64', outName: 'construct-linux-x64' },
  { id: 'linux-arm64', bunTarget: 'bun-linux-arm64', outName: 'construct-linux-arm64' },
];

function currentHostTargetId() {
  const plat = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null;
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  return plat && arch ? `${plat}-${arch}` : null;
}

function bunAvailable() {
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function buildOne(target) {
  mkdirSync(DIST_DIR, { recursive: true });
  const outfile = resolve(DIST_DIR, target.outName);
  console.log(`\n▸ building ${target.id} (${target.bunTarget})`);
  const result = spawnSync(
    'bun',
    ['build', '--compile', `--target=${target.bunTarget}`, BUILD_ENTRY, '--outfile', outfile],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error(`  ✗ build failed for ${target.id}`);
    return { target, ok: false, outfile, smoke: 'skipped (build failed)' };
  }

  // Only the host's own architecture can actually execute here; cross-compiled
  // binaries are valid ELF/Mach-O but untested until run on that platform.
  const hostId = currentHostTargetId();
  if (hostId !== target.id) {
    console.log(`  ✓ compiled (cross-target; not executed on this host)`);
    return { target, ok: true, outfile, smoke: 'not executed (cross-compiled)' };
  }

  // `doctor` is the real smoke target, not `version`: exercises registry
  // assembly, the plugin/skill catalogs, and every other data-directory read
  // the two Bun-compile gaps above broke. Doctor's exit code reflects real
  // repo health and can legitimately be 1 on pre-existing warnings unrelated
  // to the binary itself, so success here means a real health report got
  // produced, not that the process exited 0.
  const smoke = spawnSync(outfile, ['doctor'], { encoding: 'utf8', timeout: 30_000 });
  const resultLine = (smoke.stdout || '').match(/^Results:.*$/m)?.[0];
  if (resultLine) {
    console.log(`  ✓ compiled and smoke-tested: ${resultLine}`);
    return { target, ok: true, outfile, smoke: 'passed' };
  }
  console.error(`  ✗ compiled binary produced no health report (status=${smoke.status}, stdout="${smoke.stdout}", stderr="${smoke.stderr}")`);
  return { target, ok: true, outfile, smoke: 'FAILED — binary ran but produced no output' };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const t of TARGETS) console.log(`${t.id}\t${t.bunTarget}\t${t.outName}`);
    return;
  }
  if (!bunAvailable()) {
    console.error('bun not found on PATH. Install with: curl -fsSL https://bun.sh/install | bash');
    process.exit(1);
  }

  const requested = args.filter((a) => !a.startsWith('--'));
  const targets = requested.length
    ? TARGETS.filter((t) => requested.includes(t.id))
    : TARGETS;
  if (requested.length && targets.length !== requested.length) {
    const known = TARGETS.map((t) => t.id).join(', ');
    console.error(`Unknown target(s) in [${requested.join(', ')}]. Known targets: ${known}`);
    process.exit(1);
  }

  copyFileSync(ENTRY, BUILD_ENTRY);
  let results;
  try {
    results = targets.map(buildOne);
  } finally {
    rmSync(BUILD_ENTRY, { force: true });
  }

  console.log('\n▸ summary');
  for (const r of results) {
    console.log(`  ${r.ok ? 'built' : 'FAILED'}  ${r.target.id.padEnd(14)} smoke=${r.smoke}`);
  }

  if (results.some((r) => !r.ok)) process.exit(1);
  if (results.some((r) => r.smoke.startsWith('FAILED'))) {
    console.error('\nOne or more binaries built but failed the runtime smoke check.');
    process.exit(2);
  }
}

main();
