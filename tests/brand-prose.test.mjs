/**
 * tests/brand-prose.test.mjs — brand prose lint (marketing voice, naming, fonts).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lintConstructNamingLine,
  lintMarketingVoiceLine,
  lintMarkdownBrand,
} from '../lib/brand-prose.mjs';

test('lintMarketingVoiceLine flags marketing tokens in prose', () => {
  const hit = lintMarketingVoiceLine('docs/foo.md', 3, 'This is enterprise-grade tooling.');
  assert.equal(hit?.kind, 'marketing-voice');
  assert.equal(hit?.token, 'enterprise-grade');
});

test('lintMarketingVoiceLine skips WCAG Robust principle mentions', () => {
  const hit = lintMarketingVoiceLine(
    'skills/perspectives/designer.accessibility.md',
    1,
    '- Cover POUR (Perceivable, Operable, Understandable, Robust)',
  );
  assert.equal(hit, null);
});

test('lintMarketingVoiceLine skips meta-guidance that bans marketing tokens', () => {
  const refuse = lintMarketingVoiceLine(
    'skills/docs/adr-workflow.md',
    55,
    '**Before you write (voice):** refuse AI tells (delve, leverage, robust as filler, "it\'s important to note"); sound like a careful colleague.',
  );
  assert.equal(refuse, null);

  const ban = lintMarketingVoiceLine(
    'skills/docs/prd-workflow.md',
    55,
    '- Each AC is stranger-checkable. Ban “intuitive / fast / robust / delightful” without thresholds.',
  );
  assert.equal(ban, null);

  const symptom = lintMarketingVoiceLine(
    'skills/perspectives/product-manager.md',
    26,
    '**Symptom**: criteria use words like "intuitive", "fast", "robust", "delightful" with no numeric or observable threshold.',
  );
  assert.equal(symptom, null);
});

test('lintMarketingVoiceLine still flags real marketing voice claims', () => {
  const hit = lintMarketingVoiceLine(
    'skills/docs/prd-workflow.md',
    10,
    'Ship a robust billing ledger for every tenant.',
  );
  assert.equal(hit?.kind, 'marketing-voice');
  assert.equal(hit?.token, 'robust');
});

test('lintConstructNamingLine flags miscapitalized CLI', () => {
  const hit = lintConstructNamingLine('docs/foo.md', 2, 'Run Construct doctor after changes.');
  assert.equal(hit?.kind, 'construct-naming');
});

test('lintConstructNamingLine allows product noun phrases', () => {
  const hit = lintConstructNamingLine(
    'docs/foo.md',
    2,
    'Registry snapshot from the current Construct install',
  );
  assert.equal(hit, null);
});

test('lintConstructNamingLine flags unbackticked CLI in list steps', () => {
  const hit = lintConstructNamingLine('docs/foo.md', 4, '- Run construct sync after edits.');
  assert.equal(hit?.kind, 'construct-naming');
});

test('lintMarkdownBrand skips fenced code blocks', () => {
  const content = 'Intro\n```bash\nconstruct doctor\n```\n';
  const hits = lintMarkdownBrand(content, { relPath: 'docs/foo.md' });
  assert.equal(hits.length, 0);
});
