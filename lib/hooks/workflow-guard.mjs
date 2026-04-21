#!/usr/bin/env node
/**
 * lib/hooks/workflow-guard.mjs — Workflow guard hook — enforces that significant work flows through the workflow state.
 *
 * Runs as PreToolUse on implement tasks. Checks that the active workflow task is set before allowing non-trivial Bash or Edit operations. Warns without blocking.
 */
import { readFileSync } from "node:fs";
import { loadWorkflow, alignmentFindings, summarizeWorkflow } from "../workflow-state.mjs";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const text = [
  input?.prompt,
  input?.message,
  input?.transcript,
  input?.last_message,
  input?.assistant_message
].filter(Boolean).join("\n").toLowerCase();

if (/\b(stop|pause|halt|enough|abort|cancel)\b/.test(text)) {
  process.exit(0);
}

const cwd = input?.cwd || process.cwd();
const workflow = loadWorkflow(cwd);
if (!workflow || workflow.status !== "in-progress") {
  process.exit(0);
}

const tasks = workflow.tasks || [];
const openTasks = tasks.filter((task) => !["done", "skipped"].includes(task.status));
const findings = alignmentFindings(workflow).filter((finding) => finding.severity === "HIGH");

if (openTasks.length === 0 && findings.length === 0) {
  process.exit(0);
}

const next = tasks.find((task) => task.key === workflow.currentTaskKey) || openTasks[0];
const lines = [
  "Construct workflow is still active.",
  summarizeWorkflow(workflow)
];

if (next) {
  lines.push(`Next task: ${next.key} ${next.title} -> ${next.owner} [${next.status}]`);
}

if (findings.length > 0) {
  lines.push(`Alignment blockers: ${findings.length}`);
  for (const finding of findings.slice(0, 3)) {
    lines.push(`- ${finding.task ? `${finding.task}: ` : ""}${finding.issue}`);
  }
}

lines.push("Continue the current workflow, update .cx/workflow.json, or explicitly say stop/pause to end.");
console.error(lines.join("\n"));
process.exit(2);
