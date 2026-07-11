#!/usr/bin/env node
/**
 * lib/init-update.mjs — non-destructive project-standard updates and template conflict resolution.
 *
 * `construct init:update` helps projects adopt current Construct standards without replacing
 * user-managed instruction files. Proposed updates are written under .construct/proposals/ for
 * manual review and merge. Stale `.construct/construct_guide.md` copies can be refreshed via
 * `--apply-guide`.
 *
 * checkTemplateConflicts(targetDir) compares project templates against the construct install's
 * templates/docs/ directory. resolveTemplateConflict(conflict, resolution, targetDir) applies
 * one of three resolutions: keep-project, use-construct, or move-to-cx-override.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { constructDir } from "./paths.mjs";
import { configPath, CONFIG_DIR_NAME } from "./config-dir.mjs";
import {
  applyConstructGuideUpdate,
  needsConstructGuideUpdate,
  writeConstructGuideProposal,
} from "./init-update-guide.mjs";
import { isMainModule } from './roots.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const applyGuide = args.includes("--apply-guide");
const cwdArg = args.find((arg) => arg.startsWith("--cwd="));
const cwd = cwdArg ? path.resolve(cwdArg.split("=")[1]) : process.cwd();

function ensureProposalDir(targetDir) {
  const dir = configPath(targetDir, "proposals");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProposal(targetDir, fileName, content) {
  const proposalDir = ensureProposalDir(targetDir);
  const proposalPath = path.join(proposalDir, fileName);
  fs.writeFileSync(proposalPath, content, "utf8");
  return proposalPath;
}

function buildWorkflowProposal(existingContent) {
  const updatedContent = existingContent.replace(
    /(\s+- run: node bin\/construct doctor\s*\n)/,
    "$1      - run: node bin/construct docs:verify\n",
  );
  if (updatedContent === existingContent) return null;
  return [
    "# Proposed CI Workflow Update",
    "",
    "Add `construct docs:verify` next to the existing doctor check.",
    "",
    "```yaml",
    updatedContent.trimEnd(),
    "```",
    "",
  ].join("\n");
}

// ── Template conflict detection ───────────────────────────────────────────────

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Compare project templates against the construct install's templates/docs/ directory.
 *
 * @param {string} targetDir — project root to inspect
 * @returns {{ conflicts: Array<{ name, constructPath, projectPath, constructSha, projectSha }>, identical: string[], missing: string[] }}
 */
export function checkTemplateConflicts(targetDir) {
  const constructTemplatesDir = path.join(constructDir(), 'templates', 'docs');
  const projectTemplatesDir = path.join(targetDir, 'templates', 'docs');

  const conflicts = [];
  const identical = [];
  const missing = [];

  if (!fs.existsSync(constructTemplatesDir)) {
    return { conflicts, identical, missing };
  }

  const constructFiles = fs.readdirSync(constructTemplatesDir).filter((f) => f.endsWith('.md'));

  for (const name of constructFiles) {
    const constructPath = path.join(constructTemplatesDir, name);
    const projectPath = path.join(projectTemplatesDir, name);

    if (!fs.existsSync(projectPath)) {
      missing.push(name);
      continue;
    }

    const constructSha = sha256File(constructPath);
    const projectSha = sha256File(projectPath);

    if (constructSha === projectSha) {
      identical.push(name);
    } else {
      conflicts.push({ name, constructPath, projectPath, constructSha, projectSha });
    }
  }

  return { conflicts, identical, missing };
}

/**
 * Apply a resolution to a single template conflict.
 *
 * Resolutions:
 *   'keep-project'       — do nothing; leave the project template as-is
 *   'use-construct'      — overwrite project template with construct's version; backup original to <name>.bak
 *   'move-to-cx-override' — copy project template to .construct/templates/docs/<name>,
 *                           then write construct's template to templates/docs/<name>
 *
 * @param {{ name, constructPath, projectPath, constructSha, projectSha }} conflict
 * @param {'keep-project'|'use-construct'|'move-to-cx-override'} resolution
 * @param {string} targetDir
 */
export function resolveTemplateConflict(conflict, resolution, targetDir) {
  const { name, constructPath, projectPath } = conflict;

  if (resolution === 'keep-project') {
    return;
  }

  if (resolution === 'use-construct') {
    const backupPath = `${projectPath}.bak`;
    fs.copyFileSync(projectPath, backupPath);
    fs.copyFileSync(constructPath, projectPath);
    return;
  }

  if (resolution === 'move-to-cx-override') {
    const cxOverrideDir = configPath(targetDir, 'templates', 'docs');
    fs.mkdirSync(cxOverrideDir, { recursive: true });
    fs.copyFileSync(projectPath, path.join(cxOverrideDir, name));
    fs.copyFileSync(constructPath, projectPath);
    return;
  }

  throw new Error(`Unknown resolution: ${resolution}. Expected keep-project, use-construct, or move-to-cx-override.`);
}

// ── Init update workflow ──────────────────────────────────────────────────────

async function main() {
  console.log(`Preparing Construct standards update for ${cwd}`);

  const planned = [];

  // Construct's guidance in AGENTS.md/CLAUDE.md is owned by the versioned
  // CONSTRUCT INTEGRATION marker block, kept current by `construct sync`
  // (ADR-0027 §2/§4). init:update scope is opt-in standards a project owner
  // merges by hand: CI checks and template conflicts.

  const workflowPath = path.join(cwd, ".github", "workflows", "ci.yml");
  if (fs.existsSync(workflowPath)) {
    const workflowContent = fs.readFileSync(workflowPath, "utf8");
    if (!workflowContent.includes("node bin/construct docs:verify")) {
      const proposal = buildWorkflowProposal(workflowContent);
      if (proposal) {
        planned.push({
          label: "CI workflow proposal (add docs:verify)",
          write() {
            return writeProposal(cwd, "ci.yml.construct-update.md", proposal);
          },
          relativePath: path.join(CONFIG_DIR_NAME, "proposals", "ci.yml.construct-update.md"),
        });
      }
    }
  }

  const guideState = needsConstructGuideUpdate(cwd);
  if (guideState.needed) {
    planned.push({
      label: "construct_guide.md refresh (profile-neutral intake language)",
      write() {
        return writeConstructGuideProposal(cwd, guideState);
      },
      relativePath: path.join(CONFIG_DIR_NAME, "proposals", "construct_guide.construct-update.md"),
      applyGuide: () => applyConstructGuideUpdate(cwd, guideState.shipped),
    });
  }

  if (planned.length === 0) {
    console.log("No proposals needed. The project already satisfies the current update checks.");
    return;
  }

  console.log("");
  console.log("Planned proposals:");
  for (const item of planned) {
    console.log(`  - ${item.label} -> ${item.relativePath}`);
  }

  if (dryRun) {
    console.log("");
    console.log("Dry run only. No files were written.");
    return;
  }

  console.log("");
  for (const item of planned) {
    if (applyGuide && item.applyGuide) {
      const dest = item.applyGuide();
      console.log(`Applied construct_guide.md refresh: ${dest} (backup: ${dest}.bak when prior .cx copy existed)`);
      continue;
    }
    const proposalPath = item.write();
    console.log(`Wrote proposal: ${proposalPath}`);
  }

  if (applyGuide) {
    console.log("");
    console.log("Guide refresh applied. Review .construct/construct_guide.md and restore any team-specific notes from .bak if needed.");
    return;
  }

  console.log("");
  console.log("Review the proposal files under .construct/proposals/ and merge the needed changes manually.");
  console.log("To replace .construct/construct_guide.md with the shipped template: construct init:update --apply-guide");
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
