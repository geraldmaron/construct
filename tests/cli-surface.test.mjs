/**
 * tests/cli-surface.test.mjs — validates public CLI behavior against the current project cwd.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from './helpers.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin', 'construct');

test('construct search uses the current working directory as project scope', () => {
  const homeDir = tempDir('construct-cli-home-');
  const projectDir = tempDir('construct-cli-project-');

  fs.mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'docs', 'architecture.md'), '# Architecture\nProject-local authoritative search target.\n');
  fs.writeFileSync(path.join(projectDir, 'docs', 'README.md'), '# Docs\n');
  fs.writeFileSync(path.join(projectDir, '.cx', 'context.json'), JSON.stringify({
    contextSummary: 'Project-local context',
    savedAt: '2026-04-19T00:00:00Z',
  }));
  fs.writeFileSync(path.join(projectDir, 'plan.md'), '# Plan\n\n- Search should stay project-local.\n');

  const out = execFileSync(process.execPath, [BIN, 'search', 'authoritative search', '--limit=5'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir },
  });

  const json = JSON.parse(out);
  assert.equal(json.summary.hasPlan, true);
  assert.ok(json.results.some((entry) => entry.id === 'docs/concepts/architecture.md'));
});

test('construct evals exposes evaluator catalog', () => {
  const out = execFileSync(process.execPath, [BIN, 'evals', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  const json = JSON.parse(out);
  assert.ok(typeof json.backendUrl === 'string');
  assert.ok(typeof json.configured === 'boolean');
});

test('construct help includes core commands by default', () => {
  const out = execFileSync(process.execPath, [BIN, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  // Core commands should be visible
  assert.match(out, /dev\s+Start services for development/);
  assert.match(out, /stop\s+Stop all running services/);
  assert.match(out, /init\s+Project setup/);
});

test('construct help --all includes advanced commands', () => {
  const out = execFileSync(process.execPath, [BIN, '--help', '--all'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  // Advanced commands should only be visible with --all
  assert.match(out, /update\s+Reinstall this checkout/);
  assert.match(out, /beads\s+Task queue management/);
});

test('construct completions bash prints a bash completion script', () => {
  const out = execFileSync(process.execPath, [BIN, 'completions', 'bash'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.match(out, /bash completion for construct/);
  assert.match(out, /complete -F _construct_completions construct/);
});

// internal: true commands stay callable but must never be advertised as tab
// candidates. The candidate set is the top-level command list (bash) and the
// _describe block (zsh); a leak there breaks the cli-commands.mjs visibility
// contract, which is how all 15 internals once surfaced in completions.
test('completions hide internal commands and keep public ones', async () => {
  const { CLI_COMMANDS } = await import('../lib/cli-commands.mjs');
  const internal = CLI_COMMANDS.filter((c) => c.internal);
  const pub = CLI_COMMANDS.filter((c) => !c.internal);
  assert.ok(internal.length > 0 && pub.length > 0, 'fixture sanity: both sets non-empty');

  // bash: candidates are the space-separated tokens in `commands="…"` — exact
  // membership, colon-names like `claude:allow` are intact tokens.
  const bash = execFileSync(process.execPath, [BIN, 'completions', 'bash'], { cwd: ROOT, encoding: 'utf8' });
  const bashCandidates = new Set((bash.match(/commands="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean));
  for (const cmd of internal) {
    assert.ok(!bashCandidates.has(cmd.name), `bash: internal command "${cmd.name}" must not be a completion candidate`);
  }
  for (const cmd of pub) {
    assert.ok(bashCandidates.has(cmd.name), `bash: public command "${cmd.name}" must be a completion candidate`);
  }

  // zsh: the top-level command list is the 4-space-indented `'<name>:<emoji> …'`
  // _describe block; subcommand entries sit at deeper indent. Command names can
  // contain colons, so test for the literal top-level entry rather than parsing
  // the name back out of an ambiguous `name:desc` string.
  const zsh = execFileSync(process.execPath, [BIN, 'completions', 'zsh'], { cwd: ROOT, encoding: 'utf8' });
  const zshTopLevel = (name) => zsh.includes(`\n    '${name}:`);
  for (const cmd of internal) {
    assert.ok(!zshTopLevel(cmd.name), `zsh: internal command "${cmd.name}" must not be a completion candidate`);
  }
  for (const cmd of pub) {
    assert.ok(zshTopLevel(cmd.name), `zsh: public command "${cmd.name}" must be a completion candidate`);
  }
});

// `construct install` runs the global sync twice; in a non-project cwd both hit
// the same global branch and would print the summary twice. --quiet on the first
// call suppresses only the summary, not the work, so the canonical line prints
// once. Guard: --quiet drops the summary, plain sync keeps it, both still write.
test('sync --quiet suppresses the summary line but still does the work', () => {
  const home = tempDir('construct-sync-home-');
  const cwd = tempDir('construct-sync-cwd-');
  const env = { ...process.env, HOME: home, CX_HOME_OVERRIDE: home, CONSTRUCT_DEV_PATH: ROOT };
  const run = (args) => execFileSync(process.execPath, [BIN, 'sync', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });

  const plain = run([]);
  assert.match(plain, /to global scope/, 'plain sync prints the global summary');

  const quiet = run(['--quiet']);
  assert.doesNotMatch(quiet, /to global scope/, '--quiet suppresses the global summary');
  assert.doesNotMatch(quiet, /Completions updated/, '--quiet suppresses the completions line');
  // Work still happened: completions are written under the isolated HOME.
  assert.ok(fs.existsSync(path.join(home, '.local', 'share', 'construct', 'completions')), '--quiet still writes completions');
});

test('construct beads status reports lock state for a local beads directory', () => {
  const projectDir = tempDir('construct-cli-beads-');
  fs.mkdirSync(path.join(projectDir, '.beads', 'embeddeddolt'), { recursive: true });

  const out = execFileSync(process.execPath, [BIN, 'beads', 'status'], {
    cwd: projectDir,
    encoding: 'utf8',
  });

  assert.match(out, /No lock held|Lock held by/);
});
