#!/usr/bin/env node
/**
 * lib/workflow-state.mjs — Read, write, and validate Construct workflow state.
 *
 * Manages the canonical workflow.json lifecycle: loading, phase transitions,
 * task status updates, validation, and executive-gate enforcement. Also builds
 * task packets for agent dispatch and derives plan.md summaries. Used by the
 * MCP workflow tools, CLI commands, and the concierge routing layer.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { routeRequest } from "./orchestration-policy.mjs";

const PHASES = ["research", "plan", "implement", "validate", "operate"];
const VALID_STATUS = new Set(["todo", "in-progress", "blocked", "blocked_needs_user", "blocked_needs_executive", "done", "skipped"]);

/**
 * High-gate checkpoints that require explicit Executive/Customer sign-off.
 * Work cannot transition out of these phases without an 'executive-approved' status.
 */
export const EXECUTIVE_GATES = {
  plan: "The plan requires executive approval before implementation.",
  validate: "Final validation requires executive sign-off before release."
};

function normalizePhase(value, fallback = null) {
  return PHASES.includes(value) ? value : fallback;
}

function normalizeWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object") return workflow;
  const normalizedPhase = normalizePhase(workflow.phase, workflow.phase);
  const normalizedPhases = {};

  for (const [key, entry] of Object.entries(workflow.phases || {})) {
    const phaseKey = normalizePhase(key, key);
    normalizedPhases[phaseKey] = {
      ...normalizedPhases[phaseKey],
      ...entry,
      owner: normalizePhase(entry?.owner, entry?.owner ?? phaseKey)
    };
  }

  workflow.phase = normalizedPhase;
  workflow.phases = normalizedPhases;
  workflow.tasks = (workflow.tasks || []).map((task) => ({
    ...task,
    phase: normalizePhase(task.phase, task.phase)
  }));
  return workflow;
}

function now() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "workflow";
}

function projectName(root) {
  try {
    const remote = execSync("git remote get-url origin", { cwd: root, timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const match = remote.match(/[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
    if (match) return match[1];
  } catch { /* remote origin read is non-critical */ }
  return path.basename(root);
}

export function workflowPath(root = process.cwd()) {
  return path.join(root, ".cx", "workflow.json");
}

export function defaultWorkflow(root = process.cwd(), title = "Untitled workflow", specRef = null) {
  const id = `${new Date().toISOString().slice(0, 10)}-${slugify(title)}`;
  return {
    version: 1,
    project: projectName(root),
    id,
    title,
    specRef: specRef || null,
    status: "in-progress",
    phase: "plan",
    currentTaskKey: null,
    updatedAt: now(),
    phases: {
      research: { owner: "research", status: "todo", summary: "Explore the problem and gather evidence." },
      plan: { owner: "plan", status: "in-progress", summary: "Define and challenge the approach." },
      implement: { owner: "implement", status: "todo", summary: "Build the approved solution." },
      validate: { owner: "validate", status: "todo", summary: "Verify correctness, security, accessibility, and tests." },
      operate: { owner: "operate", status: "todo", summary: "Run, release, deploy, or operationalize when needed." }
    },
    tasks: [],
    decisions: [],
    handoffs: [],
    alignment: {
      acceptanceCriteriaRequired: true,
      ownerRequired: true,
      readFirstRequired: true,
      doNotChangeRequired: true,
      verificationRequiredBeforeDone: true
    }
  };
}

export function loadWorkflow(root = process.cwd()) {
  const file = workflowPath(root);
  if (!fs.existsSync(file)) return null;
  return normalizeWorkflow(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function saveWorkflow(workflow, root = process.cwd()) {
  const file = workflowPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = {
    ...normalizeWorkflow(structuredClone(workflow)),
    updatedAt: now()
  };
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function createNeedsMainInputPacket({
  taskKey,
  worker,
  blocker,
  question,
  safeDefault,
  context = [],
}) {
  if (!taskKey) throw new Error("NEEDS_MAIN_INPUT requires taskKey");
  if (!worker) throw new Error("NEEDS_MAIN_INPUT requires worker");
  if (!blocker) throw new Error("NEEDS_MAIN_INPUT requires blocker");
  if (!question) throw new Error("NEEDS_MAIN_INPUT requires question");
  return {
    type: "NEEDS_MAIN_INPUT",
    taskKey,
    worker,
    blocker,
    question,
    safeDefault: safeDefault || null,
    context: Array.isArray(context) ? context : [String(context)],
    createdAt: now(),
  };
}

export function initWorkflow(root = process.cwd(), title = "Untitled workflow", specRef = null) {
  const existing = loadWorkflow(root);
  if (existing) return { workflow: existing, created: false };
  return { workflow: saveWorkflow(defaultWorkflow(root, title, specRef), root), created: true };
}

function nextTaskKey(workflow) {
  const used = new Set((workflow.tasks || []).map((task) => task.key));
  let n = 1;
  while (used.has(`todo:${n}`)) n += 1;
  return `todo:${n}`;
}

export function addTask(root, options) {
  const workflow = loadWorkflow(root) || defaultWorkflow(root, options.workflowTitle || "Untitled workflow");
  const phase = normalizePhase(options.phase || workflow.phase || "implement");
  if (!phase) throw new Error(`Invalid phase: ${options.phase || workflow.phase}`);
  const task = {
    key: options.key || nextTaskKey(workflow),
    title: options.title || "Untitled task",
    phase,
    owner: options.owner || phase,
    status: options.status || "todo",
    dependsOn: options.dependsOn || [],
    files: options.files || [],
    readFirst: options.readFirst || [],
    doNotChange: options.doNotChange || [],
    acceptanceCriteria: options.acceptanceCriteria || [],
    verification: options.verification || [],
    overlays: options.overlays || [],
    challengeRequired: Boolean(options.challengeRequired),
    challengeStatus: options.challengeStatus || null,
    tokenBudget: options.tokenBudget || null,
    tokensUsed: null,
    notes: [],
    createdAt: now(),
    updatedAt: now()
  };
  if (!VALID_STATUS.has(task.status)) throw new Error(`Invalid status: ${task.status}`);
  const existing = workflow.tasks || [];
  const normalizedTitle = task.title.trim().toLowerCase();
  const duplicate = existing.find((t) => {
    if (t.key === task.key) return true;
    if (t.status === "done" || t.status === "skipped") return false;
    return (t.title || "").trim().toLowerCase() === normalizedTitle;
  });
  if (duplicate) {
    if (!workflow.currentTaskKey) workflow.currentTaskKey = duplicate.key;
    return saveWorkflow(workflow, root);
  }
  workflow.tasks = [...existing, task];
  if (!workflow.currentTaskKey) workflow.currentTaskKey = task.key;
  return saveWorkflow(workflow, root);
}

export function buildTaskPacketFromIntent(request, options = {}) {
  const route = routeRequest({
    request: String(request || ""),
    fileCount: options.fileCount ?? 0,
    moduleCount: options.moduleCount ?? 0,
    introducesContract: options.introducesContract ?? false,
    explicitDrive: options.explicitDrive ?? false,
  });
  if (!route) return null;
  if (route.track === "immediate") return null;

  const defaults = {
    title: options.title || request || "User-requested task",
    phase: options.phase || (route.intent === "research" ? "research" : route.intent === "fix" ? "implement" : route.intent === "evaluation" ? "validate" : route.intent === "implementation" ? "implement" : "implement"),
    owner: options.owner || (route.workCategory === "analysis" ? "cx-architect" : route.workCategory === "writing" ? "cx-docs-keeper" : route.workCategory === "visual" ? "cx-designer" : route.workCategory === "deep" ? "cx-engineer" : "cx-engineer"),
    status: "todo",
    dependsOn: options.dependsOn || [],
    files: options.files || [],
    readFirst: options.readFirst || [],
    doNotChange: options.doNotChange || [],
    acceptanceCriteria: options.acceptanceCriteria || ["Task derived from user intent and tracked in workflow state"],
    verification: options.verification || [],
    overlays: options.overlays || [],
    challengeRequired: Boolean(options.challengeRequired ?? (route.track === "orchestrated")),
    challengeStatus: options.challengeStatus || null,
    source: {
      kind: "user-intent",
      intent: route.intent,
      workCategory: route.workCategory,
      track: route.track,
      specialists: route.specialists || [],
      dispatchPlan: route.dispatchPlan || null,
      request: String(request || ""),
    },
  };

  return { ...defaults, ...options, source: { ...defaults.source, ...(options.source || {}) } };
}

export function addTaskFromIntent(root, request, options = {}) {
  const packet = buildTaskPacketFromIntent(request, options);
  if (!packet) return null;
  return addTask(root, packet);
}

function parseCommaSeparated(value) {
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

function slugifyTitle(title, usedKeys) {
  const base = slugify(title);
  if (!usedKeys.has(base)) return base;
  let n = 2;
  while (usedKeys.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function parseRichSections(markdown, options) {
  const defaultPhase = normalizePhase(options.phase || "implement");
  const defaultOwner = options.owner || "cx-engineer";
  const defaultReadFirst = options.readFirst || [];
  const defaultDoNotChange = options.doNotChange || [];
  const defaultAcceptanceCriteria = options.acceptanceCriteria || [];

  const lines = String(markdown || "").split("\n");
  const sectionStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^###\s+T\d+\s*[—-]/.test(lines[i]) || /^###\s+T\d+$/.test(lines[i])) {
      sectionStarts.push(i);
    }
  }
  if (sectionStarts.length === 0) return null;

  const usedKeys = new Set();
  const tasks = [];

  for (let si = 0; si < sectionStarts.length; si++) {
    const start = sectionStarts[si];
    const end = si + 1 < sectionStarts.length ? sectionStarts[si + 1] : lines.length;
    const sectionLines = lines.slice(start, end);

    const headerMatch = sectionLines[0].match(/^###\s+T\d+\s*[—-]\s*(.+)$/) || sectionLines[0].match(/^###\s+(T\d+)$/);
    const title = headerMatch ? headerMatch[1].trim() : sectionLines[0].replace(/^###\s*/, "").trim();

    let owner = defaultOwner;
    let phase = defaultPhase;
    let files = [];
    let dependsOn = [];
    let readFirst = defaultReadFirst.slice();
    let doNotChange = defaultDoNotChange.slice();
    let acceptanceCriteria = [];
    let inAcceptanceCriteria = false;

    for (let li = 1; li < sectionLines.length; li++) {
      const line = sectionLines[li];
      const trimmed = line.trim();
      const field = trimmed.replace(/^[-*]\s+/, "");

      if (/^\*\*Owner\*\*\s*:/.test(field)) {
        owner = field.replace(/^\*\*Owner\*\*\s*:\s*/, "").trim() || defaultOwner;
        inAcceptanceCriteria = false;
        continue;
      }
      if (/^\*\*Phase\*\*\s*:/.test(field)) {
        phase = normalizePhase(field.replace(/^\*\*Phase\*\*\s*:\s*/, "").trim()) || defaultPhase;
        inAcceptanceCriteria = false;
        continue;
      }
      if (/^\*\*Files\*\*\s*:/.test(field)) {
        files = parseCommaSeparated(field.replace(/^\*\*Files\*\*\s*:\s*/, ""));
        inAcceptanceCriteria = false;
        continue;
      }
      if (/^\*\*Depends on\*\*\s*:/.test(field)) {
        const raw = field.replace(/^\*\*Depends on\*\*\s*:\s*/, "").trim();
        dependsOn = raw.toLowerCase() === "(none)" ? [] : parseCommaSeparated(raw);
        inAcceptanceCriteria = false;
        continue;
      }
      if (/^\*\*Read first\*\*\s*:/.test(field)) {
        readFirst = parseCommaSeparated(field.replace(/^\*\*Read first\*\*\s*:\s*/, ""));
        inAcceptanceCriteria = false;
        continue;
      }
      if (/^\*\*Do not change\*\*\s*:/.test(field)) {
        doNotChange = parseCommaSeparated(field.replace(/^\*\*Do not change\*\*\s*:\s*/, ""));
        inAcceptanceCriteria = false;
        continue;
      }
      if (/^\*\*Acceptance criteria\*\*\s*:/.test(field)) {
        inAcceptanceCriteria = true;
        continue;
      }
      if (inAcceptanceCriteria && /^[-*]\s+/.test(trimmed)) {
        acceptanceCriteria.push(trimmed.replace(/^[-*]\s+/, "").trim());
        continue;
      }
      if (inAcceptanceCriteria && trimmed && !/^[-*]/.test(trimmed) && !/^\*\*/.test(trimmed)) {
        inAcceptanceCriteria = false;
      }
    }

    if (acceptanceCriteria.length === 0) {
      acceptanceCriteria = defaultAcceptanceCriteria.length
        ? defaultAcceptanceCriteria
        : [`Complete: ${title}`];
    } else if (defaultAcceptanceCriteria.length) {
      acceptanceCriteria = [...acceptanceCriteria, ...defaultAcceptanceCriteria];
    }

    const key = slugifyTitle(title, usedKeys);
    usedKeys.add(key);

    tasks.push({ title, phase, owner, files, dependsOn, readFirst, doNotChange, acceptanceCriteria });
  }
  return tasks;
}

export function extractTasksFromPlan(markdown, options = {}) {
  const rich = parseRichSections(markdown, options);
  if (rich !== null) return rich;

  const phase = normalizePhase(options.phase || "implement");
  const owner = options.owner || "cx-engineer";
  const readFirst = options.readFirst || [];
  const doNotChange = options.doNotChange || [];
  const acceptanceCriteria = options.acceptanceCriteria || [];
  return String(markdown || "")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const checkbox = /^[-*]\s+\[[ xX]\]\s+(.+)$/.exec(line);
      if (checkbox) return checkbox[1].trim();
      const numbered = /^\d+\.\s+(.+)$/.exec(line);
      if (numbered) return numbered[1].trim();
      return null;
    })
    .filter(Boolean)
    .map((title) => ({
      title,
      phase,
      owner,
      readFirst,
      doNotChange,
      acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : [`Complete: ${title}`],
    }));
}

export function addTasksFromPlan(root, markdown, options = {}) {
  const tasks = extractTasksFromPlan(markdown, options);
  let workflow = loadWorkflow(root) || saveWorkflow(defaultWorkflow(root, options.workflowTitle || "Imported plan", options.specRef || null), root);
  if (options.specRef && !workflow.specRef) {
    workflow.specRef = options.specRef;
    workflow = saveWorkflow(workflow, root);
  }
  if (options.phase && PHASES.includes(options.phase)) {
    workflow = transitionPhase(root, options.phase);
  }
  for (const task of tasks) {
    workflow = addTask(root, task);
  }
  return { workflow, count: tasks.length };
}

export function updateTask(root, key, patch) {
  const workflow = loadWorkflow(root);
  if (!workflow) throw new Error("No .cx/workflow.json found. Run `construct workflow init` first.");
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  let found = false;
  workflow.tasks = (workflow.tasks || []).map((task) => {
    if (task.key !== key) return task;
    found = true;
    const notes = cleanPatch.note
      ? [...(task.notes || []), { at: now(), note: cleanPatch.note }]
      : task.notes || [];
    return {
      ...task,
      ...cleanPatch,
      notes,
      updatedAt: now()
    };
  });
  if (!found) throw new Error(`Task not found: ${key}`);
  if (cleanPatch.status && !VALID_STATUS.has(cleanPatch.status)) throw new Error(`Invalid status: ${cleanPatch.status}`);
  if (cleanPatch.status === "done") {
    const task = workflow.tasks.find((t) => t.key === key);
    if (task && task.phase === "implement" && workflow.alignment?.verificationRequiredBeforeDone !== false) {
      const mergedVerification = cleanPatch.verification ?? task.verification ?? [];
      if (mergedVerification.length === 0) {
        throw new Error(
          `Cannot mark implement-phase task "${key}" as done without verification evidence. ` +
          `Add cx-reviewer and cx-qa results to task.verification before marking done.`
        );
      }
    }
  }
  if (cleanPatch.status === "in-progress" || cleanPatch.status === "blocked_needs_user") workflow.currentTaskKey = key;
  if (cleanPatch.status === "done" && workflow.currentTaskKey === key) {
    workflow.currentTaskKey = (workflow.tasks || []).find((task) => task.status !== "done" && task.status !== "skipped")?.key || null;
  }
  return saveWorkflow(workflow, root);
}

export function transitionPhase(root, phase, status = "in-progress") {
  phase = normalizePhase(phase);
  if (!phase) throw new Error(`Invalid phase: ${phase}`);
  const workflow = loadWorkflow(root);
  if (!workflow) throw new Error("No .cx/workflow.json found. Run `construct workflow init` first.");
  workflow.phase = phase;
  workflow.phases = workflow.phases || {};
  for (const p of PHASES) {
    workflow.phases[p] = workflow.phases[p] || { owner: p, status: "todo" };
  }
  workflow.phases[phase] = { ...workflow.phases[phase], status };
  return saveWorkflow(workflow, root);
}

export function alignmentFindings(workflow) {
  if (!workflow) {
    return [{
      severity: "HIGH",
      issue: "No .cx/workflow.json found",
      fix: "Run `construct workflow init \"<title>\"` at the project root."
    }];
  }
  const findings = [];
  const tasks = workflow.tasks || [];
  const current = tasks.find((task) => task.key === workflow.currentTaskKey);
  if (current && current.phase !== workflow.phase) {
    findings.push({
      severity: "HIGH",
      task: current.key,
      issue: `Current task phase (${current.phase}) does not match workflow phase (${workflow.phase})`,
      fix: `Run \`construct workflow phase ${current.phase}\` or move the task to the active phase.`
    });
  }
  if (workflow.status === "in-progress" && tasks.length === 0) {
    findings.push({
      severity: "MEDIUM",
      issue: "Workflow has no tasks",
      fix: "Add scoped tasks with owners, read-first files, protected files, and acceptance criteria."
    });
  }
  for (const task of tasks) {
    if (!task.owner) findings.push({ severity: "HIGH", task: task.key, issue: "Task has no owner", fix: "Set owner to a persona or cx-specialist." });
    if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
      findings.push({ severity: "HIGH", task: task.key, issue: "Task has no acceptance criteria", fix: "Add binary pass/fail acceptance criteria." });
    }
    if (!Array.isArray(task.readFirst) || task.readFirst.length === 0) {
      findings.push({ severity: "MEDIUM", task: task.key, issue: "Task has no readFirst list", fix: "Add files, docs, or memory queries to inspect before work." });
    }
    if (!Array.isArray(task.doNotChange) || task.doNotChange.length === 0) {
      findings.push({ severity: "MEDIUM", task: task.key, issue: "Task has no doNotChange list", fix: "Add explicit drift boundaries." });
    }
    if (task.status === "done" && (!Array.isArray(task.verification) || task.verification.length === 0)) {
      findings.push({ severity: "HIGH", task: task.key, issue: "Done task has no verification evidence", fix: "Record commands, checks, or review evidence before marking done." });
    }
    for (const dep of task.dependsOn || []) {
      const depTask = tasks.find((candidate) => candidate.key === dep);
      if (!depTask) findings.push({ severity: "HIGH", task: task.key, issue: `Unknown dependency ${dep}`, fix: "Remove or correct dependsOn." });
      if (depTask && task.status === "in-progress" && !["done", "skipped"].includes(depTask.status)) {
        findings.push({ severity: "HIGH", task: task.key, issue: `Started before dependency ${dep} completed`, fix: "Finish dependency first or revise task graph." });
      }
    }
  }
  return findings;
}

export function validateWorkflowState(workflow) {
  const errors = [];
  if (!workflow || typeof workflow !== "object") {
    return { valid: false, errors: ["workflow: must be an object"] };
  }
  if (workflow.version !== 1) errors.push("workflow.version: must be 1");
  if (!workflow.id || typeof workflow.id !== "string") errors.push("workflow.id: must be a non-empty string");
  if (!workflow.title || typeof workflow.title !== "string") errors.push("workflow.title: must be a non-empty string");
  if (!normalizePhase(workflow.phase)) errors.push(`workflow.phase: invalid phase '${workflow.phase}'`);
  if (!["in-progress", "blocked", "done", "skipped"].includes(workflow.status)) {
    errors.push(`workflow.status: invalid status '${workflow.status}'`);
  }
  if (!Array.isArray(workflow.tasks)) errors.push("workflow.tasks: must be an array");

  const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
  const keys = new Set();
  for (const task of tasks) {
    if (!task.key || typeof task.key !== "string") errors.push("task: key must be a non-empty string");
    else if (keys.has(task.key)) errors.push(`${task.key}: duplicate task key`);
    else keys.add(task.key);

    if (!task.title || typeof task.title !== "string") errors.push(`${task.key || "task"}: title must be a non-empty string`);
    if (!normalizePhase(task.phase)) errors.push(`${task.key || "task"}: invalid phase '${task.phase}'`);
    if (!task.owner || typeof task.owner !== "string") errors.push(`${task.key || "task"}: owner must be a non-empty string`);
    if (!VALID_STATUS.has(task.status)) errors.push(`${task.key || "task"}: invalid status '${task.status}'`);
    if (!Array.isArray(task.dependsOn)) errors.push(`${task.key || "task"}: dependsOn must be an array`);
    if (!Array.isArray(task.readFirst)) errors.push(`${task.key || "task"}: readFirst must be an array`);
    if (!Array.isArray(task.doNotChange)) errors.push(`${task.key || "task"}: doNotChange must be an array`);
    if (!Array.isArray(task.acceptanceCriteria)) errors.push(`${task.key || "task"}: acceptanceCriteria must be an array`);
    if (!Array.isArray(task.verification)) errors.push(`${task.key || "task"}: verification must be an array`);
    if (task.overlays !== undefined && !Array.isArray(task.overlays)) errors.push(`${task.key || "task"}: overlays must be an array`);
  }

  for (const finding of alignmentFindings(workflow)) {
    if (finding.severity === "HIGH") errors.push(`${finding.task ? `${finding.task}: ` : ""}${finding.issue}`);
  }

  return { valid: errors.length === 0, errors };
}

export function summarizeWorkflow(workflow) {
  if (!workflow) return "No workflow state found.";
  const tasks = workflow.tasks || [];
  const done = tasks.filter((task) => task.status === "done" || task.status === "skipped").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const current = tasks.find((task) => task.key === workflow.currentTaskKey);
  const lines = [
    `${workflow.title} (${workflow.id})`,
    `Status: ${workflow.status} | Phase: ${workflow.phase} | Tasks: ${done}/${tasks.length} complete${blocked ? ` | Blocked: ${blocked}` : ""}`
  ];
  if (current) lines.push(`Current: ${current.key} ${current.title} -> ${current.owner} [${current.status}]`);
  return lines.join("\n");
}

export function inspectWorkflowHealth(workflow, { cwd = process.cwd() } = {}) {
  const findings = alignmentFindings(workflow);
  const activeTask = workflow?.tasks?.find((task) => task.key === workflow?.currentTaskKey) || null;
  const highSeverityCount = findings.filter((finding) => finding.severity === 'HIGH').length;
  const alignmentStatus = workflow
    ? findings.length === 0
      ? 'pass'
      : highSeverityCount > 0 ? 'fail' : 'warn'
    : 'missing';

  return {
    cwd,
    exists: Boolean(workflow),
    phase: workflow?.phase ?? null,
    lifecycleStatus: workflow?.status ?? null,
    currentTaskKey: workflow?.currentTaskKey ?? null,
    summary: summarizeWorkflow(workflow),
    activeTask: activeTask
      ? {
          key: activeTask.key ?? null,
          title: activeTask.title ?? null,
          phase: activeTask.phase ?? null,
          owner: activeTask.owner ?? null,
          status: activeTask.status ?? null,
        }
      : {
          key: null,
          title: null,
          phase: null,
          owner: null,
          status: null,
        },
    alignment: {
      status: alignmentStatus,
      findings,
      findingCount: findings.length,
      highSeverityCount,
    },
  };
}

function parseOptions(args) {
  const result = { _: [] };
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const [key, raw = "true"] = arg.slice(2).split("=");
    result[key] = raw;
  }
  return result;
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function printStatus(root) {
  const workflow = loadWorkflow(root);
  console.log(summarizeWorkflow(workflow));
  if (!workflow) return;
  for (const task of workflow.tasks || []) {
    console.log(`  ${task.key.padEnd(8)} ${task.status.padEnd(11)} ${task.phase.padEnd(8)} ${task.owner.padEnd(18)} ${task.title}`);
  }
}

function printAlign(root) {
  const workflow = loadWorkflow(root);
  const findings = alignmentFindings(workflow);
  if (workflow) console.log(summarizeWorkflow(workflow));
  if (findings.length === 0) {
    console.log("Alignment: PASS");
    return;
  }
  console.log(`Alignment: ${findings.some((f) => f.severity === "HIGH") ? "FAIL" : "WARN"}`);
  for (const finding of findings) {
    const prefix = finding.task ? `${finding.severity} ${finding.task}` : finding.severity;
    console.log(`  ${prefix}: ${finding.issue}`);
    console.log(`    fix: ${finding.fix}`);
  }
}

export function approveWorkflow(root = process.cwd(), note = "Approved by Executive") {
  const workflow = loadWorkflow(root);
  if (!workflow) throw new Error("Workflow not found");
  
  workflow.status = "in-progress";
  workflow.updatedAt = now();
  
  const phase = workflow.phase;
  if (workflow.phases[phase]) {
    workflow.phases[phase].status = "executive-approved";
    if (!workflow.phases[phase].notes) workflow.phases[phase].notes = [];
    workflow.phases[phase].notes.push({ date: now(), text: note });
  }
  
  saveWorkflow(root, workflow);
  return workflow;
}

export function approveTask(root = process.cwd(), key, note = "Approved by Executive") {
  const workflow = loadWorkflow(root);
  if (!workflow) throw new Error("Workflow not found");
  
  const task = workflow.tasks.find(t => t.key === key);
  if (!task) throw new Error(`Task ${key} not found`);
  
  task.status = "todo";
  if (!task.notes) task.notes = [];
  task.notes.push({ date: now(), text: note });
  
  workflow.updatedAt = now();
  saveWorkflow(root, workflow);
  return workflow;
}
export function runWorkflowCli(argv = process.argv.slice(2), root = process.cwd()) {
  const [command = "status", ...rest] = argv;
  const options = parseOptions(rest);
  if (command === "init") {
    const title = options._.join(" ") || options.title || "Untitled workflow";
    const { workflow, created } = initWorkflow(root, title);
    console.log(`${created ? "Created" : "Existing"} .cx/workflow.json`);
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "status") {
    printStatus(root);
    return;
  }
  if (command === "add") {
    const title = options.title || options._.join(" ");
    if (!title) throw new Error("Usage: construct workflow add --title=\"...\" [--phase=implement] [--owner=cx-engineer]");
    const workflow = addTask(root, {
      title,
      phase: options.phase,
      owner: options.owner,
      files: splitList(options.files),
      readFirst: splitList(options.readFirst),
      doNotChange: splitList(options.doNotChange),
      acceptanceCriteria: splitList(options.acceptance),
      verification: splitList(options.verification),
      dependsOn: splitList(options.dependsOn),
      tokenBudget: options.tokenBudget ? Number(options.tokenBudget) : undefined
    });
    console.log("Task added.");
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "from-plan") {
    const file = options._[0] || options.file;
    if (!file) throw new Error("Usage: construct workflow from-plan plan.md [--phase=implement] [--owner=cx-engineer]");
    const markdown = fs.readFileSync(path.resolve(root, file), "utf8");
    const { workflow, count } = addTasksFromPlan(root, markdown, {
      phase: options.phase,
      owner: options.owner,
      readFirst: splitList(options.readFirst),
      doNotChange: splitList(options.doNotChange),
      acceptanceCriteria: splitList(options.acceptance),
      workflowTitle: options.title,
    });
    console.log(`Imported ${count} task${count === 1 ? "" : "s"} from ${file}.`);
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "task") {
    const key = options.task || options.key || options._[0];
    if (!key) throw new Error("Usage: construct workflow task todo:1 --status=in-progress [--note=\"...\"]");
    const workflow = updateTask(root, key, {
      status: options.status,
      owner: options.owner,
      phase: options.phase,
      note: options.note,
      verification: options.verification ? splitList(options.verification) : undefined,
      overlays: options.overlays ? splitList(options.overlays) : undefined,
      challengeRequired: options.challengeRequired !== undefined ? options.challengeRequired === "true" : undefined,
      challengeStatus: options.challengeStatus !== undefined ? options.challengeStatus : undefined,
    });
    console.log("Task updated.");
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "phase") {
    const phase = options.phase || options._[0];
    if (!phase) throw new Error("Usage: construct workflow phase implement [--status=in-progress]");
    const workflow = transitionPhase(root, phase, options.status || "in-progress");
    console.log("Phase updated.");
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "align") {
    printAlign(root);
    return;
  }
  if (command === "approve") {
    const workflow = approveWorkflow(root, options.note);
    console.log("Workflow approved by executive.");
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "approve-task") {
    const key = options.task || options.key || options._[0];
    const workflow = approveTask(root, key, options.note);
    console.log(`Task ${key} approved by executive.`);
    console.log(summarizeWorkflow(workflow));
    return;
  }
  throw new Error(`Unknown workflow subcommand: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runWorkflowCli(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
