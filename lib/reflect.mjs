/**
 * lib/reflect.mjs — construct reflect command implementation.
 *
 * Captures improvement feedback from host sessions and updates Construct core
 * knowledge base with actionable insights for continuous self-improvement.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { addObservation, listObservations } from './observation-store.mjs';
import { loadConstructEnv } from './env-config.mjs';
import { KNOWLEDGE_ROOT, KNOWLEDGE_SUBDIRS, inferKnowledgeTarget } from './knowledge/layout.mjs';
import { extractSessionObservation } from './reflect/extractor.mjs';
import { readContextState, contextSummaryLine } from './context-state.mjs';
import { configDir } from './config/xdg.mjs';
import { isMainModule } from './roots.mjs';

const HOME = process.env.HOME || process.env.USERPROFILE;
const USER_ENV_PATH = join(configDir(HOME), 'config.env');

/**
 * Main reflect command handler.
 * @param {string[]} args - Command line arguments
 */
export async function runReflectCli(args) {
  // Parse arguments
  let target = 'internal';
  let summary = '';

  for (const arg of args) {
    if (arg.startsWith('--target=')) {
      target = arg.split('=')[1];
    } else if (arg.startsWith('--summary=')) {
      summary = arg.split('=')[1];
    }
  }

  // Validate target
  const validTargets = KNOWLEDGE_SUBDIRS.map(s => `knowledge/${s}`);
  const validShorthandTargets = KNOWLEDGE_SUBDIRS; // internal, external, etc.
  const isValidTarget = validTargets.includes(target) || validShorthandTargets.includes(target);
  if (!isValidTarget) {
    console.error(`Error: Invalid target '${target}'. Valid targets: ${validTargets.join(', ')}`);
    process.exit(1);
  }
  
  // Normalize target to full format if shorthand was provided
  if (validShorthandTargets.includes(target) && !target.startsWith('knowledge/')) {
    target = `knowledge/${target}`;
  }

  let summarySource = 'cli';
  if (!summary) {
    const derived = deriveSummaryFromContext(process.cwd());
    if (derived) {
      summary = derived;
      summarySource = 'auto-derived';
      console.error(`Note: --summary not provided; using auto-derived summary from .cx/context.md and recent observations.`);
      console.error(`Captured summary: "${summary.slice(0, 180)}${summary.length > 180 ? '…' : ''}"`);
    } else {
      console.error('Error: --summary=<text> is required (no .cx/context.md or recent session summaries to derive from)');
      console.error('Example: construct reflect --target=internal --summary="Improve Slack channel intent parsing to handle edge cases"');
      process.exit(1);
    }
  }

  // Resolve the knowledge directory for this target
  const knowledgeSubdir = target.replace('knowledge/', '');
  const knowledgeDir = join(process.cwd(), KNOWLEDGE_ROOT, knowledgeSubdir);
  
  // Ensure the knowledge directory exists
  if (!existsSync(knowledgeDir)) {
    mkdirSync(knowledgeDir, { recursive: true });
  }

  // Generate a filename based on timestamp and summary hash
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summarySlug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const filename = `${timestamp}-${summarySlug}.md`;
  const filePath = join(knowledgeDir, filename);

  // Create the markdown content
  const content = [
    '---',
    `source_path: reflect-command`,
    `source_relative_path: ${filename}`,
    `source_extension: .md`,
    `extracted_at: ${new Date().toISOString()}`,
    `extraction_method: reflect-command`,
    `characters: ${summary.length}`,
    `truncated: false`,
    `output_path: ${JSON.stringify(filePath)}`,
    `output_relative_path: ${JSON.stringify(filename)}`,
    '---',
    '',
    `# Improvement Feedback`,
    '',
    summary,
    '',
    '## Context',
    '',
    `- Captured via: construct reflect`,
    `- Timestamp: ${new Date().toISOString()}`,
    `- Target knowledge directory: ${knowledgeSubdir}/`,
    '',
    '## Action Items',
    '',
    '- [ ] Review this feedback for validity and actionability',
    '- [ ] Determine if this requires code changes, documentation updates, or process improvements',
    '- [ ] If actionable, create appropriate issues in the tracker',
    '- [ ] Update relevant documentation or code based on this insight',
    '',
  ].join('\n');

  // Write the file
  writeFileSync(filePath, content);

  const observationSummary = `[reflect] Improvement feedback captured (${summarySource}): ${summary.slice(0, 100)}${summary.length > 100 ? '...' : ''}`;
  addObservation(process.cwd(), {
    role: 'construct',
    category: 'insight',
    summary: observationSummary,
    content: `Feedback captured via construct reflect (${summarySource}):\n\n${summary}\n\nStored as: ${filePath}\nTarget: ${knowledgeSubdir}/`,
    tags: ['reflect', 'improvement-feedback', `knowledge:${knowledgeSubdir}`, `source:${summarySource}`],
    confidence: summarySource === 'auto-derived' ? 0.65 : 0.9,
    source: 'reflect-command',
  });

  console.log(`✓ Improvement feedback captured and stored as: ${filePath}`);
  console.log(`  Target knowledge directory: ${knowledgeSubdir}/`);
  console.log(`  Use 'construct ingest --target=${target} <file>' to manually add similar feedback in the future`);
}

/**
 * Auto-reflect from a Claude Code Stop hook payload.
 *
 * Reads the transcript JSONL, extracts a deterministic session summary, and
 * persists it via the standard observation store. Contract: exit fast, fail
 * silent, never throw — every error path returns null so the hook always
 * exits 0.
 *
 * Returns the recorded observation id on success, null on no-op.
 *
 * @param {object} args
 * @param {string} args.transcriptPath — path to the Stop hook's transcript_path
 * @param {string} args.cwd — session cwd (the project root)
 * @param {string} [args.sessionId]
 * @param {number} [args.durationMs]
 * @returns {Promise<string|null>}
 */
export async function runReflectAuto({ transcriptPath, cwd, sessionId, durationMs }) {
  if (!transcriptPath || !cwd) return null;
  if (!existsSync(transcriptPath)) return null;

  const entries = parseTranscript(transcriptPath);
  if (entries.length === 0) return null;

  const observation = extractSessionObservation({ entries, cwd, sessionId, durationMs });
  if (!observation) return null;

  // Skip trivial sessions: no tool calls AND no substantive final text. Avoids
  // polluting the observation store with one-line acknowledgements.
  const trivial =
    observation.extras?.toolCallCount === 0 &&
    (observation.content?.length || 0) < 120;
  if (trivial) return null;

  const project = safeProject(cwd);
  const gitSha = safeGitSha(cwd);

  // Session-id stays in tags so the index can filter by it without parsing.
  // Structured metadata goes into the new extras field, not into content.
  const sessionTag = sessionId ? `session:${sessionId.slice(0, 24)}` : null;
  const tags = [...observation.tags];
  if (sessionTag) tags.push(sessionTag);

  const result = await addObservation(cwd, {
    role: observation.role,
    category: observation.category,
    summary: observation.summary,
    content: observation.content,
    tags,
    project,
    gitSha,
    confidence: observation.confidence,
    source: observation.source,
    extras: observation.extras ?? null,
  });

  return result?.id ?? null;
}

/**
 * Derive a one-paragraph reflect summary from durable session state — the
 * context.md digest first, then the most recent session-summary observation.
 * Returns null when neither source yields useful content.
 */
export function deriveSummaryFromContext(cwd) {
  const parts = [];

  try {
    const state = readContextState(cwd);
    const line = contextSummaryLine(state);
    if (line && line.trim().length > 20) parts.push(line.trim());
  } catch { /* best effort */ }

  try {
    const recent = listObservations(cwd, { limit: 5 }) || [];
    const sessionSummary = recent.find((o) => Array.isArray(o.tags) && o.tags.includes('session-summary'));
    if (sessionSummary?.summary) {
      const text = String(sessionSummary.summary).replace(/^\[[^\]]+\]\s*/, '').trim();
      if (text.length > 20 && !parts.some((p) => p.includes(text.slice(0, 40)))) {
        parts.push(text);
      }
    }
  } catch { /* best effort */ }

  if (parts.length === 0) return null;
  const joined = parts.join(' — ');
  return joined.length > 600 ? joined.slice(0, 580) + '…' : joined;
}

function safeProject(cwd) {
  try { return basename(cwd) || null; } catch { return null; }
}

function safeGitSha(cwd) {
  try {
    return execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 200 })
      .toString().trim().slice(0, 40) || null;
  } catch { return null; }
}

// Transcripts are JSONL; one JSON object per line. Be permissive — a single
// malformed line shouldn't lose the rest of the session.

function parseTranscript(path) {
  let raw = '';
  try { raw = readFileSync(path, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * CLI entry point for direct execution.
 */
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  runReflectCli(args).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
