#!/usr/bin/env node
/**
 * lib/docs-verify.mjs — comprehensive documentation validation.
 *
 * Checks:
 * 1. README.md exists and has basic sections
 * 2. AGENTS.md exists and has required sections  
 * 3. plan.md exists and is current (< 7 days)
 * 4. .cx/context.md exists and is current (< 7 days)
 * 5. docs/README.md exists (if docs system initialized)
 * 6. Required documentation lanes exist (if specified in init)
 *
 * Usage:
 *   node lib/docs-verify.mjs [--quick] [--fix] [--cwd=path]
 *   construct docs:verify [--quick] [--fix]
 */

import fs from "node:fs";
import path from "node:path";
import { statSync, readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const quickMode = args.includes("--quick");
const fixMode = args.includes("--fix");
const cwdArg = args.find(arg => arg.startsWith("--cwd="));
const cwd = cwdArg ? path.resolve(cwdArg.split("=")[1]) : process.cwd();

const errors = [];
const warnings = [];
const fixed = [];

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

function checkAgentsRequiredSections(agentsPath) {
  if (!fs.existsSync(agentsPath)) return false;
  
  try {
    const content = readFileSync(agentsPath, "utf8").toLowerCase();
    const requiredSections = [
      "operating hierarchy",
      "start-of-session rules", 
      "maintenance rules",
      "end-of-session rules",
      "verification rules"
    ];
    
    const missingSections = requiredSections.filter(section => !content.includes(section));
    
    if (missingSections.length > 0) {
      warnings.push(`AGENTS.md missing sections: ${missingSections.join(", ")} in ${path.relative(cwd, agentsPath)}`);
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
      warnings.push(`.cx/context.md missing "What was in progress" section: ${path.relative(cwd, contextPath)}`);
      return false;
    }
    if (!hasOpenIssues) {
      warnings.push(`.cx/context.md missing "Open issues" section: ${path.relative(cwd, contextPath)}`);
      return false;
    }
    
    return true;
  } catch (err) {
    warnings.push(`Cannot read .cx/context.md: ${path.relative(cwd, contextPath)} (${err.message})`);
    return false;
  }
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

Construct routes work across specialists, maintains project state, and ensures quality gates pass before shipping.

## Project Structure

- \`AGENTS.md\` — Operating contract for AI agents
- \`plan.md\` — Current implementation plan
- \`.cx/context.md\` — Session context and handoff state
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
- .cx/context.md must track active work`;
  
  fs.writeFileSync(readmePath, content, "utf8");
  fixed.push(`Created README.md: ${path.relative(cwd, readmePath)}`);
  return true;
}

function attemptFixStaleContext() {
  const contextPath = path.join(cwd, ".cx", "context.md");
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
    fixed.push(`Updated .cx/context.md timestamp: ${path.relative(cwd, contextPath)}`);
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
  checkExists(path.join(cwd, "plan.md"), "plan.md", true);
  checkExists(path.join(cwd, ".cx", "context.md"), ".cx/context.md", true);
  
  // Age checks (fail CI if stale)
  checkFileAge(path.join(cwd, "plan.md"), 7, "plan.md", true);
  checkFileAge(path.join(cwd, ".cx", "context.md"), 7, ".cx/context.md", true);
  
  if (!quickMode) {
    // Detailed checks (warnings only)
    checkReadmeBasicSections(path.join(cwd, "README.md"));
    checkAgentsRequiredSections(path.join(cwd, "AGENTS.md"));
    checkPlanLinkedToIssues(path.join(cwd, "plan.md"));
    checkContextHasProgress(path.join(cwd, ".cx", "context.md"));
    checkDocsSystem(path.join(cwd, "docs"));
    
    // Age warning for README.md (30 days)
    checkFileAge(path.join(cwd, "README.md"), 30, "README.md", false);
  }
  
  // Attempt fixes if requested
  if (fixMode) {
    if (errors.some(e => e.includes("Missing README.md"))) {
      attemptFixMissingReadme();
    }
    if (errors.some(e => e.includes("Stale .cx/context.md"))) {
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
  
  console.log("✅ Documentation validation passed with warnings");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  checkExists,
  checkFileAge,
  checkReadmeBasicSections,
  checkAgentsRequiredSections,
  checkPlanLinkedToIssues,
  checkContextHasProgress,
  checkDocsSystem,
  attemptFixMissingReadme,
  attemptFixStaleContext
};