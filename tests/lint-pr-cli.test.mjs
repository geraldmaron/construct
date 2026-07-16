/**
 * tests/lint-pr-cli.test.mjs — construct lint:pr body/base-ref resolution.
 *
 * Covers lib/lint-pr-cli.mjs's resolvePrContext() and runLintPrCli(), the
 * local pre-flight for CI's `template policy` gate (scripts/lint-commits-pr.mjs).
 * A fake `runner` stands in for `gh` so these never shell out to a real
 * `gh pr view` — no network, auth, or actual open PR required. Each test
 * captures/restores stdout+stderr and PR_* env vars since runLintPrCli
 * mutates process.env for the imported lintCommits()/lintPrBody() calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { resolvePrContext, runLintPrCli } from "../lib/lint-pr-cli.mjs";
import { rmTmpDir } from "./helpers/cleanup.mjs";

const HEAD = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

function captureConsole() {
  const out = [];
  const err = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  return {
    restore() {
      console.log = origLog;
      console.error = origError;
    },
    out: () => out.join("\n"),
    err: () => err.join("\n"),
  };
}

function withIsolatedPrEnv(fn) {
  const keys = ["PR_BODY", "PR_BODY_FILE", "PR_BASE_SHA", "PR_BASE_REF", "PR_AUTHOR"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.PR_BASE_SHA = HEAD;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

function notInstalledRunner() {
  throw new Error("command not found: gh");
}

function notAuthedRunner(cmd) {
  if (cmd === "gh --version") return "gh version 2.0.0\n";
  throw new Error("gh auth status exited 1");
}

function noOpenPrRunner(cmd) {
  if (cmd === "gh --version") return "gh version 2.0.0\n";
  if (cmd === "gh auth status") return "Logged in to github.com\n";
  throw new Error("no pull requests found for branch");
}

function makeOpenPrRunner(pr) {
  return (cmd) => {
    if (cmd === "gh --version") return "gh version 2.0.0\n";
    if (cmd === "gh auth status") return "Logged in to github.com\n";
    if (cmd.startsWith("gh pr view")) return JSON.stringify(pr);
    throw new Error(`unexpected command: ${cmd}`);
  };
}

test("resolvePrContext: --file wins even when a fake gh would resolve a PR", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-pr-cli-"));
  t.after(() => rmTmpDir(tmp));
  const file = path.join(tmp, "body.md");
  fs.writeFileSync(file, "## Summary\nx\n");
  const ctx = resolvePrContext(["--file", file], {
    runner: makeOpenPrRunner({ body: "ignored", baseRefName: "ignored", author: { login: "ignored" } }),
  });
  assert.equal(ctx.status, "file");
  assert.equal(ctx.bodyFile, file);
});

test("resolvePrContext: --file with a missing path is an error, not a silent skip", () => {
  const ctx = resolvePrContext(["--file", "/definitely/does/not/exist.md"], { runner: notInstalledRunner });
  assert.equal(ctx.status, "error");
  assert.match(ctx.message, /does not exist/);
});

test("resolvePrContext: gh not installed -> gh-unavailable with a named reason", () => {
  const ctx = resolvePrContext([], { runner: notInstalledRunner });
  assert.equal(ctx.status, "gh-unavailable");
  assert.match(ctx.reason, /not installed/);
});

test("resolvePrContext: gh installed but not authenticated -> gh-unavailable with a named reason", () => {
  const ctx = resolvePrContext([], { runner: notAuthedRunner });
  assert.equal(ctx.status, "gh-unavailable");
  assert.match(ctx.reason, /not authenticated/);
});

test("resolvePrContext: gh authenticated but no open PR for this branch -> no-pr", () => {
  const ctx = resolvePrContext([], { runner: noOpenPrRunner });
  assert.equal(ctx.status, "no-pr");
});

test("resolvePrContext: gh authenticated with an open PR resolves body/baseRef/author, --base overrides baseRefName", () => {
  const runner = makeOpenPrRunner({ body: "## Summary\nx\n", baseRefName: "main", author: { login: "octocat" } });
  const ctx = resolvePrContext([], { runner });
  assert.equal(ctx.status, "gh");
  assert.equal(ctx.baseRef, "main");
  assert.equal(ctx.author, "octocat");

  const overridden = resolvePrContext(["--base", "staging"], { runner });
  assert.equal(overridden.baseRef, "staging");
});

test("runLintPrCli: --file with no PR-template headings exits non-zero and prints the CI violation format", (t) =>
  withIsolatedPrEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-pr-cli-"));
    t.after(() => rmTmpDir(tmp));
    const file = path.join(tmp, "bad-body.md");
    fs.writeFileSync(file, "no headings here at all\n");
    const cap = captureConsole();
    let exitCode;
    try {
      exitCode = await runLintPrCli(["--file", file], { runner: notInstalledRunner });
    } finally {
      cap.restore();
    }
    assert.equal(exitCode, 1);
    assert.match(cap.err(), /Template policy violations:/);
    assert.match(cap.err(), /PR body missing required heading: ## Summary/);
  }));

test("runLintPrCli: --file with a well-formed body exits 0 with 'Template policy: clean.'", (t) =>
  withIsolatedPrEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-pr-cli-"));
    t.after(() => rmTmpDir(tmp));
    const file = path.join(tmp, "good-body.md");
    fs.writeFileSync(
      file,
      [
        "## Summary", "x", "",
        "## Beads issue", "construct-k1jrz", "",
        "## Doc updates included", "- [x] done", "",
        "## Local gates", "- [x] npm test", "",
        "## Test plan", "ran it", "",
        "## Risks / rollback", "none", "",
      ].join("\n"),
    );
    const cap = captureConsole();
    let exitCode;
    try {
      exitCode = await runLintPrCli(["--file", file], { runner: notInstalledRunner });
    } finally {
      cap.restore();
    }
    assert.equal(exitCode, 0);
    assert.match(cap.out(), /Template policy: clean\./);
  }));

test("runLintPrCli: no --file and no gh PR available exits 0 with an honest skip message, not a fake pass", () =>
  withIsolatedPrEnv(async () => {
    const cap = captureConsole();
    let exitCode;
    try {
      exitCode = await runLintPrCli([], { runner: notInstalledRunner });
    } finally {
      cap.restore();
    }
    assert.equal(exitCode, 0);
    assert.match(cap.out(), /PR-body heading check skipped/);
    assert.doesNotMatch(cap.out(), /Template policy: clean\./);
  }));

test("runLintPrCli: gh authenticated with no open PR also skips honestly and exits 0", () =>
  withIsolatedPrEnv(async () => {
    const cap = captureConsole();
    let exitCode;
    try {
      exitCode = await runLintPrCli([], { runner: noOpenPrRunner });
    } finally {
      cap.restore();
    }
    assert.equal(exitCode, 0);
    assert.match(cap.out(), /no open PR found for this branch/);
  }));

test("runLintPrCli: gh-resolved PR body with violations still exits non-zero", () =>
  withIsolatedPrEnv(async () => {
    const runner = makeOpenPrRunner({ body: "missing every heading", baseRefName: "main", author: { login: "octocat" } });
    const cap = captureConsole();
    let exitCode;
    try {
      exitCode = await runLintPrCli([], { runner });
    } finally {
      cap.restore();
    }
    assert.equal(exitCode, 1);
    assert.match(cap.err(), /PR body missing required heading: ## Summary/);
  }));

test("runLintPrCli: restores PR_* env vars after running, even on the violation path", (t) =>
  withIsolatedPrEnv(async () => {
    process.env.PR_AUTHOR = "sentinel-value";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-pr-cli-"));
    t.after(() => rmTmpDir(tmp));
    const file = path.join(tmp, "bad-body.md");
    fs.writeFileSync(file, "no headings\n");
    const cap = captureConsole();
    try {
      await runLintPrCli(["--file", file], { runner: notInstalledRunner });
    } finally {
      cap.restore();
    }
    assert.equal(process.env.PR_AUTHOR, "sentinel-value");
  }));
