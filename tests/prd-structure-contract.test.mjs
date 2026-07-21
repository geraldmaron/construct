/**
 * tests/prd-structure-contract.test.mjs — customer PRD 12-section + Phase→FR→AC contract.
 *
 * Pins templates/docs/prd.md headings, manifest structureRequirements,
 * lintPrdDeliveryDepth hierarchy rules, Why-Now timing-economics substance,
 * and nested Acceptance criteria under each FR (construct-pe9sv).
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

const WHY_NOW_TABLE = `
| Timing dimension | Estimate / window | Source |
|---|---|---|
| Revenue at risk | unknown | [unverified] — owner: pm by 2026-08-15 |
| Upside / opportunity window | unknown | [unverified] |
| Market timing | unknown | [unverified] |
| Cost of delay | support toil compounds | playbook |
| Competitive window | unknown | see Competitive |
| Compliance / legal deadline | PII on share grant | privacy |
`;

const COMPETITIVE_BLOCK = `
### Competitive landscape

Prose on alternatives, then a small matrix.

| Competitor / alternative | Dimension | Their approach | Our stance | Source |
|---|---|---|---|---|
| Email | workflow | forks | differentiate | observed |

### Financial considerations

| Item | Low | Base | High | Source |
|---|---|---|---|---|
| Build / run cost | unknown | unknown | unknown | [unverified] — owner: eng by 2026-08-15 |
| Unit economics | unknown | unknown | unknown | [unverified] |
| Expected value / ROI | unknown | unknown | unknown | [unverified] |
`;

test('customer PRD template exposes the exact 12 required sections', () => {
  const tmpl = fs.readFileSync(path.join(ROOT, 'templates/docs/prd.md'), 'utf8');
  for (const section of REQUIRED) {
    assert.match(tmpl, new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), section);
  }
  assert.match(tmpl, /Phase → one or more Requirements|FR-<phase>\.<n>/);
  assert.match(tmpl, /AC-<phase>\.<n>\.<k>/);
  assert.match(tmpl, /Do not restate Phase on every FR|LAYOUT/);
  assert.match(tmpl, /Acceptance criteria/);
  assert.match(tmpl, /strategy\/prioritization-methods/);
  assert.match(tmpl, /Revenue at risk/);
  assert.match(tmpl, /Why\?\s*\(human purpose\)|PHASE WHY\?/);
  assert.match(tmpl, /INCLUSIVE|Inclusive/);
});

test('artifact manifest structureRequirements match the 12-section PRD contract', () => {
  const entry = getArtifactEntry('prd', { rootDir: ROOT });
  assert.deepEqual(entry.structureRequirements, REQUIRED);
});

test('lintPrdDeliveryDepth passes nested Phase→area→FR with listed ACs', () => {
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
Timing thesis with financially meaningful pressure.
${WHY_NOW_TABLE}

## Competitive Landscape & Financial Considerations
${COMPETITIVE_BLOCK}

## Phases

| Phase | Name | Ships when | Status |
|---|---|---|---|
| 1 | MVP | ACs green | not started |

## Requirements

### Phase 1 — MVP

**Why?** Brief owners need a least-privilege share path so collaborators stop forking email attachments.

One sentence goal.

#### Access control

##### FR-1.1: Grant access
Prose depth for the requirement.

**Acceptance criteria**

1. **AC-1.1.1** — Non-grantee gets 403. *Verify:* automated.

## Acceptance Criteria

| AC id | FR | Criterion | Verify |
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

test('lintPrdDeliveryDepth fails thin Why-Now theater and orphan ACs', () => {
  const thin = '## Summary\n\nHello\n';
  const thinErrs = lintPrdDeliveryDepth(thin);
  assert.ok(thinErrs.some((e) => /missing required section ## TL;DR/.test(e)));

  const stubWhyNow = `
## TL;DR
x
## Background
x
## Problem
x
## Outcomes - Goals & Non-Goals
x
## Why This Matters Now
Timing.
## Competitive Landscape & Financial Considerations
Unknown competitors.
## Phases
| Phase | Name | Ships when | Status |
|---|---|---|---|
| 1 | A | done | not started |
## Requirements
### Phase 1 — A
**Why?** Named collaborators need access without email forks.
##### FR-1.1: thing
Prose.
**Acceptance criteria**
1. **AC-1.1.1** — ok. *Verify:* manual.
## Acceptance Criteria
| AC id | FR | Criterion | Verify |
|---|---|---|---|
| AC-1.1.1 | FR-1.1 | ok | manual |
## Success Metrics
x
## Risks
x
## References
x
`;
  const stubErrs = lintPrdDeliveryDepth(stubWhyNow);
  assert.ok(stubErrs.some((e) => /Why This Matters Now: missing timing-economics row/.test(e)));
  assert.ok(stubErrs.some((e) => /Competitive\/Financial/.test(e)));

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
${WHY_NOW_TABLE}
## Competitive Landscape & Financial Considerations
${COMPETITIVE_BLOCK}
## Phases
| Phase | Name | Ships when | Status |
|---|---|---|---|
| 1 | A | x | not started |
## Requirements
### Phase 1 — A
**Why?** Test fixture phase purpose.
##### FR-1.1: thing
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
  assert.match(wf, /Phase\s+→\s+(Why\?.*→\s*)?one or more Requirements/);
  assert.match(wf, /Competitive Landscape & Financial Considerations/);
  assert.match(wf, /lintPrdDeliveryDepth/);
});
