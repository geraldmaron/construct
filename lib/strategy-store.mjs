/**
 * lib/strategy-store.mjs — Multi-scope product strategy store.
 *
 * Strategy is organised by scope: product, technical, gtm, platform.
 * Each scope lives in its own file under .cx/knowledge/decisions/strategy/{scope}.md.
 * Strategy documents are NEVER auto-updated from ingested documents — they require
 * an explicit writeStrategy() call from a privileged caller.
 *
 * In team/enterprise mode Postgres is the secondary store (best-effort). Each scope
 * is stored as a separate row whose content is prefixed with `scope:{name}\n` so we
 * can store and retrieve scopes without adding a new column to the existing schema.
 *
 * getStrategyDigest() / getStrategyDigestSync() return a compact block (≤ 500 tokens)
 * suitable for injection into agent prompts. getStrategyDigestSync() is the file-only
 * synchronous path required where await is not available (e.g. prompt assembly).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { cxDir } from './paths.mjs';
import { hasSqlStore } from './storage/sql-store.mjs';
import { createSqlClient } from './storage/backend.mjs';

const VALID_SCOPES = ['product', 'technical', 'gtm', 'platform'];
const SCOPE_PREFIX = 'scope:';

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
 *
 * @param {object} [env]
 * @returns {string[]}
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
 * Read one strategy scope from Postgres (primary) or file (fallback).
 *
 * @param {string} [scope]
 * @param {object} [env]
 * @returns {Promise<{ content: string, version: number, updatedAt: string, source: 'postgres'|'file'|'none', scope: string }>}
 */
export async function readStrategy(scope = 'product', env = process.env) {
  if (hasSqlStore(env)) {
    const client = createSqlClient(env);
    try {
      const project = env.CX_PROJECT || 'default';
      const prefix = `${SCOPE_PREFIX}${scope}\n`;

      // Rows stored with the scope prefix — match on content prefix
      const rows = await client`
        select content, version, updated_at
        from construct_strategy
        where project = ${project}
          and content like ${prefix + '%'}
        order by version desc
        limit 1
      `;

      if (rows.length > 0) {
        const row = rows[0];
        return {
          content: row.content.startsWith(prefix) ? row.content.slice(prefix.length) : row.content,
          version: row.version,
          updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
          source: 'postgres',
          scope,
        };
      }
    } catch {
      // Postgres unavailable — fall through to file
    } finally {
      if (client) await client.end({ timeout: 5 }).catch(() => {});
    }
  }

  const filePath = strategyFilePath(scope, env);
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8');
    return { content, version: 1, updatedAt: new Date().toISOString(), source: 'file', scope };
  }

  return { content: '', version: 0, updatedAt: new Date().toISOString(), source: 'none', scope };
}

/**
 * Read all present strategy scopes.
 *
 * When Postgres is available it reads all rows for the project and parses scope
 * from the prefix. Files are used as the fallback or supplement for scopes that
 * have no Postgres row.
 *
 * @param {object} [env]
 * @returns {Promise<Map<string, { content: string, version: number, updatedAt: string, source: string }>>}
 */
export async function readAllStrategies(env = process.env) {
  const result = new Map();

  if (hasSqlStore(env)) {
    const client = createSqlClient(env);
    try {
      const project = env.CX_PROJECT || 'default';

      // Fetch all rows — latest version per scope
      const rows = await client`
        select distinct on (
          substring(content from 1 for position(E'\n' in content))
        ) content, version, updated_at
        from construct_strategy
        where project = ${project}
          and content like ${SCOPE_PREFIX + '%'}
        order by
          substring(content from 1 for position(E'\n' in content)),
          version desc
      `;

      for (const row of rows) {
        const firstNewline = row.content.indexOf('\n');
        if (firstNewline === -1) continue;
        const header = row.content.slice(0, firstNewline);
        if (!header.startsWith(SCOPE_PREFIX)) continue;
        const rowScope = header.slice(SCOPE_PREFIX.length);
        const content = row.content.slice(firstNewline + 1);
        result.set(rowScope, {
          content,
          version: row.version,
          updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
          source: 'postgres',
        });
      }
    } catch {
      // Fall through to file-based reads
    } finally {
      if (client) await client.end({ timeout: 5 }).catch(() => {});
    }
  }

  // Supplement / replace with file-based reads for any scope present on disk
  const fileScopes = listStrategyScopes(env);
  for (const fileScope of fileScopes) {
    if (result.has(fileScope)) continue;
    const filePath = strategyFilePath(fileScope, env);
    try {
      const content = readFileSync(filePath, 'utf8');
      result.set(fileScope, {
        content,
        version: 1,
        updatedAt: new Date().toISOString(),
        source: 'file',
      });
    } catch {
      // Skip unreadable files
    }
  }

  return result;
}

// ── Digest helpers ────────────────────────────────────────────────────────────

/**
 * Parse markdown into sections split on ## headers.
 *
 * @param {string} content
 * @returns {Array<{ header: string, body: string }>}
 */
function parseSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { header: line.slice(3).trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Truncate a body to the first N sentences.
 *
 * @param {string} body
 * @param {number} maxSentences
 * @returns {string}
 */
function firstSentences(body, maxSentences = 2) {
  const trimmed = body.trim();
  if (!trimmed) return '';
  const sentences = trimmed.match(/[^.!?\n]+[.!?\n]+/g) || [trimmed];
  return sentences.slice(0, maxSentences).join(' ').trim();
}

/**
 * Build a compact markdown block from a single scope's content.
 *
 * @param {string} scopeName
 * @param {string} content
 * @param {number} charBudget — remaining character budget; mutated by reference via returned delta
 * @returns {{ text: string, charsUsed: number }}
 */
function buildScopeBlock(scopeName, content, charBudget) {
  const sections = parseSections(content);
  if (!sections.length) return { text: '', charsUsed: 0 };

  const lines = [`### ${scopeName}`];
  let used = scopeName.length + 5;

  for (const { header, body } of sections) {
    if (used >= charBudget) break;
    const excerpt = firstSentences(body, 2);
    const line = excerpt ? `**${header}:** ${excerpt}` : `**${header}**`;
    lines.push(line);
    used += line.length + 1;
  }

  const text = lines.join('\n');
  return { text, charsUsed: used };
}

/**
 * Return a compact strategy digest (≤ 500 tokens) for agent prompt injection.
 *
 * Reads all present scopes asynchronously. Returns empty string when no scopes exist.
 *
 * @param {object} [env]
 * @returns {Promise<string>}
 */
export async function getStrategyDigest(env = process.env) {
  try {
    const all = await readAllStrategies(env);
    if (!all.size) return '';

    const TOKEN_LIMIT = 500;
    let charBudget = TOKEN_LIMIT * 4;
    const parts = ['## Active strategy'];

    for (const [scopeName, { content }] of all) {
      if (!content) continue;
      const { text, charsUsed } = buildScopeBlock(scopeName, content, charBudget);
      if (text) {
        parts.push(text);
        charBudget -= charsUsed;
      }
      if (charBudget <= 0) break;
    }

    return parts.length > 1 ? parts.join('\n') : '';
  } catch {
    return '';
  }
}

/**
 * Synchronous file-only strategy digest for prompt-composer.js.
 *
 * Reads all .md files present in the strategy directory directly. Never reads
 * Postgres. Returns empty string when the directory is absent or empty.
 *
 * @param {object} [env]
 * @returns {string}
 */
export function getStrategyDigestSync(env = process.env) {
  try {
    const dir = strategyDir(env);
    if (!existsSync(dir)) return '';

    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    if (!files.length) return '';

    const TOKEN_LIMIT = 500;
    let charBudget = TOKEN_LIMIT * 4;
    const parts = ['## Active strategy'];

    for (const file of files) {
      if (charBudget <= 0) break;
      const scopeName = basename(file, '.md');
      let content;
      try {
        content = readFileSync(join(dir, file), 'utf8');
      } catch {
        continue;
      }
      if (!content) continue;
      const { text, charsUsed } = buildScopeBlock(scopeName, content, charBudget);
      if (text) {
        parts.push(text);
        charBudget -= charsUsed;
      }
    }

    return parts.length > 1 ? parts.join('\n') : '';
  } catch {
    return '';
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Write a strategy scope to file (always) and Postgres (best-effort if available).
 *
 * The scope parameter defaults to 'product'. When writing to Postgres the content
 * is prefixed with `scope:{name}\n` to allow per-scope storage without a schema change.
 *
 * @param {string} content
 * @param {string} [scope]
 * @param {object} [opts]
 * @param {string} [opts.updatedBy]
 * @param {object} [opts.env]
 */
export async function writeStrategy(content, scope = 'product', { updatedBy, env = process.env } = {}) {
  const filePath = strategyFilePath(scope, env);
  const dir = strategyDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf8');

  if (!hasSqlStore(env)) return;

  const client = createSqlClient(env);
  try {
    const project = env.CX_PROJECT || 'default';
    const scopedContent = `${SCOPE_PREFIX}${scope}\n${content}`;
    const prefix = `${SCOPE_PREFIX}${scope}\n`;

    const existing = await client`
      select version from construct_strategy
      where project = ${project}
        and content like ${prefix + '%'}
      order by version desc
      limit 1
    `;
    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

    await client`
      insert into construct_strategy (project, content, version, updated_by)
      values (${project}, ${scopedContent}, ${nextVersion}, ${updatedBy ?? null})
    `;
  } catch {
    // Best-effort Postgres write — file write already succeeded
  } finally {
    if (client) await client.end({ timeout: 5 }).catch(() => {});
  }
}
