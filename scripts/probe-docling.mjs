#!/usr/bin/env node
/**
 * probe-docling.mjs — record whether this machine's Docling install satisfies
 * the extraction ladder's admission gate.
 *
 * Same discipline as the host conformance probes: the dependency is admitted
 * behind a probe, never on assertion. The probe asks the binary to identify
 * itself and, when present, runs one tiny extraction to prove the invocation
 * shape the executing half uses (`docling <file> --to md --output -`) still
 * holds. Exit 0 means available and conformant; exit 1 means unavailable —
 * which is a recorded state, not a failure of this script: the ladder plans
 * around it and the fallback is stated wherever a source is refused.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = spawnSync('docling', ['--version'], { encoding: 'utf8', timeout: 60_000 });
if (version.status !== 0 || !(version.stdout ?? '').trim()) {
  console.log('probe-docling: UNAVAILABLE');
  console.log(
    `  evidence: ${version.status === null ? 'binary not found on PATH' : `--version exited ${version.status}`}`,
  );
  console.log('  consequence: the docling rungs are not planned; native text formats still extract.');
  console.log('  remediation: install docling (pipx install docling) and re-run this probe.');
  process.exit(1);
}
console.log(`probe-docling: version ${version.stdout.trim().split('\n')[0]}`);

const dir = mkdtempSync(join(tmpdir(), 'docling-probe-'));
try {
  const sample = join(dir, 'probe.html');
  writeFileSync(sample, '<html><body><h1>Probe</h1><p>one paragraph</p></body></html>');
  const run = spawnSync('docling', [sample, '--to', 'md', '--output', '-'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  const ok = run.status === 0 && (run.stdout ?? '').includes('Probe');
  console.log(
    ok
      ? 'probe-docling: extraction shape holds (`<file> --to md --output -` yields markdown on stdout)'
      : `probe-docling: FAILED — binary present but the invocation shape did not hold (exit ${String(run.status)})`,
  );
  process.exit(ok ? 0 : 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
