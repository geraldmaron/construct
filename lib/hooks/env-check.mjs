#!/usr/bin/env node
/**
 * env-check.mjs — SessionStart
 *
 * Reads .env.example from the project root, compares against .env and
 * process.env, and writes missing required vars to stdout so Claude sees
 * them at session open. Silent when everything is in order.
 *
 * @p95ms 20
 * @maxBlockingScope SessionStart
 */
import { readFileSync, existsSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';

// Resolve symlinks immediately to avoid CJS/ESM loader edge cases during
// rapid concurrent session-start hook invocations.
try { realpathSync(fileURLToPath(import.meta.url)); } catch { /* non-critical */ }
import { join } from 'path';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no stdin */ }

const cwd = input?.cwd || process.cwd();

// Find .env.example — project root only (don't walk up, avoid false positives)
const examplePath = join(cwd, '.env.example');
if (!existsSync(examplePath)) process.exit(0);

// Parse both files into key sets
function parseEnvFile(path) {
  if (!existsSync(path)) return new Map();
  const map = new Map();
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    const eq = stripped.indexOf('=');
    if (eq === -1) continue;
    const key = stripped.slice(0, eq).trim();
    const val = stripped.slice(eq + 1).trim();
    if (key) map.set(key, val);
  }
  return map;
}

const example = parseEnvFile(examplePath);
if (example.size === 0) process.exit(0);

const envFile = parseEnvFile(join(cwd, '.env'));

// A key is "required" if its example value is a non-empty placeholder
// (not already set to a real value — we don't block on keys with defaults)
const PLACEHOLDER = /^(YOUR_|<|__|\$\{|REPLACE|ADD_|INSERT_|xxx|TODO)/i;
const OPTIONAL_COMMENT = /#.*optional/i;

function isRequired(key, exampleVal) {
  // If value looks like a real default (not a placeholder), it's optional
  if (!exampleVal) return true; // empty = required
  if (PLACEHOLDER.test(exampleVal)) return true;
  // If it has a real value in example, treat as optional with default
  return false;
}

const missing = [];
for (const [key, exampleVal] of example) {
  if (!isRequired(key, exampleVal)) continue;
  // Check .env file first, then process.env
  const inEnvFile = envFile.has(key) && envFile.get(key) !== '' && !PLACEHOLDER.test(envFile.get(key));
  const inProcessEnv = process.env[key] && !PLACEHOLDER.test(process.env[key]);
  if (!inEnvFile && !inProcessEnv) {
    missing.push(key);
  }
}

if (missing.length === 0) process.exit(0);

const noun = missing.length === 1 ? 'variable' : 'variables';
const list = missing.map(k => `  - ${k}`).join('\n');
process.stdout.write(
  `## Environment check — ${missing.length} required ${noun} not set\n${list}\nAdd these to .env before running the app.\n`
);

process.exit(0);
