/**
 * init-update.test.mjs — non-destructive update flow for construct init:update.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

function runInitUpdate(cwd, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, "lib", "init-update.mjs"), ...args],
    {
      cwd,
      encoding: "utf8",
      env: process.env,
    },
  );
}

test("construct init:update writes proposals instead of overwriting AGENTS.md", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-init-update-"));
  try {
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));
    fs.writeFileSync(
      path.join(projectDir, "AGENTS.md"),
      [
        "# Demo Agent Guide",
        "",
        "## Operating hierarchy",
        "",
        "- Keep work tracked.",
      ].join("\n"),
    );

    const before = fs.readFileSync(path.join(projectDir, "AGENTS.md"), "utf8");
    const result = runInitUpdate(projectDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const after = fs.readFileSync(path.join(projectDir, "AGENTS.md"), "utf8");
    assert.equal(after, before, "AGENTS.md should not be overwritten in place");

    const proposalPath = path.join(projectDir, ".cx", "proposals", "AGENTS.md.construct-update.md");
    assert.equal(fs.existsSync(proposalPath), true);
    assert.match(fs.readFileSync(proposalPath, "utf8"), /Proposed AGENTS\.md Update/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("construct init:update dry-run reports proposals without writing files", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-init-update-dry-"));
  try {
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));
    fs.writeFileSync(path.join(projectDir, "AGENTS.md"), "# Demo\n");

    const result = runInitUpdate(projectDir, ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Planned proposals:/);
    assert.equal(fs.existsSync(path.join(projectDir, ".cx", "proposals")), false);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
