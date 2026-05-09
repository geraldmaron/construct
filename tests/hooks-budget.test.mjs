/**
 * tests/hooks-budget.test.mjs — enforces SLA annotations and hook count ceiling.
 *
 * Reads every hook file in lib/hooks/ and verifies:
 *   1. Each file has a @p95ms annotation.
 *   2. Each file has a @maxBlockingScope annotation.
 *   3. Total hook count is within the approved ceiling.
 *   4. No deprecated hook files remain on disk.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const HOOKS_DIR = path.join(ROOT_DIR, 'lib', 'hooks');
const DEPRECATED_LEDGER = path.join(ROOT_DIR, 'docs', 'hooks-deprecated.md');

// Hooks approved for removal — must not exist on disk.
const DEPRECATED_HOOKS = [
  'bootstrap-guard.mjs',
  'drive-guard.mjs',
  'task-completed-guard.mjs',
  'workflow-guard.mjs',
  'mcp-task-scope.mjs',
  'repeated-read-guard.mjs',
  'continuation-enforcer.mjs',
  'teammate-idle-guard.mjs',
  'console-warn.mjs',
];

// Maximum number of hook files allowed. Prevents unreviewed hook accumulation.
const MAX_HOOK_COUNT = 30;

function hookFiles() {
  return fs.readdirSync(HOOKS_DIR).filter(f => f.endsWith('.mjs'));
}

describe('hooks budget', () => {
  it('deprecated hooks are absent from disk', () => {
    for (const name of DEPRECATED_HOOKS) {
      const fullPath = path.join(HOOKS_DIR, name);
      assert.equal(
        fs.existsSync(fullPath),
        false,
        `Deprecated hook still on disk: lib/hooks/${name} — remove it or update the ledger`
      );
    }
  });

  it('hook count is within ceiling', () => {
    const files = hookFiles();
    assert.ok(
      files.length <= MAX_HOOK_COUNT,
      `Hook count ${files.length} exceeds ceiling ${MAX_HOOK_COUNT}. ` +
      `Merge or retire hooks before adding new ones.`
    );
  });

  it('every hook has @p95ms annotation', () => {
    const missing = [];
    for (const name of hookFiles()) {
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      if (!/@p95ms\s+\d+/.test(src)) missing.push(name);
    }
    assert.deepEqual(
      missing,
      [],
      `Hooks missing @p95ms annotation:\n  ${missing.join('\n  ')}`
    );
  });

  it('every hook has @maxBlockingScope annotation', () => {
    const missing = [];
    for (const name of hookFiles()) {
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      if (!/@maxBlockingScope\s+\S+/.test(src)) missing.push(name);
    }
    assert.deepEqual(
      missing,
      [],
      `Hooks missing @maxBlockingScope annotation:\n  ${missing.join('\n  ')}`
    );
  });

  it('deprecated ledger exists', () => {
    assert.ok(
      fs.existsSync(DEPRECATED_LEDGER),
      'docs/hooks-deprecated.md is missing — create it before removing hooks'
    );
  });

  it('no banned comment patterns in hooks', () => {
    const BANNED = [
      /\bReplaces\b/,
      /\bSuperior to\b/i,
      /\bExceeds [A-Z]/,   // comparative narration ("Exceeds OmO's...") not technical description
      /\badded for\b/i,
      /\bin this PR\b/i,
      /\bpreviously\b/i,
      /\bno longer\b/i,
      /\bwe used to\b/i,
      // new policy patterns
      /\/\/\s+(?:We |This |It |Now )\w/i,   // narrative voice
      /\/\/\s*(?:ok|skip|best effort)\s*$/i, // noise sentinels
      /\/\/\s+\d+\.\s+\w/,                  // step markers
    ];
    const violations = [];
    for (const name of hookFiles()) {
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        for (const pattern of BANNED) {
          if (pattern.test(line)) {
            violations.push(`${name}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    }
    assert.deepEqual(
      violations,
      [],
      `Banned comment patterns found:\n  ${violations.join('\n  ')}`
    );
  });
});
