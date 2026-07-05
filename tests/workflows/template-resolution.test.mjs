/**
 * tests/workflows/template-resolution.test.mjs — Static drift guard, not a code-behavior test.
 *
 * Never imports lib/workflows/instantiate.mjs or any other lib/*.mjs module — only
 * regex-parses templates/workflows/*.yml for `- template: <name>` entries and checks
 * fs.existsSync against templates/docs/<name>. No runtime resolution path is exercised here:
 * lib/workflows/instantiate.mjs copies the doc template when present and otherwise writes a
 * "template not found" stub, so a dangling reference would ship a stub instead of the
 * intended artifact at runtime — but a pass/fail here only reflects static drift (a
 * reference added or renamed without the corresponding templates/docs/ file), never an
 * instantiate.mjs regression. A failure is not proof that instantiate.mjs is broken; removal
 * requires confirming templates/docs/ coverage moves elsewhere first (construct-spoz).
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
