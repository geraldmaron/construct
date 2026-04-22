/**
 * tests/agent-prompts.test.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inlineRoleAntiPatterns, ROLE_DIRECTIVE_RE } from "../lib/role-preload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const registryPath = path.join(root, "agents", "registry.json");

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

test("all agents in registry have mandatory observability guidance", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const mandatoryPhrases = [
    "MUST call cx_trace",
    "MUST call cx_score"
  ];

  const sharedGuidance = registry.sharedGuidance || [];
  
  for (const phrase of mandatoryPhrases) {
    const found = sharedGuidance.some(g => g.includes(phrase));
    assert.ok(found, `Mandatory phrase "${phrase}" missing from sharedGuidance`);
  }
});

test("Bash-enabled agents inherit required Bash tool-call schema guidance", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const guidance = (registry.sharedGuidance || []).join("\n");
  assert.match(guidance, /bash tool requires both command and description string fields/i);
  assert.match(guidance, /command/);
  assert.match(guidance, /description/);

  const entries = [...(registry.personas || []), ...(registry.agents || [])];
  const bashEnabled = entries.filter((entry) =>
    String(entry.claudeTools || "")
      .split(",")
      .map((tool) => tool.trim())
      .includes("Bash")
  );
  assert.ok(bashEnabled.length > 0, "Expected at least one Bash-enabled registry entry");

  for (const entry of bashEnabled) {
    assert.ok(
      /bash tool requires both command and description string fields/i.test(guidance),
      `${entry.name} lacks shared Bash schema guidance`
    );
  }
});

test("specialist agents have required fields", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  for (const agent of registry.agents) {
    assert.ok(agent.name, `Agent missing name`);
    assert.ok(agent.description, `Agent ${agent.name} missing description`);
    assert.ok(agent.prompt || agent.promptFile, `Agent ${agent.name} missing prompt or promptFile`);
    assert.ok(agent.modelTier || agent.model, `Agent ${agent.name} missing model configuration`);
  }
});

test("personas have valid prompt files", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  for (const persona of registry.personas) {
    const promptPath = path.join(root, persona.promptFile);
    assert.ok(fs.existsSync(promptPath), `Persona ${persona.name} prompt file missing: ${persona.promptFile}`);
    const content = fs.readFileSync(promptPath, "utf8");
    assert.ok(content.length > 100, `Persona ${persona.name} prompt too short`);
  }
});

test("every specialist role reference resolves to an existing skills/roles file", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  for (const agent of registry.agents) {
    if (!agent.promptFile) continue;
    const content = fs.readFileSync(path.join(root, agent.promptFile), "utf8");
    const match = content.match(ROLE_DIRECTIVE_RE);
    if (!match) continue;
    const ref = match[1];
    const [core, flavor] = ref.split(".");
    const coreFile = path.join(root, "skills", "roles", `${core}.md`);
    assert.ok(fs.existsSync(coreFile), `${agent.name}: core role file missing — ${coreFile}`);
    assert.ok(fs.readFileSync(coreFile, "utf8").length > 200, `${core}.md too short`);
    if (flavor) {
      const flavorFile = path.join(root, "skills", "roles", `${core}.${flavor}.md`);
      assert.ok(fs.existsSync(flavorFile), `${agent.name}: flavor role file missing — ${flavorFile}`);
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
  for (const agent of registry.agents) {
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

  for (const persona of registry.personas) {
    const content = fs.readFileSync(path.join(root, persona.promptFile), "utf8");
    const count = wordCount(content);
    assert.ok(count <= 900, `${persona.promptFile} too large: ${count} words`);
  }

  const allowlist = new Map([
    ["agents/prompts/cx-orchestrator.md", "orchestration prompt owns routing and handoff rules"],
  ]);
  for (const agent of registry.agents) {
    if (!agent.promptFile || allowlist.has(agent.promptFile)) continue;
    const content = fs.readFileSync(path.join(root, agent.promptFile), "utf8");
    const count = wordCount(content);
    assert.ok(count <= 1200, `${agent.promptFile} too large: ${count} words`);
  }
});

test("sync-agents uses shared prompt resolution helpers instead of direct prompt file loading", () => {
  const syncSource = fs.readFileSync(path.join(root, "sync-agents.mjs"), "utf8");
  assert.match(syncSource, /resolvePromptContract/);
  assert.match(syncSource, /function loadPersonaPrompt[\s\S]*resolvePromptContract/);
  assert.match(syncSource, /function buildPrompt[\s\S]*resolvePromptContract/);
  assert.doesNotMatch(syncSource, /agent\.prompt = fs\.readFileSync\(promptPath, "utf8"\)\.trim\(\)/);
});
