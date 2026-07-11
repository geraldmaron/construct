/**
 * lib/strategy-store.mjs — Multi-scope product strategy store.
 *
 * Strategy is organised by scope: product, technical, gtm, platform.
 * Each scope lives in its own file under .construct/knowledge/decisions/strategy/{scope}.md.
 * Strategy documents are NEVER auto-updated from ingested documents — they require
 * an explicit writeStrategy() call from a privileged caller.
 *
 * Construct now uses embedded LanceDB for vectors only; strategy remains
 * filesystem-primary for simplicity and Git-backed collaboration.
 *
 * getStrategyDigest() / getStrategyDigestSync() return a compact block (≤ 500 tokens)
 * suitable for injection into agent prompts. getStrategyDigestSync() is the file-only
 * synchronous path required where await is not available (e.g. prompt assembly).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { cxDir } from './paths.mjs';

const VALID_SCOPES = ['product', 'technical', 'gtm', 'platform'];

// ── Path helpers ──────────────────────────────────────────────────────────────

export function strategyDir(env = process.env) {
  return join(cxDir(), 'knowledge', 'decisions', 'strategy');
}

export function strategyFilePath(scope = 'product', env = process.env) {
  return join(strategyDir(env), `${scope}.md`);
}

// ── Scope discovery ───────────────────────────────────────────────────────────

/**
 * Return scope names that have corresponding files in the strategy directory.
 */
export function listStrategyScopes(env = process.env) {
  const dir = strategyDir(env);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => basename(f, '.md'));
  } catch {
    return [];
  }
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/**
 * Read one strategy scope from file.
 */
export async function readStrategy(scope = 'product', env = process.env) {
  const filePath = strategyFilePath(scope, env);
  if (!existsSync(filePath)) {
    return { content: '', version: 0, updatedAt: null, source: 'none', scope };
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const stat = statSync(filePath);
    return {
      content,
      version: 1,
      updatedAt: stat.mtime.toISOString(),
      source: 'file',
      scope,
    };
  } catch {
    return { content: '', version: 0, updatedAt: null, source: 'none', scope };
  }
}

/**
 * Read all strategy scopes into a Map.
 */
export async function readAllStrategies(env = process.env) {
  const result = new Map();
  const scopes = listStrategyScopes(env);
  for (const scope of scopes) {
    const data = await readStrategy(scope, env);
    if (data.source !== 'none') result.set(scope, data);
  }
  return result;
}

/**
 * Synchronous digest for prompt assembly.
 */
export function getStrategyDigestSync(scope = 'product', env = process.env) {
  const filePath = strategyFilePath(scope, env);
  if (!existsSync(filePath)) return '';
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.trim().slice(0, 2000); // approx 500 tokens
  } catch {
    return '';
  }
}

/**
 * Async digest for general use.
 */
export async function getStrategyDigest(scope = 'product', env = process.env) {
  const data = await readStrategy(scope, env);
  return data.content.trim().slice(0, 2000);
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Write a strategy scope to file.
 */
export async function writeStrategy(content, scope = 'product', { updatedBy, env = process.env } = {}) {
  const filePath = strategyFilePath(scope, env);
  const dir = strategyDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}
