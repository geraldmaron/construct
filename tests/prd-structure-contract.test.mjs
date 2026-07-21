/**
 * tests/prd-structure-contract.test.mjs — customer PRD 12-section + Phase→FR→AC contract.
 *
 * Pins templates/docs/prd.md headings, manifest structureRequirements, and
 * lintPrdDeliveryDepth hierarchy rules (construct-9jkma).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lintPrdDeliveryDepth } from '../lib/templates/visual-requirements.mjs';
import { getArtifactEntry } from '../lib/artifact-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED = [
  'TL;DR',
  'Background',
  'Problem',
  'Outcomes - Goals & Non-Goals',
  'Why This Matters Now',
  'Competitive Landscape & Financial Considerations',
  'Phases',
  'Requirements',
  'Acceptance Criteria',
  'Success Metrics',
  'Risks',
  'References',
];

test('customer PRD template exposes the exact 12 required sections', () => {
  const tmpl = fs.readFileSync(path.join(ROOT, 'templates/docs/prd.md'), 'utf8');
  for (const section of REQUIRED) {
    assert.match(tmpl, new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), section);
  }
  assert.match(tmpl, /Phase → one or more Requirements|FR-<phase>\.<n>/);
  assert.match(tmpl, /AC-<phase>\.<n>\.<k>/);
  assert.match(tmpl, /strategy\/prioritization-methods/);
});

test('artifact manifest structureRequirements match the 12-section PRD contract', () => {
  const entry = getArtifactEntry('prd', { rootDir: ROOT });
  assert.deepEqual(entry.structureRequirements, REQUIRED);
});

test('lintPrdDeliveryDepth passes a nested Phase→FR→AC sample', () => {
  const body = `
## TL;DR
Brief.

## Background
Context with evidence.

## Problem
Users cannot share.

## Outcomes - Goals & Non-Goals
Goals listed.

## Why This Matters Now
Timing.

## Competitive Landscape & Financial Considerations
Unknown competitors.

## Phases

### Phase 1: MVP
- **Requirements**: FR-1.1

## Requirements

### Phase 1 requirements

#### FR-1.1: Grant access
Prose depth for the requirement.
- **Phase**: 1
- **Acceptance criteria**: AC-1.1.1

## Acceptance Criteria

| AC id | FR id | Criterion (stranger-checkable) | Verification method |
|---|---|---|---|
| AC-1.1.1 | FR-1.1 | Non-grantee gets 403 | automated |

## Success Metrics

| Metric | Type | Baseline | Target | Owner | Source |
|---|---|---|---|---|---|
| x | lagging | unknown | unknown | pm | [unverified] |

## Risks
Legal triggers and FMEA live here.

## References
- skills/docs/prd-workflow.md
`;
  assert.deepEqual(lintPrdDeliveryDepth(body), []);
});

test('lintPrdDeliveryDepth fails thin skeletons and orphan ACs', () => {
  const thin = '## Summary\n\nHello\n';
  const thinErrs = lintPrdDeliveryDepth(thin);
  assert.ok(thinErrs.some((e) => /missing required section ## TL;DR/.test(e)));

  const orphan = `
## TL;DR
x
## Background
x
## Problem
x
## Outcomes - Goals & Non-Goals
x
## Why This Matters Now
x
## Competitive Landscape & Financial Considerations
x
## Phases
### Phase 1: A
## Requirements
#### FR-1.1: thing
## Acceptance Criteria
AC-9.9.9 orphan
## Success Metrics
x
## Risks
x
## References
x
`;
  const orphanErrs = lintPrdDeliveryDepth(orphan);
  assert.ok(orphanErrs.some((e) => /AC-9\.9\.9 has no matching FR-9\.9/.test(e)));
});

test('stress PRD fixture satisfies hierarchy lint', () => {
  const raw = fs.readFileSync(
    path.join(ROOT, 'examples/distribution/sources/stress-multi-persona-prd.md'),
    'utf8',
  );
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.deepEqual(lintPrdDeliveryDepth(body), []);
});

test('prd-workflow documents the hierarchy and 12-section contract', () => {
  const wf = fs.readFileSync(path.join(ROOT, 'skills/docs/prd-workflow.md'), 'utf8');
  assert.match(wf, /Phase\s+→\s+one or more Requirements/);
  assert.match(wf, /Competitive Landscape & Financial Considerations/);
  assert.match(wf, /lintPrdDeliveryDepth/);
});
