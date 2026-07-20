/**
 * lib/doctor/report.mjs — M1 self-host measurement reporter.
 *
 * Tallies what the L0 doctor and L1 role framework actually did over a window.
 * Evaluates the "Construct runs on Construct" milestones (M1 = SRE-only,
 * 7 days unattended; later milestones add more personas). Pure read-only —
 * scans the JSONL audit logs and ledgers and produces a markdown summary.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { recent } from './audit.mjs';
import { doctorRoot } from '../config/xdg.mjs';
import { getTotalDailySpend, getDailySpend, totalBudget, workerProfileBudget, dayKey } from '../cost-ledger.mjs';

function parseWindow(arg) {
  const m = /^(\d+)([dhm])$/.exec(arg || '7d');
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  return n * (unit === 'd' ? 86400_000 : unit === 'h' ? 3600_000 : 60_000);
}

function readJsonl(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn(x) || 'unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function summarizeActions(auditEntries) {
  const actions = auditEntries.filter((e) => e.kind === 'action');
  const escalations = auditEntries.filter((e) => e.kind === 'escalate');
  const samples = auditEntries.filter((e) => e.kind === 'sample');
  const recoveries = auditEntries.filter((e) => e.kind === 'recovery');
  const errors = auditEntries.filter((e) => e.kind === 'error');
  return {
    actions: { total: actions.length, byWatcher: groupBy(actions, (e) => e.watcher), byAction: groupBy(actions, (e) => e.action) },
    escalations: { total: escalations.length, byWatcher: groupBy(escalations, (e) => e.watcher), byEvent: groupBy(escalations, (e) => e.target) },
    samples: { total: samples.length, byWatcher: groupBy(samples, (e) => e.watcher) },
    recoveries: { total: recoveries.length, byWatcher: groupBy(recoveries, (e) => e.watcher) },
    errors: { total: errors.length, byWatcher: groupBy(errors, (e) => e.watcher) },
  };
}

function fmtTable(title, obj) {
  const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return `${title}: (none)\n`;
  let out = `${title}:\n`;
  for (const [k, v] of entries) out += `  ${String(v).padStart(4, ' ')}  ${k}\n`;
  return out;
}

export async function runReport(args = []) {
  const windowArg = args.find((a) => a.startsWith('--since='))?.split('=')[1] || '7d';
  const windowMs = parseWindow(windowArg);
  const since = Date.now() - windowMs;

  const auditEntries = recent({ since, limit: 10000 });
  const events = readJsonl(join(doctorRoot(), 'events.jsonl')).filter((e) => e.ts >= since);
  const pending = readJsonl(join(doctorRoot(), 'role-pending.jsonl')).filter((e) => e.ts >= since);

  const summary = summarizeActions(auditEntries);
  const eventsByType = groupBy(events, (e) => e.type);
  const pendingByWorkerProfile = groupBy(pending, (e) => e.workerProfileId);
  const pendingUnresolved = pending.filter((e) => !e.resolvedAt);

  const workerProfiles = ['sre', 'qa', 'security', 'docs-keeper', 'engineer'];
  const costByWorkerProfile = {};
  for (const id of workerProfiles) {
    const s = getDailySpend({ workerProfileId: id });
    costByWorkerProfile[id] = { spent: s.costUsd, cap: workerProfileBudget(id), invocations: s.invocations };
  }
  const total = getTotalDailySpend();

  const lines = [];
  lines.push(`# Construct-on-Construct measurement — window: ${windowArg}`);
  lines.push(``);
  lines.push(`Window: ${new Date(since).toISOString()} → ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`## L0 — Deterministic doctor actions`);
  lines.push(``);
  lines.push(`Total actions: ${summary.actions.total}`);
  lines.push('```');
  lines.push(fmtTable('By watcher', summary.actions.byWatcher).trim());
  lines.push(fmtTable('By action', summary.actions.byAction).trim());
  lines.push(fmtTable('Recoveries (services that came back)', summary.recoveries.byWatcher).trim());
  lines.push(fmtTable('Errors (watcher tick failures)', summary.errors.byWatcher).trim());
  lines.push('```');
  lines.push(``);
  lines.push(`## L0 → L1 escalations`);
  lines.push(``);
  lines.push(`Total escalations: ${summary.escalations.total}`);
  lines.push('```');
  lines.push(fmtTable('By watcher', summary.escalations.byWatcher).trim());
  lines.push(fmtTable('By event type', summary.escalations.byEvent).trim());
  lines.push('```');
  lines.push(``);
  lines.push(`## L1 — Role framework`);
  lines.push(``);
  lines.push(`Events emitted: ${events.length}`);
  lines.push('```');
  lines.push(fmtTable('By event type', eventsByType).trim());
  lines.push('```');
  lines.push(``);
  lines.push(`Pending invocations created: ${pending.length}  ·  unresolved: ${pendingUnresolved.length}`);
  lines.push('```');
  lines.push(fmtTable('By worker profile', pendingByWorkerProfile).trim());
  lines.push('```');
  lines.push(``);
  lines.push(`## Cost (today, ${dayKey()})`);
  lines.push(``);
  lines.push(`Total: $${total.costUsd.toFixed(4)} / $${totalBudget().toFixed(2)} cap  ·  ${total.invocations} invocations`);
  lines.push(``);
  for (const id of workerProfiles) {
    const c = costByWorkerProfile[id];
    if (c.invocations === 0 && c.spent === 0) continue;
    lines.push(`- ${id}: $${c.spent.toFixed(4)} / $${c.cap.toFixed(2)}  ·  ${c.invocations} invocations`);
  }
  lines.push(``);

  const pricingSources = {};
  for (const e of auditEntries) {
    if (e.kind === 'action' && e.action === 'ledger-sync' && e.context?.sources) {
      for (const [src, n] of Object.entries(e.context.sources)) {
        pricingSources[src] = (pricingSources[src] || 0) + n;
      }
    }
  }
  if (Object.keys(pricingSources).length > 0) {
    const total = Object.values(pricingSources).reduce((a, b) => a + b, 0);
    const staticPct = total > 0 ? Math.round(((pricingSources['estimated:static'] || 0) / total) * 100) : 0;
    lines.push(`Pricing sources: ${Object.entries(pricingSources).map(([s, n]) => `${s}=${n}`).join(', ')}`);
    if (staticPct >= 50) {
      lines.push(`⚠ ${staticPct}% of entries priced from static fallback — telemetry model sync may be inactive; absolute spend is approximate. Run \`construct status\` to check telemetry integration.`);
    }
    lines.push(``);
  }
  lines.push(`## Health verdict`);
  lines.push(``);
  const verdicts = [];
  if (summary.actions.total === 0 && summary.samples.total === 0) {
    verdicts.push('⚠ No audit entries in window — doctor may not be running. Verify with \`construct doctor status\`.');
  } else if (summary.samples.total === 0) {
    verdicts.push('⚠ Actions logged but no samples — watchers may be partially failing. Check `construct doctor logs`.');
  } else {
    verdicts.push('✓ Doctor produced samples and actions in window.');
  }
  if (summary.errors.total > 0) {
    verdicts.push(`⚠ ${summary.errors.total} watcher errors in window — see audit log.`);
  }
  if (pendingUnresolved.length > 0) {
    verdicts.push(`→ ${pendingUnresolved.length} unresolved pending invocations — Construct should dispatch these on next session.`);
  }
  if (total.costUsd / totalBudget() > 0.5) {
    verdicts.push(`⚠ Daily cost is ${Math.round((total.costUsd / totalBudget()) * 100)}% of cap — review burn rate.`);
  }
  for (const v of verdicts) lines.push(`- ${v}`);
  return lines.join('\n');
}
