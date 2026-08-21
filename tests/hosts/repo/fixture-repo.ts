/**
 * tests/hosts/repo/fixture-repo.ts — a real git repository, built in a tmpdir,
 * for the evidence gatherer to be asked questions about.
 *
 * The gatherer spawns git, so a fixture that stubbed git would be testing the
 * stub. What it must never do is reach the developer's own repository or
 * configuration: every command below runs with a HOME inside the tmpdir and
 * both config files pointed at nothing, so a global hook, template directory,
 * or `init.defaultBranch` cannot decide whether these tests pass.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The commit date every fixture commit carries unless a call overrides it. */
export const DEFAULT_COMMIT_DATE = '2026-01-01T00:00:00Z';

export interface FixtureRepo {
  readonly root: string;
  git(...args: string[]): string;
  /**
   * Write the tracker export and commit it with the given message. `at`
   * overrides the commit's author/committer date (default: DEFAULT_COMMIT_DATE)
   * for tests that need revisions spread across a history window rather than
   * stacked on one instant.
   */
  export(records: readonly Record<string, unknown>[], message: string, at?: string): void;
  /** A commit that changes nothing, so a message can be placed on a branch. */
  commit(message: string, at?: string): void;
  cleanup(): void;
}

export function fixtureRepo(mainBranch = 'main'): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), 'construct-repo-'));
  const env = {
    ...process.env,
    HOME: root,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: DEFAULT_COMMIT_DATE,
    GIT_COMMITTER_DATE: DEFAULT_COMMIT_DATE,
  };

  function run(args: string[], withEnv: typeof env): string {
    const result = spawnSync('git', args, { cwd: root, env: withEnv, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? ''}`);
    }
    return result.stdout;
  }

  function git(...args: string[]): string {
    return run(args, env);
  }

  function dated(at: string | undefined): typeof env {
    return at ? { ...env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : env;
  }

  git('init', `--initial-branch=${mainBranch}`);
  mkdirSync(join(root, '.beads'), { recursive: true });

  return {
    root,
    git,
    export(records, message, at) {
      const lines = records.map((r) => JSON.stringify({ _type: 'issue', ...r })).join('\n');
      writeFileSync(join(root, '.beads/issues.jsonl'), `${lines}\n`);
      git('add', '.beads/issues.jsonl');
      run(['commit', '-m', message], dated(at));
    },
    commit(message, at) {
      run(['commit', '--allow-empty', '-m', message], dated(at));
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
