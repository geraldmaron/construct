/**
 * tests/scripts/npm-audit-with-exceptions.test.mjs — exceptions-aware npm
 * audit gate (construct-h6qjb follow-up: ci.yml's raw npm audit had no way
 * to see .github/supply-chain-exceptions.json).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAuditAgainstExceptions } from '../../scripts/npm-audit-with-exceptions.mjs';

function fakeExecFile(reportVulnerabilities) {
  const report = JSON.stringify({ vulnerabilities: reportVulnerabilities });
  return () => report;
}

function fakeExceptions(activeIds) {
  return () => ({ ok: true, errors: [], active: activeIds.map((id) => ({ id })), expired: [] });
}

test('a direct advisory matching an active exception is excepted, not failed', () => {
  const result = evaluateAuditAgainstExceptions({
    execFile: fakeExecFile({
      'vulnerable-pkg': {
        severity: 'high',
        via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', title: 'known issue' }],
      },
    }),
    evaluateExceptions: fakeExceptions(['GHSA-aaaa-bbbb-cccc']),
  });
  assert.equal(result.ok, true);
  assert.equal(result.unexcepted.length, 0);
  assert.equal(result.excepted.length, 1);
});

test('an advisory with no matching exception fails the gate', () => {
  const result = evaluateAuditAgainstExceptions({
    execFile: fakeExecFile({
      'vulnerable-pkg': {
        severity: 'high',
        via: [{ url: 'https://github.com/advisories/GHSA-zzzz-yyyy-xxxx', title: 'new issue' }],
      },
    }),
    evaluateExceptions: fakeExceptions(['GHSA-aaaa-bbbb-cccc']),
  });
  assert.equal(result.ok, false);
  assert.equal(result.unexcepted.length, 1);
  assert.deepEqual(result.unexcepted[0].ghsaIds, ['GHSA-zzzz-yyyy-xxxx']);
});

test('a purely-transitive entry (via names another package, not a GHSA url) resolves through the graph', () => {
  const result = evaluateAuditAgainstExceptions({
    execFile: fakeExecFile({
      'root-cause-pkg': {
        severity: 'moderate',
        via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', title: 'root cause' }],
      },
      'downstream-pkg': {
        severity: 'moderate',
        via: ['root-cause-pkg'],
      },
    }),
    evaluateExceptions: fakeExceptions(['GHSA-aaaa-bbbb-cccc']),
  });
  assert.equal(result.ok, true);
  assert.equal(result.excepted.length, 2);
  const downstream = result.excepted.find((e) => e.name === 'downstream-pkg');
  assert.deepEqual(downstream.ghsaIds, ['GHSA-aaaa-bbbb-cccc']);
});

test('a transitive entry resolving to an unexcepted advisory still fails', () => {
  const result = evaluateAuditAgainstExceptions({
    execFile: fakeExecFile({
      'root-cause-pkg': {
        severity: 'high',
        via: [{ url: 'https://github.com/advisories/GHSA-zzzz-yyyy-xxxx', title: 'new root cause' }],
      },
      'downstream-pkg': {
        severity: 'high',
        via: ['root-cause-pkg'],
      },
    }),
    evaluateExceptions: fakeExceptions(['GHSA-aaaa-bbbb-cccc']),
  });
  assert.equal(result.ok, false);
  assert.equal(result.unexcepted.length, 2);
});

test('an entry with no GHSA id anywhere in its chain fails closed rather than passing silently', () => {
  const result = evaluateAuditAgainstExceptions({
    execFile: fakeExecFile({
      'mystery-pkg': {
        severity: 'high',
        via: ['nonexistent-pkg'],
      },
    }),
    evaluateExceptions: fakeExceptions(['GHSA-aaaa-bbbb-cccc']),
  });
  assert.equal(result.ok, false);
  assert.equal(result.unexcepted.length, 1);
  assert.deepEqual(result.unexcepted[0].ghsaIds, []);
});

test('an invalid exceptions file fails the gate instead of silently allowing everything', () => {
  const result = evaluateAuditAgainstExceptions({
    execFile: fakeExecFile({}),
    evaluateExceptions: () => ({ ok: false, errors: ['bad file'], active: [], expired: [] }),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /bad file/);
});
