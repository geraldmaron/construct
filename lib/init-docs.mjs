#!/usr/bin/env node
/**
 * lib/init-docs.mjs — stand up a documentation system for a project.
 *
 * This command is intentionally separate from `construct init`. It creates the
 * docs surface only: docs/README.md and selected lane directories such as
 * docs/adr/, docs/intake/, docs/memos/, docs/notes/, docs/prds/, and docs/rfcs/ with starter templates
 * copied into per-lane templates/ directories from Construct's template library.
 *
 * Usage:
 *   node lib/init-docs.mjs [target-path] [--yes] [--docs=prds,rfcs,adrs] [--with-architecture] [--suggest-org] [--organize]
 *   construct init-docs [path] [--yes] [--docs=prds,rfcs,adrs] [--with-architecture] [--suggest-org] [--organize]
 *
 * Flags:
 *   --yes          Skip interactive prompts and use defaults.
 *   --docs         Comma-separated list of lanes to initialize (default: adrs,intake,memos,notes,prds).
 *   --with-architecture  Also create docs/architecture.md.
 *   --suggest-org  Scan existing .md files and suggest where they might belong (no changes made).
 *   --organize     Actually move files to suggested locations (implies --suggest-org, requires --yes to avoid prompts).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { suggestDocsLaneForFile } from './docs-routing.mjs';
import { stampFrontmatter } from "./doc-stamp.mjs";
import { multiSelect, selectOption } from './tty-prompts.mjs';

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT_DIR, "templates", "docs");

const args = process.argv.slice(2);
const skipInteractive = args.includes("--yes") || !process.stdin.isTTY;
const docsArg = args.find((arg) => arg.startsWith("--docs="));
const extrasArg = args.find((arg) => arg.startsWith("--extras="));
const withArchitectureFlag = args.includes("--with-architecture");
const suggestOrg = args.includes("--suggest-org");
const organize = args.includes("--organize");
const targetArg = args.find((arg) => !arg.startsWith("--"));
const target = path.resolve(targetArg ?? process.cwd());

const created = [];
const skipped = [];

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
  adr: "adrs",
  adrs: "adrs",
  brief: "briefs",
  briefs: "briefs",
  changelog: "changelogs",
  changelogs: "changelogs",
  releases: "changelogs",
  release: "changelogs",
  intake: "intake",
  memo: "memos",
  memos: "memos",
  meeting: 'meetings',
  meetings: 'meetings',
  minutes: 'meetings',
  retro: 'meetings',
  note: "notes",
  notes: "notes",
  onboard: "onboarding",
  onboarding: "onboarding",
  postmortem: "postmortems",
  postmortems: "postmortems",
  incident: "postmortems",
  incidents: "postmortems",
  prd: "prds",
  prds: "prds",
  rfc: "rfcs",
  rfcs: "rfcs",
  runbook: "runbooks",
  runbooks: "runbooks",
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

function parseCsvList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const NO_ANSWER_PATTERNS = new Set([
  "",
  "n",
  "no",
  "none",
  "nope",
  "nah",
  "nothing",
  "blank",
  "skip",
  "no thanks",
]);

const ALL_ANSWER_PATTERNS = new Set([
  "all",
  "all of them",
  "everything",
  "default",
  "defaults",
]);

function normalizeAnswer(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isNegativeAnswer(value) {
  return NO_ANSWER_PATTERNS.has(normalizeAnswer(value));
}

function isAllAnswer(value) {
  return ALL_ANSWER_PATTERNS.has(normalizeAnswer(value));
}

function parseLaneSelection(value) {
  const normalized = normalizeAnswer(value);
  if (!value.trim() || isAllAnswer(value)) return DEFAULT_LANES;
  if (isNegativeAnswer(value)) return [];
  if (DOC_PRESETS[normalized]) return DOC_PRESETS[normalized];
  return parseSelectableLanes(value);
}

function parseExtraLaneSelection(value) {
  if (!value.trim() || isNegativeAnswer(value)) return [];
  return parseCsvList(value)
    .map(normalizeCustomLaneName)
    .filter(Boolean);
}

function parseSelectableLanes(value) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (/^\d+$/.test(entry)) {
        const lane = LANE_ORDER[Number(entry) - 1];
        return lane ?? "";
      }
      return normalizeLaneKey(entry);
    })
    .filter((lane) => lane in DOC_LANES);
}

function parseBooleanAnswer(value, defaultValue = false) {
  if (!value.trim()) return defaultValue;
  const normalized = normalizeAnswer(value);
  if (["y", "yes", "true"].includes(normalized)) return true;
  if (["n", "no", "false", "nope", "nah"].includes(normalized)) return false;
  return defaultValue;
}

function normalizeCustomLaneName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLaneKey(name) {
  return LANE_ALIASES[name.trim().toLowerCase()] ?? name.trim().toLowerCase();
}

function repoHasAny(targetDir, candidates) {
  return candidates.some((candidate) => fs.existsSync(path.join(targetDir, candidate)));
}

function scanNames(targetDir, maxDepth = 2) {
  const ignored = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cx', 'docs']);
  const names = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      names.push(entry.name.toLowerCase());
      if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(targetDir, 0);
  return names;
}

function suggestContextualLanes(targetDir) {
  const suggestions = [];
  const names = scanNames(targetDir);
  const hasKeyword = (keywords) => keywords.some((keyword) => names.some((name) => name.includes(keyword)));

  if (repoHasAny(targetDir, ['package.json', 'src', 'lib', 'apps', 'services', 'api']) || hasKeyword(['proposal', 'interface', 'contract', 'schema', 'openapi'])) {
    suggestions.push({ lane: 'rfcs', reason: 'codebase and interface changes usually benefit from proposal docs' });
  }
  if (repoHasAny(targetDir, ['Dockerfile', 'deploy', 'infra', '.github', 'ops', 'terraform']) || hasKeyword(['incident', 'deploy', 'runbook', 'oncall'])) {
    suggestions.push({ lane: 'runbooks', reason: 'deployment and operations files suggest an ops lane is useful' });
  }
  if (repoHasAny(targetDir, ['Dockerfile', 'deploy', 'infra', '.github']) || hasKeyword(['incident', 'postmortem', 'oncall', 'sev', 'pagerduty'])) {
    suggestions.push({ lane: 'postmortems', reason: 'ops setup suggests an incident post-mortem lane is useful' });
  }
  if (repoHasAny(targetDir, ['CHANGELOG.md', 'CHANGELOG', 'RELEASES.md']) || hasKeyword(['changelog', 'release', 'version'])) {
    suggestions.push({ lane: 'changelogs', reason: 'existing changelog or release files suggest a changelogs lane' });
  }
  if (repoHasAny(targetDir, ['onboarding', 'setup', 'getting-started']) || hasKeyword(['onboarding', 'setup', 'getting-started', 'local-dev'])) {
    suggestions.push({ lane: 'onboarding', reason: 'setup or onboarding files suggest an onboarding lane' });
  }
  if (hasKeyword(['research', 'brief', 'customer', 'interview', 'market', 'competitive', 'signal'])) {
    suggestions.push({ lane: 'briefs', reason: 'research-style source material suggests a briefs lane' });
  }
  if (hasKeyword(['meeting', 'minutes', 'standup', 'retro', 'agenda', 'sync', '1:1'])) {
    suggestions.push({ lane: 'meetings', reason: 'meeting artifacts suggest a dedicated meetings lane' });
  }

  return suggestions.filter((suggestion, index, arr) => arr.findIndex((item) => item.lane === suggestion.lane) === index);
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    skipped.push(path.relative(target, filePath));
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stamped = filePath.endsWith(".md")
    ? stampFrontmatter(content, { generator: "construct/init-docs" })
    : content;
  fs.writeFileSync(filePath, stamped, "utf8");
  created.push(path.relative(target, filePath));
}

function sortLaneKeys(lanes) {
  return [...lanes].sort((a, b) => {
    const left = DOC_LANES[a]?.title ?? titleCase(a);
    const right = DOC_LANES[b]?.title ?? titleCase(b);
    return left.localeCompare(right);
  });
}

function buildDocsReadme(projectName, selectedLanes) {
  const laneLines = sortLaneKeys(selectedLanes).map((lane) => {
    const label = DOC_LANES[lane]?.title ?? titleCase(lane);
    const laneDir = DOC_LANES[lane]?.dir ?? lane;
    const desc = DOC_LANES[lane]?.description ?? "Custom documentation lane.";
    return `- [${label}](./${laneDir}/) — ${desc}`;
  });

  return `<!--
docs/README.md — documentation index and maintenance contract.

Generated by \`construct init-docs\`. Keep this file aligned with the actual doc
lanes in the repo. Update it when lanes are added, removed, or repurposed, and
prune stale links instead of letting the doc surface drift.
-->

# ${projectName} Documentation

> This docs surface is the canonical home for long-lived project documents such as ADRs, briefs, intake material, memos, notes, PRDs, RFCs, and runbooks.

## Operating model

- Use Beads or the project's external tracker for durable task tracking.
- Use \`plan.md\` for the current implementation plan.
- Use this \`docs/\` tree for durable narrative artifacts and decision records.
- If multiple agent or harness sessions are active, use a single writer per file and coordinate handoffs in the tracker or \`plan.md\`.
- Prune stale sections and directories when they stop matching how the repo is actually run.

## Lanes

${laneLines.join("\n")}

## Maintenance rule

If a document lane stops serving a real purpose, remove it or archive it intentionally. This tree should stay opinionated and current, not become a graveyard of stale templates.
`;
}

function buildArchitectureDoc(projectName, selectedLanes) {
  const laneLines = sortLaneKeys(selectedLanes).map((lane) => {
    const label = DOC_LANES[lane]?.title ?? titleCase(lane);
    const desc = DOC_LANES[lane]?.description ?? "Custom documentation lane.";
    return `- **${label}** — ${desc}`;
  });

  return `<!--
docs/architecture.md — canonical architecture context and documentation-system contract.

Generated by \`construct init-docs\`. Update this file when the system shape,
ownership boundaries, or documentation operating model changes. Remove stale
assumptions as soon as they stop matching the codebase.
-->

# ${projectName} Architecture

## System overview

Describe the runtime shape, major modules, external dependencies, and key data boundaries.

## Project-state hierarchy

1. External tracker, preferably Beads, owns the durable backlog and issue status.
2. \`plan.md\` owns the current human-readable implementation plan.
3. cass-memory through MCP \`memory\` stores cross-session observations and preferences.
4. \`docs/\` stores durable narrative artifacts such as ADRs, briefs, intake notes, memos, notes, PRDs, RFCs, and runbooks.

## Documentation lanes

${laneLines.join("\n")}

## Key invariants

- Keep one source of truth per concern instead of parallel trackers.
- When multiple agent or harness sessions run in parallel, use a single writer per file.
- Update or prune stale docs when work changes project reality.
- Prefer adding a lane only when it has a distinct audience and decision rhythm.
`;
}

function buildLaneReadme(laneKey) {
  const lane = DOC_LANES[laneKey];
  const title = lane?.title ?? titleCase(laneKey);
  const description = lane?.description ?? "Custom documentation lane.";
  const dirName = lane?.dir ?? laneKey;
  const templateLines = (lane?.templates ?? []).map((templateName, index) => {
    const filename = index === 0 ? "_template.md" : templateName.replace(/\.md$/, ".template.md");
    return `- [${filename}](./templates/${filename})`;
  });
  const usageSection = laneKey === "intake"
    ? `
## Intake flow

- Drop source files into either [\`.cx/inbox/\`](../../.cx/inbox/) or this lane's directory when you want Construct to ingest them.
- Run \`construct ingest ./docs/intake --sync\` or \`construct ingest ./.cx/inbox --sync\` to convert supported files into retrieval-ready markdown, or let the embed daemon watch those drop zones automatically.
- Durable ingested knowledge lands under \`.cx/knowledge/internal/\` by default, which is where Construct's learning and search paths already operate.
`
    : "";

  return `<!--
docs/${dirName}/README.md — lane guide for ${title}.

Generated by \`construct init-docs\`. Keep this lane focused on one document
family. If it no longer has a distinct purpose, prune it or merge it elsewhere.
-->

# ${title}

${description}

## Starter templates

${templateLines.join("\n")}
${usageSection}
`;
}

function buildCustomLaneReadme(laneDir) {
  return `<!--
docs/${laneDir}/README.md — custom documentation lane.

Generated by \`construct init-docs\`. Rename, refine, or remove this lane once
its real purpose is clear. Do not keep placeholder structures around indefinitely.
-->

# ${titleCase(laneDir)}

Custom documentation lane for this project.

## Starter templates

- [\`_template.md\`](./templates/_template.md)
`;
}

function buildCustomLaneTemplate(laneDir) {
  return `<!--
docs/${laneDir}/_template.md — starter template for a custom documentation lane.

Replace this with a real template once the lane's purpose is clear. If the lane
never becomes meaningful, delete the lane instead of keeping placeholder docs.
-->

# ${titleCase(laneDir)}: {title}

- **Date**: {YYYY-MM-DD}
- **Author**: {name}
- **Status**: draft | active | superseded

## Summary

<!-- What this document exists to explain or decide. -->

## Context

<!-- Why this matters now and what the reader needs to know first. -->

## Details

<!-- The actual content for this lane. -->

## Decisions or next steps

<!-- What changes because of this document. -->

## References

<!-- Links to related docs, code, or evidence. -->
`;
}

function buildNotesTemplate() {
  return `<!--
docs/notes/templates/_template.md — starter template for durable project notes.

Keep notes concise, dated, and easy to skim. Promote major decisions into ADRs,
PRDs, or RFCs when they stop being just notes.
-->

# Note: {title}

- **Date**: {YYYY-MM-DD}
- **Author**: {name}
- **Topic**: {topic}

## Summary

<!-- One-paragraph summary. -->

## Details

<!-- Main notes. -->

## Follow-ups

<!-- Next actions, questions, or references. -->
`;
}

function buildMeetingNotesTemplate() {
  return `<!--
docs/notes/meetings/_template.md — starter template for meeting notes.

Use this for meeting minutes, standups, reviews, planning, retros, and working sessions.
Promote durable decisions into ADRs, memos, or PRDs when needed.
-->

# Meeting: {title}

- **Date**: {YYYY-MM-DD}
- **Attendees**: {names}
- **Type**: standup | planning | retro | review | 1:1 | working-session

## Summary

<!-- What happened and why it mattered. -->

## Decisions

<!-- Decisions made in the meeting. -->

## Action items

<!-- Follow-ups, owners, and due dates. -->

## References

<!-- Relevant docs, tickets, links, or recordings. -->
`;
}

function buildIntakeTemplate() {
  return `<!--
docs/intake/templates/_template.md — starter template for logging an intake batch.

Use this when you want a durable record of what was dropped into intake and why.
Raw source files belong in .cx/inbox/ until they are ingested.
-->

# Intake Batch: {title}

- **Date**: {YYYY-MM-DD}
- **Owner**: {name}
- **Source**: {vendor, teammate, export, upload}

## What arrived

<!-- Files, folders, or links dropped into .cx/inbox/. -->

## Why it matters

<!-- Why Construct should ingest this material. -->

## Ingest plan

- Run: \`construct ingest ./.cx/inbox --sync\`
- Target: \`.cx/knowledge/internal/\` unless a different knowledge target is more appropriate

## Notes

<!-- Caveats, access concerns, or cleanup notes. -->
`;
}

function titleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Scan for markdown files in the target directory, excluding common ignored directories.
 * Returns array of objects: { filePath: absolute path, relPath: path relative to target, content: file content }
 */
function scanMarkdownFiles(targetDir) {
   const ignoredDirs = new Set([
     'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
     '.claude', '.cx', 'templates', 'scripts', 'platforms',
     'docs', // exclude existing docs lane files from reorganization suggestions
   ]);

  const results = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Skip files that are already in a docs lane directory (we don't want to suggest moving them)
        const relPath = path.relative(targetDir, fullPath);
        if (!relPath.startsWith('docs/') || !relPath.includes('/')) {
          // Only suggest files at the repo root or in non-docs top-level dirs
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            results.push({ filePath: fullPath, relPath, content });
          } catch (err) {
            // If we can't read, skip
          }
        }
      }
    }
  }

  walk(targetDir);
  return results;
}

/**
 * Suggest a documentation lane for a given file based on its content and filename.
 * Returns the canonical lane key (e.g., 'prds', 'rfcs', 'adrs') or null if no clear suggestion.
 */
function suggestLocationForFile(filePath, content) {
  return suggestDocsLaneForFile(filePath, content);
}

function copyLaneTemplates(laneKey) {
  const lane = DOC_LANES[laneKey];
  if (!lane) return;
  const laneRoot = path.join(target, "docs", lane.dir);
  writeIfMissing(path.join(laneRoot, "README.md"), buildLaneReadme(laneKey));
  for (const [index, templateName] of lane.templates.entries()) {
    const outputName = index === 0 ? "_template.md" : templateName.replace(/\.md$/, ".template.md");
    const content =
      templateName === "__notes-template__" ? buildNotesTemplate()
      : templateName === '__meeting-notes-template__' ? buildMeetingNotesTemplate()
      : templateName === "__intake-template__" ? buildIntakeTemplate()
      : fs.readFileSync(path.join(TEMPLATE_DIR, templateName), "utf8");
    writeIfMissing(path.join(laneRoot, "templates", outputName), content);
  }
}

function createCustomLane(laneDir) {
  const laneRoot = path.join(target, "docs", laneDir);
  writeIfMissing(path.join(laneRoot, "README.md"), buildCustomLaneReadme(laneDir));
  writeIfMissing(path.join(laneRoot, "templates", "_template.md"), buildCustomLaneTemplate(laneDir));
}

/* ─── askQuestions ───────────────────────────────────────────────────────── */
async function askQuestions() {
  if (skipInteractive) {
    return {
      lanes: docsArg ? parseLaneSelection(docsArg.split("=")[1]) : DEFAULT_LANES,
      extraLanes: extrasArg ? parseExtraLaneSelection(extrasArg.split("=")[1]) : [],
      withArchitecture: withArchitectureFlag,
    };
  }

  const contextualSuggestions = suggestContextualLanes(target);
  const suggestedKeys     = new Set(contextualSuggestions.map((s) => s.lane));
  const suggestedReasons  = Object.fromEntries(contextualSuggestions.map((s) => [s.lane, s.reason]));

  const defaultSet = new Set(DEFAULT_LANES);
  const items = LANE_ORDER.map((key) => ({
    value: key,
    label: DOC_LANES[key].title,
    description: DOC_LANES[key].description,
    checked: defaultSet.has(key) || suggestedKeys.has(key),
    suggestion: suggestedKeys.has(key) ? suggestedReasons[key] : null,
    meta: `docs/${DOC_LANES[key].dir}/`,
  }));

  const selectedKeys = await multiSelect({
    title: 'Select doc lanes',
    instructions: 'Use arrows to move, Space to toggle, a to toggle all, i to invert, Enter to confirm.',
    options: items,
  });
  const lanes = selectedKeys.length ? selectedKeys : DEFAULT_LANES;

  const withArchitecture = await selectOption({
    title: 'Create docs/architecture.md?',
    instructions: 'Pick whether to scaffold the architecture document now.',
    options: [
      { value: true, label: 'Yes', description: 'Create docs/architecture.md with the project-state hierarchy and lane summary.' },
      { value: false, label: 'No', description: 'Skip docs/architecture.md for now. You can add it later.' },
    ],
  });
  process.stdout.write("\n");

  return { lanes, extraLanes: [], withArchitecture };
}

async function main() {
  const projectName = inferProjectName(target);
  const { lanes, extraLanes, withArchitecture } = await askQuestions();
  const normalizedLanes = Array.from(new Set(
    lanes
      .map((lane) => normalizeLaneKey(lane))
      .filter((lane) => lane in DOC_LANES),
  ));
  const selectedLanes = normalizedLanes.length ? normalizedLanes : DEFAULT_LANES;
  const selectedCustomLanes = Array.from(new Set(
    extraLanes
      .map(normalizeCustomLaneName)
      .filter(Boolean)
      .filter((lane) => !(lane in DOC_LANES)),
  ));
  const allLaneKeys = sortLaneKeys([...selectedLanes, ...selectedCustomLanes]);

  process.stdout.write(`\nConstruct init-docs → ${target}\n\n`);

  writeIfMissing(path.join(target, "docs", "README.md"), buildDocsReadme(projectName, allLaneKeys));
  if (withArchitecture) {
    writeIfMissing(path.join(target, "docs", "architecture.md"), buildArchitectureDoc(projectName, allLaneKeys));
  }
  if (selectedLanes.includes('intake')) {
    writeIfMissing(path.join(target, '.cx', 'inbox', '.gitkeep'), '');
  }

  for (const laneKey of selectedLanes) copyLaneTemplates(laneKey);
  for (const laneKey of selectedCustomLanes) createCustomLane(laneKey);

  // Handle suggestion and organization of existing markdown files
  if (suggestOrg || organize) {
    if (organize && !skipInteractive) {
      process.stdout.write("Error: --organize requires --yes to avoid interactive prompts.\n");
      process.exit(1);
    }

    const markdownFiles = scanMarkdownFiles(target);
    const suggestions = [];

    for (const file of markdownFiles) {
      const suggestedLane = suggestLocationForFile(file.filePath, file.content);
      if (suggestedLane) {
        suggestions.push({ file: file, lane: suggestedLane });
      }
    }

    if (suggestions.length === 0) {
      process.stdout.write("No files found that could be organized into documentation lanes.\n");
    } else {
      process.stdout.write(`Found ${suggestions.length} file(s) that could be organized:\n\n`);
      for (const { file, lane } of suggestions) {
        process.stdout.write(`  ${file.relPath} → docs/${DOC_LANES[lane]?.dir ?? lane}/\n`);
      }
      process.stdout.write("\n");

      if (organize) {
        // Actually move the files
        process.stdout.write("Moving files to suggested locations...\n");
        for (const { file, lane } of suggestions) {
          const targetDir = path.join(target, "docs", DOC_LANES[lane]?.dir ?? lane);
          const targetPath = path.join(targetDir, path.basename(file.filePath));
          try {
            fs.renameSync(file.filePath, targetPath);
            process.stdout.write(`  Moved: ${file.relPath} → docs/${DOC_LANES[lane]?.dir ?? lane}/${path.basename(file.filePath)}\n`);
          } catch (err) {
            process.stdout.write(`  Failed to move ${file.relPath}: ${err.message}\n`);
          }
        }
        process.stdout.write("Organization complete.\n");
      }
    }
  }

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

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
});
