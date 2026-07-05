#!/usr/bin/env node
/**
 * scripts/lint-commits-pr.mjs - Enforce commit + PR templates.
 *
 * Validates that every commit subject on the current branch matches the
 * conventional pattern in `.gitmessage`, and that the PR body (when running
 * inside a pull_request CI event) preserves the headings and at least one
 * checked box per gate group from `.github/pull_request_template.md`.
 *
 * Exit 0 on pass, 1 on any violation. Runs as the ci.yml `template policy`
 * job and is also runnable locally before push.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The conventional `type(scope):` prefix is enforced; the subject itself is kept
// deliberately permissive so a descriptive, family-scoped subject can name the finding
// and the fix on one line and may lead with an acronym or label (P1, JSONC, ADR-0050,
// MCP). Only a leading space and an over-140-char subject are rejected; richer detail
// belongs in the body.

const COMMIT_SUBJECT_RE =
  /^(feat|fix|refactor|perf|docs|test|chore|ci|build|style)(\([\w/.,:-]+\))?(!)?: \S.{0,139}$/;

const FORBIDDEN_TRAILER_RE = /^Co-[Aa]uthored-[Bb]y:/im;

// Legacy commits that predate this policy, on the shared `staging` branch
// (already pushed, referenced by closed PRs) — rewriting history to fix the
// subject is out of scope and riskier than a narrow, documented exemption.
// Do not add new entries here for commits made after this policy existed.
const LEGACY_EXEMPT_SHAS = new Set([
  "e16890584a745ed8aded6ffbfe0c830c428c7cc8", // "AP audit: status, secrets, defaults fix" (2026-07-02, pre-policy)
]);

const REQUIRED_PR_HEADINGS = [
  "## Summary",
  "## Beads issue",
  "## Doc updates included",
  "## Local gates",
  "## Test plan",
  "## Risks / rollback",
];

const REQUIRED_GATE_GROUPS = [
  { label: "Doc updates", marker: "## Doc updates included" },
  { label: "Local gates", marker: "## Local gates" },
];

function getRange() {
  const currentBranch = process.env.GIT_BRANCH;
  const upstreamRef = process.env.GIT_UPSTREAM_REF;
  const baseSha = process.env.PR_BASE_SHA;
  const baseRef = process.env.PR_BASE_REF || process.env.GITHUB_BASE_REF;

  if (baseSha && /^[0-9a-f]{7,40}$/i.test(baseSha)) {
    try {
      execSync(`git fetch --no-tags --depth=200 origin ${baseSha}`, { stdio: "pipe" });
    } catch { /* may already be present */ }
    try {
      execSync(`git rev-parse --verify ${baseSha}^{commit}`, { stdio: "pipe" });
      return `${baseSha}..HEAD`;
    } catch { /* fall through */ }
  }

  if (baseRef) {
    try {
      execSync(`git fetch --no-tags --depth=200 origin ${baseRef}`, { stdio: "pipe" });
      return `origin/${baseRef}..HEAD`;
    } catch { /* fall through */ }
  }

  if (!baseSha && !baseRef) {
    try {
      const branch = currentBranch || execSync('git branch --show-current', { stdio: 'pipe', encoding: 'utf8' }).trim();
      const upstream = upstreamRef || execSync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, {
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
      if (upstream) {
        try {
          execSync(`git fetch --no-tags --depth=200 ${upstream.split('/')[0]} ${upstream.split('/').slice(1).join('/')}`, { stdio: 'pipe' });
        } catch { /* already available or offline */ }
        return `${upstream}..HEAD`;
      }
    } catch { /* no upstream configured */ }
  }

  try {
    execSync("git rev-parse --verify origin/main", { stdio: "pipe" });
    return "origin/main..HEAD";
  } catch {
    return "HEAD~10..HEAD";
  }
}

function lintCommits() {
  const range = getRange();
  let log;
  try {
    log = execSync(`git log --format=%H%x09%s%x09%B%x1e ${range}`, {
      encoding: "utf8",
    });
  } catch (err) {
    console.error(`fatal: cannot read commit range ${range}: ${err.message}`);
    return [`unable to enumerate commits in ${range}`];
  }
  if (!log.trim()) return [];

  const violations = [];
  const records = log.split("\x1e").map((r) => r.trim()).filter(Boolean);
  for (const record of records) {
    const [sha, subject, body] = record.split("\t");
    const merge = subject?.startsWith("Merge ") || subject?.startsWith("Revert ");
    if (merge || LEGACY_EXEMPT_SHAS.has(sha)) continue;
    if (!COMMIT_SUBJECT_RE.test(subject ?? "")) {
      violations.push(`${sha.slice(0, 9)}: subject does not match \`type(scope): subject\` (≤140 chars, no leading space): ${JSON.stringify(subject)}`);
    }
    if (FORBIDDEN_TRAILER_RE.test(body ?? "")) {
      violations.push(`${sha.slice(0, 9)}: forbidden Co-Authored-By trailer detected`);
    }
  }
  return violations;
}

function lintPrBody() {
  const path = process.env.PR_BODY_FILE;
  let body = process.env.PR_BODY;
  if (!body && path) {
    try {
      body = readFileSync(path, "utf8");
    } catch {
      return [`PR_BODY_FILE set but unreadable: ${path}`];
    }
  }
  if (!body) return [];

  const violations = [];
  for (const heading of REQUIRED_PR_HEADINGS) {
    if (!body.includes(heading)) {
      violations.push(`PR body missing required heading: ${heading}`);
    }
  }
  for (const group of REQUIRED_GATE_GROUPS) {
    const start = body.indexOf(group.marker);
    if (start === -1) continue;
    const next = REQUIRED_PR_HEADINGS
      .map((h) => body.indexOf(h, start + 1))
      .filter((i) => i > start)
      .sort((a, b) => a - b)[0] ?? body.length;
    const segment = body.slice(start, next);
    const hasBoxes = /^\s*-\s*\[[ xX]\]/m.test(segment);
    const hasChecked = /^\s*-\s*\[[xX]\]/m.test(segment);
    if (hasBoxes && !hasChecked) {
      violations.push(`PR body section "${group.label}" has zero checked boxes — at least one must be checked`);
    }
  }
  return violations;
}

const commitViolations = lintCommits();
const prViolations = lintPrBody();
const all = [...commitViolations, ...prViolations];

if (all.length > 0) {
  console.error("\nTemplate policy violations:\n");
  for (const v of all) console.error(`  - ${v}`);
  console.error("\nSee .gitmessage and .github/pull_request_template.md for the required shape.");
  console.error("Run `git config commit.template .gitmessage` once per clone to load the commit template.\n");
  process.exit(1);
}

console.log("Template policy: clean.");
