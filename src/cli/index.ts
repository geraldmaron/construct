/**
 * cli/index.ts — the one CLI. Phase 0 surface: doctor, version. Commands stay
 * few; capability grows in packs and kernel libraries, not in CLI surface.
 */

import { readFileSync } from 'node:fs';
import { resolvePaths } from '../kernel/paths.ts';

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

export function main(argv: string[] = process.argv.slice(2)): number {
  const command = argv[0] ?? 'help';
  switch (command) {
    case 'doctor':
      return doctor();
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${packageVersion()}\n`);
      return 0;
    default:
      process.stdout.write('usage: construct <doctor|version>\n');
      return command === 'help' ? 0 : 1;
  }
}
