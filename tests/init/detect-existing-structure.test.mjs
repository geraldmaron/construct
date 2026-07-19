/**
 * tests/init/detect-existing-structure.test.mjs — Unit coverage for the
 * project-structure detector that gates init/sync's docs/inbox/templates
 * scaffolding (issue #97).
 *
 * Every test sets up a tmpdir fixture, runs the detector, and asserts on the
 * deterministic return shape. No init code is exercised here; that's covered
 * by tests/functional/init-respects-existing-structure.functional.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectExistingContent,
  formatDeferralSummary,
  rootTemplateCoversLane,
  shouldScaffoldLane,
  shouldSkipProjectInbox,
  LANE_DIR_ALIASES,
} from '../../lib/init/detect-existing-structure.mjs';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'des-'));
  return {
    dir,
    file(rel, content = '') {
      const abs = join(dir, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    },
    dir_(rel) { mkdirSync(join(dir, rel), { recursive: true }); },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test('empty project: no lanes, no intake, no templates', () => {
  const p = makeProject();
  try {
    const detection = detectExistingContent(p.dir);
    assert.deepEqual(detection.existingLanes, {});
    assert.equal(detection.customIntake.ingestScript, null);
    assert.deepEqual(detection.customIntake.intakePaths, []);
    assert.equal(detection.rootTemplates.dir, null);
    assert.deepEqual(detection.rootTemplates.files, []);
  } finally { p.cleanup(); }
});

test('populated internal/meetings/ registers as existing meetings lane (issue #97)', () => {
  const p = makeProject();
  try {
    p.file('internal/meetings/2026-05-01-standup.md', '# Standup\n');
    p.file('internal/meetings/2026-05-08-retro.md', '# Retro\n');
    const detection = detectExistingContent(p.dir);
    assert.ok(detection.existingLanes.meetings, 'expected meetings lane to be detected');
    assert.equal(detection.existingLanes.meetings.length, 1);
    assert.equal(detection.existingLanes.meetings[0].path, 'internal/meetings');
    assert.equal(detection.existingLanes.meetings[0].markdownCount, 2);
  } finally { p.cleanup(); }
});

test('empty docs/meetings/ does NOT register (init may have scaffolded it before)', () => {
  const p = makeProject();
  try {
    p.dir_('docs/meetings');
    const detection = detectExistingContent(p.dir);
    assert.equal(detection.existingLanes.meetings, undefined);
  } finally { p.cleanup(); }
});

test('docs/<lane>/ with markdown still does NOT register (it IS the lane init owns)', () => {
  const p = makeProject();
  try {
    p.file('docs/meetings/notes.md', '# Notes\n');
    const detection = detectExistingContent(p.dir);
    assert.equal(detection.existingLanes.meetings, undefined,
      'docs/meetings/ is the lane init writes — must not flag as pre-existing');
  } finally { p.cleanup(); }
});

test('lane aliases match (incidents/ → postmortems, minutes/ → meetings)', () => {
  const p = makeProject();
  try {
    p.file('operational/incidents/oct-outage.md', '# Outage\n');
    p.file('team/minutes/2026-05-08.md', '# Minutes\n');
    const detection = detectExistingContent(p.dir);
    assert.ok(detection.existingLanes.postmortems);
    assert.equal(detection.existingLanes.postmortems[0].path, 'operational/incidents');
    assert.ok(detection.existingLanes.meetings);
    assert.equal(detection.existingLanes.meetings[0].path, 'team/minutes');
  } finally { p.cleanup(); }
});

test('multiple matches for same lane are accumulated in order', () => {
  const p = makeProject();
  try {
    p.file('internal/memos/q2.md', '# Q2\n');
    p.file('team/memos/leadership.md', '# Leadership\n');
    const detection = detectExistingContent(p.dir);
    assert.equal(detection.existingLanes.memos.length, 2);
  } finally { p.cleanup(); }
});

test('skip dirs (.git, node_modules, .construct, .construct, .claude) are ignored', () => {
  const p = makeProject();
  try {
    p.file('node_modules/some-pkg/notes/random.md', '# Random\n');
    p.file('.git/notes/anything.md', '# Git Note\n');
    p.file('.construct/notes/scratch.md', '# Scratch\n');
    const detection = detectExistingContent(p.dir);
    assert.equal(detection.existingLanes.notes, undefined,
      'node_modules / .git / .construct must never trigger lane detection');
  } finally { p.cleanup(); }
});

test('ingest script in root is detected as custom intake (issue #97)', () => {
  const p = makeProject();
  try {
    p.file('ingest', '#!/bin/sh\necho ingesting\n');
    const detection = detectExistingContent(p.dir);
    assert.equal(detection.customIntake.ingestScript, 'ingest');
  } finally { p.cleanup(); }
});

test('ingest.sh, ingest.mjs, ingest.py also detected; ingest as directory is NOT', () => {
  for (const candidate of ['ingest.sh', 'ingest.mjs', 'ingest.py']) {
    const p = makeProject();
    try {
      p.file(candidate, '# ingest');
      const detection = detectExistingContent(p.dir);
      assert.equal(detection.customIntake.ingestScript, candidate);
    } finally { p.cleanup(); }
  }
  // Directory named "ingest" is not a script
  const p = makeProject();
  try {
    p.dir_('ingest');
    const detection = detectExistingContent(p.dir);
    assert.equal(detection.customIntake.ingestScript, null);
  } finally { p.cleanup(); }
});

test('custom intake path data/customers/notes/raw/ is detected (issue #97)', () => {
  const p = makeProject();
  try {
    p.dir_('data/customers/notes/raw');
    const detection = detectExistingContent(p.dir);
    assert.deepEqual(detection.customIntake.intakePaths, ['data/customers/notes/raw']);
  } finally { p.cleanup(); }
});

test('root templates/ with prd.md is detected; coverage helper hits matching lane', () => {
  const p = makeProject();
  try {
    p.file('templates/prd.md', '# PRD template\n');
    p.file('templates/rfc.md', '# RFC template\n');
    p.file('templates/README.md', '# README\n');
    const detection = detectExistingContent(p.dir);
    assert.equal(detection.rootTemplates.dir, 'templates');
    assert.ok(detection.rootTemplates.files.includes('prd.md'));
    assert.ok(detection.rootTemplates.files.includes('rfc.md'));
    assert.equal(rootTemplateCoversLane(detection, 'prds'), true);
    assert.equal(rootTemplateCoversLane(detection, 'rfcs'), true);
    assert.equal(rootTemplateCoversLane(detection, 'meetings'), false);
  } finally { p.cleanup(); }
});

test('LANE_DIR_ALIASES is exported and contains the issue #97 categories', () => {
  for (const key of ['meetings', 'memos', 'prds', 'rfcs', 'notes', 'incidents', 'postmortems']) {
    assert.ok(LANE_DIR_ALIASES[key], `expected ${key} to be in LANE_DIR_ALIASES`);
  }
});

test('formatDeferralSummary renders a readable block when lanes + intake + templates are all present', () => {
  const p = makeProject();
  try {
    p.file('internal/meetings/standup.md', '# Standup\n');
    p.file('ingest', '#!/bin/sh');
    p.dir_('data/customers/notes/raw');
    p.file('templates/prd.md', '# PRD\n');
    const detection = detectExistingContent(p.dir);
    const summary = formatDeferralSummary(detection);
    assert.match(summary, /lane "meetings".*internal\/meetings/);
    assert.match(summary, /custom script \.\/ingest/);
    assert.match(summary, /custom path.*data\/customers\/notes\/raw/);
    assert.match(summary, /root \.\/templates\/ has 1 template file/);
  } finally { p.cleanup(); }
});

test('formatDeferralSummary returns empty string on a clean project', () => {
  const p = makeProject();
  try {
    const detection = detectExistingContent(p.dir);
    assert.equal(formatDeferralSummary(detection), '');
  } finally { p.cleanup(); }
});

test('shouldScaffoldLane skips when lane is in existingLanes, runs when not', () => {
  const detection = {
    existingLanes: { meetings: [{ path: 'internal/meetings', markdownCount: 12 }] },
    customIntake: { ingestScript: null, intakePaths: [] },
    rootTemplates: { dir: null, files: [] },
  };
  const skip = shouldScaffoldLane('meetings', detection);
  assert.equal(skip.skip, true);
  assert.match(skip.reason, /internal\/meetings.*12 markdown files/);
  assert.deepEqual(shouldScaffoldLane('prds', detection), { skip: false });
});

test('shouldScaffoldLane with force=true never skips', () => {
  const detection = {
    existingLanes: { meetings: [{ path: 'internal/meetings', markdownCount: 12 }] },
    customIntake: { ingestScript: null, intakePaths: [] },
    rootTemplates: { dir: null, files: [] },
  };
  assert.deepEqual(shouldScaffoldLane('meetings', detection, { force: true }), { skip: false });
});

test('shouldSkipProjectInbox skips on ingest script, on intake paths, runs when both absent', () => {
  const skipScript = shouldSkipProjectInbox({
    customIntake: { ingestScript: 'ingest', intakePaths: [] },
  });
  assert.equal(skipScript.skip, true);
  assert.match(skipScript.reason, /\.\/ingest/);

  const skipPath = shouldSkipProjectInbox({
    customIntake: { ingestScript: null, intakePaths: ['data/customers/notes/raw'] },
  });
  assert.equal(skipPath.skip, true);
  assert.match(skipPath.reason, /data\/customers\/notes\/raw/);

  const noSkip = shouldSkipProjectInbox({
    customIntake: { ingestScript: null, intakePaths: [] },
  });
  assert.deepEqual(noSkip, { skip: false });
});

test('shouldSkipProjectInbox with force=true never skips', () => {
  const detection = { customIntake: { ingestScript: 'ingest', intakePaths: ['data/raw'] } };
  assert.deepEqual(shouldSkipProjectInbox(detection, { force: true }), { skip: false });
});
