/**
 * tests/kernel/workflow/domain-merge.test.ts — a domain-keyed workflow is
 * addressed by its id and one of its declared domains; each binding uses that
 * domain's skill, and nothing else resolves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { workflowCandidates } from '../../../src/kernel/registry/workflow-domains.ts';

const workflows = createWorkflowRegistry({ projectDir: null });

test('each declared domain binds its own skill, and an undeclared domain or id resolves to nothing', () => {
  assert.equal(workflows.list().length, 12);
  assert.equal(workflows.get('remember'), null);
  for (const merged of workflows.list().filter((w) => w.manifest.domains)) {
    for (const domain of Object.keys(merged.manifest.domains!)) {
      const bound = workflows.get(merged.manifest.id, domain)!;
      assert.equal(bound.canonicalId, merged.manifest.id);
      assert.equal(bound.domain, domain);
      assert.equal(bound.manifest.id, merged.manifest.id);
      assert.equal(bound.manifest.steps.find((s) => s.id === merged.manifest.domainStep)?.skill?.id, domain);
    }
    assert.equal(workflows.get(merged.manifest.id, 'wrong-domain'), null);
    assert.equal(workflows.get(merged.manifest.id, 'constructor'), null);
  }
  for (const formerId of ['implementation-review', 'prd-authoring', 'research-brief']) assert.equal(workflows.get(formerId), null);
});

test('intake candidates hold one bound copy per domain, ordered by id then domain', () => {
  const candidates = workflowCandidates(workflows.list());
  const review = workflows.get('review')!;
  const bound = candidates.filter((c) => c.canonicalId === 'review').map((c) => c.domain);
  assert.deepEqual(bound, Object.keys(review.manifest.domains!).sort());
});
