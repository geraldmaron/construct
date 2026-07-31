/**
 * tests/artifact-structure-contract.test.mjs — PRD-variant + major non-PRD depth contracts.
 *
 * Pins templates/docs spines, manifest structureRequirements, and
 * lintArtifactDeliveryDepth hierarchy rules (follow-up).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  lintPrdDeliveryDepth,
  lintMetaPrdDeliveryDepth,
  lintPrdBusinessDeliveryDepth,
  lintAdrDeliveryDepth,
  lintStrategyDeliveryDepth,
  lintRunbookDeliveryDepth,
  lintResearchBriefDeliveryDepth,
  lintRfcDeliveryDepth,
  lintArtifactDeliveryDepth,
} from '../lib/templates/visual-requirements.mjs';
import { getArtifactEntry } from '../lib/artifact-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readTemplate(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertSections(tmpl, sections) {
  for (const section of sections) {
    assert.match(
      tmpl,
      new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
      section,
    );
  }
}

test('prd-platform template and manifest share the deepened spine + FR/AC hierarchy', () => {
  const required = getArtifactEntry('prd-platform', { rootDir: ROOT }).structureRequirements;
  assertSections(readTemplate('templates/docs/prd-platform.md'), required);
  const body = readTemplate('templates/docs/prd-platform.md');
  assert.deepEqual(lintPrdDeliveryDepth(body, { type: 'prd-platform', requiredTop: required }), []);
});

test('prd-business template enforces bet/kill/FMEA spine', () => {
  const required = getArtifactEntry('prd-business', { rootDir: ROOT }).structureRequirements;
  assertSections(readTemplate('templates/docs/prd-business.md'), required);
  assert.deepEqual(lintPrdBusinessDeliveryDepth(readTemplate('templates/docs/prd-business.md')), []);
  assert.ok(lintPrdBusinessDeliveryDepth('## The bet\n\nx\n').length > 0);
});

test('meta-prd template enforces Phase→MR/DR→Acceptance hierarchy', () => {
  const required = getArtifactEntry('meta-prd', { rootDir: ROOT }).structureRequirements;
  assertSections(readTemplate('templates/docs/meta-prd.md'), required);
  assert.deepEqual(lintMetaPrdDeliveryDepth(readTemplate('templates/docs/meta-prd.md')), []);
  assert.ok(lintMetaPrdDeliveryDepth('## TL;DR\n\nx\n').some((e) => /Phase/.test(e)));
});

test('adr / rfc / strategy / research-brief / runbook depth contracts hold', () => {
  const cases = [
    ['adr', lintAdrDeliveryDepth],
    ['rfc', (b) => lintRfcDeliveryDepth(b, 'rfc')],
    ['rfc-platform', (b) => lintRfcDeliveryDepth(b, 'rfc-platform')],
    ['strategy', lintStrategyDeliveryDepth],
    ['research-brief', lintResearchBriefDeliveryDepth],
    ['runbook', lintRunbookDeliveryDepth],
  ];
  for (const [type, lint] of cases) {
    const entry = getArtifactEntry(type, { rootDir: ROOT });
    const tmpl = readTemplate(entry.template);
    assertSections(tmpl, entry.structureRequirements);
    assert.deepEqual(lint(tmpl), [], `${type} template should pass depth lint`);
    assert.ok(lintArtifactDeliveryDepth(type, '## Summary\n\nthin\n').length > 0, `${type} thin body fails`);
  }
});

test('workflows document native spines and depth lints', () => {
  const prdWf = readTemplate('skills/docs/prd-workflow.md');
  assert.match(prdWf, /prd-business|meta-prd/);
  assert.match(prdWf, /Kill criteria|MR-<phase>|Phase\s+→/);

  const adrWf = readTemplate('skills/docs/adr-workflow.md');
  assert.match(adrWf, /Adversarial challenge|Rejected alternatives/);

  const strategyWf = readTemplate('skills/docs/strategy-workflow.md');
  assert.match(strategyWf, /Kill criterion|Competitive Positioning/);

  const researchWf = readTemplate('skills/docs/research-workflow.md');
  assert.match(researchWf, /Counter-evidence|Observation/);

  const runbookWf = readTemplate('skills/docs/runbook-workflow.md');
  assert.match(runbookWf, /Diagnostic|Rollback|Adversarial/);

  const authorship = readTemplate('skills/docs/artifact-authorship.md');
  assert.match(authorship, /meta-prd|prd-business|NATIVE SPINE|artifact family spines/i);
});
