/**
 * 03b-naming.mjs — Phase 3b: naming-convention drift across every surface.
 *
 * The canonical names are dev/stop/dashboard; up/down/serve are retired. Three drift
 * classes the sweep flags:
 *   - retired aliases printed to users (skills, templates, personas, bin error strings)
 *     — hard drift a user sees and copies;
 *   - retired aliases in internal comments — softer drift;
 *   - handler rows binding a function whose identity diverges from the command name
 *     (`['dev', cmdUp]`).
 * Covers source + content surfaces (docs are Phase 3) and flags each class.
 *
 * Read-only. Run: node scripts/audit/03b-naming.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, BIN_PATH } from './lib/handlers.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const RETIRED = { up: 'dev', down: 'stop', serve: 'dashboard' };
const ALIAS_RE = /construct\s+(up|down|serve)\b/g;

const SCAN_DIRS = ['bin', 'lib', 'scripts', 'skills', 'specialists', 'templates', 'personas', 'rules'];
const SCAN_EXTS = ['.mjs', '.js', '.md', '.mdx', '.json', '.toml', '.txt'];
const EXCLUDE = /(node_modules|\.git|audit-artifacts|scripts\/audit)/;

// User-facing surfaces: a retired alias here is copied verbatim by a human or agent.

const USER_FACING_DIR = /(^|\/)(skills|specialists|templates|personas)(\/|$)/;
const USER_FACING_LINE = /(errorln|println|console\.(log|error)|process\.stdout|process\.stderr)/;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (EXCLUDE.test(full)) continue;
    if (e.isDirectory()) out.push(...walk(full));
    else if (SCAN_EXTS.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

function aliasDrift() {
  const hits = [];
  for (const base of SCAN_DIRS) {
    for (const file of walk(path.join(REPO_ROOT, base))) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        ALIAS_RE.lastIndex = 0;
        let m;
        while ((m = ALIAS_RE.exec(line))) {
          const rel = path.relative(REPO_ROOT, file);
          const userFacing = USER_FACING_DIR.test(rel) || USER_FACING_LINE.test(line);
          hits.push({ file: rel, line: i + 1, alias: m[1], replacement: RETIRED[m[1]], userFacing, text: line.trim().slice(0, 120) });
        }
      });
    }
  }
  return hits;
}

// Handler rows `['<cmd>', <ident>]` where the bound identifier diverges from the command
// name (e.g. dev bound to cmdUp).

function handlerNameDrift() {
  const source = fs.readFileSync(BIN_PATH, 'utf8');
  const start = source.indexOf('const handlers = new Map([');
  const after = source.slice(start);
  const body = after.slice(0, after.match(/\n\]\);/).index);
  const drift = [];
  for (const m of body.matchAll(/\n {2,3}\[\s*'([^']+)'\s*,\s*(cmd[A-Za-z0-9]+)\s*\]/g)) {
    const cmd = m[1];
    const fn = m[2];
    const norm = cmd.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!fn.toLowerCase().includes(norm)) drift.push({ command: cmd, fn });
  }
  return drift;
}

export function runNamingSweep() {
  return { aliasDrift: aliasDrift(), handlerNameDrift: handlerNameDrift() };
}

export function namingFindings() {
  return toFindings(runNamingSweep());
}

function toFindings(report) {
  const rows = [];
  for (const h of report.aliasDrift) {
    rows.push({
      type: h.userFacing ? 'naming-drift-user-facing' : 'naming-drift-comment',
      target: `${h.file}:${h.line}`,
      severity: h.userFacing ? 'high' : 'low',
      tier: 'mechanical',
      evidence: `\`construct ${h.alias}\` → should be \`construct ${h.replacement}\`: ${h.text}`,
      recommendation: `Replace construct ${h.alias} with construct ${h.replacement}.`,
    });
  }
  for (const d of report.handlerNameDrift) {
    rows.push({
      type: 'handler-name-drift',
      target: `${d.command} → ${d.fn}`,
      severity: 'low',
      tier: 'mechanical',
      evidence: `handler for '${d.command}' is bound to ${d.fn}; identifier no longer matches the command`,
      recommendation: `Rename ${d.fn} to reflect '${d.command}' (e.g. cmd${d.command[0].toUpperCase()}${d.command.slice(1)}).`,
    });
  }
  return rows;
}

function main() {
  const report = runNamingSweep();
  const findings = toFindings(report);
  recordFindings('03b-naming', findings);
  writeJson('naming-drift.json', report);
  const userFacing = report.aliasDrift.filter((h) => h.userFacing).length;
  process.stdout.write(`[audit:03b] alias drift: ${report.aliasDrift.length} hit(s) (${userFacing} user-facing), ` +
    `handler-name drift: ${report.handlerNameDrift.length} (${report.handlerNameDrift.map((d) => `${d.command}→${d.fn}`).join(', ')}).\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
