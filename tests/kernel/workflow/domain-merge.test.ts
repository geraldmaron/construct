import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import type { WorkflowManifest } from '../../../src/kernel/registry/models.ts';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/domain-contracts.json', import.meta.url), 'utf8')) as Record<
  string,
  WorkflowManifest
>;
const workflows = createWorkflowRegistry({ projectDir: null });

for (const [oldId, old] of Object.entries(baseline)) {
  test(`${oldId}: the merged domain preserves every validator, input, tier and source`, () => {
    const family = old.steps.some((s) => s.id === 'review') ? 'review' : 'authoring';
    const domain = old.steps.find((s) => ['review', 'draft', 'synthesize'].includes(s.id))!.skill!.id;
    const merged = workflows.get(family, domain)!.manifest;
    const normalized = JSON.parse(JSON.stringify(old).replaceAll('synthesize', 'draft')) as WorkflowManifest;
    assert.deepEqual(
      merged.requiredInputs.filter((k) => k !== 'domain'),
      old.requiredInputs,
    );
    assert.deepEqual(merged.inputSchema, { ...old.inputSchema, domain: 'string' });
    for (const step of normalized.steps) {
      const bound = merged.steps.find((s) => s.id === step.id)!;
      assert.deepEqual({ ...bound, validators: undefined }, { ...step, validators: undefined });
      for (const validator of step.validators) assert.ok(bound.validators.includes(validator), `${step.id}: ${validator} preserved`);
    }
    for (const key of [
      'triggers',
      'onNoData',
      'onStaleData',
      'concurrency',
      'cancellation',
      'deliverable',
      'execution',
      'proposes',
    ] as const)
      assert.deepEqual(merged[key], old[key], key);
    assert.deepEqual(merged.dedupeKey, [...old.dedupeKey, 'domain']);
  });
}

test('aliases select exactly one domain; the canonical catalog has no retired workflows', () => {
  assert.equal(workflows.list().length, 12);
  assert.equal(workflows.get('remember'), null);
  for (const merged of workflows.list().filter((w) => w.manifest.domains)) {
    for (const [alias, domain] of Object.entries(merged.manifest.aliases!)) {
      const selected = workflows.get(alias)!;
      assert.equal(selected.canonicalId, merged.manifest.id);
      assert.equal(selected.domain, domain);
      assert.equal(selected.manifest.steps.find((s) => s.id === merged.manifest.domainStep)?.skill?.id, domain);
      assert.equal(workflows.get(alias, 'wrong-domain'), null);
      assert.ok(!workflows.list().some((w) => w.manifest.id === alias));
      assert.ok(workflows.file(alias, 'workflow.json'), 'old bundle addresses resolve to the merged bundle');
    }
    assert.equal(workflows.get(merged.manifest.id, 'wrong-domain'), null);
    assert.equal(workflows.get(merged.manifest.id, 'constructor'), null);
    assert.equal(workflows.get('constructor'), null);
  }
});
