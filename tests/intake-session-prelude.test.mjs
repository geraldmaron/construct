/**
 * tests/intake-session-prelude.test.mjs — shared session-start surfaces.
 *
 * Pins the rendered shape of the R&D intake block, the broker status
 * line, and the combined prelude builder. Both claude (SessionStart
 * hook) and opencode (plugin) consume these builders, so the same
 * fixtures protect cross-platform parity.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildIntakePrelude,
  buildBrokerStatusLine,
  buildSessionPrelude,
  readOracleDockState,
} from '../lib/intake/session-prelude.mjs';

let tmpRoot;
let pendingDir;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prelude-'));
  pendingDir = path.join(tmpRoot, '.cx', 'intake', 'pending');
  fs.mkdirSync(pendingDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writePacket(id, body) {
  fs.writeFileSync(path.join(pendingDir, `${id}.json`), JSON.stringify(body, null, 2));
}

describe('buildIntakePrelude', () => {
  it('returns empty string when no intake is pending', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-empty-'));
    try {
      assert.equal(buildIntakePrelude({ cwd: empty }), '');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('renders count + last 3 triage lines + processing instructions when packets exist', () => {
    writePacket('p1', {
      id: 'p1',
      status: 'pending',
      intake: { sourcePath: 'note-1.md' },
      triage: { intakeType: 'idea', rdStage: 'discovery', primaryOwner: 'product-manager', risk: 'low' },
    });
    writePacket('p2', {
      id: 'p2',
      status: 'pending',
      intake: { sourcePath: 'note-2.md' },
      triage: { intakeType: 'bug', rdStage: 'diagnosis', primaryOwner: 'debugger', risk: 'medium' },
    });
    const out = buildIntakePrelude({ cwd: tmpRoot });
    assert.match(out, /## Pending R&D intake \(2\)/);
    assert.match(out, /note-1\.md/);
    assert.match(out, /note-2\.md/);
    assert.match(out, /construct intake done <id>/);
  });

  it('returns empty string and never throws when the queue cannot be read', () => {
    assert.equal(buildIntakePrelude({}), '');
    assert.equal(buildIntakePrelude({ cwd: '/nonexistent/path/never/exists' }), '');
  });
});

describe('buildBrokerStatusLine', () => {
  it('reports broker off in default solo mode', () => {
    const line = buildBrokerStatusLine({ env: {} });
    assert.match(line, /MCP broker: off/);
    assert.match(line, /deployment mode: solo/);
    assert.match(line, /CONSTRUCT_MCP_BROKER=on/);
  });

  it('reports broker on when team mode is set', () => {
    const line = buildBrokerStatusLine({ env: { CONSTRUCT_DEPLOYMENT_MODE: 'team' } });
    assert.match(line, /MCP broker: on/);
    assert.match(line, /deployment mode: team/);
    assert.match(line, /ApprovalRequired/);
  });

  it('honors the explicit CONSTRUCT_MCP_BROKER=on override in solo mode', () => {
    const line = buildBrokerStatusLine({ env: { CONSTRUCT_MCP_BROKER: 'on' } });
    assert.match(line, /MCP broker: on/);
    assert.match(line, /deployment mode: solo/);
  });

  it('honors the explicit CONSTRUCT_MCP_BROKER=off override in team mode', () => {
    const line = buildBrokerStatusLine({
      env: { CONSTRUCT_DEPLOYMENT_MODE: 'team', CONSTRUCT_MCP_BROKER: 'off' },
    });
    assert.match(line, /MCP broker: off/);
  });
});

describe('buildSessionPrelude', () => {
  it('combines intake + broker blocks when both have content', () => {
    const out = buildSessionPrelude({
      cwd: tmpRoot,
      env: { CONSTRUCT_DEPLOYMENT_MODE: 'team', CONSTRUCT_INTAKE_QUEUE_BACKEND: 'filesystem' },
    });
    assert.match(out, /## Pending R&D intake/);
    assert.match(out, /MCP broker: on/);
  });

  it('still renders the broker line when no intake is pending', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prelude-empty-'));
    try {
      const out = buildSessionPrelude({ cwd: empty, env: {} });
      assert.doesNotMatch(out, /## Pending R&D intake/);
      assert.match(out, /MCP broker: off/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('readOracleDockState', () => {
  it('returns hidden state when oracle is disabled', () => {
    const state = readOracleDockState({ cwd: tmpRoot, env: { CONSTRUCT_ORACLE: 'off' } });
    assert.equal(state.visible, false);
  });
});
