/**
 * lib/chat/session-context.mjs — session-scoped context for planTurn routing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export function buildPlanContext({ session, cwd = process.cwd(), turnBlocks = [], text = '' } = {}) {
  const turns = turnBlocks.filter((item) => item.kind === 'turn');
  const lastTurn = turns.length ? turns[turns.length - 1].block : null;

  let workingBranch = null;
  try {
    workingBranch = execSync('git branch --show-current', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { /* not a git repo */ }

  let projectSummary = null;
  const contextPath = path.join(cwd, '.cx', 'context.md');
  try {
    if (fs.existsSync(contextPath)) {
      projectSummary = fs.readFileSync(contextPath, 'utf8').slice(0, 500);
    }
  } catch { /* unreadable */ }

  const trimmed = String(text).trim();
  const vagueFollowUp = /^(tell me more|what about|continue|go on|explain|elaborate|and\?)/i.test(trimmed);
  const projectQuestion = /\b(what is this project|what('s| is) this (repo|project|codebase)|describe this project)\b/i.test(trimmed);

  return {
    turnIndex: session?.usage?.turns ?? 0,
    priorIntent: lastTurn?.overlay?.intent ?? null,
    priorWorkCategory: lastTurn?.overlay?.workCategory ?? null,
    workingBranch,
    projectSummary,
    vagueFollowUp: vagueFollowUp && (session?.usage?.turns ?? 0) > 0,
    projectQuestion,
  };
}
