/**
 * tests/lint-commits-pr-script-entry.test.mjs — CLI-entry-guard regression.
 *
 * scripts/lint-commits-pr.mjs was refactored so lintCommits/lintPrBody/
 * getRange/isBotAuthor/reportTemplatePolicy are importable without running
 * the checks (construct lint:pr, lib/lint-pr-cli.mjs, imports it as a
 * library). This pins that the *direct-invocation* path — `node
 * scripts/lint-commits-pr.mjs`, the exact command `npm run lint:templates`
 * and CI's `template policy` job run — still prints the same messages and
 * exits with the same codes as before the refactor, and that importing the
 * module in-process (as the CLI wrapper does) never calls process.exit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execSync } from "node:child_process";

const HEAD = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

function run(env) {
  return spawnSync("node", ["scripts/lint-commits-pr.mjs"], {
    env: { ...process.env, PR_BASE_SHA: HEAD, ...env },
    encoding: "utf8",
  });
}

test("direct invocation: clean PR body + isolated empty commit range exits 0 with 'Template policy: clean.'", () => {
  const r = run({ PR_AUTHOR: "someone", PR_BODY: "" });
  assert.equal(r.status, 0, `expected clean, got:\n${r.stderr}`);
  assert.match(r.stdout, /Template policy: clean\.\n?$/);
});

test("direct invocation: violating PR body exits 1 with the exact violation block format", () => {
  const r = run({ PR_AUTHOR: "someone", PR_BODY: "no headings at all" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^\nTemplate policy violations:\n\n/);
  assert.match(r.stderr, / {2}- PR body missing required heading: ## Summary\n/);
  assert.match(r.stderr, /See \.gitmessage and \.github\/pull_request_template\.md for the required shape\.\n/);
  assert.match(r.stderr, /Run `git config commit\.template \.gitmessage` once per clone to load the commit template\.\n/);
});

test("importing the module in-process does not run the checks or call process.exit", async () => {
  // If the import guard regressed, this import alone would run lintCommits()/
  // lintPrBody() and call process.exit — which would kill the test runner
  // before the assertions below ever execute.
  const mod = await import("../scripts/lint-commits-pr.mjs");
  assert.equal(typeof mod.lintCommits, "function");
  assert.equal(typeof mod.lintPrBody, "function");
  assert.equal(typeof mod.getRange, "function");
  assert.equal(typeof mod.isBotAuthor, "function");
  assert.equal(typeof mod.reportTemplatePolicy, "function");
});

test("reportTemplatePolicy() returns 0 on empty violations and 1 with the shared format otherwise", async () => {
  const mod = await import("../scripts/lint-commits-pr.mjs");
  assert.equal(mod.reportTemplatePolicy([]), 0);
  assert.equal(mod.reportTemplatePolicy(["one violation"]), 1);
});
