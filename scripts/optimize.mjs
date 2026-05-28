#!/usr/bin/env node
/**
 *  scripts/optimize.mjs — Agent prompt improvement loop.
 *
 * Reads low-scoring telemetry traces for a given agent, extracts failure
 * patterns, and generates a prompt patch that is applied to the agent's
 * role skill file. Zero external deps — uses the same fetch + chat API
 * as the rest of the pipeline.
 *
 * Usage (via construct optimize):
 *   node scripts/optimize.mjs <agent> [--dry-run] [--list]
 *   node scripts/optimize.mjs --list
 *
 * Requires env: CONSTRUCT_TELEMETRY_BASEURL, CONSTRUCT_TELEMETRY_PUBLIC_KEY, CONSTRUCT_TELEMETRY_SECRET_KEY
 * Optional env: OPENROUTER_API_KEY or ANTHROPIC_API_KEY (for patch generation)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// ─── Config ─────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    })
);
const agentArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

// Default is preview only. --apply is required to write changes to disk so
// prompt-rewriting can never happen silently as a side-effect of a hook or
// scheduled job. --dry-run is retained as an alias for clarity. --rollback
// restores the most recent backup created by a prior --apply.
const APPLY = Boolean(args.apply);
const ROLLBACK = Boolean(args.rollback);
const DRY_RUN = Boolean(args['dry-run']) || (!APPLY && !ROLLBACK);
const LIST_MODE = Boolean(args.list);
const THRESHOLD = parseFloat(args.threshold ?? '0.7');
const DAYS = parseInt(args.days ?? '7', 10);
const MIN_TRACES = parseInt(args['min-traces'] ?? '3', 10);
const APPLY_RATE_LIMIT_DAYS = 7;
const HISTORY_CAP = 5;

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const REVIEW_DIR = path.join(HOME, '.cx', 'performance-reviews');
const HISTORY_DIR = path.join(HOME, '.cx', 'prompt-history');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills', 'roles');

const TELEMETRY_BASEURL = (process.env.CONSTRUCT_TELEMETRY_BASEURL ?? '').replace(/\/$/, '');

// ─── Helpers ────────────────────────────────────────────────────────────────

function telemetryHeaders() {
  const key = process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  const secret = process.env.CONSTRUCT_TELEMETRY_SECRET_KEY;
  if (!key || !secret) {
    process.stderr.write('Error: CONSTRUCT_TELEMETRY_PUBLIC_KEY and CONSTRUCT_TELEMETRY_SECRET_KEY must be set.\n');
    process.exit(1);
  }
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

async function telemetryFetch(endpoint) {
  const url = `${TELEMETRY_BASEURL}${endpoint}`;
  const res = await fetch(url, { headers: telemetryHeaders() });
  if (!res.ok) throw new Error(`Telemetry ${endpoint} returned ${res.status}: ${await res.text()}`);
  return res.json();
}

function println(s) { process.stdout.write(s + '\n'); }
function warn(s) { process.stderr.write(s + '\n'); }

// ─── Fetch traces for an agent ───────────────────────────────────────────────

async function fetchAgentTraces(agentName, { days = 7, limit = 50 } = {}) {
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  // Query by name (how cx_trace sets it) — tags are a secondary fallback
  const params = new URLSearchParams({ page: 1, limit, name: agentName, fromTimestamp: from });
  const data = await telemetryFetch(`/api/public/traces?${params}`);
  return data.data ?? [];
}

async function fetchQualityScoresByTraceIds(traceIds) {
   // Fetch all quality scores in one request and build a traceId→value map.
   // Telemetry /scores endpoint supports userId/traceId filters individually.
   // Broad fetch with client-side filtering avoids N+1 queries.
   // Works around local-instance traceId filter bugs.
  const limit = Math.min(traceIds.length * 3, 200);
  const data = await telemetryFetch(`/api/public/scores?name=quality&limit=${limit}`);
  const traceSet = new Set(traceIds);
  const map = new Map();
  for (const s of data.data ?? []) {
    if (traceSet.has(s.traceId) && !map.has(s.traceId)) {
      map.set(s.traceId, s.value);
    }
  }
  return map;
}

// ─── Load agent stats from most recent review ───────────────────────────────

function loadLatestReview() {
  if (!fs.existsSync(REVIEW_DIR)) return null;
  const files = fs.readdirSync(REVIEW_DIR)
    .filter((f) => f.endsWith('-raw.json'))
    .sort()
    .reverse();
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, files[0]), 'utf8')); } catch { return null; }
}

// ─── Find the skill file for an agent ───────────────────────────────────────

function findSkillFile(agentName) {
  const bare = agentName.replace(/^cx-/, '');
  const candidates = [
    path.join(SKILLS_DIR, `${bare}.md`),
    path.join(SKILLS_DIR, `${agentName}.md`),
    path.join(ROOT_DIR, 'skills', 'roles', `${bare}.md`),
    path.join(ROOT_DIR, 'agents', 'personas', `${agentName}.md`),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

// ─── Generate improvement patch via LLM ─────────────────────────────────────

async function generatePatch(agentName, failureExamples) {
  // Try OpenRouter first, fall back to local Anthropic-compatible endpoint
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!openrouterKey && !anthropicKey) {
    warn('No LLM key found (OPENROUTER_API_KEY or ANTHROPIC_API_KEY). Cannot generate patch.');
    return null;
  }

  const prompt = `You are improving the system prompt for the AI agent "${agentName}".

Here are ${failureExamples.length} recent low-quality interactions (quality score < ${THRESHOLD}):

${failureExamples.map((ex, i) => `### Example ${i + 1} (score: ${ex.score?.toFixed(2) ?? 'n/a'})
Input: ${String(ex.input ?? '').slice(0, 300)}
Output: ${String(ex.output ?? '').slice(0, 300)}
`).join('\n')}

Identify 1-3 concrete failure patterns and write a SHORT improvement note (≤ 5 bullet points, plain text) that could be prepended to the agent's system prompt to prevent these failures.

Format:
## Improvement Note (auto-generated ${new Date().toISOString().slice(0, 10)})
- <bullet>
- <bullet>
...

Be specific and actionable. Do not restate the examples verbatim.`;

  const body = {
    model: openrouterKey
      ? (process.env.OPENROUTER_STANDARD_MODEL ?? 'openai/gpt-4o-mini')
      : 'claude-3-haiku-20240307',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
  };

  const endpoint = openrouterKey
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.anthropic.com/v1/messages';

  const headers = openrouterKey
    ? { Authorization: `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' }
    : { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };

  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    warn(`LLM API error ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? data.content?.[0]?.text ?? '').trim() || null;
}

// ─── Apply patch to skill file ───────────────────────────────────────────────

function applyPatch(skillFile, patch) {
  const existing = fs.readFileSync(skillFile, 'utf8');

  // Remove any prior auto-generated improvement note
  const cleaned = existing.replace(/\n## Improvement Note \(auto-generated [0-9-]+\)[\s\S]*?(?=\n## |\n# |$)/, '');

  // Prepend patch after the first heading block (first paragraph break)
  const insertAt = cleaned.indexOf('\n\n') + 2;
  const updated = insertAt > 1
    ? cleaned.slice(0, insertAt) + patch + '\n\n' + cleaned.slice(insertAt)
    : patch + '\n\n' + cleaned;

  fs.writeFileSync(skillFile, updated, 'utf8');
}

// Backup + audit-trail helpers for the --apply / --rollback gate.

function historyFile(agentName) {
  const safe = agentName.replace(/^cx-/, '').replace(/[^a-z0-9-]/gi, '-');
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  return path.join(HISTORY_DIR, `${safe}.jsonl`);
}

function backupSkill(skillFile) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${skillFile}.${stamp}.bak`;
  fs.copyFileSync(skillFile, backup);
  return backup;
}

function trimHistoryBackups(skillFile) {
  const dir = path.dirname(skillFile);
  const base = path.basename(skillFile);
  const backups = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.`) && f.endsWith('.bak'))
    .map((f) => path.join(dir, f))
    .sort();
  while (backups.length > HISTORY_CAP) {
    const oldest = backups.shift();
    try { fs.unlinkSync(oldest); } catch { /* race */ }
  }
}

function readHistory(agentName) {
  const f = historyFile(agentName);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function appendHistory(agentName, entry) {
  const f = historyFile(agentName);
  fs.appendFileSync(f, JSON.stringify(entry) + '\n');
}

function lastApplyAt(agentName) {
  const entries = readHistory(agentName);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].action === 'apply') return Date.parse(entries[i].ts) || 0;
  }
  return 0;
}

function rateLimitOk(agentName) {
  const last = lastApplyAt(agentName);
  if (!last) return { ok: true };
  const elapsedDays = (Date.now() - last) / (24 * 60 * 60 * 1000);
  return { ok: elapsedDays >= APPLY_RATE_LIMIT_DAYS, lastApplyDaysAgo: Math.floor(elapsedDays) };
}

function rollbackToLatestBackup(skillFile) {
  const dir = path.dirname(skillFile);
  const base = path.basename(skillFile);
  const backups = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.`) && f.endsWith('.bak'))
    .map((f) => path.join(dir, f))
    .sort();
  if (backups.length === 0) return null;
  const latest = backups[backups.length - 1];
  fs.copyFileSync(latest, skillFile);
  fs.unlinkSync(latest);
  return latest;
}

// ─── List mode ───────────────────────────────────────────────────────────────

async function runList() {
  const review = loadLatestReview();
  if (!review || !review.agentStats?.length) {
    println('No agent stats in latest review. Run `construct review` first.');
    return;
  }
  println('Agent Quality Scores (latest review)\n══════════════════════════════════\n');
  for (const agent of review.agentStats.sort((a, b) => (a.avgScore ?? 1) - (b.avgScore ?? 1))) {
    const q = agent.avgScore != null ? agent.avgScore.toFixed(2) : 'n/a';
    const flag = agent.avgScore != null && agent.avgScore < THRESHOLD ? ' ← below threshold' : '';
    println(`  ${agent.name.padEnd(30)} quality: ${q}  traces: ${agent.invocations ?? 0}${flag}`);
  }
}

// ─── Optimize a single agent ─────────────────────────────────────────────────

async function runOptimize(agentName) {
  println(`\nOptimizing agent: ${agentName}`);
  println(`Threshold: ${THRESHOLD}  Window: ${DAYS}d  Min traces: ${MIN_TRACES}\n`);

  // Fetch traces
  let traces;
  try {
    traces = await fetchAgentTraces(agentName, { days: DAYS, limit: 100 });
  } catch (err) {
    warn(`Failed to fetch traces: ${err.message}`);
    process.exit(1);
  }

  if (!traces.length) {
    println(`No traces found for "${agentName}" in the last ${DAYS} days.`);
    println('Tip: cx_trace calls must include the agent name as a tag for retrieval to work.');
    return;
  }

  println(`Found ${traces.length} trace(s). Fetching quality scores...`);

  // Fetch all quality scores for these traces in one request, join by traceId
  const scoreMap = await fetchQualityScoresByTraceIds(traces.map(t => t.id)).catch(() => new Map());
  const scored = traces.map(t => ({ ...t, qualityScore: scoreMap.get(t.id) ?? null }));

  const withScores = scored.filter((t) => t.qualityScore != null);
  const lowScoring = withScores.filter((t) => t.qualityScore < THRESHOLD);

  println(`  ${withScores.length} scored · ${lowScoring.length} below threshold (${THRESHOLD})`);

  if (withScores.length < MIN_TRACES) {
    println(`\nNot enough scored traces (${withScores.length} < ${MIN_TRACES}). Skipping optimization.`);
    return;
  }

  if (!lowScoring.length) {
    println(`\nAll scored traces meet the quality threshold. No optimization needed.`);
    return;
  }

  // Find skill file
  const skillFile = findSkillFile(agentName);
  if (!skillFile) {
    warn(`No skill file found for "${agentName}". Searched: skills/roles/${agentName.replace(/^cx-/, '')}.md`);
    warn('Cannot apply patch without a skill file.');
    return;
  }
  println(`\nSkill file: ${path.relative(ROOT_DIR, skillFile)}`);

  // Generate patch
  println('Generating improvement patch...');
  const failureExamples = lowScoring.slice(0, 5).map((t) => ({
    score: t.qualityScore,
    input: t.input,
    output: t.output,
  }));

  const patch = await generatePatch(agentName, failureExamples);
  if (!patch) {
    warn('Patch generation failed or no LLM available.');
    return;
  }

  println('\nGenerated patch:\n');
  println(patch);

  if (DRY_RUN) {
    println('\n[dry-run] Patch not applied. Pass --apply to write changes (cap: 1 apply per agent per 7 days).');
    return;
  }

  const rl = rateLimitOk(agentName);
  if (!rl.ok) {
    warn(`Rate-limited: last --apply was ${rl.lastApplyDaysAgo} day(s) ago; minimum interval is ${APPLY_RATE_LIMIT_DAYS} days.`);
    warn('Use --rollback to revert the prior change before applying a new patch, or wait out the window.');
    return;
  }

  const backup = backupSkill(skillFile);
  applyPatch(skillFile, patch);
  trimHistoryBackups(skillFile);
  appendHistory(agentName, {
    ts: new Date().toISOString(),
    agent: agentName,
    action: 'apply',
    skillFile: path.relative(ROOT_DIR, skillFile),
    backup: path.relative(ROOT_DIR, backup),
    score: lowScoring[0]?.qualityScore ?? null,
    traceCount: withScores.length,
  });
  println(`\nPatch applied to ${path.relative(ROOT_DIR, skillFile)}`);
  println(`Backup written to ${path.relative(ROOT_DIR, backup)}; --rollback restores it.`);

  // Trigger validation of the optimized persona
  try {
    println('\n🧪 Triggering persona validation...');
    const validationResult = spawnSync(process.execPath, [
      path.join(__dirname, '../lib/hooks/persona-validator.mjs')
    ], {
      cwd: ROOT_DIR,
      input: JSON.stringify({
        tool_name: 'optimize',
        tool_result: {
          result: `Optimized ${agentName} persona with patch: ${patch.slice(0, 200)}...`
        }
      }),
      encoding: 'utf8',
      timeout: 30000
    });
    
    if (validationResult.status === 0) {
      println('✅ Persona validation triggered');
    }
  } catch (error) {
    warn(`Validation trigger failed: ${error.message}`);
  }

  // Auto-trigger sync to propagate updated skill to all hosts
  const syncScript = path.join(ROOT_DIR, 'scripts', 'sync-agents.mjs');
  if (fs.existsSync(syncScript)) {
    println('Running `construct sync` to propagate updated skill…');
    const result = spawnSync(process.execPath, [syncScript], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      warn(`sync-agents exited with code ${result.status} — run 'construct sync' manually if needed.`);
    }
  } else {
    println('Run `construct sync` to propagate the updated skill to all hosts.');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (LIST_MODE) {
  await runList();
} else if (ROLLBACK) {
  if (!agentArg) {
    process.stderr.write('Usage: construct optimize <agent> --rollback\n');
    process.exit(1);
  }
  const skillFile = findSkillFile(agentArg);
  if (!skillFile) {
    process.stderr.write(`No skill file found for ${agentArg}\n`);
    process.exit(1);
  }
  const restored = rollbackToLatestBackup(skillFile);
  if (!restored) {
    process.stderr.write(`No backup found for ${agentArg}. Nothing to roll back.\n`);
    process.exit(1);
  }
  appendHistory(agentArg, {
    ts: new Date().toISOString(),
    agent: agentArg,
    action: 'rollback',
    restoredFrom: path.relative(ROOT_DIR, restored),
  });
  process.stdout.write(`Rolled ${agentArg} back from ${path.relative(ROOT_DIR, restored)}\n`);
} else if (agentArg) {
  await runOptimize(agentArg);
} else {
  process.stderr.write('Usage: construct optimize <agent> [--apply | --rollback | --dry-run]\n');
  process.stderr.write('       construct optimize --list\n');
  process.exit(1);
}
