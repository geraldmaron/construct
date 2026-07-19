/**
 * worker-profile-prompts.test.mjs — Worker Profile prompt corpus contracts.
 *
 * Verifies registry integrity and canonical prompt ownership.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inlinePerspectiveAntiPatterns, PERSPECTIVE_DIRECTIVE_RE } from "../lib/perspective-preload.mjs";
import { stripLeadingYamlFrontmatter } from "../lib/prompt-composer.mjs";
import { loadRegistry } from "../lib/registry/loader.mjs";
import { resolveWorkerProfilePromptPath } from "../lib/prompt-metadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Budgets are about emitted prompt tokens; YAML frontmatter does not count.
function promptWordCount(content) {
  return wordCount(stripLeadingYamlFrontmatter(content));
}

test("Worker Profiles own canonical prompt files", () => {
  const registry = loadRegistry({ rootDir: root });
  for (const profile of Object.values(registry.workerProfiles)) {
    assert.ok(profile.id, "Worker Profile missing id");
    assert.ok(profile.displayName, `Worker Profile ${profile.id} missing displayName`);
    const promptPath = resolveWorkerProfilePromptPath(profile.id, { rootDir: root, registry });
    assert.equal(promptPath, `registry/worker-profiles/prompts/${profile.id}.md`);
    assert.ok(fs.existsSync(path.join(root, promptPath)), `${profile.id}: canonical prompt missing`);
  }
});

test("every Worker Profile perspective reference resolves to an existing skill", () => {
  const registry = loadRegistry({ rootDir: root });
  for (const profile of Object.values(registry.workerProfiles)) {
    const promptPath = resolveWorkerProfilePromptPath(profile.id, { rootDir: root, registry });
    const content = fs.readFileSync(path.join(root, promptPath), "utf8");
    const match = content.match(PERSPECTIVE_DIRECTIVE_RE);
    if (!match) continue;
    const ref = match[1];
    const [core, flavor] = ref.split(".");
    const coreFile = path.join(root, "skills", "perspectives", `${core}.md`);
    assert.ok(fs.existsSync(coreFile), `${profile.id}: core perspective missing — ${coreFile}`);
    assert.ok(fs.readFileSync(coreFile, "utf8").length > 200, `${core}.md too short`);
    if (flavor) {
      const flavorFile = path.join(root, "skills", "perspectives", `${core}.${flavor}.md`);
      assert.ok(fs.existsSync(flavorFile), `${profile.id}: flavor perspective missing — ${flavorFile}`);
    }
  }
});

test("product manager flavor overlays exist for Product Intelligence routing", () => {
  const flavors = ["product", "platform", "enterprise", "ai-product", "growth"];
  for (const flavor of flavors) {
    const p = path.join(root, "skills", "perspectives", `product-manager.${flavor}.md`);
    assert.ok(fs.existsSync(p), `Missing product-manager flavor overlay: ${p}`);
    const content = fs.readFileSync(p, "utf8");
    assert.match(content, new RegExp(`perspective:\\s*product-manager\\.${flavor.replace("-", "\\-")}`));
    assert.ok(content.length > 500, `${p} too short to provide useful guidance`);
  }
});

test("domain role flavor overlays exist for routing metadata", () => {
  const splitRoles = ["ai-engineer", "platform-engineer"];
  for (const role of splitRoles) {
    const p = path.join(root, "skills", "perspectives", `${role}.md`);
    assert.ok(fs.existsSync(p), `Missing split role overlay: ${p}`);
    const content = fs.readFileSync(p, "utf8");
    assert.match(content, new RegExp(`perspective:\\s*${role}`));
    assert.ok(content.length > 500, `${p} too short to provide useful guidance`);
  }

  const overlays = {
    architect: ["platform", "integration", "data", "ai-systems", "enterprise"],
    qa: ["web-ui", "api-contract", "data-pipeline", "ai-eval"],
    security: ["appsec", "cloud", "ai", "privacy", "supply-chain"],
    "data-analyst": ["product", "experiment", "telemetry", "product-intelligence"],
    "data-engineer": ["pipeline", "warehouse", "vector-retrieval"],
  };

  for (const [role, flavors] of Object.entries(overlays)) {
    for (const flavor of flavors) {
      const p = path.join(root, "skills", "perspectives", `${role}.${flavor}.md`);
      assert.ok(fs.existsSync(p), `Missing ${role} flavor overlay: ${p}`);
      const content = fs.readFileSync(p, "utf8");
      assert.match(content, new RegExp(`perspective:\\s*${role}\\.${flavor.replace("-", "\\-")}`));
      assert.ok(content.length > 500, `${p} too short to provide useful guidance`);
    }
  }
});

test("orchestrator perspective stays compact", () => {
  const perspectivePath = path.join(root, "skills", "perspectives", "orchestrator.md");
  const content = fs.readFileSync(perspectivePath, "utf8");
  const count = wordCount(content);
  assert.ok(count <= 450, `orchestrator perspective too large: ${count} words`);
});

test("inlinePerspectiveAntiPatterns expands the directive when preload: true", () => {
  // On-demand is the default (see rules/common/skill-composition.md). Preload
  // is opt-in for hosts without reliable runtime get_skill.
  const src = '**Perspective guidance**: call `get_skill("perspectives/ai-engineer")` before drafting.';
  const out = inlinePerspectiveAntiPatterns(src, root, "ai-engineer", () => {}, { preload: true });
  assert.ok(!/get_skill\("perspectives\//.test(out), "raw directive should be expanded");
  assert.match(out, /## Perspective guidance/);
  assert.match(out, /Prompt tuning without evals/i);
});

test("inlinePerspectiveAntiPatterns defaults to on-demand (leaves directive in place)", () => {
  const src = '**Perspective guidance**: call `get_skill("perspectives/ai-engineer")` before drafting.';
  const out = inlinePerspectiveAntiPatterns(src, root, "ai-engineer", () => {});
  assert.strictEqual(out, src, "default should leave the directive untouched for runtime get_skill");
});

test("inlinePerspectiveAntiPatterns is a no-op when no directive present", () => {
  const src = "nothing to inline here";
  assert.strictEqual(inlinePerspectiveAntiPatterns(src, root, "x", () => {}, { preload: true }), src);
});

test("get_template shipped defaults all exist for template names referenced in prompts", () => {
  const registry = loadRegistry({ rootDir: root });
  const names = new Set();
  for (const profile of Object.values(registry.workerProfiles)) {
    const promptPath = resolveWorkerProfilePromptPath(profile.id, { rootDir: root, registry });
    const content = fs.readFileSync(path.join(root, promptPath), "utf8");
    for (const m of content.matchAll(/get_template\("([^"]+)"\)/g)) {
      if (m[1] === m[1].toUpperCase()) continue; // skip placeholder like "NAME"
      names.add(m[1]);
    }
  }
  for (const name of names) {
    const p = path.join(root, "templates", "docs", `${name}.md`);
    assert.ok(fs.existsSync(p), `Template missing for get_template("${name}") → ${p}`);
  }
});

test("prompt source files stay within token-efficiency budgets", () => {
  const registry = loadRegistry({ rootDir: root });
  const orchestrator = registry.workerProfiles.orchestrator;
  for (const profile of [orchestrator].filter(Boolean)) {
    const promptPath = resolveWorkerProfilePromptPath(profile.id, { rootDir: root, registry });
    const content = fs.readFileSync(path.join(root, promptPath), "utf8");
    const count = promptWordCount(content);
    // Persona cap is 1000 words. Baseline rule-of-thumb is 900 for an
    // always-on prompt; the extra 100 words are reserved for behavioral
    // mandates the model cannot get from code (currently: the call-the-
    // orchestration_policy mandate and the neurodivergent-output style
    // rule). Anything restated from code belongs in the policy module,
    // not here — see tests/prompt-surface.test.mjs anti-restatement gates.
    assert.ok(count <= 1000, `${promptPath} too large: ${count} words`);
  }

  const allowlist = new Map([
    ["registry/worker-profiles/prompts/orchestrator.md", "orchestration prompt owns routing and handoff rules"],
  ]);
  for (const profile of Object.values(registry.workerProfiles)) {
    const promptPath = resolveWorkerProfilePromptPath(profile.id, { rootDir: root, registry });
    if (allowlist.has(promptPath)) continue;
    const content = fs.readFileSync(path.join(root, promptPath), "utf8");
    const count = promptWordCount(content);
    assert.ok(count <= 1200, `${promptPath} too large: ${count} words`);
  }
});

test("sync-worker-profiles uses shared prompt resolution helpers instead of direct prompt file loading", () => {
  const syncSource = fs.readFileSync(path.join(root, "scripts", "sync-worker-profiles.mjs"), "utf8");
  assert.match(syncSource, /resolvePromptContract/);
  assert.match(syncSource, /function loadWorkerProfilePrompt[\s\S]*resolvePromptContract/);
  assert.match(syncSource, /function buildPrompt[\s\S]*resolvePromptContract/);
  assert.doesNotMatch(syncSource, /agent\.prompt = fs\.readFileSync\(promptPath, "utf8"\)\.trim\(\)/);
});
