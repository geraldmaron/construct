#!/usr/bin/env node
/**
 * lib/hooks/repeated-read-guard.mjs — warns when a Read tool call repeats a file
 * already read this session, and escalates to a block on the 3rd+ repeat at a
 * large range.
 *
 * Runs as PreToolUse on Read. Uses the session-efficiency store populated by
 * read-tracker.mjs to check prior reads. The rule:
 *
 *   - First read of a file → allow silently.
 *   - Repeat read at a narrower range (limit < 100) → allow (legit follow-up).
 *   - Repeat read at a broad range (limit unset or >= 200) after 2+ prior reads
 *     of the same file → block with a pointed message steering the model to
 *     Grep, a narrower range, or reading the session's prior slice from context.
 *
 * Exit 2 blocks in Claude Code hooks. Exit 0 allows.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const EFFICIENCY_STORE = join(homedir(), '.cx', 'session-efficiency.json');
const REPEAT_BLOCK_THRESHOLD = 2;
const BROAD_READ_LIMIT = 200;

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

if ((input?.tool_name || '') !== 'Read') process.exit(0);

const rawPath = input?.tool_input?.file_path || '';
if (!rawPath) process.exit(0);

const absPath = rawPath.startsWith('/') ? rawPath : resolve(input?.cwd || process.cwd(), rawPath);
const requestedLimit = Number(input?.tool_input?.limit || 0);
const isBroad = requestedLimit === 0 || requestedLimit >= BROAD_READ_LIMIT;

let store = {};
try { store = JSON.parse(readFileSync(EFFICIENCY_STORE, 'utf8')); } catch { process.exit(0); }

const fileEntry = store?.files?.[absPath];
if (!fileEntry) process.exit(0);

const priorCount = Number(fileEntry.count || 0);
if (priorCount < REPEAT_BLOCK_THRESHOLD) process.exit(0);
if (!isBroad) process.exit(0);

const priorSize = fileEntry.size ? `${Math.round(fileEntry.size / 1024)} KB` : 'unknown size';
process.stderr.write(
  `[repeated-read-guard] ${absPath} has already been read ${priorCount} times this session (${priorSize}). ` +
  `The content is in your conversation context. ` +
  `Prefer Grep with a targeted pattern, Read with offset+limit for a specific slice, ` +
  `or reference what was read earlier. If you truly need the whole file again, run the Read ` +
  `with an explicit narrow limit (e.g. limit: 150) to signal intent.\n`
);
process.exit(2);
