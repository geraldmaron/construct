/**
 * tests/lint-commits-pr-bot-exemption.test.mjs — template-policy bot exemption.
 *
 * The `template policy` CI gate (scripts/lint-commits-pr.mjs) requires the PR
 * body to carry the human PR-template headings. A bot (dependabot, renovate)
 * cannot fill that template — its change traceability is the release notes it
 * generates — so the body check is exempt by author while the gate stays
 * hard-failing for humans. Spawning the real script with PR_BASE_SHA=HEAD pins
 * an empty commit range, isolating the PR-body check.
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

test("a dependabot PR is exempt from the PR-body-heading requirement", () => {
  const r = run({ PR_AUTHOR: "dependabot[bot]", PR_BODY: "Bumps actions/cache from 4.3.0 to 6.1.0." });
  assert.equal(r.status, 0, `expected clean, got:\n${r.stderr}`);
});

test("the exemption covers renovate and any [bot] author, case-insensitively", () => {
  for (const author of ["renovate[bot]", "renovate", "Dependabot[bot]", "some-other[bot]"]) {
    assert.equal(run({ PR_AUTHOR: author, PR_BODY: "x" }).status, 0, `${author} should be exempt`);
  }
});

test("a human author is still held to the PR-body headings", () => {
  const r = run({ PR_AUTHOR: "geraldmaron", PR_BODY: "just some text with no headings" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PR body missing required heading: ## Summary/);
});

test("a missing PR_AUTHOR still enforces the headings (fail closed, not open)", () => {
  const r = run({ PR_AUTHOR: "", PR_BODY: "no headings here" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PR body missing required heading/);
});
