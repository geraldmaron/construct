#!/usr/bin/env node
/**
 * scripts/build-binary.mjs — compile the Construct CLI to standalone binaries with Bun.
 *
 * Distribution primary path per the language-runtime strategy: `bun build --compile`
 * cross-compiles from a single host to macOS arm64/x64 and Linux x64/arm64 without
 * needing four physical machines. Requires Bun on PATH (`curl -fsSL https://bun.sh/install
 * | bash`) — this script does not install Bun itself.
 *
 * Known limitation (verified by hand, not yet fixed): `bin/construct` resolves its
 * install root via `path.resolve(import.meta.dirname, '..')` to locate sibling data
 * directories (skills/, specialists/, templates/, config/, registry/, package.json,
 * etc.) by real filesystem path. Under a Bun-compiled binary, `import.meta.dirname`
 * resolves to the virtual `/$bunfs/root` path, so that resolution collapses to
 * `/$bunfs` and every one of those reads throws ENOENT — the compiled binary currently
 * exits with no output and status 0 for every command. This is an architecture gap
 * (the CLI assumes a real on-disk sibling tree), not a native-module problem: LanceDB's
 * N-API binding and the MCP SDK both load and function correctly under a Bun-compiled
 * binary in isolation (see scratch verification in the task report). Fixing the CLI to
 * run standalone requires either an env/flag override for the data root (falling back
 * to `process.execPath`'s real directory when `import.meta.dirname` is a bunfs path) or
 * migrating the runtime reads to Bun's embedded-asset APIs. Tracked as follow-up; this
 * script still produces the binaries and runs a smoke check so the failure is visible
 * rather than silent.
 *
 * Usage:
 *   node scripts/build-binary.mjs                  — build all four targets
 *   node scripts/build-binary.mjs darwin-arm64      — build one target
 *   node scripts/build-binary.mjs --list            — print target table and exit
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = resolve(ROOT, 'dist');
const ENTRY = resolve(ROOT, 'bin', 'construct');

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
    ['build', '--compile', `--target=${target.bunTarget}`, ENTRY, '--outfile', outfile],
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

  const smoke = spawnSync(outfile, ['version'], { encoding: 'utf8', timeout: 10_000 });
  const producedOutput = (smoke.stdout || '').trim().length > 0;
  if (smoke.status === 0 && producedOutput) {
    console.log(`  ✓ compiled and smoke-tested: ${smoke.stdout.trim()}`);
    return { target, ok: true, outfile, smoke: 'passed' };
  }
  console.error(`  ✗ compiled binary produced no usable output (status=${smoke.status}, stdout="${smoke.stdout}", stderr="${smoke.stderr}")`);
  return { target, ok: true, outfile, smoke: 'FAILED — see known limitation in file header' };
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

  const results = targets.map(buildOne);

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
