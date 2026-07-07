/**
 * tests/oracle-gaps-detection.test.mjs — oracle gaps detection and filtering.
 *
 * Tests collectOracleGaps verdict-only classification, actionable gap detection,
 * and edge cases: empty gap list, impact-untested (changed capability with/without
 * validating test).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectOracleGaps, formatOracleGapsReport } from '../lib/oracle/gaps.mjs';
import { writeVerdict } from '../lib/oracle/verdicts.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-gaps-'));
  tmpDirs.push(dir);
  return dir;
}

describe('collectOracleGaps verdict-only and actionable classification', () => {
  it('returns empty arrays when no verdict exists', () => {
    const projectDir = freshProjectDir();
    const result = collectOracleGaps(projectDir);
    assert.equal(result.verdict, null);
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(result.verdictOnly, []);
    assert.deepEqual(result.actionable, []);
  });

  it('classifies verdict-only gaps correctly', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'degraded',
      gaps: [
        { id: 'beads-hygiene', severity: 'high', detail: 'Stuck beads' },
        { id: 'workflow-misaligned', severity: 'high', detail: 'Workflow mismatch' },
        { id: 'propagation-stale', severity: 'medium', detail: 'Stale propagation' },
      ],
    };
    writeVerdict(projectDir, verdict);
    const result = collectOracleGaps(projectDir);
    assert.equal(result.verdict, 'degraded');
    assert.equal(result.gaps.length, 3);
    assert.equal(result.verdictOnly.length, 3, 'all three are verdict-only');
    assert.deepEqual(
      result.verdictOnly.map((g) => g.id),
      ['beads-hygiene', 'workflow-misaligned', 'propagation-stale'],
    );
    assert.equal(result.actionable.length, 0, 'verdict-only gaps never actionable');
  });

  it('classifies actionable high-severity gaps when auto-raise enabled', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'degraded',
      gaps: [
        { id: 'impact-untested', severity: 'high', detail: 'Changed capabilities lack test' },
        { id: 'specialist-review', severity: 'high', detail: 'Manual review needed' },
      ],
    };
    writeVerdict(projectDir, verdict);
    const env = { CONSTRUCT_ORACLE: '1', CONSTRUCT_ORACLE_AUTO_RAISE: '1' };
    const result = collectOracleGaps(projectDir, { env });
    assert.equal(result.verdictOnly.length, 0);
    assert.equal(result.actionable.length, 2, 'both high-severity non-verdict-only gaps are actionable');
  });

  it('excludes low-severity gaps from actionable', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'degraded',
      gaps: [
        { id: 'impact-untested', severity: 'medium', detail: 'Low severity' },
      ],
    };
    writeVerdict(projectDir, verdict);
    const env = { CONSTRUCT_ORACLE: '1', CONSTRUCT_ORACLE_AUTO_RAISE: '1' };
    const result = collectOracleGaps(projectDir, { env });
    assert.equal(result.actionable.length, 0, 'medium-severity gaps not actionable');
  });

  it('honors CONSTRUCT_ORACLE off switch', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'degraded',
      gaps: [
        { id: 'impact-untested', severity: 'high', detail: 'Changed capability' },
      ],
    };
    writeVerdict(projectDir, verdict);
    const env = { CONSTRUCT_ORACLE: 'off' };
    const result = collectOracleGaps(projectDir, { env });
    assert.equal(result.actionable.length, 0, 'oracle off disables auto-raise');
  });

  it('separates verdict-only and actionable in mixed gaps', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'degraded',
      gaps: [
        { id: 'beads-hygiene', severity: 'high', detail: 'Verdict-only' },
        { id: 'impact-untested', severity: 'high', detail: 'Actionable' },
        { id: 'team-understaffed', severity: 'high', detail: 'Verdict-only' },
        { id: 'specialist-review', severity: 'low', detail: 'Below threshold' },
      ],
    };
    writeVerdict(projectDir, verdict);
    const env = { CONSTRUCT_ORACLE: '1', CONSTRUCT_ORACLE_AUTO_RAISE: '1' };
    const result = collectOracleGaps(projectDir, { env });
    assert.equal(result.verdictOnly.length, 2);
    assert.equal(result.actionable.length, 1, 'only high-severity non-verdict-only gap');
    assert.equal(result.actionable[0].id, 'impact-untested');
  });
});

describe('formatOracleGapsReport output formatting', () => {
  it('formats empty gaps report', () => {
    const data = { verdict: 'healthy', gaps: [], verdictOnly: [], actionable: [] };
    const report = formatOracleGapsReport(data);
    assert.match(report, /No gaps in latest verdict/);
    assert.match(report, /healthy/);
  });

  it('includes verdict-only section when present', () => {
    const data = {
      verdict: 'degraded',
      gaps: [{ id: 'beads-hygiene', severity: 'high', detail: 'Stuck beads' }],
      verdictOnly: [{ id: 'beads-hygiene', severity: 'high', detail: 'Stuck beads' }],
      actionable: [],
    };
    const report = formatOracleGapsReport(data);
    assert.match(report, /Verdict-only/);
    assert.match(report, /beads-hygiene/);
    assert.match(report, /construct beads drift/);
  });

  it('includes actionable section when present', () => {
    const data = {
      verdict: 'degraded',
      gaps: [{ id: 'impact-untested', severity: 'high', detail: 'Untested changes' }],
      verdictOnly: [],
      actionable: [{ id: 'impact-untested', severity: 'high', detail: 'Untested changes' }],
    };
    const report = formatOracleGapsReport(data);
    assert.match(report, /Actionable/);
    assert.match(report, /impact-untested/);
    assert.match(report, /auto-raise/);
  });

  it('includes other gaps section for in-between gaps', () => {
    const data = {
      verdict: 'degraded',
      gaps: [
        { id: 'impact-untested', severity: 'medium', detail: 'Medium severity' },
        { id: 'specialist-review', severity: 'low', detail: 'Low severity' },
      ],
      verdictOnly: [],
      actionable: [],
    };
    const report = formatOracleGapsReport(data);
    assert.match(report, /Other gaps/);
  });
});

describe('collectOracleGaps impact-untested edge cases', () => {
  it('detects impact-untested gap when changed capability lacks validating test', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'degraded',
      gaps: [
        {
          id: 'impact-untested',
          severity: 'high',
          detail: 'Changed capability: lib/model/new-feature.mjs lacks validating test',
        },
      ],
    };
    writeVerdict(projectDir, verdict);
    const env = { CONSTRUCT_ORACLE: '1', CONSTRUCT_ORACLE_AUTO_RAISE: '1' };
    const result = collectOracleGaps(projectDir, { env });
    assert.equal(result.actionable.length, 1);
    assert.equal(result.actionable[0].id, 'impact-untested');
    assert.match(result.actionable[0].detail, /changed/i);
  });

  it('does not flag impact-untested when changed capability has validating test', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'healthy',
      gaps: [],
    };
    writeVerdict(projectDir, verdict);
    const env = { CONSTRUCT_ORACLE: '1', CONSTRUCT_ORACLE_AUTO_RAISE: '1' };
    const result = collectOracleGaps(projectDir, { env });
    assert.equal(result.actionable.length, 0, 'no gap when test exists');
  });

  it('handles verdict with no gaps field gracefully', () => {
    const projectDir = freshProjectDir();
    const now = new Date().toISOString();
    const verdict = {
      at: now,
      verdict: 'healthy',
    };
    writeVerdict(projectDir, verdict);
    const result = collectOracleGaps(projectDir);
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(result.verdictOnly, []);
    assert.deepEqual(result.actionable, []);
  });

  it('treats null/undefined gaps as empty', () => {
    const projectDir = freshProjectDir();
    fs.mkdirSync(path.join(projectDir, '.cx', 'oracle', 'verdicts'), { recursive: true });
    const file = path.join(projectDir, '.cx', 'oracle', 'verdicts', '2026-01-01.json');
    const verdict = { date: '2026-01-01', latest: { at: '2026-01-01T00:00:00Z', verdict: 'healthy', gaps: null } };
    fs.writeFileSync(file, JSON.stringify(verdict));
    const result = collectOracleGaps(projectDir);
    assert.deepEqual(result.gaps, []);
  });
});
