#!/usr/bin/env node
/**
 * lib/init.mjs — bootstrap Construct project state in an existing repo.
 *
 * This is intentionally separate from `init-docs`: `construct init` creates the
 * baseline agent/workflow context for a repo, while `construct init-docs`
 * stands up a documentation system and lane-specific templates.
 *
 * Usage:
 *   node lib/init.mjs [target-path]
 *   construct init [path]
 */

import fs from "node:fs";
import path from "node:path";

import {
  buildAgentsGuide,
  buildContextJson,
  buildContextMarkdown,
  buildPlanTemplate,
  writeStampedIfMissing,
} from "./project-init-shared.mjs";

const args = process.argv.slice(2);
const targetArg = args.find((arg) => !arg.startsWith("--"));
const target = path.resolve(targetArg ?? process.cwd());

const created = [];
const skipped = [];

function inferProjectName(targetPath) {
  const packageJsonPath = path.join(targetPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      return pkg.name || path.basename(targetPath);
    } catch {}
  }
  return path.basename(targetPath);
}

function main() {
  const projectName = inferProjectName(target);

  writeStampedIfMissing({
    targetRoot: target,
    created,
    skipped,
    filePath: path.join(target, "AGENTS.md"),
    content: buildAgentsGuide(projectName),
    generator: "construct/init",
  });
  writeStampedIfMissing({
    targetRoot: target,
    created,
    skipped,
    filePath: path.join(target, "plan.md"),
    content: buildPlanTemplate(),
    generator: "construct/init",
  });
  writeStampedIfMissing({
    targetRoot: target,
    created,
    skipped,
    filePath: path.join(target, ".cx", "context.json"),
    content: buildContextJson(projectName),
    generator: "construct/init",
  });
  writeStampedIfMissing({
    targetRoot: target,
    created,
    skipped,
    filePath: path.join(target, ".cx", "context.md"),
    content: buildContextMarkdown(),
    generator: "construct/init",
  });
  writeStampedIfMissing({
    targetRoot: target,
    created,
    skipped,
    filePath: path.join(target, ".cx", ".gitkeep"),
    content: "",
    generator: "construct/init",
  });
  writeStampedIfMissing({
    targetRoot: target,
    created,
    skipped,
    filePath: path.join(target, ".cx", "inbox", ".gitkeep"),
    content: "",
    generator: "construct/init",
  });

  process.stdout.write(`\nConstruct init → ${target}\n\n`);
  if (created.length) {
    process.stdout.write("Created:\n");
    for (const file of created) process.stdout.write(`  + ${file}\n`);
  }
  if (skipped.length) {
    process.stdout.write("\nSkipped (already exist):\n");
    for (const file of skipped) process.stdout.write(`  ~ ${file}\n`);
  }
  process.stdout.write(`\n${created.length} created, ${skipped.length} skipped.\n`);
}

main();
