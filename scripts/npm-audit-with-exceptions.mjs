#!/usr/bin/env node
/**
 * scripts/npm-audit-with-exceptions.mjs — high+ npm audit gate that honors
 * .github/supply-chain-exceptions.json (construct-h6qjb follow-up).
 *
 * ci.yml's raw `npm audit --audit-level=high` had no way to see the
 * exceptions file supply-chain.yml's osv-scanner step already respects, so
 * any dependency bump that surfaced an already-accepted, dated GHSA
 * permanently failed ci-required. This wraps `npm audit --json`, matches
 * each advisory's GHSA ID against the active (non-expired) exceptions, and
 * only fails on findings that aren't excepted.
 */

import { execFileSync } from 'node:child_process';

import { evaluateSupplyChainExceptions } from './check-supply-chain-exceptions.mjs';

const GHSA_RE = /\/advisories\/(GHSA-[a-z0-9-]+)/i;

/**
 * A vulnerability's `via` entries are either direct advisory objects (with a
 * GHSA url) or plain strings naming another vulnerable package it depends on
 * (npm audit's transitive "effects" shape). Resolve the string form by
 * walking the rest of the report so a purely-transitive entry (e.g. a direct
 * dependency that's vulnerable only because it pulls in a vulnerable
 * sub-dependency) inherits the real advisory IDs instead of matching nothing.
 */
function extractGhsaIds(via, vulnerabilities, seen = new Set()) {
  const ids = new Set();
  for (const entry of via) {
    if (typeof entry === 'object' && entry?.url) {
      const match = GHSA_RE.exec(entry.url);
      if (match) ids.add(match[1]);
      continue;
    }
    if (typeof entry === 'string' && !seen.has(entry)) {
      seen.add(entry);
      const nested = vulnerabilities[entry];
      if (nested) {
        for (const id of extractGhsaIds(nested.via || [], vulnerabilities, seen)) ids.add(id);
      }
    }
  }
  return ids;
}

export function runNpmAuditJson({ execFile = execFileSync, args } = {}) {
  try {
    return execFile('npm', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    // npm audit exits non-zero when it finds vulnerabilities; stdout still
    // carries the JSON report in that case.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

/**
 * @param {{ auditArgs?: string[], execFile?: Function, evaluateExceptions?: Function }} [opts]
 */
export function evaluateAuditAgainstExceptions({
  auditArgs = ['audit', '--omit=dev', '--audit-level=high', '--workspaces=false', '--json'],
  execFile = execFileSync,
  evaluateExceptions = evaluateSupplyChainExceptions,
} = {}) {
  const stdout = runNpmAuditJson({ execFile, args: auditArgs });
  const report = JSON.parse(stdout);
  const vulnerabilities = report.vulnerabilities || {};

  const exceptions = evaluateExceptions();
  if (!exceptions.ok) {
    return {
      ok: false,
      unexcepted: [],
      excepted: [],
      errors: [`supply-chain-exceptions.json invalid: ${exceptions.errors.join('; ')}`],
    };
  }
  const activeIds = new Set(exceptions.active.map((e) => e.id));

  const unexcepted = [];
  const excepted = [];

  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    const ghsaIds = extractGhsaIds(Array.isArray(vuln.via) ? vuln.via : [], vulnerabilities);
    if (ghsaIds.size === 0) {
      unexcepted.push({ name, severity: vuln.severity, ghsaIds: [] });
      continue;
    }
    const allExcepted = [...ghsaIds].every((id) => activeIds.has(id));
    const record = { name, severity: vuln.severity, ghsaIds: [...ghsaIds] };
    (allExcepted ? excepted : unexcepted).push(record);
  }

  return { ok: unexcepted.length === 0, unexcepted, excepted, errors: [] };
}

function main() {
  const result = evaluateAuditAgainstExceptions();

  if (result.errors.length) {
    for (const err of result.errors) process.stderr.write(`${err}\n`);
    process.exit(1);
  }

  for (const entry of result.excepted) {
    process.stdout.write(`[excepted] ${entry.name} (${entry.severity}): ${entry.ghsaIds.join(', ')}\n`);
  }
  for (const entry of result.unexcepted) {
    process.stderr.write(`[FAIL] ${entry.name} (${entry.severity}): ${entry.ghsaIds.join(', ') || 'no GHSA id found'}\n`);
  }

  if (!result.ok) {
    process.stderr.write(
      `\n${result.unexcepted.length} unexcepted high+ advisory(ies). Add a dated exception to ` +
      '.github/supply-chain-exceptions.json if accepted, or fix the dependency.\n'
    );
    process.exit(1);
  }

  process.stdout.write(`\nnpm audit: 0 unexcepted high+ advisories (${result.excepted.length} excepted)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
