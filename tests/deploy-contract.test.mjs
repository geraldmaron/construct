/**
 * tests/deploy-contract.test.mjs — Contract tests for deploy/runtime wiring.
 *
 * Verifies Terraform templates and runtime env helpers stay aligned on
 * named secrets, database settings, and expected container environment.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('terraform root passes ACM certificate through to ECS module', () => {
  const source = read('deploy/terraform/main.tf');
  assert.match(source, /certificate_arn\s*=\s*var\.acm_certificate_arn/);
});

test('ECS module injects named runtime secrets instead of anonymous SECRET_n variables', () => {
  const source = read('deploy/terraform/modules/ecs/main.tf');
  assert.match(source, /name\s*=\s*"CONSTRUCT_DASHBOARD_TOKEN"/);
  assert.match(source, /name\s*=\s*"DB_PASSWORD"/);
  assert.match(source, /name\s*=\s*"ANTHROPIC_API_KEY"/);
  assert.doesNotMatch(source, /SECRET_\$\{index|SECRET_0|SECRET_1/);
});

test('ECS module sets CX_DATA_DIR for the container runtime contract', () => {
  const source = read('deploy/terraform/modules/ecs/main.tf');
  assert.match(source, /name\s*=\s*"CX_DATA_DIR"/);
  assert.match(source, /value\s*=\s*"\/data"/);
});
