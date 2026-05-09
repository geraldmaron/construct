#!/usr/bin/env node
/**
 * scripts/lint-commits-pr.mjs - Enforce commit + PR templates.
 *
 * Validates that every commit subject on the current branch matches the
 * conventional pattern in `.gitmessage`, and that the PR body (when running
 * inside a pull_request CI event) preserves the headings and at least one
 * checked box per gate group from `.github/pull_request_template.md`.
 *
 * Exit 0 on pass, 1 on any violation. Used by the ci.yml `template policy`
 * job and runnable locally before push.
 */
import { execSync } from "node:child_process";

const COMMIT_SUBJECT_RE =
  /^(feat|fix|refactor|perf|docs|test|chore|ci|build|style)(\([\w/.,:-]+\))?(!)?: [^A-Z].{1,70}$/;

const FORBIDDEN_TRAILER_RE = /^Co-Authored-By:\s+Claude/im;

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
    if (merge) continue;
    if (!COMMIT_SUBJECT_RE.test(subject ?? "")) {
      violations.push(`${sha.slice(0, 9)}: subject does not match \`type(scope): subject\` (≤72 chars, imperative, no period): ${JSON.stringify(subject)}`);
    }
    if (FORBIDDEN_TRAILER_RE.test(body ?? "")) {
      violations.push(`${sha.slice(0, 9)}: forbidden trailer "Co-Authored-By: Claude" detected`);
    }
  }
  return violations;
}

function lintPrBody() {
  const path = process.env.PR_BODY_FILE;
  let body = process.env.PR_BODY;
  if (!body && path) {
    try {
      body = require("node:fs").readFileSync(path, "utf8");
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
