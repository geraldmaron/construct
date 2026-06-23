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
const DEPRECATED_LEDGER = path.join(ROOT_DIR, 'docs', 'reference', 'hooks-deprecated.md');

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
const MAX_HOOK_COUNT = 41;

// PostToolUse fires on every tool call — cap entries there to bound hot-path latency.
const MAX_POST_TOOL_USE_ENTRIES = 21;

const SETTINGS_TEMPLATE = path.join(ROOT_DIR, 'platforms', 'claude', 'settings.template.json');

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

  it('PostToolUse entry count is within hot-path ceiling', () => {
    if (!fs.existsSync(SETTINGS_TEMPLATE)) return;
    const settings = JSON.parse(fs.readFileSync(SETTINGS_TEMPLATE, 'utf8'));
    const entries = settings?.hooks?.PostToolUse ?? [];
    assert.ok(
      entries.length <= MAX_POST_TOOL_USE_ENTRIES,
      `PostToolUse has ${entries.length} entries (ceiling ${MAX_POST_TOOL_USE_ENTRIES}). ` +
      `Consolidate or move logic to PreCompact/Stop before adding more.`
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

  it('every hook has @lifecycle or @unwired annotation', () => {
    const missing = [];
    for (const name of hookFiles()) {
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      const hasLifecycle = /@lifecycle\s+(SessionStart|PreToolUse|PostToolUse|PostToolUseFailure|PreCompact|Stop|UserPromptSubmit)\b/.test(src);
      const hasUnwired = /@unwired\b/.test(src);
      if (!hasLifecycle && !hasUnwired) missing.push(name);
    }
    assert.deepEqual(missing, [], `Hooks missing @lifecycle/@unwired:\n  ${missing.join('\n  ')}`);
  });

  it('every hook has @matcher (or @unwired)', () => {
    const missing = [];
    for (const name of hookFiles()) {
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      const hasMatcher = /@matcher\s+\S/.test(src);
      const hasUnwired = /@unwired\b/.test(src);
      if (!hasMatcher && !hasUnwired) missing.push(name);
    }
    assert.deepEqual(missing, [], `Hooks missing @matcher:\n  ${missing.join('\n  ')}`);
  });

  it('every hook has @exits annotation that matches process.exit() calls', () => {
    const violations = [];
    for (const name of hookFiles()) {
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      const exitsMatch = src.match(/@exits\s+([^\n]+)/);
      if (!exitsMatch) { violations.push(`${name}: missing @exits`); continue; }
      const declaresBlock = /\b2\s*=\s*block/i.test(exitsMatch[1]);
      const usesExitTwo = /process\.exit\(\s*2\s*\)/.test(src);
      if (usesExitTwo && !declaresBlock) violations.push(`${name}: process.exit(2) used but @exits omits "2 = block"`);
      if (!usesExitTwo && declaresBlock) violations.push(`${name}: @exits declares "2 = block" but no process.exit(2) in source`);
    }
    assert.deepEqual(violations, [], `Hook @exits drift:\n  ${violations.join('\n  ')}`);
  });

  it('every settings.template.json hook command resolves to a present .mjs file', () => {
    const text = fs.readFileSync(SETTINGS_TEMPLATE, 'utf8');
    const matches = [...text.matchAll(/lib\/hooks\/([a-z0-9_/-]+\.mjs)/g)].map((m) => m[1]);
    const unique = [...new Set(matches)];
    const missing = unique.filter((rel) => !fs.existsSync(path.join(HOOKS_DIR, rel)));
    assert.deepEqual(missing, [], `Settings entries pointing at missing files:\n  ${missing.join('\n  ')}`);
  });

  it('every wired hook .mjs is referenced from settings (or carries @unwired)', () => {
    const text = fs.readFileSync(SETTINGS_TEMPLATE, 'utf8');
    const referenced = new Set([...text.matchAll(/lib\/hooks\/([a-z0-9_-]+\.mjs)/g)].map((m) => m[1]));
    const orphans = [];
    for (const name of hookFiles()) {
      if (referenced.has(name)) continue;
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      if (!/@unwired\b/.test(src)) orphans.push(name);
    }
    assert.deepEqual(orphans, [], `Hooks present on disk, missing from settings, and not marked @unwired:\n  ${orphans.join('\n  ')}`);
  });

  it('deprecated ledger exists', () => {
    assert.ok(
      fs.existsSync(DEPRECATED_LEDGER),
      'docs/reference/hooks-deprecated.md is missing — create it before removing hooks'
    );
  });

  it('Stop hooks that maintain tracking surfaces are non-blocking', () => {
    const TRACKING_REFRESH_HOOKS = ['session-tracking-refresh.mjs'];
    const violations = [];
    for (const name of TRACKING_REFRESH_HOOKS) {
      const src = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      const blockScope = src.match(/@maxBlockingScope\s+(\S+)/);
      if (!blockScope) {
        violations.push(`${name}: missing @maxBlockingScope`);
        continue;
      }
      if (blockScope[1] !== 'none') {
        violations.push(`${name}: tracking-refresh hooks must be @maxBlockingScope none, got "${blockScope[1]}"`);
      }
    }
    assert.deepEqual(violations, [], `Tracking-refresh hook blocking-scope drift:\n  ${violations.join('\n  ')}`);
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
