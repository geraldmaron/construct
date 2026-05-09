/**
 * workflow-runtime.test.mjs — Integration tests for workflow state read/write and phase transitions.
 *
 * Covers: load, task status updates, phase advancement, executive-gate
 * enforcement, validation errors, and plan.md synchronisation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addTask,
  addTasksFromPlan,
  alignmentFindings,
  createNeedsMainInputPacket,
  extractTasksFromPlan,
  initWorkflow,
  loadWorkflow,
  transitionPhase,
  updateTask,
  validateWorkflowState,
} from "../lib/workflow-state.mjs";

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "construct-workflow-test-"));
}

test("workflow alignment requires Construct-native task packets", () => {
  const root = tempProject();
  initWorkflow(root, "Worker packet contract");
  const workflow = addTask(root, {
    title: "Implement task runtime",
    phase: "implement",
    owner: "cx-engineer",
    acceptanceCriteria: ["runtime state is enforced"],
  });

  const findings = alignmentFindings(workflow);
  assert.equal(findings.some((f) => f.issue.includes("readFirst")), true);
  assert.equal(findings.some((f) => f.issue.includes("doNotChange")), true);
});

test("done tasks require verification evidence", () => {
  const root = tempProject();
  initWorkflow(root, "Verification gate");
  let workflow = addTask(root, {
    title: "Verify before done",
    phase: "implement",
    owner: "cx-engineer",
    readFirst: ["src/index.ts"],
    doNotChange: ["package-lock.json"],
    acceptanceCriteria: ["tests pass"],
  });

  // The done-gate now throws hard when verification is missing for implement tasks.
  assert.throws(
    () => updateTask(root, workflow.tasks[0].key, { status: "done" }),
    /Cannot mark implement-phase task.*without verification evidence/
  );

  // Alignment still surfaces the finding when a done task has no verification
  // (e.g. state loaded from an older workflow.json that predates the gate).
  workflow.tasks[0].status = "done"; // bypass gate by mutating directly
  const findings = alignmentFindings(workflow);
  assert.equal(findings.some((f) => f.issue.includes("verification evidence")), true);
});

test("blocked_needs_user is a first-class worker status", () => {
  const root = tempProject();
  initWorkflow(root, "Needs input");
  let workflow = addTask(root, {
    title: "Ask main session",
    phase: "implement",
    owner: "cx-ai-engineer",
    readFirst: ["prompts/system.md"],
    doNotChange: ["secrets.env"],
    acceptanceCriteria: ["main session asks the user"],
  });
  workflow = updateTask(root, workflow.tasks[0].key, {
    status: "blocked_needs_user",
    note: "Need product choice from user",
  });

  assert.equal(workflow.tasks[0].status, "blocked_needs_user");
  assert.equal(workflow.currentTaskKey, workflow.tasks[0].key);
});

test("NEEDS_MAIN_INPUT packet is structured for primary persona resumption", () => {
  const packet = createNeedsMainInputPacket({
    taskKey: "todo:7",
    worker: "cx-security",
    blocker: "Cannot choose an auth policy safely",
    question: "Should this endpoint be admin-only or project-member writable?",
    safeDefault: "admin-only",
    context: ["api/routes/projects.ts"],
  });

  assert.equal(packet.type, "NEEDS_MAIN_INPUT");
  assert.equal(packet.taskKey, "todo:7");
  assert.equal(packet.safeDefault, "admin-only");
  assert.deepEqual(packet.context, ["api/routes/projects.ts"]);
});

test("workflow schema validator catches broken dependencies and phase drift", () => {
  const root = tempProject();
  initWorkflow(root, "Schema validation");
  let workflow = addTask(root, {
    title: "Blocked task",
    phase: "implement",
    owner: "cx-engineer",
    readFirst: ["src/a.ts"],
    doNotChange: ["src/b.ts"],
    acceptanceCriteria: ["done"],
    dependsOn: ["todo:99"],
  });
  transitionPhase(root, "validate");
  workflow = loadWorkflow(root);

  const result = validateWorkflowState(workflow);
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((error) => error.includes("Unknown dependency todo:99")), true);
  assert.equal(result.errors.some((error) => error.includes("does not match workflow phase")), true);
});

test("plans can be imported into workflow task packets", () => {
  const root = tempProject();
  const plan = [
    "- [ ] Update contracts",
    "- [ ] Add lifecycle hooks",
    "1. Verify generated adapters",
  ].join("\n");
  const { workflow, count } = addTasksFromPlan(root, plan, {
    phase: "implement",
    owner: "cx-engineer",
    readFirst: ["plan.md"],
    doNotChange: [".env"],
  });

  assert.equal(count, 3);
  assert.equal(workflow.tasks.length, 3);
  assert.equal(workflow.tasks[0].owner, "cx-engineer");
  assert.deepEqual(workflow.tasks[0].readFirst, ["plan.md"]);
});

test("extractTasksFromPlan parses rich T-section format into full task packets", () => {
  const plan = `
## Tasks

### T1 — Setup backend
- **Owner**: cx-engineer
- **Phase**: implement
- **Files**: lib/backend.mjs
- **Depends on**: (none)
- **Read first**: lib/noop.mjs
- **Do not change**: .env
- **Acceptance criteria**:
  - exports listTraces function
  - passes unit test

### T2 — Wire rollup
- **Owner**: cx-engineer
- **Phase**: implement
- **Files**: lib/rollup.mjs
- **Depends on**: T1
- **Read first**: lib/backend.mjs
- **Acceptance criteria**:
  - resolveBackend returns correct adapter
`;
  const tasks = extractTasksFromPlan(plan);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "Setup backend");
  assert.equal(tasks[0].owner, "cx-engineer");
  assert.deepEqual(tasks[0].files, ["lib/backend.mjs"]);
  assert.deepEqual(tasks[0].readFirst, ["lib/noop.mjs"]);
  assert.deepEqual(tasks[0].doNotChange, [".env"]);
  assert.deepEqual(tasks[0].acceptanceCriteria, ["exports listTraces function", "passes unit test"]);
  assert.deepEqual(tasks[0].dependsOn, []);
  assert.equal(tasks[1].title, "Wire rollup");
  assert.deepEqual(tasks[1].dependsOn, ["T1"]);
});

test("extractTasksFromPlan falls back to flat list when no T-sections present", () => {
  const plan = ["- [ ] Update contracts", "- [ ] Add hooks", "1. Verify adapters"].join("\n");
  const tasks = extractTasksFromPlan(plan, { owner: "cx-engineer" });
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].owner, "cx-engineer");
});
