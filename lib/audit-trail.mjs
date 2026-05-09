/**
 * lib/audit-trail.mjs — reads the append-only audit log produced by
 * lib/hooks/audit-trail.mjs and renders it for `construct audit trail`.
 *
 * The log is JSONL at ~/.cx/audit-trail.jsonl. Each line carries a
 * prev_line_hash pointing at the SHA-256 of the previous line — tampering
 * (reorder, delete, edit) breaks the chain and is surfaced by --verify.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AUDIT_FILE = join(homedir(), '.cx', 'audit-trail.jsonl');

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function readAuditTrail({ limit = 50, since = null, agent = null, tool = null } = {}) {
  if (!existsSync(AUDIT_FILE)) return [];
  const lines = readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
  const sinceMs = since ? new Date(since).getTime() : 0;
  const filtered = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (sinceMs && new Date(row.ts).getTime() < sinceMs) continue;
      if (agent && row.agent !== agent) continue;
      if (tool && row.tool !== tool) continue;
      filtered.push(row);
    } catch { /* skip malformed */ }
  }
  return filtered.slice(-limit);
}

export function verifyChain() {
  if (!existsSync(AUDIT_FILE)) return { ok: true, verified: 0, broken: [] };
  const lines = readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
  const broken = [];
  let prevHash = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let row;
    try { row = JSON.parse(line); } catch {
      broken.push({ line: i + 1, reason: 'malformed JSON' });
      continue;
    }
    if (i > 0 && row.prev_line_hash !== prevHash) {
      broken.push({
        line: i + 1,
        expected: prevHash,
        actual: row.prev_line_hash,
        reason: 'prev_line_hash mismatch — chain break',
      });
    }
    prevHash = sha256(line);
  }
  return { ok: broken.length === 0, verified: lines.length, broken };
}

function formatRow(row) {
  const ts = row.ts?.replace('T', ' ').replace('Z', '') || '?';
  const agent = (row.agent || '?').padEnd(22);
  const tool = (row.tool || '?').padEnd(12);
  const task = row.task?.key ? `task=${row.task.key}` : '';
  const target = row.target || '';
  return `${ts}  ${agent}  ${tool}  ${task}${task && target ? '  ' : ''}${target}`;
}

export async function runAuditTrailCli(args = []) {
  const flags = new Set();
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--verify') flags.add('verify');
    else if (arg === '--json') flags.add('json');
    else if (arg === '--all') flags.add('all');
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice(8));
    else if (arg === '--limit') options.limit = Number(args[++i]);
    else if (arg.startsWith('--since=')) options.since = arg.slice(8);
    else if (arg === '--since') options.since = args[++i];
    else if (arg.startsWith('--agent=')) options.agent = arg.slice(8);
    else if (arg === '--agent') options.agent = args[++i];
    else if (arg.startsWith('--tool=')) options.tool = arg.slice(7);
    else if (arg === '--tool') options.tool = args[++i];
    else if (arg === '--help' || arg === '-h') flags.add('help');
  }

  if (flags.has('help')) {
    console.log(`Usage: construct audit trail [options]

Options:
  --limit N         Show only the last N records (default: 50, --all for everything)
  --all             Show all records
  --since <iso>     Filter to records on or after an ISO timestamp
  --agent <name>    Filter to a specific agent (e.g. cx-engineer)
  --tool <name>     Filter to a specific tool (Edit, Write, MultiEdit, NotebookEdit, Bash)
  --verify          Verify the tamper-evidence chain and exit
  --json            Emit raw JSONL lines instead of formatted output
  -h, --help        Show this message

Log location: ${AUDIT_FILE}
`);
    return;
  }

  if (flags.has('verify')) {
    const result = verifyChain();
    if (result.ok) {
      console.log(`Audit chain OK — ${result.verified} records verified.`);
      return;
    }
    console.error(`Audit chain BROKEN — ${result.broken.length} issue${result.broken.length === 1 ? '' : 's'} across ${result.verified} records:`);
    for (const b of result.broken) {
      console.error(`  line ${b.line}: ${b.reason}`);
    }
    process.exit(1);
  }

  if (!existsSync(AUDIT_FILE)) {
    console.log(`No audit trail yet. Log will appear at ${AUDIT_FILE} once mutations occur.`);
    return;
  }

  const rows = readAuditTrail({
    limit: flags.has('all') ? Infinity : (options.limit || 50),
    since: options.since,
    agent: options.agent,
    tool: options.tool,
  });

  if (rows.length === 0) {
    console.log('No audit records match the current filter.');
    return;
  }

  if (flags.has('json')) {
    for (const r of rows) console.log(JSON.stringify(r));
    return;
  }

  const size = statSync(AUDIT_FILE).size;
  console.log(`Audit trail — ${rows.length} record${rows.length === 1 ? '' : 's'} (log ${Math.round(size / 1024)} KB at ${AUDIT_FILE})`);
  console.log('─'.repeat(100));
  for (const r of rows) console.log(formatRow(r));
  console.log('');
  console.log('Use --json for full records, --verify to check the tamper-evidence chain.');
}
