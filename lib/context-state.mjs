#!/usr/bin/env node
/**
 * lib/context-state.mjs — compact project/session context persistence.
 *
 * Writes go through writeContextState, which uses write-to-tmp + atomic
 * rename so concurrent writers from different hooks (pre-compact, Stop,
 * context-window-recovery, tracking-surfaces) cannot leave a half-written
 * JSON or markdown file behind. POSIX rename(2) is atomic for files on
 * the same filesystem; the .construct directory always lives next to the target.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { projectConfigDir, configPath } from './config-dir.mjs';

export function contextJsonPath(rootDir) {
  return configPath(rootDir, 'context.json');
}

export function contextMarkdownPath(rootDir) {
  return configPath(rootDir, 'context.md');
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

function atomicWrite(targetPath, content) {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, targetPath);
}

export function writeContextState(rootDir, state, { markdown = null } = {}) {
  const constructDir = projectConfigDir(rootDir);
  mkdirSync(constructDir, { recursive: true });

  const payload = {
    format: 'json',
    savedAt: new Date().toISOString(),
    ...state,
  };
  atomicWrite(contextJsonPath(rootDir), `${JSON.stringify(payload, null, 2)}\n`);

  if (markdown !== null) {
    atomicWrite(contextMarkdownPath(rootDir), markdown.endsWith('\n') ? markdown : `${markdown}\n`);
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
