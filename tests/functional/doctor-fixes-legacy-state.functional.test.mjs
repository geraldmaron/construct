/**
 * tests/functional/doctor-fixes-legacy-state.functional.test.mjs
 *
 * End-to-end coverage for the `construct doctor --fix-*` migration flags
 * added to clean up state that pre-2.0 installs left behind:
 *   - `.cx/` missing from project .gitignore (bead construct-1vv5)
 *   - Legacy cx-* files at user scope (sync-scope refactor cleanup)
 *   - Embed daemon log > 500MB (bead construct-88i)
 *
 * Each test spawns the real CLI in an isolated tmp HOME + tmp project,
 * seeds the legacy state, runs the fix flag, asserts the state is gone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { doctorRoot } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeEnv(args, extraEnv = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'cx-doctor-fix-'));
  const project = join(sandbox, 'project');
  const home = join(sandbox, 'HOME');
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  // Mark as a Construct project so the gitignore check runs.

  mkdirSync(join(project, '.cx'), { recursive: true });
  return {
    sandbox, project, home,
    runDoctor: (...moreArgs) => spawnSync(process.execPath, [BIN, 'doctor', ...args, ...moreArgs], {
      cwd: project,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env, HOME: home, CONSTRUCT_SKIP_POSTINSTALL: '1', ...extraEnv },
    }),
    cleanup: () => rmTmpDir(sandbox),
  };
}

test('doctor flags missing .cx/ in project .gitignore and --fix-gitignore appends it', { timeout: 60_000 }, async () => {
  const env = makeEnv([]);
  try {
    const before = env.runDoctor();
    assert.ok(
      /\.cx\/.*--fix-gitignore/.test(before.stdout),
      `doctor should flag the missing .cx/ entry; stdout:\n${before.stdout}`,
    );
    assert.equal(existsSync(join(env.project, '.gitignore')), false, 'precondition: no .gitignore');

    const fix = env.runDoctor('--fix-gitignore');
    assert.match(fix.stdout, /appended \.cx\//, `fix run must announce the append; stdout:\n${fix.stdout}`);
    const gi = readFileSync(join(env.project, '.gitignore'), 'utf8');
    assert.match(gi, /\.cx\/\s*$/m, '.cx/ must be in .gitignore after --fix-gitignore');
    assert.match(gi, /Construct runtime state/, 'fix block must include the explanation');
  } finally { env.cleanup(); }
});

test('doctor counts legacy cx-* files at user scope and --fix-legacy-agents sweeps them', { timeout: 90_000 }, async () => {
  const env = makeEnv([]);
  try {
    // Seed legacy cx-* files in each user-scope dir, mimicking a pre-2.0 install.

    const claude = join(env.home, '.claude', 'agents');
    const codex = join(env.home, '.codex', 'agents');
    const copilot = join(env.home, '.github', 'prompts');
    mkdirSync(claude, { recursive: true });
    mkdirSync(codex, { recursive: true });
    mkdirSync(copilot, { recursive: true });
    for (const name of ['cx-architect', 'cx-engineer', 'cx-security']) {
      writeFileSync(join(claude, `${name}.md`), `# ${name}\n`);
      writeFileSync(join(codex, `${name}.toml`), `name = "${name}"\n`);
      writeFileSync(join(copilot, `${name}.prompt.md`), `prompt body\n`);
    }
    // User-authored cx-* that DOES NOT match a registered name — must survive the sweep.

    writeFileSync(join(claude, 'cx-mytool.md'), '# my tool\n');

    const before = env.runDoctor();
    assert.match(before.stdout, /Legacy cx-\* files at user scope:\s*9/, `before-fix should report 9 files; stdout:\n${before.stdout}`);

    const fix = env.runDoctor('--fix-legacy-agents');
    assert.match(fix.stdout, /swept 9 legacy cx-\* file/, `fix run must announce the sweep; stdout:\n${fix.stdout}`);

    // The 9 registered cx-* files are gone; the user-authored cx-mytool.md survives.

    for (const name of ['cx-architect', 'cx-engineer', 'cx-security']) {
      assert.equal(existsSync(join(claude, `${name}.md`)), false, `${name}.md must be swept from Claude`);
      assert.equal(existsSync(join(codex, `${name}.toml`)), false, `${name}.toml must be swept from Codex`);
      assert.equal(existsSync(join(copilot, `${name}.prompt.md`)), false, `${name}.prompt.md must be swept from Copilot`);
    }
    assert.equal(existsSync(join(claude, 'cx-mytool.md')), true, 'user-authored cx-mytool.md must survive');
  } finally { env.cleanup(); }
});

test('doctor flags oversized embed daemon log and --fix-embed-log rotates it', { timeout: 90_000 }, async () => {
  // Lower the doctor's "force rotate" threshold to 2 MB so the test seeds a
  // small fixture file instead of a 600 MB sparse one (which APFS reported as
  // logical-size 0 from a foreign process — flaky cross-platform).

  const env = makeEnv([], { CONSTRUCT_DOCTOR_EMBED_LOG_FORCE_MB: '2' });
  try {
    const runtimeDir = join(doctorRoot(env.home), 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    const logPath = join(runtimeDir, 'embed-daemon.log');
    writeFileSync(logPath, 'x'.repeat(3 * 1024 * 1024));  // 3 MB > 2 MB threshold
    assert.ok(statSync(logPath).size > 2 * 1024 * 1024, 'precondition: log > 2MB');

    const before = env.runDoctor();
    assert.match(before.stdout, /Embed daemon log oversized.*--fix-embed-log/, `before-fix flags oversize; stdout:\n${before.stdout}`);

    const fix = env.runDoctor('--fix-embed-log');
    assert.match(fix.stdout, /rotated to embed-daemon\.1\.log/, `fix run must announce the rotation; stdout:\n${fix.stdout}`);
    assert.equal(existsSync(logPath), false, 'active log file must be moved aside after rotation');
    const segments = readdirSync(runtimeDir).filter((f) => f.startsWith('embed-daemon.'));
    assert.ok(segments.some((s) => /\.1\.log(\.gz)?$/.test(s)), `expected a .1.log segment; got ${segments.join(', ')}`);
  } finally { env.cleanup(); }
});

test('doctor flags legacy user-scope project-state files and --fix-migrate-state archives them', { timeout: 90_000 }, async () => {
  const env = makeEnv([]);
  try {
    // Seed legacy project-scoped .jsonl files at the user-scope doctor root
    // (pre-isolation refactor).

    const userState = doctorRoot(env.home);
    mkdirSync(userState, { recursive: true });
    writeFileSync(join(userState, 'contract-violations.jsonl'), '{"contract":"x"}\n');
    writeFileSync(join(userState, 'audit-reads.jsonl'), '{"path":"y"}\n');
    writeFileSync(join(userState, 'agent-log.jsonl'), '{"agent":"z"}\n');
    writeFileSync(join(userState, 'intent-verifications.jsonl'), '{"specialist":"q"}\n');

    const before = env.runDoctor();
    assert.match(before.stdout, /Legacy user-scope project-state files: 4.*--fix-migrate-state/, `before-fix flags legacy state; stdout:\n${before.stdout}`);

    const fix = env.runDoctor('--fix-migrate-state');
    assert.match(fix.stdout, /archived 4 legacy user-scope file/, `fix run must announce archive; stdout:\n${fix.stdout}`);

    // Originals removed.

    for (const name of ['contract-violations.jsonl', 'audit-reads.jsonl', 'agent-log.jsonl', 'intent-verifications.jsonl']) {
      assert.equal(existsSync(join(userState, name)), false, `${name} must be moved out of the user-scope doctor root`);
    }
    // Archive contains four files under the doctor root's legacy/ dir.

    const archiveDir = join(userState, 'legacy');
    assert.ok(existsSync(archiveDir), 'archive dir must exist');
    const archived = readdirSync(archiveDir).filter((f) => f.endsWith('.jsonl'));
    assert.equal(archived.length, 4, `expected 4 archived files; got: ${archived.join(', ')}`);
  } finally { env.cleanup(); }
});

test('doctor --fix-all runs every available fix in one invocation', { timeout: 120_000 }, async () => {
  const env = makeEnv([]);
  try {
    // Seed all three legacy states.

    const claude = join(env.home, '.claude', 'agents');
    mkdirSync(claude, { recursive: true });
    writeFileSync(join(claude, 'cx-architect.md'), '# legacy\n');

    const result = env.runDoctor('--fix-all');
    assert.match(result.stdout, /appended \.cx\//, 'fix-all must run --fix-gitignore');
    assert.match(result.stdout, /swept 1 legacy cx-\* file/, 'fix-all must run --fix-legacy-agents');

    // Verify both took effect.

    const gi = readFileSync(join(env.project, '.gitignore'), 'utf8');
    assert.match(gi, /\.cx\//, '.gitignore must contain .cx/');
    assert.equal(existsSync(join(claude, 'cx-architect.md')), false, 'legacy file swept');
  } finally { env.cleanup(); }
});
