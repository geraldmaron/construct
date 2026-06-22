/**
 * lib/certification/cli.mjs — read-only certification run inspection (construct certify).
 *
 * Scenario execution lands in construct-xp5k.2.2; this module wires the durable store
 * into production so certification artifacts are not test-only dead code.
 */

import {
  listCertificationRunIds,
  readCertificationRun,
} from './store.mjs';

export function runCertificationCli(args = [], { projectDir = process.cwd() } = {}) {
  const sub = args[0] || 'list';
  const rest = args.slice(1);

  if (sub === 'list') {
    const ids = listCertificationRunIds({ rootDir: projectDir });
    if (rest.includes('--json')) {
      process.stdout.write(`${JSON.stringify(ids, null, 2)}\n`);
      return 0;
    }
    if (!ids.length) {
      process.stdout.write('No certification runs recorded under .cx/certification/runs/\n');
      return 0;
    }
    for (const id of ids) process.stdout.write(`${id}\n`);
    return 0;
  }

  if (sub === 'show') {
    const runId = rest.find((arg) => !arg.startsWith('-'));
    if (!runId) {
      process.stderr.write('Usage: construct certify show <run-id> [--json]\n');
      return 1;
    }
    const { run } = readCertificationRun(runId, { rootDir: projectDir });
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    return 0;
  }

  process.stderr.write('Usage: construct certify list|show\n');
  return 1;
}
