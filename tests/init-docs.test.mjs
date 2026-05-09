/**
 * tests/init-docs.test.mjs — verifies non-destructive project and docs bootstrap.
 *
 * Covers the split between `construct init` and `construct init-docs`, making
 * sure both commands create only missing files, preserve existing repo rules,
 * and scaffold the expected docs lanes/templates.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('construct init bootstraps repo state without overwriting existing AGENTS.md', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-');
  const existingAgents = '# Existing agent rules\n\nDo not overwrite me.\n';

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-init-check', description: 'Construct test repo' }, null, 2)}\n`);
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), existingAgents);

  execFileSync(process.execPath, [path.join(repoRoot, 'lib', 'init.mjs'), cwd], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'), existingAgents);
  assert.equal(fs.existsSync(path.join(cwd, 'plan.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'context.json')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'context.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', '.gitkeep')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'inbox', '.gitkeep')), true);

  const plan = fs.readFileSync(path.join(cwd, 'plan.md'), 'utf8');
  const context = fs.readFileSync(path.join(cwd, '.cx', 'context.md'), 'utf8');

  assert.match(plan, /one writer per file/i);
  assert.match(context, /Beads/);
  assert.doesNotMatch(plan, /workflow\.json/i);
});

test('init-docs scaffolds selected doc lanes and preserves existing docs files', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-');
  const existingDocsReadme = '# Existing docs index\n';

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-check', description: 'Construct docs repo' }, null, 2)}\n`);
  fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'docs', 'README.md'), existingDocsReadme);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--yes',
    '--docs=adrs,intake,memos,meetings,notes,prds,rfcs,runbooks',
    '--with-architecture',
    '--extras=decision-notes',
  ], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.readFileSync(path.join(cwd, 'docs', 'README.md'), 'utf8'), existingDocsReadme);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'architecture.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'intake', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'inbox', '.gitkeep')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'meetings', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'notes', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'prds', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'rfcs', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'adr', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'memos', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'runbooks', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'decision-notes', 'templates', '_template.md')), true);

  const architectureDoc = fs.readFileSync(path.join(cwd, 'docs', 'architecture.md'), 'utf8');
  const customLane = fs.readFileSync(path.join(cwd, 'docs', 'decision-notes', 'README.md'), 'utf8');
  const intakeReadme = fs.readFileSync(path.join(cwd, 'docs', 'intake', 'README.md'), 'utf8');
  const notesTemplate = fs.readFileSync(path.join(cwd, 'docs', 'notes', 'templates', '_template.md'), 'utf8');
  const meetingsTemplate = fs.readFileSync(path.join(cwd, 'docs', 'meetings', 'templates', '_template.md'), 'utf8');

  assert.match(architectureDoc, /single writer per file/i);
  assert.match(architectureDoc, /Beads/i);
  assert.match(intakeReadme, /construct ingest \.\/\.cx\/inbox --sync/i);
  assert.match(intakeReadme, /\.cx\/inbox\//i);
  assert.match(notesTemplate, /starter template for durable project notes/i);
  assert.match(meetingsTemplate, /starter template for meeting notes/i);
  assert.match(customLane, /custom documentation lane/i);
});

test('init-docs treats "all of them" as defaults and "nope" as no custom lanes', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-interactive-');

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-interactive', description: 'Construct docs interactive repo' }, null, 2)}\n`);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--docs=All of them',
    '--extras=nope',
  ], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'prds', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'adr', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'intake', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'inbox', '.gitkeep')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'meetings', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'memos', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'notes', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'rfcs', 'README.md')), false);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'runbooks', 'README.md')), false);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'architecture.md')), false);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'nope')), false);
});

test('init-docs lists lanes alphabetically in docs README', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-order-');

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-order', description: 'Construct docs ordering repo' }, null, 2)}\n`);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--yes',
    '--docs=full',
  ], {
    cwd,
    stdio: 'pipe',
  });

  const readme = fs.readFileSync(path.join(cwd, 'docs', 'README.md'), 'utf8');
  const adrIndex = readme.indexOf('[ADRs]');
  const briefsIndex = readme.indexOf('[Briefs]');
  const changelogsIndex = readme.indexOf('[Changelogs]');
  const intakeIndex = readme.indexOf('[Intake]');
  const memosIndex = readme.indexOf('[Memos]');
  const meetingsIndex = readme.indexOf('[Meetings]');
  const notesIndex = readme.indexOf('[Notes]');
  const onboardingIndex = readme.indexOf('[Onboarding]');
  const postmortemsIndex = readme.indexOf('[Postmortems]');
  const prdsIndex = readme.indexOf('[PRDs]');
  const rfcsIndex = readme.indexOf('[RFCs]');
  const runbooksIndex = readme.indexOf('[Runbooks]');

  assert.ok(adrIndex < briefsIndex);
  assert.ok(briefsIndex < changelogsIndex);
  assert.ok(changelogsIndex < intakeIndex);
  assert.ok(intakeIndex < meetingsIndex);
  assert.ok(meetingsIndex < memosIndex);
  assert.ok(memosIndex < notesIndex);
  assert.ok(notesIndex < onboardingIndex);
  assert.ok(onboardingIndex < postmortemsIndex);
  assert.ok(postmortemsIndex < prdsIndex);
  assert.ok(prdsIndex < rfcsIndex);
  assert.ok(rfcsIndex < runbooksIndex);
});

test('init-docs accepts adrs as the canonical lane name and keeps docs/adr on disk', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-adrs-');

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-adrs', description: 'Construct docs adrs repo' }, null, 2)}\n`);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--yes',
    '--docs=adrs',
  ], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'adr', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'adrs')), false);
});

test('init-docs can create a custom lane with templates in a templates subdirectory', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-custom-lane-');

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-custom-lane', description: 'Construct docs custom lane repo' }, null, 2)}\n`);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--yes',
    '--extras=decision-notes',
  ], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'decision-notes', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'decision-notes', 'templates', '_template.md')), true);
});

test('init-docs scaffolds postmortems, changelogs, and onboarding lanes', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-new-lanes-');

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-new-lanes', description: 'Construct new lanes test' }, null, 2)}\n`);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--yes',
    '--docs=postmortems,changelogs,onboarding',
  ], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'postmortems', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'postmortems', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'changelogs', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'changelogs', 'templates', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'onboarding', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'onboarding', 'templates', '_template.md')), true);

  const postmortemTemplate = fs.readFileSync(path.join(cwd, 'docs', 'postmortems', 'templates', '_template.md'), 'utf8');
  const changelogTemplate = fs.readFileSync(path.join(cwd, 'docs', 'changelogs', 'templates', '_template.md'), 'utf8');
  const onboardingTemplate = fs.readFileSync(path.join(cwd, 'docs', 'onboarding', 'templates', '_template.md'), 'utf8');

  assert.match(postmortemTemplate, /Root cause/i);
  assert.match(postmortemTemplate, /Timeline/i);
  assert.match(changelogTemplate, /## Added/i);
  assert.match(changelogTemplate, /## Fixed/i);
  assert.match(onboardingTemplate, /Local setup/i);
  assert.match(onboardingTemplate, /Prerequisites/i);
});

test('init-docs full preset includes postmortems, changelogs, and onboarding', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-full-preset-');

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-full-preset', description: 'Construct full preset test' }, null, 2)}\n`);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--yes',
    '--docs=full',
  ], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'postmortems', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'changelogs', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'onboarding', 'README.md')), true);
});

test('setup docs include hybrid backend configuration entries', () => {
  const cwd = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const envExample = fs.readFileSync(path.join(cwd, '.env.example'), 'utf8');
  assert.match(envExample, /DATABASE_URL/);
  assert.match(envExample, /CONSTRUCT_VECTOR_URL/);
  assert.match(envExample, /CONSTRUCT_VECTOR_MODEL/);
});
