#!/usr/bin/env node
/**
 * lib/init-docs.mjs — stand up a documentation system for a project.
 *
 * Intentionally separate from `construct init`. Creates the docs surface only:
 * docs/README.md plus selected lane directories such as docs/decisions/adr/, docs/intake/,
 * docs/notes/memos/, docs/notes/, templates/docs/prds/, and templates/docs/rfcs/ with starter templates
 * copied into per-lane templates/ directories from Construct's template library.
 *
 * Usage:
 *   node lib/init-docs.mjs [target-path] [--yes] [--docs-preset=lean|product|full] [--docs=prds,rfcs,adrs] ...
 *   construct init-docs [path] [options]   (retired CLI alias — prefer `construct init` docs flags)
 *
 * Flags:
 *   --yes          Skip interactive prompts. Default is docs/ only; opt into lanes explicitly.
 *   --docs-preset  Curated pack: lean|product|full (same as construct init).
 *   --docs         Comma-separated lanes, preset name (lean|product|full), or "all of them" for the lean pack.
 *   --with-architecture  Also create docs/architecture.md.
 *   --suggest-org  Scan existing .md files and suggest where they might belong (no changes made).
 *   --organize     Actually move files to suggested locations (implies --suggest-org, requires --yes to avoid prompts).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { suggestDocsLaneForFile } from './docs-routing.mjs';
import { PROJECT_MARKERS } from './config-dir.mjs';
import { stampFrontmatter } from "./doc-stamp.mjs";
import { multiSelect, selectOption } from './tty-prompts.mjs';
import readline from "node:readline";
import {
  DOC_LANES,
  DOC_PRESETS,
  DEFAULT_LANES,
  LANE_ORDER,
  normalizeCustomLaneName,
  normalizeLaneKey,
  parseCsvList,
  parseSelectableLanes,
  resolveNonInteractiveDocsLanes,
} from './init/doc-lanes.mjs';

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT_DIR, "templates", "docs");

const args = process.argv.slice(2);
const skipInteractive = args.includes("--yes") || !process.stdin.isTTY;
const docsArg = args.find((arg) => arg.startsWith("--docs="));
const docsPresetArg = args.find((arg) => arg.startsWith('--docs-preset='));
const extrasArg = args.find((arg) => arg.startsWith("--extras="));
const withArchitectureFlag = args.includes("--with-architecture");
const suggestOrg = args.includes("--suggest-org");
const organize = args.includes("--organize");
// --force bypasses the existing-content detector so lanes already covered by
// the project (e.g. internal/meetings/) still get a parallel docs/<lane>/.
const forceScaffold = args.includes("--force");
const targetArg = args.find((arg) => !arg.startsWith("--"));
const target = path.resolve(targetArg ?? process.cwd());

const docsRootArg = args.find((arg) => arg.startsWith('--docs-root='));
const docsRootRelative = docsRootArg ? docsRootArg.split('=')[1] : 'docs';
const docsDir = path.join(target, docsRootRelative);

const created = [];
const skipped = [];

function inferProjectName(targetPath) {
  const packageJsonPath = path.join(targetPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return pkg.name || path.basename(targetPath);
    } catch { /* ignore */ }
  }
  return path.basename(targetPath);
}

const NO_ANSWER_PATTERNS = new Set([
  '',
  'n',
  'no',
  'none',
  'nope',
  'nah',
  'nothing',
  'blank',
  'skip',
  'no thanks',
]);

const ALL_ANSWER_PATTERNS = new Set([
  'all',
  'all of them',
  'everything',
  'default',
  'defaults',
]);

function normalizeAnswer(value) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isNegativeAnswer(value) {
  return NO_ANSWER_PATTERNS.has(normalizeAnswer(value));
}

function isAllAnswer(value) {
  return ALL_ANSWER_PATTERNS.has(normalizeAnswer(value));
}

function parseLaneSelection(value) {
  const normalized = normalizeAnswer(value);
  if (!value.trim()) return [];
  if (isNegativeAnswer(value)) return [];
  if (isAllAnswer(value)) return DEFAULT_LANES;
  if (DOC_PRESETS[normalized]) return DOC_PRESETS[normalized];
  return parseSelectableLanes(value);
}

function parseExtraLaneSelection(value) {
  if (!value.trim() || isNegativeAnswer(value)) return [];
  return parseCsvList(value)
    .map(normalizeCustomLaneName)
    .filter(Boolean);
}

function parseBooleanAnswer(value, defaultValue = false) {
  if (!value.trim()) return defaultValue;
  const normalized = normalizeAnswer(value);
  if (['y', 'yes', 'true'].includes(normalized)) return true;
  if (['n', 'no', 'false', 'nope', 'nah'].includes(normalized)) return false;
  return defaultValue;
}

function repoHasAny(targetDir, candidates) {
  return candidates.some((candidate) => fs.existsSync(path.join(targetDir, candidate)));
}

function scanNames(targetDir, maxDepth = 2) {
  const ignored = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', ...PROJECT_MARKERS, 'docs']);
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

  const lanesSection = laneLines.length > 0
    ? laneLines.join("\n")
    : [
        '_No documentation lanes scaffolded yet._',
        '',
        'Add curated packs or individual lanes when you need them:',
        '',
        '- `construct init --interactive` — Packs / Individual docs menu',
        '- `construct init --docs-preset=lean` — lean pack (ADRs, memos, meetings, notes, PRDs)',
        '- `construct init-docs --docs-preset=lean` — same packs via the docs-only entrypoint',
      ].join("\n");

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

${lanesSection}

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

  return `<!--
docs/${dirName}/README.md — lane guide for ${title}.

Generated by \`construct init-docs\`. Keep this lane focused on one document
family. If it no longer has a distinct purpose, prune it or merge it elsewhere.
-->

# ${title}

${description}

## Starter templates

${templateLines.join("\n")}
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
     '.claude', ...PROJECT_MARKERS, 'templates', 'scripts', 'platforms',
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
  const laneRoot = path.join(docsDir, lane.dir);
  writeIfMissing(path.join(laneRoot, "README.md"), buildLaneReadme(laneKey));
  for (const [index, templateName] of lane.templates.entries()) {
    const outputName = index === 0 ? "_template.md" : templateName.replace(/\.md$/, ".template.md");
    const content =
      templateName === "__notes-template__" ? buildNotesTemplate()
      : templateName === '__meeting-notes-template__' ? buildMeetingNotesTemplate()
      : fs.readFileSync(path.join(TEMPLATE_DIR, templateName), "utf8");
    writeIfMissing(path.join(laneRoot, "templates", outputName), content);
  }
}

function createCustomLane(laneDir) {
  const laneRoot = path.join(docsDir, laneDir);
  writeIfMissing(path.join(laneRoot, "README.md"), buildCustomLaneReadme(laneDir));
  writeIfMissing(path.join(laneRoot, "templates", "_template.md"), buildCustomLaneTemplate(laneDir));
}

/* ─── askQuestions ───────────────────────────────────────────────────────── */
async function askQuestions() {
  if (skipInteractive) {
    const docsPresetName = docsPresetArg ? docsPresetArg.split('=')[1].toLowerCase() : null;
    let lanes = [];
    if (docsPresetName) {
      lanes = resolveNonInteractiveDocsLanes({ docsPresetName });
    } else if (docsArg) {
      lanes = parseLaneSelection(docsArg.split('=')[1]);
    }

    return {
      lanes,
      extraLanes: extrasArg ? parseExtraLaneSelection(extrasArg.split('=')[1]) : [],
      withArchitecture: withArchitectureFlag,
    };
  }

  const contextualSuggestions = suggestContextualLanes(target);
  const suggestedKeys     = new Set(contextualSuggestions.map((s) => s.lane));
  const suggestedReasons  = Object.fromEntries(contextualSuggestions.map((s) => [s.lane, s.reason]));

  const items = LANE_ORDER.map((key) => ({
    value: key,
    label: DOC_LANES[key].title,
    description: DOC_LANES[key].description,
    checked: suggestedKeys.has(key),
    suggestion: suggestedKeys.has(key) ? suggestedReasons[key] : null,
    meta: `docs/${DOC_LANES[key].dir}/`,
  }));

  const selectedKeys = await multiSelect({
    title: 'Select doc lanes',
    instructions: 'Space toggles · Enter confirms · nothing is pre-selected unless context-suggested.',
    options: items,
  });
  const lanes = selectedKeys;

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
  const selectedLanes = normalizedLanes;
  const selectedCustomLanes = Array.from(new Set(
    extraLanes
      .map(normalizeCustomLaneName)
      .filter(Boolean)
      .filter((lane) => !(lane in DOC_LANES)),
  ));
  const allLaneKeys = sortLaneKeys([...selectedLanes, ...selectedCustomLanes]);

  process.stdout.write(`\nConstruct init-docs → ${target}\n\n`);

  // Inspect existing project content once and filter out lanes the project
  // already covers (issue #97). --force bypasses every check.

  const { detectExistingContent, shouldScaffoldLane, shouldSkipProjectInbox, formatDeferralSummary } =
    await import('./init/detect-existing-structure.mjs');
  const detection = detectExistingContent(target);

  const deferredLanes = [];
  const lanesToScaffold = [];
  for (const laneKey of selectedLanes) {
    const decision = shouldScaffoldLane(laneKey, detection, { force: forceScaffold });
    if (decision.skip) {
      deferredLanes.push({ laneKey, reason: decision.reason });
    } else {
      lanesToScaffold.push(laneKey);
    }
  }
  const allScaffoldedLaneKeys = sortLaneKeys([...lanesToScaffold, ...selectedCustomLanes]);

  writeIfMissing(path.join(docsDir, "README.md"), buildDocsReadme(projectName, allScaffoldedLaneKeys));
  if (withArchitecture) {
    writeIfMissing(path.join(docsDir, "architecture.md"), buildArchitectureDoc(projectName, allScaffoldedLaneKeys));
  }
  const inboxDecision = shouldSkipProjectInbox(detection, { force: forceScaffold });
  if (inboxDecision.skip) {
    process.stdout.write(`[init:docs] skipping inbox/ — ${inboxDecision.reason}. Run with --force to scaffold anyway.\n`);
    skipped.push('inbox/ (deferred to existing intake)');
  } else {
    // Single canonical drop zone (ADR-0045 §C): the project-root inbox/, with
    // a gitignored .staging/ for atomic rename-in handoff. Independent of any
    // docs lane.

    fs.mkdirSync(path.join(target, 'inbox', '.staging'), { recursive: true });
  }

  for (const { laneKey, reason } of deferredLanes) {
    process.stdout.write(`[init:docs] skipping docs/${DOC_LANES[laneKey].dir}/ — ${reason}. Run with --force to scaffold anyway.\n`);
    skipped.push(`docs/${DOC_LANES[laneKey].dir}/ (deferred to existing project structure)`);
  }

  for (const laneKey of lanesToScaffold) copyLaneTemplates(laneKey);
  for (const laneKey of selectedCustomLanes) createCustomLane(laneKey);

  if (!forceScaffold) {
    const summary = formatDeferralSummary(detection);
    if (summary) {
      process.stdout.write('\nDeferred to existing project structure (use --force to scaffold anyway):\n');
      process.stdout.write(`${summary}\n`);
    }
  }

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
  if (lanesToScaffold.length === 0 && selectedCustomLanes.length === 0) {
    process.stdout.write('\nDocs: docs/ only (add packs with --docs-preset=lean or construct init --interactive)\n');
  }

  process.stdout.write(`\n${created.length} created, ${skipped.length} skipped.\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
});
