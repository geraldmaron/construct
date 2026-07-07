/**
 * init-update.test.mjs — non-destructive update flow for construct init:update.
 *
 * Construct's AGENTS.md/CLAUDE.md guidance is owned by the versioned CONSTRUCT
 * INTEGRATION marker block (kept current by `construct sync`, ADR-0027 §2/§4).
 * init:update leaves AGENTS.md bodies untouched; its scope is opt-in standards a
 * project owner merges by hand: CI checks and template conflicts.
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

function writeCiWorkflow(projectDir) {
  const wfDir = path.join(projectDir, ".github", "workflows");
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, "ci.yml"),
    ["jobs:", "  docs:", "    steps:", "      - run: node bin/construct doctor", ""].join("\n"),
  );
}

test("construct init:update proposes a CI docs:verify check without rewriting AGENTS.md", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-init-update-"));
  try {
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));
    const agents = "# Demo Agent Guide\n\nHouse rules go here.\n";
    fs.writeFileSync(path.join(projectDir, "AGENTS.md"), agents);
    writeCiWorkflow(projectDir);

    const result = runInitUpdate(projectDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(fs.readFileSync(path.join(projectDir, "AGENTS.md"), "utf8"), agents, "AGENTS.md must not be rewritten");
    assert.equal(
      fs.existsSync(path.join(projectDir, ".construct", "proposals", "AGENTS.md.construct-update.md")),
      false,
      "init:update must not propose an AGENTS.md body rewrite",
    );

    const ciProposal = path.join(projectDir, ".construct", "proposals", "ci.yml.construct-update.md");
    assert.equal(fs.existsSync(ciProposal), true, "a CI proposal should be written");
    assert.match(fs.readFileSync(ciProposal, "utf8"), /docs:verify/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("construct init:update reports no proposals when standards are already met", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-init-update-clean-"));
  try {
    fs.writeFileSync(path.join(projectDir, "AGENTS.md"), "# Demo\n\nBody.\n");

    const result = runInitUpdate(projectDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /No proposals needed/);
    assert.equal(fs.existsSync(path.join(projectDir, ".construct", "proposals")), false);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("construct init:update dry-run reports proposals without writing files", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-init-update-dry-"));
  try {
    writeCiWorkflow(projectDir);

    const result = runInitUpdate(projectDir, ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Planned proposals:/);
    assert.equal(fs.existsSync(path.join(projectDir, ".construct", "proposals")), false);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("construct init:update proposes construct_guide refresh for stale .cx copy", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-init-update-guide-"));
  try {
    fs.mkdirSync(path.join(projectDir, ".construct"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".construct", "construct_guide.md"),
      "# Welcome\n\nR&D intake queue instructions.\n",
    );

    const result = runInitUpdate(projectDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const proposal = path.join(projectDir, ".construct", "proposals", "construct_guide.construct-update.md");
    assert.equal(fs.existsSync(proposal), true);
    assert.match(fs.readFileSync(proposal, "utf8"), /construct intake --help/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
