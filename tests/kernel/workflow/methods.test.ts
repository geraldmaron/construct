import type { RefResolver } from '../../../src/kernel/project/evidence.ts';
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
  const result = methodReceipts(
    {
      methods: [
        { id: 'context-mapping', disposition: 'applied', why: 'Established the dependency and authority map.', evidence: ['records/a'] },
        { id: 'adversarial-review', disposition: 'deferred', why: 'Draft is not yet available.', evidence: [] },
      ],
    },
    'context-mapping',
    skills,
    (ref) => ({ ref, kind: 'item', provenance: 'reported', text: 'Actual source content' }),
  );
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
    [
      { id: 'context-mapping', disposition: 'applied', why: 'x' },
      { id: 'context-mapping', disposition: 'skipped', why: 'y' },
    ],
  ])
    assert.ok(methodReceipts({ methods }, null, skills, () => null).problems.length > 0);
});

test('method obligations bind existing output sections and keep doctrine separate from project facts', () => {
  const resolve: RefResolver = (ref) =>
    ref === 'project:policy' ? { ref, kind: 'item', provenance: 'reported', text: 'Actual policy' } : null;
  const applied = {
    id: 'decision-framing',
    disposition: 'applied',
    why: 'Compared the alternatives',
    evidence: ['project:policy'],
    doctrine: ['method:decision-framework'],
    obligations: [{ obligation: 'State tradeoffs', section: '/findings/0', evidence: ['project:policy'] }],
  };
  const result = methodReceipts(
    { findings: ['The constraint affects both alternatives.'], methods: [applied] },
    'decision-framing',
    skills,
    resolve,
  );
  assert.deepEqual(result.problems, []);
  assert.equal(result.receipts[0].doctrine?.[0].purpose, 'procedure_only');
  assert.match(result.receipts[0].obligations?.[0].sectionDigest ?? '', /^[a-f0-9]{64}$/);
  assert.ok(methodReceipts({ findings: [], methods: [applied] }, null, skills, resolve).problems.some((p) => p.includes('absent')));
  assert.ok(
    methodReceipts(
      {
        findings: ['claim'],
        methods: [{ ...applied, obligations: [{ ...applied.obligations[0], evidence: ['method:decision-framework'] }] }],
      },
      null,
      skills,
      resolve,
    ).problems.some((p) => p.includes('project evidence')),
  );
});

test('an obligation may cite a listed file by another spelling of the same file, and a stray ref is named', () => {
  const resolve: RefResolver = (ref) =>
    ['src/a.ts', './src/a.ts', '/work/src/a.ts'].includes(ref)
      ? { ref, kind: 'file', provenance: 'witnessed', path: '/work/src/a.ts', text: 'x' }
      : null;
  const method = (evidence: string[], cited: string[]) => ({
    findings: ['f'],
    methods: [
      {
        id: 'decision-framing',
        disposition: 'applied',
        why: 'w',
        evidence,
        obligations: [{ obligation: 'o', section: '/findings/0', evidence: cited }],
      },
    ],
  });
  assert.deepEqual(methodReceipts(method(['src/a.ts'], ['./src/a.ts']), null, skills, resolve).problems, []);
  assert.deepEqual(methodReceipts(method(['/work/src/a.ts'], ['src/a.ts']), null, skills, resolve).problems, []);
  const problems = methodReceipts(method(['src/a.ts'], ['src/b.ts']), null, skills, resolve).problems;
  assert.ok(problems.some((p) => p.includes('"src/b.ts"') && p.includes('src/a.ts') && p.includes('project evidence list')));
});

test('equivalence never joins distinct sources, different items, or a directory and its descendant', () => {
  const table: Record<string, { kind: 'source' | 'file' | 'directory'; path: string; sourceId?: string }> = {
    alpha: { kind: 'source', path: '/w/src', sourceId: 'alpha' },
    beta: { kind: 'source', path: '/w/src', sourceId: 'beta' },
    dir: { kind: 'directory', path: '/w/src' },
    'dir/a.ts': { kind: 'file', path: '/w/src/a.ts' },
    'dir/b.ts': { kind: 'file', path: '/w/src/b.ts' },
  };
  const resolve: RefResolver = (ref) => (table[ref] ? { ref, provenance: 'witnessed', text: 'x', ...table[ref] } : null);
  const run = (listed: string, cited: string) =>
    methodReceipts(
      {
        findings: ['f'],
        methods: [
          {
            id: 'decision-framing',
            disposition: 'applied',
            why: 'w',
            evidence: [listed],
            obligations: [{ obligation: 'o', section: '/findings/0', evidence: [cited] }],
          },
        ],
      },
      null,
      skills,
      resolve,
    );
  for (const [l, c] of [
    ['alpha', 'beta'],
    ['dir', 'dir/a.ts'],
    ['dir/a.ts', 'dir/b.ts'],
  ])
    assert.ok(
      run(l, c).problems.some((p) => p.includes('project evidence list')),
      `${l} vs ${c}`,
    );
  const same = run('dir/a.ts', 'dir/a.ts');
  assert.deepEqual(same.problems, []);
  assert.deepEqual(same.receipts[0]?.obligations?.[0]?.evidence, ['dir/a.ts']);
});
