/**
 * tests/workflows/template-resolution.test.mjs — Reference integrity for workflow templates.
 *
 * Every `- template: <name>` entry in templates/workflows/*.yml must resolve to
 * a real doc template at templates/docs/<name>. Workflow instantiation copies
 * the doc template when present and otherwise writes a "template not found" stub
 * (lib/workflows/instantiate.mjs), so a dangling reference ships a stub instead
 * of the intended artifact. This test fails loudly on that drift.
 *
 * Coverage: every .yml file present at test-run time is scanned automatically,
 * so new workflows and new template references are validated without edits here.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT_DIR = path.resolve(import.meta.dirname, "../..");
const WORKFLOWS_DIR = path.join(ROOT_DIR, "templates", "workflows");
const DOCS_DIR = path.join(ROOT_DIR, "templates", "docs");

const TEMPLATE_REF_PATTERN = /^\s*-\s*template\s*:\s*"?([^"\n]+?)"?\s*$/gm;

function loadWorkflowFiles() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({ file: f, fullPath: path.join(WORKFLOWS_DIR, f) }));
}

function extractTemplateRefs(content) {
  const refs = [];
  let match;
  TEMPLATE_REF_PATTERN.lastIndex = 0;
  while ((match = TEMPLATE_REF_PATTERN.exec(content)) !== null) {
    refs.push(match[1].trim());
  }
  return refs;
}

const workflows = loadWorkflowFiles();

describe("workflow template references resolve", () => {
  it("at least one workflow template is present", () => {
    assert.ok(workflows.length > 0, "No .yml files found in templates/workflows/");
  });

  for (const { file, fullPath } of workflows) {
    describe(file, () => {
      const content = fs.readFileSync(fullPath, "utf8");
      const refs = extractTemplateRefs(content);

      it("declares at least one template reference", () => {
        assert.ok(refs.length > 0, `${file}: no "- template:" entries found`);
      });

      for (const ref of refs) {
        it(`template "${ref}" resolves to templates/docs/`, () => {
          const docPath = path.join(DOCS_DIR, ref);
          assert.ok(
            fs.existsSync(docPath),
            `${file} references template "${ref}" but ${docPath} does not exist`
          );
        });
      }
    });
  }
});
