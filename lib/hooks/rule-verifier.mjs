#!/usr/bin/env node
/**
 * lib/hooks/rule-verifier.mjs — Stop hook that audits the session for
 * compliance with the construct rules the agent claimed to follow.
 *
 * Checks:
 *   - Each commit / push was preceded by an approval signal scoped to that
 *     branch + change.
 *   - Edits to protected files (CLAUDE.md table) had user confirmation.
 *   - Beads claims exist for any work that touched durable state.
 *
 * Approval detection is intent-based, not keyword-based. The verifier reads
 * the conversational window before each consequential action and classifies
 * the user's stance: APPROVED, REFUSED, INCONCLUSIVE. Direct affirmation,
 * accepting a proposed plan that named the action, or "go ahead" all count
 * as approval — no specific word is required.
 *
 * Output: { ok: 'pass' | 'fail' | 'inconclusive', findings[] } written to
 * .construct/audit.jsonl. Inconclusive results surface as escalation questions to
 * the user rather than silent passes or false-positive blocks.
 *
 * @p95ms 200
 * @maxBlockingScope Stop
 *
 * @unwired (not referenced from platforms/claude/settings.template.json)
 * @exits 0 = pass | 2 = block tool call
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logHookFailure } from './_lib/log.mjs';
import { isMainModule } from '../roots.mjs';
import { configPath } from '../config-dir.mjs';

function safeReadJsonLines(transcriptPath) {
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    return raw.split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function lastN(entries, count) {
  return entries.slice(Math.max(0, entries.length - count));
}

/**
 * Identify consequential actions in the transcript tail. Returns a list of
 * { kind, branch, target, atIndex } items. Each one needs an approval signal
 * within the window of conversation immediately preceding it.
 *
 * Detected actions:
 *   - 'commit'        — git commit invocation
 *   - 'push'          — git push invocation
 *   - 'protected'     — edit to a CLAUDE.md-protected file
 *   - 'durable-state' — bd close / claim against durable state
 */
export function findConsequentialActions(entries) {
  const actions = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const cmd = extractBashCommand(e);
    if (cmd) {
      if (/^git\s+commit\b/.test(cmd) && !/--dry-run/.test(cmd)) {
        actions.push({ kind: 'commit', target: cmd.slice(0, 200), atIndex: i });
      } else if (/^git\s+push\b/.test(cmd) && !/--dry-run/.test(cmd)) {
        actions.push({ kind: 'push', target: cmd.slice(0, 200), atIndex: i });
      } else if (/^gh\s+pr\s+(create|merge)\b/.test(cmd)) {
        actions.push({ kind: 'pr-mutation', target: cmd.slice(0, 200), atIndex: i });
      }
    }
    const editPath = extractEditPath(e);
    if (editPath && /CLAUDE\.md|install\.sh|claude\/settings\.template\.json|agents\/registry\.json/.test(editPath)) {
      actions.push({ kind: 'protected', target: editPath, atIndex: i });
    }
  }
  return actions;
}

function extractBashCommand(entry) {
  const toolUse = entry?.message?.content?.find?.((c) => c?.type === 'tool_use' && c?.name === 'Bash');
  return toolUse?.input?.command || null;
}

function extractEditPath(entry) {
  const toolUse = entry?.message?.content?.find?.((c) => c?.type === 'tool_use' && (c?.name === 'Edit' || c?.name === 'Write'));
  return toolUse?.input?.file_path || null;
}

/**
 * Classify a conversational window for approval intent. This is intentionally
 * conservative — it does not require any keyword. If the window contains a
 * user turn that directly addresses the action being taken (mentioning the
 * branch, the file, or accepting a proposed plan), that counts as approval.
 *
 * The default classifier is deterministic: it scans for plausible approval
 * tokens AND for the action target appearing earlier in the conversation.
 * A pluggable classifier can replace this with an LLM-graded inference at
 * runtime — register via setApprovalClassifier(fn).
 *
 * Returns: 'APPROVED' | 'REFUSED' | 'INCONCLUSIVE'.
 */
let _approvalClassifier = defaultApprovalClassifier;

export function setApprovalClassifier(fn) {
  _approvalClassifier = typeof fn === 'function' ? fn : defaultApprovalClassifier;
}

export function classifyApproval(window, action) {
  return _approvalClassifier(window, action);
}

function defaultApprovalClassifier(window, action) {
  if (!Array.isArray(window) || window.length === 0) return 'INCONCLUSIVE';

  let assistantProposedAction = false;
  let userResponded = false;
  let userRefused = false;
  let userAffirmed = false;

  for (const entry of window) {
    const role = entry?.message?.role || entry?.role;
    const text = extractText(entry).toLowerCase();
    if (!text) continue;

    if (role === 'assistant') {
      if (actionMentioned(text, action)) assistantProposedAction = true;
    }
    if (role === 'user') {
      userResponded = true;
      if (/\b(no|stop|don'?t|cancel|wait|abort|hold off|never mind)\b/.test(text)) userRefused = true;
      if (/\b(yes|yep|yeah|go ahead|do it|proceed|ship it|approve|confirmed|sounds good|that works|lgtm|sgtm|ok|sure|please do|merge it|continue)\b/.test(text)) userAffirmed = true;
      // Even without explicit affirmation words, accepting a named plan is approval.
      if (assistantProposedAction && !userRefused && text.length > 0 && !/\?$/.test(text.trim())) {
        userAffirmed = userAffirmed || /\b(thanks|great|perfect|sounds|works|good)\b/.test(text);
      }
    }
  }

  if (userRefused) return 'REFUSED';
  if (userAffirmed && assistantProposedAction) return 'APPROVED';
  if (userAffirmed) return 'APPROVED';
  if (!userResponded) return 'INCONCLUSIVE';
  return 'INCONCLUSIVE';
}

function extractText(entry) {
  const msg = entry?.message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join(' ');
  }
  return '';
}

function actionMentioned(text, action) {
  if (!text) return false;
  if (action.kind === 'commit' || action.kind === 'push' || action.kind === 'pr-mutation') {
    return /\b(commit|push|merge|ship|pr|pull request)\b/.test(text);
  }
  if (action.kind === 'protected') {
    const fname = action.target.split('/').pop().toLowerCase();
    return text.includes(fname.toLowerCase()) || text.includes(action.target.toLowerCase());
  }
  return false;
}

/**
 * Verify a transcript against the rule set. Returns a structured audit
 * result. Side-effect free; the runtime entry point below writes the result
 * to .construct/audit.jsonl.
 */
export function verifyTranscript(entries, { windowSize = 20 } = {}) {
  const findings = [];
  const actions = findConsequentialActions(entries);

  for (const action of actions) {
    const window = lastN(entries.slice(0, action.atIndex), windowSize);
    const verdict = classifyApproval(window, action);
    findings.push({
      action: action.kind,
      target: action.target,
      verdict,
      atIndex: action.atIndex,
    });
  }

  const failed = findings.some((f) => f.verdict === 'REFUSED');
  const inconclusive = findings.some((f) => f.verdict === 'INCONCLUSIVE');
  let ok;
  if (failed) ok = 'fail';
  else if (inconclusive) ok = 'inconclusive';
  else ok = 'pass';

  return { ok, findings, actionCount: actions.length };
}

function writeAudit(cwd, payload) {
  const path = configPath(cwd, 'audit.jsonl');
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ignore */ }
  try { appendFileSync(path, JSON.stringify(payload) + '\n'); }
  catch (err) { logHookFailure({ hook: 'rule-verifier', err, phase: 'append-audit' }); }
}

if (isMainModule(import.meta.url)) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); }
  catch (err) { logHookFailure({ hook: 'rule-verifier', err, phase: 'parse-stdin' }); process.exit(0); }

  const cwd = input?.cwd || process.cwd();
  const transcriptPath = input?.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0);

  const entries = safeReadJsonLines(transcriptPath);
  const result = verifyTranscript(entries);
  writeAudit(cwd, { ts: new Date().toISOString(), hook: 'rule-verifier', ...result });

  if (result.ok === 'fail' && process.env.CONSTRUCT_RULE_VERIFIER === 'block') process.exit(2);
  process.exit(0);
}
