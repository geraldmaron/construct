/**
 * tests/platforms-claude-md-parity.test.mjs — structural parity between
 * the canonical /CLAUDE.md and the shipped reference template at
 * platforms/claude/CLAUDE.md.
 *
 * The canonical file lives at the repo root and is what Claude Code
 * reads when a session opens inside THIS repo. The platforms variant
 * is a project-agnostic reference template that ships in the npm
 * package — users see it as guidance for what their own /CLAUDE.md
 * should look like after `construct init`.
 *
 * The contract: both files reference the same critical rules and have
 * matching section headings. Content can differ (canonical is repo-
 * specific, platform is generic) but the shape must align so the
 * template stays useful as guidance.
 *
 * If this test fails, either:
 *   - /CLAUDE.md added a new critical rule → mirror it in the platform file
 *   - platforms/claude/CLAUDE.md drifted from the canonical structure → realign
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CANONICAL = path.join(REPO, 'CLAUDE.md');
const PLATFORM = path.join(REPO, 'platforms', 'claude', 'CLAUDE.md');

// Critical rules from /CLAUDE.md's "Critical rules" section that every
// project's CLAUDE.md should mirror. Each entry is a regex against the
// platform file's text — the rule must be referenced by name, even if
// the surrounding wording differs.

const CRITICAL_RULES = [
  /never fabricate/i,
  /confirm the working branch/i,
  /never commit, push, or merge without asking/i,
  /never edit running hook files/i,
  /hooks fire unconditionally/i,
  /never commit directly to main/i,
  /run\s+`?construct doctor`?/i,
];

const REQUIRED_HEADINGS = [
  /^##\s+critical rules/im,
  /^##\s+workflow perspectives/im,
  /^##\s+beads issue tracker/im,
  /^##\s+session completion/im,
];

test('platforms/claude/CLAUDE.md references every critical rule from /CLAUDE.md', () => {
  const platform = fs.readFileSync(PLATFORM, 'utf8');
  for (const rule of CRITICAL_RULES) {
    assert.match(
      platform,
      rule,
      `platforms/claude/CLAUDE.md must reference the critical rule: ${rule}`,
    );
  }
});

test('platforms/claude/CLAUDE.md has the required section headings', () => {
  const platform = fs.readFileSync(PLATFORM, 'utf8');
  for (const heading of REQUIRED_HEADINGS) {
    assert.match(
      platform,
      heading,
      `platforms/claude/CLAUDE.md must have section heading: ${heading}`,
    );
  }
});

test('/CLAUDE.md still names every critical rule the template mirrors (canonical not drifting away from template)', () => {
  const canonical = fs.readFileSync(CANONICAL, 'utf8');
  for (const rule of CRITICAL_RULES) {
    assert.match(
      canonical,
      rule,
      `/CLAUDE.md must reference the critical rule: ${rule}. If you removed it from /CLAUDE.md, also remove it from the CRITICAL_RULES list in this test and from platforms/claude/CLAUDE.md.`,
    );
  }
});
