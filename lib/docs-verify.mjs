#!/usr/bin/env node
/**
 * lib/docs-verify.mjs — comprehensive documentation validation.
 *
 * Checks:
 * 1. README.md exists and has basic sections
 * 2. AGENTS.md exists and has required sections
 * 3. plan.md exists and is current (< 7 days)
 * 4. .construct/context.md is current (< 7 days, critical when .construct/ exists). Verifier
 *    reconstitutes the file from the init template when .construct/ exists but the
 *    file does not — invariant enforcement is centralized here.
 * 5. docs/README.md exists (if docs system initialized)
 * 6. Required documentation lanes exist (if specified in init)
 *
 * Usage:
 *   node lib/docs-verify.mjs [--quick] [--fix] [--cwd=path]
 *   construct docs:verify [--quick] [--fix]
 */

import fs from "node:fs";
import path from "node:path";
import { statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { hasIntakeReference } from "./intake/traceability.mjs";
import { ensureCxDir } from "./project-init-shared.mjs";
import { projectConfigDir, configPath, CONFIG_DIR_NAME } from "./config-dir.mjs";
import { isMainModule } from './roots.mjs';

const args = process.argv.slice(2);
const quickMode = args.includes("--quick");
const fixMode = args.includes("--fix");
const stagedMode = args.includes("--staged");
const strictMode = args.includes("--strict") || process.env.CI === 'true';
const cwdArg = args.find(arg => arg.startsWith("--cwd="));
const cwd = cwdArg ? path.resolve(cwdArg.split("=")[1]) : process.cwd();

const errors = [];
const warnings = [];
const fixed = [];

if (stagedMode) {
  const { execSync } = await import("node:child_process");
  let stagedList = "";
  try {
    stagedList = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd, timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    process.exit(0);
  }
  const files = stagedList.split("\n").map((s) => s.trim()).filter(Boolean);
  const codeRe = /^(?:lib|bin|src|app)\/.*\.(?:m?js|jsx?|tsx?|cjs)$/;
  const docRe = /^(?:CHANGELOG\.md|docs\/.+\.md|\.construct\/context\.(?:md|json))$/;
  const changedCode = files.filter((f) => codeRe.test(f));
  const changedDocs = files.filter((f) => docRe.test(f));
  if (changedCode.length === 0) process.exit(0);
  if (changedDocs.length > 0) process.exit(0);

  const sample = changedCode.slice(0, 6).map((f) => `  - ${f}`).join("\n");
  process.stderr.write(
    `[docs:verify --staged] ${changedCode.length} code file(s) staged but no CHANGELOG.md / docs/* / .construct/context.* updates.\n` +
    `${sample}${changedCode.length > 6 ? `\n  ... (${changedCode.length - 6} more)` : ""}\n` +
    `Update docs in this commit before pushing.\n`,
  );
  process.exit(1);
}

function checkExists(filePath, description, isCritical = true) {
  if (!fs.existsSync(filePath)) {
    const msg = `Missing ${description}: ${path.relative(cwd, filePath)}`;
    if (isCritical) errors.push(msg);
    else warnings.push(msg);
    return false;
  }
  return true;
}

function checkFileAge(filePath, maxDays, description, isCritical = true) {
  if (!fs.existsSync(filePath)) return false;
  
  try {
    const stats = statSync(filePath);
    const ageDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
    
    if (ageDays > maxDays) {
      const msg = `Stale ${description}: ${path.relative(cwd, filePath)} (last modified ${Math.floor(ageDays)} days ago, max ${maxDays} days)`;
      if (isCritical) errors.push(msg);
      else warnings.push(msg);
      return false;
    }
    return true;
  } catch (err) {
    const msg = `Cannot read ${description}: ${path.relative(cwd, filePath)} (${err.message})`;
    if (isCritical) errors.push(msg);
    else warnings.push(msg);
    return false;
  }
}

function checkReadmeBasicSections(readmePath) {
  if (!fs.existsSync(readmePath)) return false;
  
  try {
    const content = readFileSync(readmePath, "utf8").toLowerCase();
    const hasGettingStarted = content.includes("getting started") || content.includes("## getting started");
    const hasUsage = content.includes("usage") || content.includes("## usage");
    const hasConstruct = content.includes("construct");
    
    if (!hasGettingStarted) {
      warnings.push(`README.md missing "Getting Started" section: ${path.relative(cwd, readmePath)}`);
      return false;
    }
    if (!hasUsage) {
      warnings.push(`README.md missing "Usage" section: ${path.relative(cwd, readmePath)}`);
      return false;
    }
    if (!hasConstruct) {
      warnings.push(`README.md doesn't mention Construct: ${path.relative(cwd, readmePath)}`);
      return false;
    }
    
    return true;
  } catch (err) {
    warnings.push(`Cannot read README.md: ${path.relative(cwd, readmePath)} (${err.message})`);
    return false;
  }
}

// AGENTS.md is user-owned: a host project carries bd's skeleton
// plus Construct's fenced integration block, while the meta-repo carries its own
// hand-written contract. Neither has a fixed section list, so verify substance —
// a heading and a non-trivial body past any frontmatter — not a prescribed shape.

function checkAgentsPresent(agentsPath) {
  if (!fs.existsSync(agentsPath)) return false;

  try {
    const content = readFileSync(agentsPath, "utf8");
    const body = content.replace(/^---[\s\S]*?\n---\s*/, "").trim();

    if (!/^#\s/m.test(body) || body.length < 40) {
      warnings.push(`AGENTS.md is empty or lacks a usable agent guide: ${path.relative(cwd, agentsPath)}`);
      return false;
    }

    return true;
  } catch (err) {
    warnings.push(`Cannot read AGENTS.md: ${path.relative(cwd, agentsPath)} (${err.message})`);
    return false;
  }
}

function checkPlanLinkedToIssues(planPath) {
  if (!fs.existsSync(planPath)) return false;
  
  try {
    const content = readFileSync(planPath, "utf8");
    // Check if plan mentions any issue tracker format (construct-xxx, beads issue, etc.)
    const hasIssueRef = /construct-\w{3}|bd\s+issue|beads\s+issue|tracker\s+link|issue:\s*\w+/i.test(content);
    
    if (!hasIssueRef) {
      warnings.push(`plan.md doesn't appear linked to tracker issues: ${path.relative(cwd, planPath)}`);
      return false;
    }
    
    return true;
  } catch (err) {
    warnings.push(`Cannot read plan.md: ${path.relative(cwd, planPath)} (${err.message})`);
    return false;
  }
}

function checkContextHasProgress(contextPath) {
  if (!fs.existsSync(contextPath)) return false;
  
  try {
    const content = readFileSync(contextPath, "utf8").toLowerCase();
    const hasProgress = content.includes("what was in progress") || content.includes("## what was in progress");
    const hasOpenIssues = content.includes("open issues") || content.includes("## open issues");
    
    if (!hasProgress) {
      warnings.push(`.construct/context.md missing "What was in progress" section: ${path.relative(cwd, contextPath)}`);
      return false;
    }
    if (!hasOpenIssues) {
      warnings.push(`.construct/context.md missing "Open issues" section: ${path.relative(cwd, contextPath)}`);
      return false;
    }
    
    return true;
  } catch (err) {
    warnings.push(`Cannot read .construct/context.md: ${path.relative(cwd, contextPath)} (${err.message})`);
    return false;
  }
}

// Surfaces drift: artifacts under intake-fed locations that lack an
// intake_id / intake: none frontmatter reference. Advisory (warning) because
// not every artifact necessarily comes from an intake packet — but the absence
// is a flag for the operator to either stamp the provenance or declare it
// intake-independent.
function gitTrackedMdFiles(cwd, dir) {
  if (!fs.existsSync(dir)) return [];
  const rel = path.relative(cwd, dir).split(path.sep).join('/');
  const result = spawnSync('git', ['ls-files', '--', `${rel}/`], { cwd, encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .filter((line) => line.endsWith('.md') && !line.endsWith('/README.md'))
    .map((line) => path.join(cwd, line));
}

function checkIntakeTraceability(cwd) {
  const intakeFedDirs = [
    path.join(cwd, 'docs', 'specs', 'prd'),
    path.join(cwd, 'docs', 'prd'),
    path.join(cwd, 'docs', 'notes', 'research'),
    path.join(cwd, 'docs', 'research'),
    configPath(cwd, 'knowledge', 'internal'),
  ];
  let inspected = 0;
  for (const dir of intakeFedDirs) {
    const files = gitTrackedMdFiles(cwd, dir);
    for (const filePath of files) {
      const base = path.basename(filePath);
      if (base.startsWith('_')) continue;
      inspected += 1;
      if (!hasIntakeReference(filePath)) {
        warnings.push(
          `Intake traceability: ${path.relative(cwd, filePath)} lacks intake_id or "intake: none" in frontmatter — stamp via \`construct intake done <id> --output\` or declare intake-independent.`,
        );
      }
    }
  }
  return inspected;
}

function checkDocsSystem(docsPath) {
  if (!fs.existsSync(docsPath)) {
    // docs/ directory doesn't exist, which is fine if project doesn't use docs system
    return true;
  }
  
  try {
    const docsReadmePath = path.join(docsPath, "README.md");
    if (!fs.existsSync(docsReadmePath)) {
      warnings.push(`docs/ directory exists but docs/README.md is missing: ${path.relative(cwd, docsReadmePath)}`);
      return false;
    }
    
    // Check if docs/ has subdirectories that should have README.md
    const entries = fs.readdirSync(docsPath, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith("."));
    
    for (const dir of dirs) {
      const dirReadmePath = path.join(docsPath, dir.name, "README.md");
      if (!fs.existsSync(dirReadmePath)) {
        warnings.push(`docs/${dir.name}/ directory exists but docs/${dir.name}/README.md is missing: ${path.relative(cwd, dirReadmePath)}`);
      }
    }
    
    return true;
  } catch (err) {
    warnings.push(`Cannot inspect docs/ directory: ${path.relative(cwd, docsPath)} (${err.message})`);
    return false;
  }
}

function attemptFixMissingReadme() {
  const readmePath = path.join(cwd, "README.md");
  if (fs.existsSync(readmePath)) return false;
  
  const projectName = path.basename(cwd);
  const packageJsonPath = path.join(cwd, "package.json");
  let name = projectName;
  
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      name = pkg.name || projectName;
    } catch {}
  }
  
  const content = `# ${name}

## Getting Started

This project uses [Construct](https://github.com/geraldmaron/construct) for agentic software development.

## Usage

From inside OpenCode, Claude Code, or similar agent surfaces:

\`\`\`text
@construct build the feature and ship it when it's verified
@construct fix the bug  
@construct review the changes before release
\`\`\`

Construct routes work across Worker Profiles, maintains project state, and ensures quality gates pass before shipping.

## Project Structure

- \`AGENTS.md\` — Operating contract for AI agents
- \`plan.md\` — Current implementation plan
- \`.construct/context.md\` — Session context and handoff state
- \`docs/\` — Documentation system (if initialized with \`construct init --docs-preset\`)

## Development

\`\`\`bash
# Initialize project with Construct
construct init --docs-preset=lean

# Check documentation quality
construct docs:verify

# Run tests
npm test
\`\`\`

## CI Enforcement

This project enforces documentation quality:
- README.md must exist and be current
- AGENTS.md must have required sections
- plan.md must be updated weekly
- .construct/context.md must track active work`;
  
  fs.writeFileSync(readmePath, content, "utf8");
  fixed.push(`Created README.md: ${path.relative(cwd, readmePath)}`);
  return true;
}

function attemptFixStaleContext() {
  const contextPath = configPath(cwd, "context.md");
  if (!fs.existsSync(contextPath)) return false;
  
  try {
    const content = readFileSync(contextPath, "utf8");
    const now = new Date().toISOString().split("T")[0];
    
    // Add or update timestamp at top
    const lines = content.split("\n");
    let foundTimestamp = false;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes("last saved") || lines[i].toLowerCase().includes("last updated")) {
        lines[i] = `Last saved: ${now}`;
        foundTimestamp = true;
        break;
      }
    }
    
    if (!foundTimestamp && lines.length > 0) {
      lines.splice(1, 0, `Last saved: ${now}`);
    }
    
    fs.writeFileSync(contextPath, lines.join("\n"), "utf8");
    fixed.push(`Updated .construct/context.md timestamp: ${path.relative(cwd, contextPath)}`);
    return true;
  } catch (err) {
    return false;
  }
}

function main() {
  console.log(`\n📄 Documentation verification for ${path.relative(process.cwd(), cwd) || "."}\n`);
  
  // Critical checks (fail CI)
  checkExists(path.join(cwd, "README.md"), "README.md", true);
  checkExists(path.join(cwd, "AGENTS.md"), "AGENTS.md", true);

  // .construct/context.md invariant. The verifier is the canonical enforcer: if .construct/
  // exists but context.md does not, the file is reconstituted from the init
  // template here. This is consistent with construct init (which creates both
  // together) and absorbs the case where a subsystem creates a .construct/ subdirectory
  // for operational reasons without going through ensureCxDir. CI starts with
  // no .construct/ at all (gitignored) so the block is skipped entirely. Staleness
  // remains critical — a context.md older than 7 days indicates sessions that
  // are running without keeping the handoff state current, which is the real
  // bug the gate exists to catch.
  const constructDir = projectConfigDir(cwd);
  const contextMdPath = path.join(constructDir, "context.md");
  const constructExists = fs.existsSync(constructDir);
  if (constructExists) {
    if (!fs.existsSync(contextMdPath)) {
      ensureCxDir(cwd);
    }
    checkFileAge(contextMdPath, 7, `${CONFIG_DIR_NAME}/context.md`, true);
  }

  // plan.md is a local working document — gitignored, not committed.
  // Verify it's healthy when present, but don't fail when it's absent.
  const planExists = fs.existsSync(path.join(cwd, "plan.md"));

  // Age checks (fail CI if stale)
  if (planExists) checkFileAge(path.join(cwd, "plan.md"), 7, "plan.md", true);

  if (!quickMode) {
    // Detailed checks (warnings only)
    checkReadmeBasicSections(path.join(cwd, "README.md"));
    checkAgentsPresent(path.join(cwd, "AGENTS.md"));
    if (planExists) checkPlanLinkedToIssues(path.join(cwd, "plan.md"));
    if (constructExists && fs.existsSync(contextMdPath)) checkContextHasProgress(contextMdPath);
    checkDocsSystem(path.join(cwd, "docs"));
    checkIntakeTraceability(cwd);

    // Age warning for README.md (30 days)
    checkFileAge(path.join(cwd, "README.md"), 30, "README.md", false);
  }
  
  // Attempt fixes if requested
  if (fixMode) {
    if (errors.some(e => e.includes("Missing README.md"))) {
      attemptFixMissingReadme();
    }
    if (errors.some(e => e.includes(`Stale ${CONFIG_DIR_NAME}/context.md`))) {
      attemptFixStaleContext();
    }
  }
  
  // Output results
  if (fixed.length > 0) {
    console.log("✅ Fixed:");
    for (const fix of fixed) {
      console.log(`  • ${fix}`);
    }
    console.log();
  }
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log("🎉 All documentation checks passed!");
    process.exit(0);
  }
  
  if (warnings.length > 0) {
    console.log("⚠️  Warnings:");
    for (const warning of warnings) {
      console.log(`  • ${warning}`);
    }
    console.log();
  }
  
  if (errors.length > 0) {
    console.log("❌ Critical errors (CI will fail):");
    for (const error of errors) {
      console.log(`  • ${error}`);
    }
    console.log();
    console.log("💡 Run `construct docs:verify --fix` to attempt automatic fixes");
    console.log("💡 Run `construct init:update` to update project to current standards");
    process.exit(1);
  }

  if (strictMode && warnings.length > 0) {
    console.log("❌ Strict mode: warnings are blocking:");
    for (const warning of warnings) {
      console.log(`  • ${warning}`);
    }
    process.exit(1);
  }
  
  console.log("✅ Documentation validation passed with warnings");
  process.exit(0);
}

if (isMainModule(import.meta.url)) {
  main();
}

export {
  checkExists,
  checkFileAge,
  checkReadmeBasicSections,
  checkAgentsPresent,
  checkPlanLinkedToIssues,
  checkContextHasProgress,
  checkDocsSystem,
  attemptFixMissingReadme,
  attemptFixStaleContext
};
