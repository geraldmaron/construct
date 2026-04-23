#!/usr/bin/env node
/**
 * lib/hooks/model-fallback.mjs — Model fallback hook — reroutes requests when the primary model is unavailable.
 *
 * Runs as PostToolUse when model calls fail. Reads the error, selects a fallback provider from the model router, and retries the request with the alternate model.
 *
 * @p95ms 100
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readOpenRouterApiKeyFromOpenCodeConfig } from '../model-router.mjs';

const RATE_LIMIT_PATTERNS = [
  /\b429\b/i,
  /rate limit/i,
  /usage limits?/i,
  /specified API usage limits?/i,
  /regain access/i,
  /weekly limit/i,
  /monthly limit/i,
  /daily limit/i,
  /too many requests/i,
  /quota exceeded/i,
  /model unavailable/i,
  /model.*overloaded/i,
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
];

const COOLDOWN_MS = 10 * 60 * 1000;
const statePath = join(homedir(), '.cx', 'construct-model-fallback.json');

function readInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function flatten(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).join('\n');
  if (typeof value === 'object') return Object.values(value).map(flatten).join('\n');
  return '';
}

function recentlyApplied(now) {
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return typeof state.lastAppliedAt === 'number' && now - state.lastAppliedAt < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function writeState(payload) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(payload, null, 2));
}

const input = readInput();
const haystack = flatten(input);
if (!RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(haystack))) process.exit(0);

const now = Date.now();
if (recentlyApplied(now)) {
  process.stderr.write('[model-fallback] Rate limit/timeout detected; fallback recently applied, skipping cooldown window.\n');
  process.exit(0);
}

const toolkitDir = process.env.CX_TOOLKIT_DIR || join(homedir(), '.construct');
const constructBin = join(toolkitDir, 'bin', 'construct');

if (!existsSync(constructBin)) {
  process.stderr.write(`[model-fallback] construct binary not found at ${constructBin}\n`);
  process.exit(0);
}

const openRouterApiKey = process.env.OPENROUTER_API_KEY || readOpenRouterApiKeyFromOpenCodeConfig();

if (!openRouterApiKey) {
  process.stderr.write('[model-fallback] Rate limit/timeout detected; no OpenRouter API key found in OPENROUTER_API_KEY or OpenCode config, so automatic fallback cannot poll models.\n');
  process.exit(0);
}

try {
  process.stderr.write('[model-fallback] Rate limit/timeout detected. Running construct models --apply.\n');
  execFileSync(constructBin, ['models', '--apply'], {
    cwd: toolkitDir,
    stdio: 'inherit',
    env: { ...process.env, CX_TOOLKIT_DIR: toolkitDir, OPENROUTER_API_KEY: openRouterApiKey },
    timeout: 120_000,
  });
  writeState({ lastAppliedAt: now, reason: 'rate-limit-or-timeout' });
} catch (error) {
  process.stderr.write(`[model-fallback] Fallback failed: ${error.message}\n`);
}

process.exit(0);
