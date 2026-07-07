/**
 * tests/workflows/template-shape.test.mjs — Static drift guard, not a code-behavior test.
 *
 * Never imports any lib/*.mjs module or CLI code — only regex-checks templates/workflows/*.yml
 * for the required top-level fields (id, title, artifacts), the id slug pattern, an optional
 * positive-integer version, and a 1:1 template/path count in the artifacts block. A pattern
 * match instead of a full YAML parser keeps the test dependency-free, at the cost of never
 * confirming any lib/*.mjs consumer actually parses these fields the same way. A failure here
 * flags shape drift in the static template files themselves, never a regression in workflow
 * instantiation code; removal requires confirming this shape coverage moves elsewhere first
 * (construct-spoz).
 *
 * Coverage: every .yml file present at test-run time is checked automatically,
 * so new templates are validated without editing this file.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT_DIR = path.resolve(import.meta.dirname, "../..");
const WORKFLOWS_DIR = path.join(ROOT_DIR, "templates", "workflows");

// Required top-level YAML keys and the regex that detects them at the start of a line.
const REQUIRED_FIELDS = [
  { name: "id", pattern: /^id\s*:/m },
  { name: "title", pattern: /^title\s*:/m },
  { name: "artifacts", pattern: /^artifacts\s*:/m },
];

// id values must match the slug pattern from the schema.
const ID_PATTERN = /^id\s*:\s*([a-z][a-z0-9-]*)$/m;

// The version field, when present, must be a positive integer.
const VERSION_PATTERN = /^version\s*:\s*(\d+)$/m;

function loadTemplateFiles() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({ file: f, fullPath: path.join(WORKFLOWS_DIR, f) }));
}

const templates = loadTemplateFiles();

describe("workflow template shape", () => {
  it("templates/workflows/ directory exists", () => {
    assert.ok(
      fs.existsSync(WORKFLOWS_DIR),
      `Expected directory to exist: ${WORKFLOWS_DIR}`
    );
  });

  it("at least one workflow template is present", () => {
    assert.ok(
      templates.length > 0,
      "No .yml files found in templates/workflows/"
    );
  });

  for (const { file, fullPath } of templates) {
    describe(file, () => {
      let content;

      it("file is readable and non-empty", () => {
        content = fs.readFileSync(fullPath, "utf8");
        assert.ok(content.trim().length > 0, `${file} is empty`);
      });

      for (const { name, pattern } of REQUIRED_FIELDS) {
        it(`has required field: ${name}`, () => {
          if (!content) content = fs.readFileSync(fullPath, "utf8");
          assert.ok(
            pattern.test(content),
            `${file} is missing required top-level field "${name}"`
          );
        });
      }

      it("id matches slug pattern [a-z][a-z0-9-]*", () => {
        if (!content) content = fs.readFileSync(fullPath, "utf8");
        const match = content.match(ID_PATTERN);
        assert.ok(match, `${file}: id field not found or does not match slug pattern`);
      });

      it("version, if present, is a positive integer", () => {
        if (!content) content = fs.readFileSync(fullPath, "utf8");
        const match = content.match(VERSION_PATTERN);
        if (!match) return; // version is optional
        const v = Number(match[1]);
        assert.ok(v >= 1, `${file}: version must be >= 1, got ${v}`);
      });

      it("artifacts block contains at least one template entry", () => {
        if (!content) content = fs.readFileSync(fullPath, "utf8");
        // After the artifacts: line, there must be at least one "- template:" entry.
        const artifactsSection = content.slice(content.search(/^artifacts\s*:/m));
        assert.ok(
          /^\s+- template\s*:/m.test(artifactsSection),
          `${file}: artifacts block has no "- template:" entries`
        );
      });

      it("all artifact entries have a path field", () => {
        if (!content) content = fs.readFileSync(fullPath, "utf8");
        // Count template: lines and path: lines within the artifacts block.
        const artifactsStart = content.search(/^artifacts\s*:/m);
        // Find the next top-level key after artifacts (zero-indented line not starting with ' ').
        const afterArtifacts = content.slice(artifactsStart + "artifacts:".length);
        const nextTopLevel = afterArtifacts.search(/\n[a-z]/);
        const artifactsBlock =
          nextTopLevel === -1 ? afterArtifacts : afterArtifacts.slice(0, nextTopLevel);

        const templateCount = (artifactsBlock.match(/^\s+- template\s*:/gm) || []).length;
        const pathCount = (artifactsBlock.match(/^\s+path\s*:/gm) || []).length;

        assert.equal(
          templateCount,
          pathCount,
          `${file}: mismatch between template entries (${templateCount}) and path entries (${pathCount}) in artifacts`
        );
      });
    });
  }
});
