/**
 * tests/functional/lci-external-repo.functional.test.mjs —
 * construct-4uxq0.11.15 multi-component proof: init → graph build → change-intent
 * → impact packet → graph verify in a plain non-Construct project directory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

function makeExternalProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-external-project-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-external-home-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'lci-external@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'LCI External Cert'], { cwd: project });

  fs.mkdirSync(path.join(project, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(project, 'lib', 'greeter.mjs'), `export function greet(name) {
  return \`Hello, \${name}!\`;
}
`, 'utf8');
  fs.writeFileSync(path.join(project, 'lib', 'index.mjs'), `import { greet } from './greeter.mjs';
export { greet };
`, 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: project });
  spawnSync('git', ['commit', '-q', '-m', 'initial plain project'], { cwd: project });

  return {
    project,
    home,
    cleanup: () => {
      rmTmpDir(project);
      rmTmpDir(home);
    },
  };
}

function runConstruct(args, { project, home }) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: project,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: sterileSpawnEnv({
      HOME: home,
      CONSTRUCT_HOME_OVERRIDE: home,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
    }),
  });
}

test('LCI loop completes in a disposable non-Construct project', (t) => {
  const { project, home, cleanup } = makeExternalProject();
  t.after(cleanup);

  assert.notEqual(path.resolve(project), path.resolve(REPO_ROOT), 'fixture must live outside the Construct checkout');

  const init = runConstruct(['init', '--yes', '--no-start'], { project, home });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  assert.ok(fs.existsSync(path.join(project, '.construct', 'context.md')), 'init scaffolds .construct/');

  const build = runConstruct(['graph', 'build', '--no-co-change'], { project, home });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.ok(fs.existsSync(path.join(project, '.construct', 'graph', 'nodes.jsonl')), 'graph persisted under project .construct/graph');

  const files = runConstruct(['graph', 'query', '--type', 'file', '--json'], { project, home });
  assert.equal(files.status, 0, files.stderr || files.stdout);
  const filesJson = JSON.parse(files.stdout.slice(files.stdout.indexOf('{')));
  const greeterNodes = filesJson.nodes.filter((n) => (n.node?.name || n.name) === 'lib/greeter.mjs');
  assert.ok(greeterNodes.length >= 1, 'project lib/greeter.mjs appears in the import graph');

  const target = 'file:lib/greeter.mjs';
  const declare = runConstruct(['graph', 'intent', 'declare', '--target', target, '--json'], { project, home });
  assert.equal(declare.status, 0, declare.stderr || declare.stdout);
  const intent = JSON.parse(declare.stdout.slice(declare.stdout.indexOf('{')));
  assert.ok(intent.id.startsWith('intent-'));
  assert.deepEqual(intent.targets, [target]);
  assert.ok(intent.packet?.graphPresent, 'impact packet computed against built graph');

  fs.appendFileSync(path.join(project, 'lib', 'greeter.mjs'), '\n// post-intent touch\n', 'utf8');

  const verify = runConstruct(['graph', 'verify', '--changed', 'lib/greeter.mjs'], { project, home });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.match(verify.stdout, /graph verify passed/);
});
