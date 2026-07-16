/**
 * tests/oracle-invariants-deployment-workflow-targets-real-artifacts.test.mjs — the
 * `deployment-workflow-targets-real-artifacts` Layer 1 invariant: docker build line
 * parsing (real observed shapes from deploy.yml/aws-smoke.yml) and Dockerfile
 * existence checks against a real hermetic fixture tree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { id, layer, parseDockerBuildLine, evaluateWorkflowFile, check } from '../lib/oracle/invariants/deployment-workflow-targets-real-artifacts.mjs';

function makeFixtureRepo(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-deploy-artifacts-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, '.github', 'workflows'), { recursive: true });
  return cwd;
}

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'deployment-workflow-targets-real-artifacts');
  assert.equal(layer, 1);
});

test('parseDockerBuildLine parses real observed shapes from this repo\'s own workflows', () => {
  assert.deepEqual(parseDockerBuildLine('          docker build -t "$IMAGE_URI" .'), { file: null, context: '.' });
  assert.deepEqual(
    parseDockerBuildLine('          docker build -t construct-smoke:${{ github.sha }} .'),
    { file: null, context: '.' },
  );
  assert.deepEqual(parseDockerBuildLine('docker build -f deploy/Dockerfile.prod -t tag ./services/api'), {
    file: 'deploy/Dockerfile.prod',
    context: './services/api',
  });
});

test('parseDockerBuildLine returns null for a line with no docker build invocation', () => {
  assert.equal(parseDockerBuildLine('          docker push "$IMAGE_URI"'), null);
  assert.equal(parseDockerBuildLine('name: Deploy'), null);
});

test('evaluateWorkflowFile: a docker build targeting a missing Dockerfile is a violation', (t) => {
  const cwd = makeFixtureRepo(t);
  const workflowPath = path.join(cwd, '.github', 'workflows', 'deploy.yml');
  fs.writeFileSync(workflowPath, 'jobs:\n  build:\n    steps:\n      - run: docker build -t "$IMAGE_URI" .\n');

  const results = evaluateWorkflowFile(workflowPath, cwd);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].dockerfilePath, 'Dockerfile');
});

test('evaluateWorkflowFile: a docker build targeting an existing Dockerfile passes', (t) => {
  const cwd = makeFixtureRepo(t);
  fs.writeFileSync(path.join(cwd, 'Dockerfile'), 'FROM node:20\n');
  const workflowPath = path.join(cwd, '.github', 'workflows', 'deploy.yml');
  fs.writeFileSync(workflowPath, 'jobs:\n  build:\n    steps:\n      - run: docker build -t "$IMAGE_URI" .\n');

  const results = evaluateWorkflowFile(workflowPath, cwd);
  assert.equal(results[0].status, 'passed');
});

test('evaluateWorkflowFile: an explicit -f flag resolves the Dockerfile path, not context/Dockerfile', (t) => {
  const cwd = makeFixtureRepo(t);
  fs.mkdirSync(path.join(cwd, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'deploy', 'Dockerfile.prod'), 'FROM node:20\n');
  const workflowPath = path.join(cwd, '.github', 'workflows', 'deploy.yml');
  fs.writeFileSync(workflowPath, 'jobs:\n  build:\n    steps:\n      - run: docker build -f deploy/Dockerfile.prod -t tag .\n');

  const results = evaluateWorkflowFile(workflowPath, cwd);
  assert.equal(results[0].status, 'passed');
  assert.equal(results[0].dockerfilePath, path.join('deploy', 'Dockerfile.prod'));
});

test('check(): rolls up to failed when any workflow targets a missing Dockerfile', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.writeFileSync(
    path.join(cwd, '.github', 'workflows', 'deploy.yml'),
    'jobs:\n  build:\n    steps:\n      - run: docker build -t "$IMAGE_URI" .\n',
  );
  const result = await check({ cwd });
  assert.equal(result.status, 'failed');
  assert.equal(result.violations.length, 1);
});

test('check(): no docker build lines in any workflow rolls up to passed with zero evaluated', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'ci.yml'), 'jobs:\n  test:\n    steps:\n      - run: npm test\n');
  const result = await check({ cwd });
  assert.equal(result.status, 'passed');
  assert.equal(result.evaluated, 0);
});

test('check(): a repo with no .github/workflows directory rolls up to passed with zero evaluated, not a crash', async () => {
  const result = await check({ workflowsDir: '/nonexistent/workflows/dir/for/this/test' });
  assert.equal(result.status, 'passed');
  assert.equal(result.evaluated, 0);
});
