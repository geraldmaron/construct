/**
 * tests/cli/directives-cli.test.mjs — `construct directives` CLI handler
 * (lib/cli/directives.mjs). Read-only: list/status against a real
 * construct.config.json and due-tracker state, no execution path.
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runDirectivesCli } from '../../lib/cli/directives.mjs';
import { writeDirectiveState } from '../../lib/directives/due-tracker.mjs';

// writeDirectiveState/readDirectiveState resolve through the machine-scoped
// state root (lib/state-root.mjs) — CONSTRUCT_HOME_OVERRIDE keeps that
// off the real developer machine's $HOME for the whole file.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-directives-cli-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

let rootDir;

function capture() {
  const lines = [];
  const errLines = [];
  return {
    println: (s) => lines.push(s),
    errorln: (s) => errLines.push(s),
    lines,
    errLines,
  };
}

function writeConfig(directives) {
  fs.writeFileSync(path.join(rootDir, 'construct.config.json'), JSON.stringify({ version: 1, directives }, null, 2));
}

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-directives-cli-'));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('runDirectivesCli', () => {
  it('prints usage with no subcommand', async () => {
    const out = capture();
    const code = await runDirectivesCli([], { rootDir, env: {}, ...out });
    assert.equal(code, 0);
    assert.ok(out.lines.some((l) => l.includes('Usage: construct directives')));
  });

  it('list reports no directives configured when none exist', async () => {
    writeConfig([]);
    const out = capture();
    const code = await runDirectivesCli(['list'], { rootDir, env: {}, ...out });
    assert.equal(code, 0);
    assert.ok(out.lines.some((l) => l.includes('No directives configured')));
  });

  it('list shows a configured directive as due when it has never run', async () => {
    writeConfig([{
      id: 'jira-weekly', provider: 'jira', workerProfileId: 'operations',
      instruction: 'Summarize the team\'s open work',
      trigger: { kind: 'interval', intervalMinutes: 10_080 },
      action: 'summarize', output: { kind: 'knowledge-note' },
    }]);
    const out = capture();
    const code = await runDirectivesCli(['list'], { rootDir, env: {}, ...out });
    assert.equal(code, 0);
    const text = out.lines.join('\n');
    assert.match(text, /jira-weekly/);
    assert.match(text, /due:\s+true/);
  });

  it('list shows a directive as not due right after a recorded run', async () => {
    writeConfig([{
      id: 'jira-weekly', provider: 'jira', workerProfileId: 'operations',
      instruction: 'Summarize the team\'s open work',
      trigger: { kind: 'interval', intervalMinutes: 10_080 },
      action: 'summarize', output: { kind: 'knowledge-note' },
    }]);
    writeDirectiveState(rootDir, 'jira-weekly', { lastRunAt: new Date().toISOString() });
    const out = capture();
    await runDirectivesCli(['list'], { rootDir, env: {}, ...out });
    assert.match(out.lines.join('\n'), /due:\s+false/);
  });

  it('surfaces config errors on list without crashing', async () => {
    writeConfig([{ id: 'bad', provider: 'jira' }]);
    const out = capture();
    const code = await runDirectivesCli(['list'], { rootDir, env: {}, ...out });
    assert.equal(code, 0);
    assert.ok(out.errLines.some((l) => l.includes('directives config errors')));
  });

  it('status <id> returns the directive detail as JSON', async () => {
    writeConfig([{
      id: 'jira-weekly', provider: 'jira', workerProfileId: 'operations',
      instruction: 'Summarize the team\'s open work',
      trigger: { kind: 'interval', intervalMinutes: 10_080 },
      action: 'summarize', output: { kind: 'knowledge-note' },
    }]);
    const out = capture();
    const code = await runDirectivesCli(['status', 'jira-weekly'], { rootDir, env: {}, ...out });
    assert.equal(code, 0);
    const parsed = JSON.parse(out.lines.join('\n'));
    assert.equal(parsed.directive.id, 'jira-weekly');
    assert.equal(parsed.directive.workerProfileId, 'operations');
    assert.equal(parsed.due, true);
    assert.deepEqual(parsed.shapeErrors, []);
  });

  it('status <id> errors for an unknown id', async () => {
    writeConfig([]);
    const out = capture();
    const code = await runDirectivesCli(['status', 'nope'], { rootDir, env: {}, ...out });
    assert.equal(code, 1);
    assert.ok(out.errLines.some((l) => l.includes('not found')));
  });

  it('errors on an unknown subcommand', async () => {
    writeConfig([]);
    const out = capture();
    const code = await runDirectivesCli(['bogus'], { rootDir, env: {}, ...out });
    assert.equal(code, 1);
    assert.ok(out.errLines.some((l) => l.includes('Unknown directives subcommand')));
  });
});
