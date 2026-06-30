#!/usr/bin/env node
/**
 * scripts/learning-status.mjs — One-screen dashboard for the learning loops.
 *
 * Answers "is Construct actually getting smarter?" by reading the durable
 * artifacts each epic produces:
 *
 *   A1 reflect hook      .cx/observations/index.json + vectors.json
 *   A2 research          .cx/knowledge/external/research/*.md
 *   A3 outcomes          .cx/outcomes/_summary.json (after aggregateOutcomes)
 *   B1 scope             construct.config.json / .cx/scope.json
 *
 * Output is a tab-aligned table. No LLM, no network. Cheap to run on every
 * `construct status` invocation.
 */
import fs from 'node:fs';
import path from 'node:path';

import { summarizeToolNameMisses, summarizeToolFailures } from '../lib/mcp/tool-recovery.mjs';

const cwd = process.cwd();

function safeRead(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function countObservations() {
  const idx = safeRead(path.join(cwd, '.cx', 'observations', 'index.json'));
  if (!Array.isArray(idx)) return { total: 0, last24h: 0 };
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = idx.filter((e) => Date.parse(e.createdAt) >= since).length;
  return { total: idx.length, last24h };
}

function countResearchFindings() {
  const dir = path.join(cwd, '.cx', 'knowledge', 'external', 'research');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

function readOutcomesSummary() {
  return safeRead(path.join(cwd, '.cx', 'outcomes', '_summary.json'));
}

function readActiveScope() {
  const config = safeRead(path.join(cwd, 'construct.config.json'));
  if (config?.scope) return { id: config.scope, source: 'construct.config.json' };
  const custom = safeRead(path.join(cwd, '.cx', 'scope.json'));
  if (custom?.custom === true && custom.id) return { id: custom.id, source: '.cx/scope.json (custom)' };
  return { id: 'rnd (default)', source: 'fallback' };
}

const obs = countObservations();
const research = countResearchFindings();
const outcomes = readOutcomesSummary();
const scope = readActiveScope();

const misses = summarizeToolNameMisses(cwd);
const failures = summarizeToolFailures(cwd);

const rows = [
  ['Active scope', `${scope.id}`, scope.source],
  ['Observations (A1)', `${obs.total} total, ${obs.last24h} in last 24h`, '.cx/observations/'],
  ['Research findings (A2)', `${research}`, '.cx/knowledge/external/research/'],
  ['Tool-name misses', misses.total === 0 ? 'none' : `${misses.total} (top: ${misses.top.map((m) => `${m.name}×${m.count}`).join(', ')})`, '.cx/observations/tool-name-misses.jsonl'],
  ['Tool failures', failures.total === 0 ? 'none' : `${failures.total} (top: ${failures.top.map((m) => `${m.name}×${m.count}`).join(', ')})`, '.cx/observations/tool-failures.jsonl'],
];

if (outcomes && outcomes.roles && Object.keys(outcomes.roles).length > 0) {
  const roles = Object.entries(outcomes.roles).slice(0, 5);
  rows.push(['Outcomes (A3)', `${roles.length} role${roles.length === 1 ? '' : 's'} with data`, '.cx/outcomes/']);
  for (const [role, stats] of roles) {
    rows.push([`  ${role}`, `${stats.count} runs · ${Math.round(stats.successRate * 100)}% success · 30d: ${Math.round(stats.last30.successRate * 100)}%`, '']);
  }
} else {
  rows.push(['Outcomes (A3)', 'no data yet', '.cx/outcomes/']);
}

const widths = [0, 0, 0];
for (const r of rows) for (let i = 0; i < 3; i++) widths[i] = Math.max(widths[i], String(r[i]).length);

console.log('Construct learning status');
console.log('-'.repeat(widths[0] + widths[1] + widths[2] + 6));
for (const r of rows) {
  console.log(`${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2]}`);
}
console.log('');
console.log('Tip: run `node scripts/learning-status.mjs --aggregate` to rebuild .cx/outcomes/_summary.json first.');

if (process.argv.includes('--aggregate')) {
  const { aggregateOutcomes } = await import('../lib/outcomes/aggregate.mjs');
  aggregateOutcomes(cwd);
  console.log('Aggregated outcomes summary written.');
}
