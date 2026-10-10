import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { methodReceipts } from '../../../src/kernel/workflow/methods.ts';

const skills = createSkillRegistry({ projectDir: null });
test('method assignment cannot masquerade as application or qualification', () => {
  const result = methodReceipts({ methodReceipts: [{ status: 'executed_verified' }] }, 'context-mapping', skills);
  assert.equal(result.receipts[0]?.status, 'unreported');
  assert.equal(result.receipts[0]?.digest, skills.get('context-mapping')?.digest);
});
test('composed method reports bind exact skills and evidence while preserving their weaker provenance', () => {
  const result = methodReceipts({ methods: [
    { id: 'context-mapping', disposition: 'applied', why: 'Established the dependency and authority map.', evidence: ['records/a'] },
    { id: 'adversarial-review', disposition: 'deferred', why: 'Draft is not yet available.', evidence: [] },
  ] }, 'context-mapping', skills, (ref) => ({ ref, kind: 'item', provenance: 'reported', text: 'Actual source content' }));
  assert.deepEqual(result.problems, []);
  assert.equal(result.receipts[0]?.status, 'reported_applied');
  assert.match(result.receipts[0]?.evidence[0]?.digest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(result.receipts[1]?.status, 'reported_deferred');
  assert.equal(result.receipts[0]?.evidence[0]?.provenance, 'reported');
});
test('unknown methods, duplicate claims and unresolved method evidence are rejected', () => {
  for (const methods of [
    [{ id: 'fictional', disposition: 'applied', why: 'x' }],
    [{ id: 'context-mapping', disposition: 'qualified', why: 'x' }],
    [{ id: 'context-mapping', disposition: 'applied', why: 'x', evidence: ['missing'] }],
    [{ id: 'context-mapping', disposition: 'applied', why: 'x' }, { id: 'context-mapping', disposition: 'skipped', why: 'y' }],
  ]) assert.ok(methodReceipts({ methods }, null, skills, () => null).problems.length > 0);
});
