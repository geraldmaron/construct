#!/usr/bin/env node
/**
 * lib/init-unified.mjs — unified bootstrap for Construct project state and documentation system.
 *
 * Replaces both `construct init` and `construct init-docs`.
 *
 * Usage:
 *   node lib/init-unified.mjs [target-path] [--docs-preset=lean|product|full] [--docs-lanes=adrs,prds] [--with-architecture] [--with-readme]
 *   construct init [path] [--docs-preset=lean|product|full] [--docs-lanes=adrs,prds] [--with-architecture] [--with-readme]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAgentsGuide,
  buildContextJson,
  buildContextMarkdown,
  buildPlanTemplate,
  writeStampedIfMissing,
} from "./project-init-shared.mjs";
import { multiSelect } from './tty-prompts.mjs';
import { execSync, spawnSync } from 'node:child_process';
import { stageProjectAdapters } from './install/stage-project.mjs';

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT_DIR, "templates", "docs");

const args = process.argv.slice(2);
const targetArg = args.find((arg) => !arg.startsWith("--"));
const target = path.resolve(targetArg ?? process.cwd());

// Documentation flags - granular control
const withDocsFlag = args.find((arg) => arg.startsWith("--with-docs="));
const withAllDocsFlag = args.includes("--with-all-docs");
const withAdrsFlag = args.includes("--with-adrs");
const withRfcsFlag = args.includes("--with-rfcs");
const withRunbooksFlag = args.includes("--with-runbooks");
const withPostmortemsFlag = args.includes("--with-postmortems");
const withArchitectureFlag = args.includes("--with-architecture");
const withReadmeFlag = args.includes("--with-readme");
const withDevcontainerFlag = args.includes("--devcontainer");

// Behavior flags
const verbose = args.includes("--verbose") || args.includes("-v");
const interactive = args.includes("--interactive") || args.includes("-i");
const quiet = args.includes("--quiet") || args.includes("-q");
const skipInteractive = !interactive;

const created = [];
const skipped = [];

async function confirm(question) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim() !== 'n');
    });
  });
}

async function checkPrerequisites() {
  const { checkPrerequisites: sharedCheck } = await import('./health-check.mjs');
  const os = await import('node:os');
  const homeDir = os.homedir();
  
  const result = await sharedCheck({ 
    interactive: true, 
    homeDir 
  });
  
  if (!result.ok) {
    console.log('\n💡 Run `construct install --yes` to install missing dependencies automatically.');
    
    const runInstall = await confirm('\n🔧 Run `construct install` now? [Y/n] ');
    if (runInstall) {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'construct'), 'install', '--yes'], {
        stdio: 'inherit',
        env: process.env,
      });
      
      if (result.status !== 0) {
        console.log('\n⚠️  Install did not complete successfully. You can run `construct install` manually later.');
        const continueAnyway = await confirm('\nContinue with project initialization anyway? [y/N] ');
        if (!continueAnyway) {
          process.exit(1);
        }
      } else {
        console.log('\n✅ Install complete! Continuing with project initialization...\n');
      }
    } else {
      console.log('\n⏭️  Skipping install. You can run `construct install` later.');
      const continueAnyway = await confirm('\nContinue with project initialization anyway? [y/N] ');
      if (!continueAnyway) {
        process.exit(1);
      }
    }
  }
  
  return result.ok;
}

// Documentation system configuration
const DOC_LANES = {
  adrs: {
    title: "ADRs",
    dir: "adr",
    description: "Architecture decision records for decisions that have already been made.",
    templates: ["adr.md"],
  },
  briefs: {
    title: "Briefs",
    dir: "briefs",
    description: "Research, evidence, signal, and one-pager style documents.",
    templates: [
      "research-brief.md",
      "evidence-brief.md",
      "signal-brief.md",
      "one-pager.md",
      "customer-profile.md",
      "product-intelligence-report.md",
      "backlog-proposal.md",
    ],
  },
  changelogs: {
    title: "Changelogs",
    dir: "changelogs",
    description: "User-facing release notes and version history entries.",
    templates: ["changelog-entry.md"],
  },
  intake: {
    title: "Intake",
    dir: "intake",
    description: "Intake batch records that explain what arrived, why it matters, and how it should be ingested.",
    templates: ["__intake-template__"],
  },
  memos: {
    title: "Memos",
    dir: "memos",
    description: "Decision memos and internal arguments for alignment and approval.",
    templates: ["memo.md"],
  },
  meetings: {
    title: 'Meetings',
    dir: 'meetings',
    description: 'Meeting notes, minutes, retros, standups, planning sessions, and agendas.',
    templates: ['__meeting-notes-template__'],
  },
  notes: {
    title: "Notes",
    dir: "notes",
    description: "Working notes and lightweight durable context outside formal docs or meetings.",
    templates: ["__notes-template__"],
  },
  onboarding: {
    title: "Onboarding",
    dir: "onboarding",
    description: "Runnable setup guides and first-day workflows for engineers, product, or ops.",
    templates: ["onboarding.md"],
  },
  postmortems: {
    title: "Postmortems",
    dir: "postmortems",
    description: "Blameless incident reports: timeline, root cause, contributing factors, and corrective actions.",
    templates: ["incident-report.md"],
  },
  prds: {
    title: "PRDs",
    dir: "prds",
    description: "Product and capability requirement documents.",
    templates: ["prd.md", "meta-prd.md", "prd-business.md", "prd-platform.md", "prfaq.md"],
  },
  rfcs: {
    title: "RFCs",
    dir: "rfcs",
    description: "Architecture and implementation proposals that need review before a decision.",
    templates: ["rfc.md", "rfc-platform.md"],
  },
  runbooks: {
    title: "Runbooks",
    dir: "runbooks",
    description: "Operational procedures, diagnostics, remediation, and escalation paths.",
    templates: ["runbook.md"],
  },
};

// Lane order for display (alphabetical by title)
const LANE_ORDER = ["adrs", "briefs", "changelogs", "intake", "meetings", "memos", "notes", "onboarding", "postmortems", "prds", "rfcs", "runbooks"];

// Project type detection
function detectProjectType(targetPath) {
  const files = fs.readdirSync(targetPath);
  const hasPackageJson = files.includes('package.json');
  const hasCargoToml = files.includes('Cargo.toml');
  const hasGoMod = files.includes('go.mod');
  const hasRequirementsTxt = files.includes('requirements.txt') || files.includes('pyproject.toml');
  const hasDockerfile = files.includes('Dockerfile') || files.includes('docker-compose.yml');
  const hasK8s = files.some(f => f.endsWith('.yaml') && (f.includes('deployment') || f.includes('service') || f.includes('ingress')));
  
  // Read package.json if present
  let packageInfo = null;
  if (hasPackageJson) {
    try {
      packageInfo = JSON.parse(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'));
    } catch {}
  }
  
  // Detect type
  if (hasK8s) return { type: 'platform', label: 'Platform/Infrastructure', icon: '☸️' };
  if (hasDockerfile && hasPackageJson) return { type: 'api', label: 'API Service', icon: '🔌' };
  if (packageInfo?.dependencies?.express || packageInfo?.dependencies?.fastify) return { type: 'api', label: 'API Service', icon: '🔌' };
  if (packageInfo?.dependencies?.react || packageInfo?.dependencies?.vue || packageInfo?.dependencies?.svelte) return { type: 'webapp', label: 'Web Application', icon: '🌐' };
  if (hasCargoToml) return { type: 'system', label: 'Systems/CLI Tool', icon: '⚙️' };
  if (hasGoMod) return { type: 'backend', label: 'Go Backend', icon: '🔋' };
  if (hasRequirementsTxt) return { type: 'data', label: 'Data/ML Project', icon: '📊' };
  if (packageInfo?.bin) return { type: 'cli', label: 'CLI Tool', icon: '⌨️' };
  if (files.includes('README.md') && !hasPackageJson) return { type: 'docs', label: 'Documentation Project', icon: '📚' };
  
  return { type: 'generic', label: 'Generic Project', icon: '📦' };
}

// Suggest lanes based on project type and detected files
function suggestLanes(targetPath, projectType) {
  const suggestions = [];
  const files = fs.readdirSync(targetPath);
  
  // Always suggest intake for collecting feedback
  suggestions.push({ lane: 'intake', reason: 'Collect incoming requests and feedback', recommended: true });
  
  // ADRs for any non-trivial project
  if (projectType.type !== 'docs') {
    suggestions.push({ lane: 'adrs', reason: 'Track architectural decisions', recommended: true });
  }
  
  // RFCs for APIs and platform projects
  if (['api', 'platform', 'backend'].includes(projectType.type)) {
    suggestions.push({ lane: 'rfcs', reason: 'Design reviews for API changes', recommended: true });
  }
  
  // Runbooks for deployed services
  if (['api', 'platform', 'webapp', 'backend'].includes(projectType.type)) {
    suggestions.push({ lane: 'runbooks', reason: 'Operational procedures and on-call docs', recommended: false });
  }
  
  // Postmortems for production services
  if (['api', 'platform', 'webapp', 'backend'].includes(projectType.type)) {
    suggestions.push({ lane: 'postmortems', reason: 'Incident retrospectives', recommended: false });
  }
  
  // PRDs for product-focused projects
  if (['webapp', 'api'].includes(projectType.type)) {
    suggestions.push({ lane: 'prds', reason: 'Product requirements', recommended: false });
  }
  
  // Notes for all projects
  suggestions.push({ lane: 'notes', reason: 'General notes and scratchpad', recommended: true });
  
  return suggestions;
}

// Parse --with-docs flag value
function parseWithDocs(value) {
  if (!value || value === 'all') {
    return LANE_ORDER;
  }
  
  const lanes = value.split(',').map(v => v.trim().toLowerCase());
  const validLanes = lanes.filter(lane => LANE_ORDER.includes(lane));
  
  // Map common aliases
  const mapped = validLanes.map(lane => {
    if (lane === 'adr') return 'adrs';
    if (lane === 'rfc') return 'rfcs';
    if (lane === 'runbook') return 'runbooks';
    if (lane === 'postmortem') return 'postmortems';
    if (lane === 'prd') return 'prds';
    return lane;
  });
  
  return [...new Set(mapped)]; // dedupe
}

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

function normalizeAnswer(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}



function buildDocsReadme(projectName) {
  return `# ${projectName} Documentation

This directory contains the structured documentation system for ${projectName}.

## Lanes

Each subdirectory represents a documentation lane with a specific purpose:

- **adr/** – Architecture decision records
- **briefs/** – Research, evidence, and one-pager documents  
- **changelogs/** – User-facing release notes
- **intake/** – Raw source material awaiting processing
- **memos/** – Decision memos and internal arguments
- **meetings/** – Meeting notes and minutes
- **notes/** – Working notes and lightweight context
- **onboarding/** – Setup guides and first-day workflows
- **postmortems/** – Blameless incident reports
- **prds/** – Product and capability requirement documents
- **rfcs/** – Architecture and implementation proposals
- **runbooks/** – Operational procedures and diagnostics

## Usage

### Adding Documents

Place new documents in the appropriate lane directory. Each lane has templates in its \`templates/\` subdirectory.

### Consistency Rules

- Use the templates as starting points
- Keep documents focused on one lane's purpose
- Update related documents when making changes
- Link to beads issues in \`plan.md\`

### Quality Gates

Run \`construct docs:verify\` to check documentation quality.

\`\`\`bash
# Validate all documentation
construct docs:verify

# Quick check (critical only)
construct docs:verify --quick

# Attempt to fix issues
construct docs:verify --fix
\`\`\`

## Maintenance

- Review documentation quarterly with \`construct init:update\`
- Remove stale documents that no longer reflect reality
- Update README.md when architecture changes`;
}

function buildLaneReadme(laneKey) {
  const lane = DOC_LANES[laneKey];
  if (!lane) return `# ${laneKey}\n\nDocumentation lane.`;
  
  return `# ${lane.title}

${lane.description}

## Templates

This directory includes starter templates in the \`templates/\` subdirectory.`;
}

function buildNotesTemplate() {
  return `# Title

Date: {{date}}
Author: {{author}}
Related: {{related-issue}}

## Context

What prompted this note? What problem are we trying to understand?

## Observations

- Fact 1
- Fact 2  
- Fact 3

## Questions

- What don't we know yet?
- What assumptions need testing?

## Next Steps

- [ ] Action 1
- [ ] Action 2`;
}

function buildMeetingNotesTemplate() {
  return `# {{meeting-title}}

Date: {{date}}
Time: {{time}}
Attendees: {{attendees}}

## Agenda

1. Topic 1
2. Topic 2
3. Topic 3

## Notes

### Topic 1

- Key point
- Decision
- Action item

### Topic 2

- Key point  
- Decision
- Action item

## Decisions

- Decision 1
- Decision 2

## Action Items

- [ ] @owner: Task description (due: {{date}})
- [ ] @owner: Task description (due: {{date}})`;
}

function buildIntakeTemplate() {
  return `# Intake: {{source}}

Received: {{date}}
From: {{from}}
Priority: {{priority}}

## What arrived

Brief description of what was received.

## Why it matters

Why this intake item is important to process.

## How it should be ingested

Processing instructions:
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

## Notes

<!-- Caveats, access concerns, or cleanup notes. -->`;
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    skipped.push(path.relative(target, filePath));
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  created.push(path.relative(target, filePath));
  return true;
}

function copyLaneTemplates(laneKey) {
  const lane = DOC_LANES[laneKey];
  if (!lane) return;
  
  const laneRoot = path.join(target, "docs", lane.dir);
  writeIfMissing(path.join(laneRoot, "README.md"), buildLaneReadme(laneKey));
  
  for (const [index, templateName] of lane.templates.entries()) {
    const outputName = index === 0 ? "_template.md" : templateName.replace(/\.md$/, ".template.md");
    let content;
    
    if (templateName === "__notes-template__") {
      content = buildNotesTemplate();
    } else if (templateName === '__meeting-notes-template__') {
      content = buildMeetingNotesTemplate();
    } else if (templateName === "__intake-template__") {
      content = buildIntakeTemplate();
    } else {
      const templatePath = path.join(TEMPLATE_DIR, templateName);
      if (fs.existsSync(templatePath)) {
        content = fs.readFileSync(templatePath, "utf8");
      } else {
        content = `# ${templateName.replace('.md', '')}\n\nTemplate file.`;
      }
    }
    
    writeIfMissing(path.join(laneRoot, "templates", outputName), content);
  }
}

async function askDocumentationQuestions() {
  // Non-interactive mode: use flags or defaults
  if (skipInteractive) {
    let lanes = [];
    
    // Build lanes from explicit flags
    if (withAllDocsFlag) {
      lanes = LANE_ORDER;
    } else if (withDocsFlag) {
      lanes = parseWithDocs(withDocsFlag.split("=")[1]);
    } else {
      // Check individual flags
      if (withAdrsFlag) lanes.push('adrs');
      if (withRfcsFlag) lanes.push('rfcs');
      if (withRunbooksFlag) lanes.push('runbooks');
      if (withPostmortemsFlag) lanes.push('postmortems');
    }
    
    return {
      lanes: [...new Set(lanes)], // dedupe
      withArchitecture: withArchitectureFlag,
      withReadme: withReadmeFlag || !fs.existsSync(path.join(target, "README.md")),
    };
  }
  
  // Interactive mode: project-aware workflow
  const projectType = detectProjectType(target);
  const suggestions = suggestLanes(target, projectType);
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DOCUMENTATION SETUP');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Detected project type: ${projectType.icon} ${projectType.label}`);
  console.log('');
  
  // Ask about README.md
  let withReadme = withReadmeFlag;
  if (!withReadmeFlag && !fs.existsSync(path.join(target, "README.md"))) {
    const response = await confirm('Create README.md? [Y/n] ');
    withReadme = response;
  }
  
  // Build options for multi-select with suggestions pre-checked
  const suggestedLaneNames = new Set(suggestions.map(s => s.lane));
  const laneOptions = LANE_ORDER.map(lane => {
    const suggestion = suggestions.find(s => s.lane === lane);
    return {
      label: DOC_LANES[lane].title,
      value: lane,
      checked: suggestion?.recommended ?? false,
      description: DOC_LANES[lane].description,
      suggestion: suggestion?.reason,
    };
  });
  
  // Show checkbox multi-select
  console.log('');
  console.log('Documentation lanes are directories under docs/ that organize specific');
  console.log('types of written work — decisions (ADRs), proposals (RFCs), incidents, etc.');
  console.log('Select which ones you need (recommended items are pre-checked).');
  console.log('');
  
  const selectedLanes = await multiSelect({
    title: 'Documentation Lanes',
    instructions: 'Press Enter to confirm your selection',
    options: laneOptions,
  });
  
  // Ask about architecture doc
  let withArchitecture = withArchitectureFlag;
  if (!withArchitectureFlag) {
    console.log('');
    const archResponse = await confirm('Create docs/architecture.md? [y/N] ');
    withArchitecture = archResponse;
  }
  
  return { lanes: selectedLanes, withArchitecture, withReadme };
}

function buildProjectReadme(projectName) {
  return `# ${projectName}

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
}

function preflight(target) {
  console.log('[TRACE init:pre-flight]');
  
  // Check git repo
  try {
    execSync('git rev-parse --show-toplevel', { cwd: target, stdio: 'ignore' });
  } catch {
    throw new Error('Not a git repository. Run `git init` first.');
  }
  
  // Check working tree clean (silent unless verbose)
  const porcelain = execSync('git status --porcelain', { cwd: target, encoding: 'utf8' }).trim();
  const clean = porcelain === '';
  if (!clean && verbose) {
    console.warn('Warning: Working tree has uncommitted changes');
    if (porcelain.split('\n').length > 10) {
      console.warn(`  (${porcelain.split('\n').length} files modified)`);
    }
  }
  
  // Check tests (silent unless verbose)
  if (verbose) {
    try {
      execSync('npm test -- --passWithNoTests', { cwd: target, timeout: 30000, stdio: 'ignore' });
    } catch {
      console.warn('Warning: Tests do not pass (or no tests)');
    }
  }
  
  return { clean };
}

function initializeBeadsTracker(target) {
  const result = spawnSync("bd", ["init"], {
    cwd: target,
    encoding: "utf8",
    stdio: "inherit",
    killSignal: "SIGTERM",
    timeout: 30_000,
  });

  if (result.error?.code === "ETIMEDOUT") {
    throw new Error("bd init timed out after 30s");
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`bd init exited with code ${result.status ?? "unknown"}`);
  }
}

async function main() {
  const projectName = inferProjectName(target);
  
  const { clean } = preflight(target);
  
  if (!quiet) {
    console.log(`Initializing Construct in ${path.relative(process.cwd(), target) || "."}`);
  }
  
  // Always create core Construct files
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

  // Stage .construct/ launcher + sync .claude/ adapters so init produces the
  // same project shape as a fresh `npm install` of the package as a dep.

  try {
    let pkgVersion = '';
    try {
      pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '';
    } catch { /* fall through with empty version */ }
    const stagingPre = fs.existsSync(path.join(target, '.construct', 'run.mjs'));
    const claudePre = fs.existsSync(path.join(target, '.claude', 'settings.json'));
    stageProjectAdapters({
      projectRoot: target,
      packageRoot: ROOT_DIR,
      pkgVersion,
      log: (msg) => console.log(`[init:stage] ${msg}`),
    });
    if (!stagingPre && fs.existsSync(path.join(target, '.construct', 'run.mjs'))) {
      created.push('.construct/ (launcher staged)');
    }
    if (!claudePre && fs.existsSync(path.join(target, '.claude', 'settings.json'))) {
      created.push('.claude/ (agents + settings)');
    }
  } catch (err) {
    console.warn(`⚠️  Adapter staging failed: ${err.message}`);
  }

  // Written once, never re-copied, so user edits survive subsequent inits
  // and `npm install` rebuilds. Skip-when-exists is the contract.

  const guideSrc = path.join(ROOT_DIR, 'templates', 'docs', 'construct_guide.md');
  const guideDst = path.join(target, 'construct_guide.md');
  if (fs.existsSync(guideSrc) && !fs.existsSync(guideDst)) {
    try {
      fs.copyFileSync(guideSrc, guideDst);
      created.push('construct_guide.md');
    } catch (err) {
      console.warn(`⚠️  Could not write construct_guide.md: ${err.message}`);
    }
  } else if (fs.existsSync(guideDst)) {
    skipped.push('construct_guide.md');
  }

  // Auto-init beads
  const beadsMeta = path.join(target, ".beads", "metadata.json");
  if (!fs.existsSync(beadsMeta)) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  TASK TRACKING (beads)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('Beads is a local-first issue tracker that keeps your work');
    console.log('organized without depending on external services like Jira.');
    console.log('');
    console.log('Features:');
    console.log('  • Local SQLite database (no cloud required)');
    console.log('  • Issues sync to git (optional)');
    console.log('  • Works offline');
    console.log('');
    console.log("Initializing beads tracker...");
    fs.mkdirSync(path.join(target, ".beads"), { recursive: true });
    try {
      initializeBeadsTracker(target);
      created.push(".beads/ (initialized)");
    } catch (e) {
      console.warn("⚠️  Beads init failed:", e.message);
    }
    console.log('');
  }
  
  // Ask about documentation system
  console.log('[TRACE init:docs-ask]');
  
  const { lanes, withArchitecture, withReadme, docsPreset: userDocsPreset } = await askDocumentationQuestions();
  
  // Create README.md if requested or missing
  const readmePath = path.join(target, "README.md");
  if (withReadme || !fs.existsSync(readmePath)) {
    writeIfMissing(readmePath, buildProjectReadme(projectName));
  }
  
    console.log('[TRACE init:docs-write]');
  
  // Create documentation system if lanes specified
  if (lanes.length > 0) {
    // Create docs/README.md
    writeIfMissing(
      path.join(target, "docs", "README.md"),
      buildDocsReadme(projectName)
    );
    
    // Create selected lanes
    for (const laneKey of lanes) {
      copyLaneTemplates(laneKey);
    }
    
    // Create architecture.md if requested
    if (withArchitecture) {
      writeIfMissing(
        path.join(target, "docs", "architecture.md"),
        `# ${projectName} Architecture\n\n## Overview\n\n## Components\n\n## Data Flow\n\n## Deployment\n`
      );
    }
  }
  
  // Output results (respect quiet mode)
  if (!quiet) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  SETUP COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    
    if (created.length) {
      console.log('Created:');
      for (const file of created) console.log(`  ${file}`);
      console.log('');
    }
    
    if (skipped.length && verbose) {
      console.log('Already exist (skipped):');
      for (const file of skipped) console.log(`  ${file}`);
      console.log('');
    }
    
    console.log(`${created.length} created, ${skipped.length} skipped`);
    console.log('');

    if (lanes.length > 0) {
      console.log('Documentation lanes enabled:');
      for (const lane of lanes) {
        console.log(`  • ${DOC_LANES[lane].title}`);
      }
      console.log('');
    }
  }

  // Seed the vector index from the project's existing docs so the agent
  // can compare new intake against established PRDs/RFCs/ADRs from day
  // one. Best-effort: skipped silently when Postgres + embedding model
  // aren't ready yet (DATABASE_URL unset, no ONNX cache). User can re-run
  // `construct ingest` or `construct setup` later to seed manually.

  try {
    const { syncFileStateToSql } = await import('./storage/sync.mjs');
    const projectName = path.basename(target);
    const seed = await syncFileStateToSql(target, { env: process.env, project: projectName });
    if (seed?.status === 'ok' && (seed.documentsSynced || 0) > 0) {
      console.log(`\n🔍 Indexed existing project material: ${seed.documentsSynced} doc(s), ${seed.embeddingsSynced || 0} embeddings.`);
      console.log(`   The agent can now compare new intake (.cx/inbox/, docs/intake/) against your existing PRDs, ADRs, and notes.`);
    }
  } catch { /* silent — corpus seeding is best-effort, not a setup blocker */ }
  
  // ── Devcontainer recipe ────────────────────────────────────────────────
  if (withDevcontainerFlag) {
    const dcDir = path.join(target, '.devcontainer');
    const templateDir = path.join(ROOT_DIR, 'templates', 'devcontainer');
    fs.mkdirSync(dcDir, { recursive: true });
    for (const file of ['devcontainer.json', 'Dockerfile.devcontainer']) {
      const src = path.join(templateDir, file);
      const dst = path.join(dcDir, file);
      if (fs.existsSync(dst)) { skipped.push(`.devcontainer/${file}`); continue; }
      if (fs.existsSync(src)) { fs.copyFileSync(src, dst); created.push(`.devcontainer/${file}`); }
    }
  }

  if (!quiet) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  NEXT STEPS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('1. Review AGENTS.md');
    console.log('   Operating rules and guidelines for this project');
    console.log('');
    console.log('2. Edit plan.md');
    console.log('   Add your current work and tasks');
    console.log('');
    if (lanes.includes('intake')) {
      console.log('3. Use Intake');
      console.log('   Drop files in .cx/inbox/ for processing');
      console.log('   Run: construct intake');
      console.log('');
    }
    console.log('4. Start working');
    console.log('   Address @construct in your editor to begin');
    console.log('');
  }
  
  // Auto-start services by default (silent unless verbose)
  const shouldStart = !args.includes('--no-start') && 
    (args.includes('--auto-start') || !interactive);
  
  if (shouldStart) {
    if (verbose) console.log('\nStarting services...');
    try {
      const { startServices } = await import('./service-manager.mjs');
      const { os } = await import('node:os');
      const { detectDockerCompose } = await import('./setup.mjs');
      
      const homeDir = os.homedir();
      const composeRunner = detectDockerCompose();
      
      const { results } = await startServices({
        rootDir: target,
        homeDir,
        detectDockerComposeFn: () => composeRunner,
      });
      
      if (!quiet) {
        console.log('\nServices:');
        for (const svc of results) {
          if (svc.status === 'started' || svc.status === 'reused') {
            const status = svc.status === 'reused' ? ' (running)' : '';
            const url = svc.url ? ` ${svc.url}` : '';
            console.log(`  ${svc.name}${status}${url}`);
          }
        }
        
        // Show Langfuse credentials if running locally
        const langfuse = results.find(r => r.name === 'Langfuse' && r.url?.includes('localhost'));
        if (langfuse) {
          const { loadConstructEnv } = await import('./env-config.mjs');
          const env = loadConstructEnv({ rootDir: target, homeDir });
          if (env.LANGFUSE_ADMIN_EMAIL) {
            console.log(`\nLangfuse: ${langfuse.url}`);
            console.log(`  Login: ${env.LANGFUSE_ADMIN_EMAIL}`);
          }
        }
        
        const dashboardPort = process.env.DASHBOARD_PORT || '4242';
        console.log(`\nDashboard: http://127.0.0.1:${dashboardPort}`);
      }
    } catch (error) {
      console.error(`Services could not be started: ${error.message}`);
      console.error(`Run 'construct dev' manually when ready`);
    }
  } else if (!quiet) {
    console.log(`\nRun 'construct dev' to start services`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

export default main;
