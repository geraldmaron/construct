/**
 * 06-audit.mjs — Phase 6: is the experience actually auditable?
 *
 * The audit trail is a SHA-256 hash chain in .cx/audit-trail.jsonl, populated by the
 * audit-trail hook on tool use (not by commands calling an append API — there is none).
 * Two things make it trustworthy: the chain verifies, and the hook is registered so
 * mutations are captured. This phase checks both against the real artifacts, no assumptions.
 *
 * Read-only. Run: node scripts/audit/06-audit.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyChain } from '../../lib/audit-trail.mjs';
import { REPO_ROOT } from './lib/handlers.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

// The hook registry is lib/hook-health.mjs (the manifest the dispatcher resolves), not
// settings.template.json; the trail being non-empty is independent proof the hook fires.

function hookRegistered() {
  const hookFile = path.join(REPO_ROOT, 'lib', 'hooks', 'audit-trail.mjs');
  const manifest = path.join(REPO_ROOT, 'lib', 'hook-health.mjs');
  const present = fs.existsSync(hookFile);
  const registered = fs.existsSync(manifest) && /['"]audit-trail['"]/.test(fs.readFileSync(manifest, 'utf8'));
  return { present, registered };
}

export function runAuditability() {
  const chain = verifyChain();
  const hook = hookRegistered();
  const brokenRatio = chain.verified ? chain.broken.length / chain.verified : 0;
  return {
    chain: { ok: chain.ok, verified: chain.verified, broken: chain.broken.length, brokenRatio: Number(brokenRatio.toFixed(3)), firstBreak: chain.broken[0]?.line ?? null },
    hook,
  };
}

function toFindings(report) {
  const rows = [];
  if (!report.chain.ok) {
    rows.push({
      type: 'audit-chain-broken', target: '.cx/audit-trail.jsonl',
      severity: report.chain.brokenRatio > 0.5 ? 'high' : 'medium', tier: 'judgment',
      evidence: `verifyChain ok=false: ${report.chain.broken}/${report.chain.verified} links broken (${Math.round(report.chain.brokenRatio * 100)}%), first break at line ${report.chain.firstBreak}. Signature of concurrent appends to a serial hash chain (hook + daemons + commands share one writer).`,
      recommendation: 'Make the chain concurrency-safe (single-writer queue, or per-writer segments each independently chained), or document a reset/migration boundary so verifyChain can validate per-segment.',
    });
  }
  if (!report.hook.present || !report.hook.registered) {
    rows.push({
      type: 'audit-hook-missing', target: 'lib/hooks/audit-trail.mjs',
      severity: 'high', tier: 'judgment',
      evidence: `present=${report.hook.present} registered=${report.hook.registered}`,
      recommendation: 'Ensure the audit-trail hook exists and is registered so mutations are captured.',
    });
  }
  return rows;
}

function main() {
  const report = runAuditability();
  const findings = toFindings(report);
  recordFindings('06-audit', findings);
  writeJson('auditability-report.json', report);
  process.stdout.write(`[audit:06] chain ok=${report.chain.ok} (${report.chain.broken}/${report.chain.verified} broken, first@${report.chain.firstBreak}); ` +
    `hook present=${report.hook.present} registered=${report.hook.registered}.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
