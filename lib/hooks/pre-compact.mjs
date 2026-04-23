#!/usr/bin/env node
/**
 * lib/hooks/pre-compact.mjs — Pre-compact hook — prepares context summary before compaction runs.
 *
 * Runs before context compaction. Writes a structured summary of active workflow, context state, and pending tasks to preserve continuity across the compaction boundary.
 *
 * @p95ms 100
 * @maxBlockingScope PreCompact
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { writeContextState } from '../context-state.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const transcriptPath = input?.transcript_path || '';

const filesChanged = [];
const decisions = [];
const pendingTodos = [];
const workflowTasks = [];
const warnFlagsPath = join(homedir(), '.cx', 'warn-flags.txt');
const efficiencyPath = join(homedir(), '.cx', 'session-efficiency.json');
let lastSummary = '';

if (transcriptPath && existsSync(transcriptPath)) {
  try {
    const transcriptRaw = readFileSync(transcriptPath, 'utf8');
    let transcript;
    try {
      transcript = JSON.parse(transcriptRaw);
    } catch {
      transcript = transcriptRaw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    }
    const messages = Array.isArray(transcript) ? transcript : (transcript.messages || []);
    const recent = messages.slice(-60);

    // Track the latest TodoWrite call to get current todo state
    let latestTodos = null;

    for (const msg of recent) {
      if (msg.role === 'tool' || msg.type === 'tool_result') continue;

      // Handle both array-of-blocks and plain-string content formats
      const blocks = Array.isArray(msg.content)
        ? msg.content
        : (typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : []);

      for (const block of blocks) {
        if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit')) {
          const fp = block.input?.file_path || block.input?.path || '';
          if (fp && !filesChanged.includes(fp)) filesChanged.push(fp);
        }
        if (block.type === 'tool_use' && block.name === 'TodoWrite') {
          const todos = block.input?.todos;
          if (Array.isArray(todos)) latestTodos = todos;
        }
        if (block.type === 'text' && msg.role === 'assistant') {
          const text = (block.text || '').trim();
          // Prefer the last substantive response (>80 chars) over short one-liners
          if (text.length > 80 || (!lastSummary && text.length > 0)) {
            lastSummary = text.slice(0, 400);
          }
          const decisionMatches = text.match(/(?:^|\n)(?:DECISION:|Decision:|\*\*Decision\*\*:)\s*([^\n]+)/g) || [];
          for (const match of decisionMatches) {
            const cleaned = match.replace(/^\n?/, '').replace(/^(?:DECISION:|Decision:|\*\*Decision\*\*:)\s*/, '').trim();
            if (cleaned && !decisions.includes(cleaned)) decisions.push(cleaned);
          }
        }
      }
    }

    // Extract pending/in_progress todos from latest TodoWrite
    if (latestTodos) {
      for (const todo of latestTodos) {
        if (todo.status === 'pending' || todo.status === 'in_progress') {
          pendingTodos.push(todo);
        }
      }
    }

    // Extract active workflow tasks from .cx/workflow.json
    const workflowPath = join(cwd, '.cx', 'workflow.json');
    if (existsSync(workflowPath)) {
      try {
        const wf = JSON.parse(readFileSync(workflowPath, 'utf8'));
        const tasks = wf?.tasks || wf?.state?.tasks || [];
        for (const task of tasks) {
          if (task.status !== 'done' && task.status !== 'skipped') {
            workflowTasks.push({ key: task.key || task.id, title: task.title || task.description || '' });
          }
        }
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

const warnFlags = (() => {
  try { return readFileSync(warnFlagsPath, 'utf8').trim(); } catch { return ''; }
})();

const efficiencySummary = (() => {
  try {
    const stats = JSON.parse(readFileSync(efficiencyPath, 'utf8'));
    const parts = [
      `${stats.readCount || 0} reads`,
      `${stats.uniqueFileCount || 0} unique files`,
    ];
    if (stats.repeatedReadCount) parts.push(`${stats.repeatedReadCount} repeated reads`);
    if (stats.largeReadCount) parts.push(`${stats.largeReadCount} large reads`);
    if (stats.totalBytesRead) parts.push(`${Math.round(stats.totalBytesRead / 1024)} KB read`);
    return parts.join(' · ');
  } catch {
    return '';
  }
})();

const projectName = cwd.split('/').pop() || 'project';
const date = new Date().toISOString().slice(0, 16).replace('T', ' ');

const contextLines = [
  `# Session Context`,
  `Last saved: ${date}`,
  ``,
  `## What was in progress`,
  lastSummary || '(no summary available)',
  ``,
];

if (filesChanged.length) {
  contextLines.push('## Files changed this session');
  for (const f of filesChanged.slice(0, 20)) contextLines.push(`- ${f}`);
  contextLines.push('');
}

if (decisions.length) {
  contextLines.push('## Decisions captured');
  for (const decision of decisions.slice(-10)) contextLines.push(`- ${decision}`);
  contextLines.push('');
}

if (pendingTodos.length) {
  contextLines.push('## Pending TODOs');
  for (const todo of pendingTodos) {
    const status = todo.status === 'in_progress' ? '[~]' : '[ ]';
    contextLines.push(`${status} ${todo.content || todo.title || todo.text || JSON.stringify(todo)}`);
  }
  contextLines.push('');
}

if (workflowTasks.length) {
  contextLines.push('## Active workflow tasks');
  for (const task of workflowTasks.slice(0, 10)) {
    contextLines.push(`- ${task.key}: ${task.title}`);
  }
  contextLines.push('');
}

if (efficiencySummary) {
  contextLines.push('## Session efficiency snapshot');
  contextLines.push(efficiencySummary);
  contextLines.push('');
}

contextLines.push('## Open issues');
contextLines.push(warnFlags || 'None');

const content = contextLines.join('\n') + '\n';
const contextJson = {
  source: 'pre-compact',
  projectName,
  lastSummary,
  filesChanged: filesChanged.slice(0, 20),
  decisions: decisions.slice(-10),
  pendingTodos: pendingTodos.slice(0, 20),
  workflowTasks: workflowTasks.slice(0, 10),
  efficiencySummary,
  warnFlags: warnFlags || 'None',
};

const projectCxDir = join(cwd, '.cx');
try { mkdirSync(projectCxDir, { recursive: true }); } catch { /* exists */ }
try { writeContextState(cwd, { ...contextJson, contextSummary: lastSummary }, { markdown: content }); } catch { /* best effort */ }
if (decisions.length) {
  const decisionsDir = join(projectCxDir, 'decisions');
  const slug = `${date.replace(/[^0-9]/g, '')}-session-decisions`;
  const decisionDoc = [
    '# Session Decisions',
    `Captured: ${date}`,
    '',
    '## Decisions',
    ...decisions.slice(-10).map((decision) => `- ${decision}`),
    '',
    '## Files changed',
    ...(filesChanged.length ? filesChanged.slice(0, 20).map((file) => `- ${file}`) : ['- None captured']),
    '',
  ].join('\n');
  try { mkdirSync(decisionsDir, { recursive: true }); } catch { /* exists */ }
  try { writeFileSync(join(decisionsDir, `${slug}.md`), decisionDoc); } catch { /* best effort */ }
}

const globalCxDir = join(homedir(), '.cx');
try { mkdirSync(globalCxDir, { recursive: true }); } catch { /* exists */ }
try { writeContextState(homedir(), { ...contextJson, contextSummary: lastSummary }, { markdown: content }); } catch { /* best effort */ }

process.exit(0);
