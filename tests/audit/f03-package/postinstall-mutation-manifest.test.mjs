/**
 * tests/audit/f03-package/postinstall-mutation-manifest.red.mjs — F03 [R3][R4] postinstall mutation receipt.
 *
 * RED fixtures (must FAIL against current code). bin/construct-postinstall.mjs runs on a
 * consumer's `npm install` and mutates the consumer project: it stages the `.construct/`
 * launcher and adapter dirs (L112-118) and APPENDS Construct patterns to the project's
 * `.gitignore` (L122-133). npm has no uninstall lifecycle hook to reverse those mutations when
 * the dependency is removed. The hook records no itemized manifest of what it touched and ships
 * no recovery command, and discards the stageProjectAdapters return value (L112) so a half-stage
 * (.gitignore appended but `.claude/` not synced) goes unrecorded.
 *
 * Contract these encode (CX-AUDIT-PACKAGE-004): any install-time project mutation must leave
 * an itemized, machine-readable manifest of the files it created/appended plus a recovery
 * command, and a failed sync must not leave the project mutated-but-incoherent without a
 * recorded marker. Each test runs the REAL postinstall script against a throwaway consumer
 * project (INIT_CWD pointed at a tmpdir) and asserts the receipt/marker that does not exist.
 *
 * Hermetic: the consumer project is fs.mkdtemp(os.tmpdir()); INIT_CWD/cwd are scoped to it so
 * nothing touches host state. CONSTRUCT_SKIP_POSTINSTALL is NOT set — this is the scripts-enabled
 * path. The package root is the real working tree resolved from this file's location.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const POSTINSTALL = path.join(REPO_ROOT, 'bin', 'construct-postinstall.mjs');

// Run the real postinstall as npm would: a project install (npm_config_global=false) with
// INIT_CWD pointed at a fresh consumer project that carries a package.json. Returns the
// project root plus the spawn result. The caller is responsible for tmp cleanup.

function runPostinstallInConsumer({ packageJson = '{"name":"demo-consumer","version":"1.0.0"}\n' } = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f03-postinstall-'));
  fs.writeFileSync(path.join(projectRoot, 'package.json'), packageJson);
  const result = spawnSync(process.execPath, [POSTINSTALL], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      INIT_CWD: projectRoot,
      npm_config_global: 'false',
      CONSTRUCT_SKIP_POSTINSTALL: '',
    },
  });
  return { projectRoot, result };
}

function snapshotMutations(projectRoot) {
  return {
    gitignore: fs.existsSync(path.join(projectRoot, '.gitignore')),
    construct: fs.existsSync(path.join(projectRoot, '.construct')),
    claude: fs.existsSync(path.join(projectRoot, '.claude')),
  };
}

// A receipt is any itemized record of install-time mutations the hook could leave: a JSON
// list of touched files plus a recovery command. Probe the documented and conventional spots.

function findInstallReceipt(projectRoot) {
  const candidates = [
    path.join(projectRoot, '.construct', 'install-manifest.json'),
    path.join(projectRoot, '.construct', 'install-receipt.json'),
    path.join(projectRoot, '.construct', 'postinstall-manifest.json'),
    path.join(projectRoot, '.cx', 'install-manifest.json'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  return { file, candidates };
}

test('[R3] scripts-enabled postinstall must leave an itemized mutation manifest with a recovery command', (t) => {
  const { projectRoot, result } = runPostinstallInConsumer();
  t.after(() => { try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch { /* tmp */ } });

  assert.equal(result.status, 0, `postinstall should exit 0; got ${result.status}: ${result.stderr}`);

  // Establish that real mutation happened — otherwise the manifest assertion would be vacuous.
  const mutated = snapshotMutations(projectRoot);
  assert.ok(
    mutated.gitignore || mutated.construct,
    `precondition: postinstall should have mutated the consumer project (.gitignore/.construct); saw ${JSON.stringify(mutated)}`,
  );

  const { file, candidates } = findInstallReceipt(projectRoot);
  assert.ok(
    file,
    `postinstall mutated the consumer project but wrote no itemized manifest (looked for: ${candidates.join(', ')})`,
  );

  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(
    Array.isArray(receipt.files) && receipt.files.length > 0,
    'manifest must itemize the files postinstall created/appended (receipt.files[])',
  );
  assert.ok(
    typeof receipt.recovery === 'string' && receipt.recovery.length > 0,
    'manifest must carry a recovery command (npm has no uninstall hook to reverse these mutations)',
  );
});

test('[R3] the manifest must record the .gitignore append so it can be reverted', (t) => {
  const { projectRoot, result } = runPostinstallInConsumer();
  t.after(() => { try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch { /* tmp */ } });

  assert.equal(result.status, 0, `postinstall should exit 0; got ${result.status}: ${result.stderr}`);

  const gitignorePath = path.join(projectRoot, '.gitignore');
  const appended = fs.existsSync(gitignorePath) && fs.readFileSync(gitignorePath, 'utf8').includes('.construct/');
  assert.ok(appended, 'precondition: postinstall appended Construct patterns to .gitignore');

  const { file } = findInstallReceipt(projectRoot);
  assert.ok(file, 'no install manifest exists, so the .gitignore append is unrecorded and unrevertable');

  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  const recordsGitignore = JSON.stringify(receipt).includes('.gitignore');
  assert.ok(
    recordsGitignore,
    'manifest must name the .gitignore append among its recorded mutations so a recovery step can undo exactly what was added',
  );
});
