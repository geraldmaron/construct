#!/usr/bin/env node
/**
 * lib/context-state.mjs — compact project/session context persistence.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function contextJsonPath(rootDir) {
  return join(rootDir, '.cx', 'context.json');
}

export function contextMarkdownPath(rootDir) {
  return join(rootDir, '.cx', 'context.md');
}

export function readContextState(rootDir) {
  const inspection = inspectContextState(rootDir);
  return inspection.state;
}

export function inspectContextState(rootDir) {
  const jsonPath = contextJsonPath(rootDir);
  const mdPath = contextMarkdownPath(rootDir);
  const hasJsonFile = existsSync(jsonPath);
  const hasMarkdownFile = existsSync(mdPath);
  const hasFile = hasJsonFile || hasMarkdownFile;

  let state = null;
  let source = 'missing';

  if (hasJsonFile) {
    try {
      state = JSON.parse(readFileSync(jsonPath, 'utf8'));
      source = 'json';
    } catch {
      source = hasMarkdownFile ? 'markdown' : 'invalid';
    }
  }

  if (!state && hasMarkdownFile) {
    try {
      state = {
        format: 'markdown',
        markdown: readFileSync(mdPath, 'utf8'),
      };
      if (source !== 'json') source = 'markdown';
    } catch {
      if (!hasJsonFile) source = 'invalid';
    }
  }

  return {
    hasFile,
    source,
    savedAt: state?.savedAt || null,
    summary: state?.contextSummary || contextSummaryLine(state) || null,
    state,
  };
}

export function writeContextState(rootDir, state, { markdown = null } = {}) {
  const cxDir = join(rootDir, '.cx');
  mkdirSync(cxDir, { recursive: true });

  const payload = {
    format: 'json',
    savedAt: new Date().toISOString(),
    ...state,
  };
  writeFileSync(contextJsonPath(rootDir), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  if (markdown !== null) {
    writeFileSync(contextMarkdownPath(rootDir), markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  }

  return payload;
}

export function contextSummaryLine(state) {
  if (!state || typeof state !== 'object') return '';
  if (state.compact) return String(state.compact);
  if (state.recoveryContext) return String(state.recoveryContext).slice(0, 240);
  if (state.markdown) return String(state.markdown).slice(0, 240);
  return '';
}

export function buildContextDigest(state, { maxItems = 3 } = {}) {
  if (!state || typeof state !== 'object') return null;

  return {
    summary: state.contextSummary || contextSummaryLine(state) || null,
    activeWork: Array.isArray(state.activeWork) ? state.activeWork.slice(0, maxItems) : [],
    recentDecisions: Array.isArray(state.recentDecisions) ? state.recentDecisions.slice(0, maxItems) : [],
    architectureNotes: Array.isArray(state.architectureNotes) ? state.architectureNotes.slice(0, maxItems) : [],
    openQuestions: Array.isArray(state.openQuestions) ? state.openQuestions.slice(0, maxItems) : [],
    source: state.source || null,
    savedAt: state.savedAt || null,
  };
}
