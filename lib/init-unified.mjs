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

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT_DIR, "templates", "docs");

const args = process.argv.slice(2);
const targetArg = args.find((arg) => !arg.startsWith("--"));
const target = path.resolve(targetArg ?? process.cwd());

const docsPresetArg = args.find((arg) => arg.startsWith("--docs-preset="));
const docsLanesArg = args.find((arg) => arg.startsWith("--docs-lanes="));
const withArchitectureFlag = args.includes("--with-architecture");
const withReadmeFlag = args.includes("--with-readme");
const skipInteractive = args.includes("--yes") || !process.stdin.isTTY;

const created = [];
const skipped = [];

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

const DOC_PRESETS = {
  lean: ["adrs", "intake", "memos", "meetings", "notes", "prds"],
  product: ["adrs", "intake", "memos", "meetings", "notes", "prds", "rfcs"],
  full: ["adrs", "briefs", "changelogs", "intake", "memos", "meetings", "notes", "onboarding", "postmortems", "prds", "rfcs", "runbooks"],
};

const DEFAULT_LANES = DOC_PRESETS.lean;
const LANE_ORDER = ["adrs", "briefs", "changelogs", "intake", "memos", "meetings", "notes", "onboarding", "postmortems", "prds", "rfcs", "runbooks"];
const LANE_ALIASES = {
  adr: "adrs", adrs: "adrs",
  brief: "briefs", briefs: "briefs",
  changelog: "changelogs", changelogs: "changelogs", releases: "changelogs", release: "changelogs",
  intake: "intake",
  memo: "memos", memos: "memos",
  meeting: 'meetings', meetings: 'meetings', minutes: 'meetings', retro: 'meetings',
  note: "notes", notes: "notes",
  onboard: "onboarding", onboarding: "onboarding",
  postmortem: "postmortems", postmortems: "postmortems", incident: "postmortems", incidents: "postmortems",
  prd: "prds", prds: "prds",
  rfc: "rfcs", rfcs: "rfcs",
  runbook: "runbooks", runbooks: "runbooks",
};

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

function parseLaneSelection(value) {
  const normalized = normalizeAnswer(value);
  
  // Handle presets
  if (DOC_PRESETS[normalized]) {
    return DOC_PRESETS[normalized];
  }
  
  // Handle "all" or empty
  if (!value.trim() || normalized === "all" || normalized === "default") {
    return DEFAULT_LANES;
  }
  
  // Parse comma-separated list
  return value
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => LANE_ALIASES[entry] || entry)
    .filter(lane => lane in DOC_LANES);
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
  if (skipInteractive) {
    let lanes = DEFAULT_LANES;
    
    if (docsPresetArg) {
      const preset = docsPresetArg.split("=")[1];
      lanes = DOC_PRESETS[preset] || DEFAULT_LANES;
    } else if (docsLanesArg) {
      lanes = parseLaneSelection(docsLanesArg.split("=")[1]);
    }
    
    return {
      lanes,
      withArchitecture: withArchitectureFlag,
      withReadme: withReadmeFlag || !fs.existsSync(path.join(target, "README.md")),
    };
  }
  
  console.log("\n📝 Documentation System Setup");
  console.log("─────────────────────────────\n");
  
  // Ask about README.md
  let withReadme = withReadmeFlag;
  if (!withReadmeFlag && !fs.existsSync(path.join(target, "README.md"))) {
    const response = await multiSelect({
      question: "Create/update project README.md?",
      options: [
        { label: "Yes, create basic README.md", value: "yes" },
        { label: "No, skip README.md", value: "no" },
      ],
      default: ["yes"],
    });
    withReadme = response.includes("yes");
  }
  
  // Ask about documentation system
  console.log("\nDocumentation presets:");
  console.log("  • lean     – ADRs, intake, memos, meetings, notes, PRDs");
  console.log("  • product  – lean + RFCs");
  console.log("  • full     – All lanes (briefs, changelogs, onboarding, postmortems, runbooks)");
  console.log("  • custom   – Choose specific lanes");
  
  const presetResponse = await multiSelect({
    question: "Select documentation preset:",
    options: [
      { label: "lean (recommended)", value: "lean" },
      { label: "product", value: "product" },
      { label: "full", value: "full" },
      { label: "custom", value: "custom" },
    ],
    default: ["lean"],
  });
  
  let lanes = DEFAULT_LANES;
  let withArchitecture = withArchitectureFlag;
  
  if (presetResponse.includes("custom")) {
    const laneOptions = LANE_ORDER.map(laneKey => ({
      label: `${DOC_LANES[laneKey].title} – ${DOC_LANES[laneKey].description}`,
      value: laneKey,
    }));
    
    const selectedLanes = await multiSelect({
      question: "Select documentation lanes to create:",
      options: laneOptions,
      default: DEFAULT_LANES,
    });
    
    lanes = selectedLanes;
    
    const architectureResponse = await multiSelect({
      question: "Create docs/architecture.md?",
      options: [
        { label: "Yes, create architecture overview", value: "yes" },
        { label: "No, skip architecture doc", value: "no" },
      ],
      default: ["no"],
    });
    
    withArchitecture = architectureResponse.includes("yes");
  } else {
    const preset = presetResponse[0];
    lanes = DOC_PRESETS[preset] || DEFAULT_LANES;
    
    if (!withArchitectureFlag) {
      const architectureResponse = await multiSelect({
        question: "Create docs/architecture.md?",
        options: [
          { label: "Yes, create architecture overview", value: "yes" },
          { label: "No, skip architecture doc", value: "no" },
        ],
        default: ["no"],
      });
      
      withArchitecture = architectureResponse.includes("yes");
    }
  }
  
  return { lanes, withArchitecture, withReadme };
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
  
  // Check working tree clean
  const porcelain = execSync('git status --porcelain', { cwd: target, encoding: 'utf8' }).trim();
  const clean = porcelain === '';
  if (!clean) {
    console.warn('⚠️  Working tree not clean:');
    console.warn(porcelain.split('\\n').slice(0, 5).join('\\n'));
  }
  
  // Check tests
  try {
    execSync('npm test -- --passWithNoTests', { cwd: target, timeout: 30000, stdio: 'ignore' });
  } catch {
    console.warn('⚠️  Tests do not pass (or no tests)');
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
  
  console.log(`\n🏗️  Construct init → ${path.relative(process.cwd(), target) || "."}\n`);
  
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

  // Auto-init beads
  const beadsMeta = path.join(target, ".beads", "metadata.json");
  if (!fs.existsSync(beadsMeta)) {
    console.log('[TRACE init:beads-init]');
    console.log("Initializing beads tracker...");
    fs.mkdirSync(path.join(target, ".beads"), { recursive: true });
    try {
      initializeBeadsTracker(target);
      created.push(".beads/ (initialized)");
    } catch (e) {
      console.warn("⚠️  Beads init failed:", e.message);
    }
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
  
  // Output results
  if (created.length) {
    console.log("\n✅ Created:");
    for (const file of created) console.log(`  + ${file}`);
  }
  
  if (skipped.length) {
    console.log("\n⏭️  Skipped (already exist):");
    for (const file of skipped) console.log(`  ~ ${file}`);
  }
  
  console.log(`\n📊 ${created.length} created, ${skipped.length} skipped.`);
  
  if (lanes.length > 0) {
    console.log(`\n📚 Documentation system initialized with ${lanes.length} lane(s): ${lanes.join(", ")}`);
    console.log(`   Run \`construct docs:verify\` to check documentation quality.`);
  }
  
  console.log(`\n🎯 Next steps:`);
  console.log(`   1. Review AGENTS.md for operating rules`);
  console.log(`   2. Update plan.md with current work`);
  console.log(`   3. Run \`construct docs:verify\` to validate setup`);
  console.log(`   4. Add \`construct docs:verify\` to your CI pipeline`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}

export default main;
