/**
 * tests/kernel/skills/reach.test.ts — what a dispatch can get at from the
 * portable method library, decided against described directories rather than a
 * disk: which rung answers for each name, what the role is told, and what the
 * run records about it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  skillsDirective,
  skillsOffered,
  skillsReachable,
} from '../../../src/kernel/skills/reach.ts';
import type { InstalledFolder, SkillSource } from '../../../src/kernel/skills/library.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function source(name: string, description = `what ${name} is for`): SkillSource {
  const skillBytes = bytes(`---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`);
  return {
    name,
    description,
    version: '1.0.0',
    bytes: skillBytes,
    files: [{ relativePath: 'SKILL.md', bytes: skillBytes }],
  };
}

function installed(name: string, description = `what ${name} is for`): InstalledFolder {
  return {
    name,
    skill: bytes(`---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`),
    extras: [],
  };
}

const SHIPPED = ['adversarial-review', 'intake'];
const INSTALL_DIR = '/somewhere/.claude/skills';
const SOURCE_DIR = '/somewhere/checkout/skills';

test('an installed copy answers, and the checkout answers for the rest', () => {
  const reachable = skillsReachable({
    shipped: SHIPPED,
    sources: [source('intake'), source('adversarial-review')],
    installed: [installed('intake')],
    installDir: INSTALL_DIR,
    sourceDir: SOURCE_DIR,
  });
  assert.deepEqual(
    reachable.offers.map((offer) => [offer.name, offer.reach, offer.locator]),
    [
      ['adversarial-review', 'checkout', `${SOURCE_DIR}/adversarial-review/SKILL.md`],
      ['intake', 'installed', INSTALL_DIR],
    ],
  );
});

test('a name is offered from one rung only, never twice', () => {
  const reachable = skillsReachable({
    shipped: SHIPPED,
    sources: [source('intake'), source('adversarial-review')],
    installed: [installed('intake'), installed('adversarial-review')],
    installDir: INSTALL_DIR,
    sourceDir: SOURCE_DIR,
  });
  assert.equal(reachable.offers.length, 2);
  assert.deepEqual(new Set(reachable.offers.map((offer) => offer.name)).size, 2);
  assert.ok(reachable.offers.every((offer) => offer.reach === 'installed'));
});

test('an installed skill is described by its own text, not by this checkout’s copy', () => {
  const reachable = skillsReachable({
    shipped: ['intake'],
    sources: [source('intake', 'the description this checkout ships')],
    installed: [installed('intake', 'the description the host will actually load')],
    installDir: INSTALL_DIR,
    sourceDir: SOURCE_DIR,
  });
  assert.equal(reachable.offers[0].description, 'the description the host will actually load');
});

test('a published install with nothing installed reaches nothing, and says so', () => {
  const reachable = skillsReachable({
    shipped: SHIPPED,
    sources: [],
    installed: [],
    installDir: INSTALL_DIR,
    sourceDir: null,
  });
  assert.deepEqual(reachable.offers, []);
  const directive = skillsDirective(reachable);
  assert.match(directive, /No portable method skills are reachable/);
  assert.match(directive, /Do not name or cite one\./);
});

test('a published install still reaches what was installed from git', () => {
  const reachable = skillsReachable({
    shipped: SHIPPED,
    sources: [],
    installed: [installed('intake')],
    installDir: INSTALL_DIR,
    sourceDir: null,
  });
  assert.deepEqual(
    reachable.offers.map((offer) => [offer.name, offer.reach]),
    [['intake', 'installed']],
  );
});

test('a folder that is not one of the shipped names is never offered', () => {
  const reachable = skillsReachable({
    shipped: SHIPPED,
    sources: [],
    installed: [installed('somebody-elses-skill')],
    installDir: INSTALL_DIR,
    sourceDir: null,
  });
  assert.deepEqual(reachable.offers, []);
});

test('a folder holding no skill file is not reachable through it', () => {
  const reachable = skillsReachable({
    shipped: ['intake'],
    sources: [source('intake')],
    installed: [{ name: 'intake', skill: null, extras: ['README.md'] }],
    installDir: INSTALL_DIR,
    sourceDir: SOURCE_DIR,
  });
  assert.deepEqual(
    reachable.offers.map((offer) => offer.reach),
    ['checkout'],
  );
});

test('the directive names every reachable skill, where it is, and what it is for', () => {
  const directive = skillsDirective(
    skillsReachable({
      shipped: SHIPPED,
      sources: [source('adversarial-review', 'challenge a finished thing')],
      installed: [installed('intake', 'turn a messy request into a plan')],
      installDir: INSTALL_DIR,
      sourceDir: SOURCE_DIR,
    }),
  );
  assert.match(directive, /- intake \(installed at \/somewhere\/\.claude\/skills\): turn a messy request into a plan/);
  assert.match(
    directive,
    /- adversarial-review \(read the file at \/somewhere\/checkout\/skills\/adversarial-review\/SKILL\.md\): challenge a finished thing/,
  );
  // The choosing stays with the skill's own scope rule, and applying none is a
  // correct outcome rather than a gap.
  assert.match(directive, /scope rule matches this work/);
  assert.match(directive, /using none of them is a correct outcome/);
});

test('the record names what was offered and where both rungs looked', () => {
  const record = skillsOffered(
    skillsReachable({
      shipped: SHIPPED,
      sources: [source('adversarial-review')],
      installed: [installed('intake')],
      installDir: INSTALL_DIR,
      sourceDir: SOURCE_DIR,
    }),
  );
  assert.deepEqual(record.offered, ['adversarial-review (checkout)', 'intake (installed)']);
  assert.equal(record.installDir, INSTALL_DIR);
  assert.equal(record.sourceDir, SOURCE_DIR);
});

test('the record is written even when nothing was reachable', () => {
  const record = skillsOffered(
    skillsReachable({
      shipped: SHIPPED,
      sources: [],
      installed: [],
      installDir: INSTALL_DIR,
      sourceDir: null,
    }),
  );
  assert.deepEqual(record.offered, []);
  assert.equal(record.sourceDir, null);
});
