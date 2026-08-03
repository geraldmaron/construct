/**
 * cli/index.ts — the one CLI. Phase 0 surface: doctor, version. Phase 1 adds
 * cleanup. Commands stay few; capability grows in packs and kernel libraries,
 * not in CLI surface.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolvePaths } from '../kernel/paths.ts';
import { buildCleanupCatalog } from '../kernel/cleanup/catalog.ts';
import { detectedItems, selectedItems, applyCleanup } from '../kernel/cleanup/run.ts';
import type { CleanupOptions } from '../kernel/cleanup/run.ts';

const MIN_NODE = { major: 22, minor: 18 };

function packageVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return (parsed as { version: string }).version;
}

function nodeFloorOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major !== MIN_NODE.major) return major > MIN_NODE.major;
  return minor >= MIN_NODE.minor;
}

export function doctor(): number {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: 'node',
    ok: nodeFloorOk(process.versions.node),
    detail: `v${process.versions.node} (floor: ${MIN_NODE.major}.${MIN_NODE.minor})`,
  });

  const paths = resolvePaths();
  checks.push({ name: 'paths', ok: true, detail: `state: ${paths.stateDir}` });

  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}  ${check.detail}\n`);
  }
  process.stdout.write(failed === 0 ? 'doctor: healthy\n' : `doctor: ${failed} check(s) failed\n`);
  return failed === 0 ? 0 : 1;
}

interface CleanupArgs extends CleanupOptions {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly cwd: string;
  readonly home: string;
}

export function parseCleanupArgs(argv: string[]): CleanupArgs {
  let scope: CleanupOptions['scope'] = 'all';
  let dryRun = false;
  let yes = false;
  let all = false;
  let keepState = false;
  let cwd = process.cwd();
  let home = homedir();
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--all') all = true;
    else if (arg === '--keep-state') keepState = true;
    else if (arg.startsWith('--scope=')) scope = arg.slice('--scope='.length) as CleanupOptions['scope'];
    else if (arg.startsWith('--cwd=')) cwd = arg.slice('--cwd='.length);
    else if (arg.startsWith('--home=')) home = arg.slice('--home='.length);
  }
  if (!['project', 'machine', 'all'].includes(scope)) {
    throw new Error(`Invalid --scope=${scope}; expected project|machine|all`);
  }
  return { scope, dryRun, yes, all, keepState, cwd, home };
}

const CLEANUP_COVERAGE_NOTE =
  'Note: does not yet detect Docker containers/images or macOS LaunchAgents left by the predecessor — remove those by hand if present (see construct-506.1).';

export function cleanup(argv: string[]): number {
  const args = parseCleanupArgs(argv);
  const paths = resolvePaths(process.env, args.home);
  const catalog = buildCleanupCatalog({ cwd: args.cwd, home: args.home, paths });
  const detected = detectedItems(catalog, args);

  if (detected.length === 0) {
    process.stdout.write('cleanup: no predecessor state detected in the selected scope.\n');
    process.stdout.write(`${CLEANUP_COVERAGE_NOTE}\n`);
    return 0;
  }

  if (args.dryRun) {
    process.stdout.write(`cleanup: dry-run plan (scope=${args.scope}${args.keepState ? ', keep-state' : ''}):\n`);
    for (const item of detected) {
      const mark = item.risk === 'auto' ? '✓' : '◐';
      process.stdout.write(`  ${mark} ${item.label}\n      ${item.describe()}\n`);
    }
    process.stdout.write('\nPass --yes to remove ✓ items, --yes --all to also remove ◐ items.\n');
    process.stdout.write(`${CLEANUP_COVERAGE_NOTE}\n`);
    return 0;
  }

  if (!args.yes) {
    process.stderr.write('cleanup: pass --dry-run to preview, or --yes (optionally --all) to apply.\n');
    return 2;
  }

  const toRemove = selectedItems(detected, args.all);
  const result = applyCleanup(detected, new Set(toRemove.map((item) => item.id)));
  for (const outcome of result.removed) {
    process.stdout.write(`  ✓ ${outcome.label} — ${outcome.detail}\n`);
  }
  process.stdout.write(`\ncleanup: removed ${result.removed.length}, skipped ${result.skipped.length}.\n`);
  process.stdout.write(`${CLEANUP_COVERAGE_NOTE}\n`);
  return result.removed.some((o) => o.detail.startsWith('error:')) ? 1 : 0;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const command = argv[0] ?? 'help';
  switch (command) {
    case 'doctor':
      return doctor();
    case 'cleanup':
      return cleanup(argv.slice(1));
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${packageVersion()}\n`);
      return 0;
    default:
      process.stdout.write('usage: construct <doctor|cleanup|version>\n');
      return command === 'help' ? 0 : 1;
  }
}
