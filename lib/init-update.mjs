#!/usr/bin/env node
/**
 * lib/init-update.mjs — non-destructive project-standard updates and template conflict resolution.
 *
 * `construct init:update` helps projects adopt current Construct standards without replacing
 * user-managed instruction files. Proposed updates are written under .cx/proposals/ for
 * manual review and merge.
 *
 * checkTemplateConflicts(targetDir) compares project templates against the construct install's
 * templates/docs/ directory. resolveTemplateConflict(conflict, resolution, targetDir) applies
 * one of three resolutions: keep-project, use-construct, or move-to-cx-override.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { constructDir } from "./paths.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const cwdArg = args.find((arg) => arg.startsWith("--cwd="));
const cwd = cwdArg ? path.resolve(cwdArg.split("=")[1]) : process.cwd();

const REQUIRED_AGENT_SECTIONS = [
  "Operating hierarchy",
  "Start-of-session rules",
  "Maintenance rules",
  "End-of-session rules",
  "Verification rules",
];

async function loadAgentsTemplate(projectName) {
  const modulePath = path.join(import.meta.dirname, "project-init-shared.mjs");
  const module = await import(modulePath);
  if (!module.buildAgentsGuide) {
    throw new Error("buildAgentsGuide not available from project-init-shared.mjs");
  }
  return module.buildAgentsGuide(projectName);
}

function inferProjectName(targetDir) {
  const packagePath = path.join(targetDir, "package.json");
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      if (pkg.name) return pkg.name;
    } catch { /* fall through */ }
  }
  return path.basename(targetDir);
}

function findMissingAgentsSections(content) {
  return REQUIRED_AGENT_SECTIONS.filter((section) => !content.toLowerCase().includes(section.toLowerCase()));
}

function ensureProposalDir(targetDir) {
  const dir = path.join(targetDir, ".cx", "proposals");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProposal(targetDir, fileName, content) {
  const proposalDir = ensureProposalDir(targetDir);
  const proposalPath = path.join(proposalDir, fileName);
  fs.writeFileSync(proposalPath, content, "utf8");
  return proposalPath;
}

function buildAgentsProposal(existingContent, template, missingSections) {
  const missingList = missingSections.map((section) => `- ${section}`).join("\n");
  return [
    "<!--",
    "Construct init:update proposal",
    "Review this file and merge the needed sections into AGENTS.md manually.",
    "The original AGENTS.md was not modified.",
    "-->",
    "",
    "# Proposed AGENTS.md Update",
    "",
    "## Why this proposal exists",
    "",
    "Your current `AGENTS.md` is missing these required sections:",
    missingList,
    "",
    "## Current AGENTS.md",
    "",
    "```md",
    existingContent.trimEnd(),
    "```",
    "",
    "## Current Construct template",
    "",
    "```md",
    template.trimEnd(),
    "```",
    "",
  ].join("\n");
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
 *   'move-to-cx-override' — copy project template to .cx/templates/docs/<name>,
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
    const cxOverrideDir = path.join(targetDir, '.cx', 'templates', 'docs');
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

  const agentsPath = path.join(cwd, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    console.error("AGENTS.md not found. Run `construct init` first.");
    process.exit(1);
  }

  const projectName = inferProjectName(cwd);
  const existingAgents = fs.readFileSync(agentsPath, "utf8");
  const template = await loadAgentsTemplate(projectName);
  const missingSections = findMissingAgentsSections(existingAgents);

  const planned = [];

  if (missingSections.length > 0) {
    const proposalPath = path.join(".cx", "proposals", "AGENTS.md.construct-update.md");
    planned.push({
      label: `AGENTS.md proposal (${missingSections.length} missing section${missingSections.length === 1 ? "" : "s"})`,
      write() {
        return writeProposal(cwd, "AGENTS.md.construct-update.md", buildAgentsProposal(existingAgents, template, missingSections));
      },
      relativePath: proposalPath,
    });
  }

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
          relativePath: path.join(".cx", "proposals", "ci.yml.construct-update.md"),
        });
      }
    }
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
    const proposalPath = item.write();
    console.log(`Wrote proposal: ${proposalPath}`);
  }

  console.log("");
  console.log("Review the proposal files under .cx/proposals/ and merge the needed changes manually.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
