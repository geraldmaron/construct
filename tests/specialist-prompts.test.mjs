/**
 * agent-prompts.test.mjs — Contract tests for the Construct agent registry and prompt corpus.
 *
 * Verifies registry integrity: required fields, unique names, valid
 * persona references, and that prompt files resolve on disk.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inlineRoleAntiPatterns, ROLE_DIRECTIVE_RE } from "../lib/role-preload.mjs";
import { stripLeadingYamlFrontmatter } from "../lib/prompt-composer.js";
import { loadRegistry } from "../lib/registry/loader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Budgets are about emitted prompt tokens; YAML frontmatter and the inline
// `<!-- cx:prio=N -->` section markers are structured metadata stripped before emit
// (the markers by renderPersonaForTier in lib/persona-sections.mjs), so neither counts
// against the cap.
function promptWordCount(content) {
  return wordCount(stripLeadingYamlFrontmatter(content).replace(/<!--\s*cx:prio=\d+\s*-->/g, ""));
}

test("specialist agents have required fields", () => {
  const registry = loadRegistry({ rootDir: root });
  for (const specialist of Object.values(registry.specialists || {})) {
    assert.ok(specialist.name, `Specialist missing name`);
    assert.ok(specialist.displayName, `Specialist ${specialist.name} missing displayName`);
    assert.ok(specialist.promptFile, `Specialist ${specialist.name} missing promptFile`);
    assert.ok(specialist.team, `Specialist ${specialist.name} missing team`);
  }
});

test("every specialist role reference resolves to an existing skills/roles file", () => {
  const registry = loadRegistry({ rootDir: root });
  for (const specialist of Object.values(registry.specialists || {})) {
    if (!specialist.promptFile) continue;
    const content = fs.readFileSync(path.join(root, specialist.promptFile), "utf8");
    const match = content.match(ROLE_DIRECTIVE_RE);
    if (!match) continue;
    const ref = match[1];
    const [core, flavor] = ref.split(".");
    const coreFile = path.join(root, "skills", "roles", `${core}.md`);
    assert.ok(fs.existsSync(coreFile), `${specialist.name}: core role file missing — ${coreFile}`);
    assert.ok(fs.readFileSync(coreFile, "utf8").length > 200, `${core}.md too short`);
    if (flavor) {
      const flavorFile = path.join(root, "skills", "roles", `${core}.${flavor}.md`);
      assert.ok(fs.existsSync(flavorFile), `${specialist.name}: flavor role file missing — ${flavorFile}`);
    }
  }
});

test("product manager flavor overlays exist for Product Intelligence routing", () => {
  const flavors = ["product", "platform", "enterprise", "ai-product", "growth"];
  for (const flavor of flavors) {
    const p = path.join(root, "skills", "roles", `product-manager.${flavor}.md`);
    assert.ok(fs.existsSync(p), `Missing product-manager flavor overlay: ${p}`);
    const content = fs.readFileSync(p, "utf8");
    assert.match(content, new RegExp(`role:\\s*product-manager\\.${flavor.replace("-", "\\-")}`));
    assert.ok(content.length > 500, `${p} too short to provide useful guidance`);
  }
});

test("domain role flavor overlays exist for routing metadata", () => {
  const overlays = {
    engineer: ["ai", "data", "platform"],
    architect: ["platform", "integration", "data", "ai-systems", "enterprise"],
    qa: ["web-ui", "api-contract", "data-pipeline", "ai-eval"],
    security: ["appsec", "cloud", "ai", "privacy", "supply-chain"],
    "data-analyst": ["product", "experiment", "telemetry", "product-intelligence"],
    "data-engineer": ["pipeline", "warehouse", "vector-retrieval"],
  };

  for (const [role, flavors] of Object.entries(overlays)) {
    for (const flavor of flavors) {
      const p = path.join(root, "skills", "roles", `${role}.${flavor}.md`);
      assert.ok(fs.existsSync(p), `Missing ${role} flavor overlay: ${p}`);
      const content = fs.readFileSync(p, "utf8");
      assert.match(content, new RegExp(`role:\\s*${role}\\.${flavor.replace("-", "\\-")}`));
      assert.ok(content.length > 500, `${p} too short to provide useful guidance`);
    }
  }
});

test("orchestrator role preload stays compact", () => {
  const rolePath = path.join(root, "skills", "roles", "orchestrator.md");
  const content = fs.readFileSync(rolePath, "utf8");
  const count = wordCount(content);
  assert.ok(count <= 450, `orchestrator role preload too large: ${count} words`);
});

test("inlineRoleAntiPatterns expands the directive when preload: true", () => {
  // On-demand is the default (see rules/common/skill-composition.md). Preload
  // is opt-in for hosts without reliable runtime get_skill.
  const src = '**Role guidance**: call `get_skill("roles/engineer.ai")` before drafting.';
  const out = inlineRoleAntiPatterns(src, root, "cx-ai-engineer", () => {}, { preload: true });
  assert.ok(!/get_skill\("roles\//.test(out), "raw directive should be expanded");
  assert.match(out, /## Role guidance/);
  assert.match(out, /ai overlay/i);
});

test("inlineRoleAntiPatterns defaults to on-demand (leaves directive in place)", () => {
  const src = '**Role guidance**: call `get_skill("roles/engineer.ai")` before drafting.';
  const out = inlineRoleAntiPatterns(src, root, "cx-ai-engineer", () => {});
  assert.strictEqual(out, src, "default should leave the directive untouched for runtime get_skill");
});

test("inlineRoleAntiPatterns is a no-op when no directive present", () => {
  const src = "nothing to inline here";
  assert.strictEqual(inlineRoleAntiPatterns(src, root, "x", () => {}, { preload: true }), src);
});

test("get_template shipped defaults all exist for template names referenced in prompts", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const names = new Set();
  for (const agent of registry.specialists) {
    if (!agent.promptFile) continue;
    const content = fs.readFileSync(path.join(root, agent.promptFile), "utf8");
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
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const sharedGuidanceWords = wordCount((registry.sharedGuidance || []).join("\n"));
  assert.ok(sharedGuidanceWords <= 1500, `sharedGuidance too large: ${sharedGuidanceWords} words`);

  for (const persona of [registry.orchestrator].filter(Boolean)) {
    const content = fs.readFileSync(path.join(root, persona.promptFile), "utf8");
    const count = promptWordCount(content);
    // Persona cap is 1000 words. Baseline rule-of-thumb is 900 for an
    // always-on prompt; the extra 100 words are reserved for behavioral
    // mandates the model cannot get from code (currently: the call-the-
    // orchestration_policy mandate and the neurodivergent-output style
    // rule). Anything restated from code belongs in the policy module,
    // not here — see tests/prompt-surface.test.mjs anti-restatement gates.
    assert.ok(count <= 1000, `${persona.promptFile} too large: ${count} words`);
  }

  const allowlist = new Map([
    ["specialists/prompts/cx-orchestrator.md", "orchestration prompt owns routing and handoff rules"],
  ]);
  for (const agent of registry.specialists) {
    if (!agent.promptFile || allowlist.has(agent.promptFile)) continue;
    const content = fs.readFileSync(path.join(root, agent.promptFile), "utf8");
    const count = promptWordCount(content);
    assert.ok(count <= 1200, `${agent.promptFile} too large: ${count} words`);
  }
});

test("sync-specialists uses shared prompt resolution helpers instead of direct prompt file loading", () => {
  const syncSource = fs.readFileSync(path.join(root, "scripts", "sync-specialists.mjs"), "utf8");
  assert.match(syncSource, /resolvePromptContract/);
  assert.match(syncSource, /function loadPersonaPrompt[\s\S]*resolvePromptContract/);
  assert.match(syncSource, /function buildPrompt[\s\S]*resolvePromptContract/);
  assert.doesNotMatch(syncSource, /agent\.prompt = fs\.readFileSync\(promptPath, "utf8"\)\.trim\(\)/);
});
