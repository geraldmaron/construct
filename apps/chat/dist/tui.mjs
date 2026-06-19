var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/providers/creds.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function constructDir() {
  return path.join(os.homedir(), ".construct");
}
function credsFilePath() {
  return path.join(constructDir(), CONFIG_FILE);
}
function readRaw() {
  const fp = credsFilePath();
  try {
    return fs.readFileSync(fp, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}
function extractBlocks(raw) {
  const blocks = {};
  const lines = raw.split("\n");
  let current = null;
  let currentLines = [];
  for (const line of lines) {
    const startMatch = line.match(/^# CONSTRUCT_CREDS_([A-Z0-9_]+)$/);
    const endMatch = line.match(/^# END_CONSTRUCT_CREDS_([A-Z0-9_]+)$/);
    if (startMatch) {
      current = startMatch[1];
      currentLines = [line];
      continue;
    }
    if (endMatch && current === endMatch[1]) {
      currentLines.push(line);
      blocks[current] = currentLines.join("\n");
      current = null;
      currentLines = [];
      continue;
    }
    if (current) {
      currentLines.push(line);
    }
  }
  return blocks;
}
function parseBlock(blockText) {
  const result = {};
  for (const line of blockText.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    result[m[1]] = m[2];
  }
  return result;
}
function nextRotationDue(rotatedAtStr) {
  if (!rotatedAtStr) return null;
  const d = new Date(rotatedAtStr);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}
function readCreds() {
  const raw = readRaw();
  const blocks = extractBlocks(raw);
  const result = {};
  for (const [upperKey, blockText] of Object.entries(blocks)) {
    const prefix = `CONSTRUCT_CREDS_${upperKey}`;
    const fields = parseBlock(blockText);
    const rotatedAt = fields[`${prefix}_ROTATED_AT`] || null;
    result[upperKey.toLowerCase().replace(/_/g, "-")] = {
      account: fields[`${prefix}_ACCOUNT`] || null,
      key: fields[`${prefix}_KEY`] || null,
      rotatedAt,
      nextRotationDue: nextRotationDue(rotatedAt)
    };
  }
  return result;
}
var CONFIG_FILE;
var init_creds = __esm({
  "lib/providers/creds.mjs"() {
    CONFIG_FILE = "config.env";
  }
});

// lib/providers/credential-catalog.mjs
var API_KEY_CREDENTIALS;
var init_credential_catalog = __esm({
  "lib/providers/credential-catalog.mjs"() {
    API_KEY_CREDENTIALS = [
      {
        id: "anthropic",
        envVars: ["ANTHROPIC_API_KEY"],
        credsKey: "anthropic",
        opTitles: ["anthropic", "anthropic api key"],
        opField: "credential"
      },
      {
        id: "openai",
        envVars: ["OPENAI_API_KEY"],
        credsKey: "openai",
        opTitles: ["openai", "openai api key"],
        opField: "credential"
      },
      {
        id: "openrouter",
        envVars: ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
        credsKey: "openrouter",
        opTitles: ["openrouter", "openrouter api key"],
        opField: "credential",
        openCodeProvider: "openrouter"
      },
      {
        id: "github",
        envVars: ["GITHUB_TOKEN", "GH_TOKEN"],
        credsKey: "github",
        opTitles: ["github", "github token", "github personal access token"],
        opField: "credential"
      }
    ];
  }
});

// lib/providers/credential-sources.mjs
import fs2 from "node:fs";
import path2 from "node:path";
import os2 from "node:os";
function openCodeConfigPath(homeDir2 = os2.homedir()) {
  return path2.join(homeDir2, ".config", "opencode", "opencode.json");
}
function isPlaceholder(value) {
  return !value || String(value).includes("__OPENROUTER_API_KEY__");
}
function readRawFromOpenCodeProvider(providerName, configPath = openCodeConfigPath()) {
  try {
    if (!fs2.existsSync(configPath)) return null;
    const config = JSON.parse(fs2.readFileSync(configPath, "utf8"));
    const provider = config?.provider?.[providerName];
    if (!provider) return null;
    if (!isPlaceholder(provider.apiKey)) return String(provider.apiKey).trim();
    const auth = provider.options?.headers?.Authorization;
    if (typeof auth === "string") {
      const value = auth.replace(/^Bearer\s+/i, "").trim();
      if (!isPlaceholder(value)) return value;
    }
    return null;
  } catch {
    return null;
  }
}
function readRawFromCredsStore(credsKey) {
  if (!credsKey) return null;
  try {
    const key = readCreds()?.[credsKey]?.key;
    return key ? String(key).trim() : null;
  } catch {
    return null;
  }
}
function discoverAlternateRawForCredential(entry, { home = os2.homedir() } = {}) {
  if (!entry) return null;
  const fromCreds = readRawFromCredsStore(entry.credsKey);
  if (fromCreds) return fromCreds;
  if (entry.openCodeProvider) {
    return readRawFromOpenCodeProvider(entry.openCodeProvider, openCodeConfigPath(home));
  }
  return null;
}
function discoverAlternateRawForVar(varName, opts = {}) {
  const entry = API_KEY_CREDENTIALS.find((item) => item.envVars.includes(varName));
  return entry ? discoverAlternateRawForCredential(entry, opts) : null;
}
var init_credential_sources = __esm({
  "lib/providers/credential-sources.mjs"() {
    init_creds();
    init_credential_catalog();
  }
});

// lib/providers/secret-resolver.mjs
import fs3 from "node:fs";
import path3 from "node:path";
import os3 from "node:os";
import { spawnSync } from "node:child_process";
function unquote(value) {
  return String(value).trim().replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
}
function extractOpRef(rawValue) {
  if (!rawValue) return null;
  const value = unquote(rawValue);
  if (value.startsWith("op://")) return value;
  const m = value.match(/\$\(\s*op\s+read\s+(['"]?)(op:\/\/[^'")\s]+)\1\s*\)/);
  return m ? m[2] : null;
}
function defaultOpRead(opRef) {
  const result = spawnSync("op", ["read", opRef], { encoding: "utf8", timeout: OP_READ_TIMEOUT_MS });
  if (result.error && result.error.code === "ENOENT") {
    throw new SecretResolutionError("1Password CLI not found \u2014 install `op` or set the key directly.", "OP_NOT_INSTALLED");
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").toLowerCase();
    if (/sign in|signin|session|not currently|authenticate|authorization|no account/.test(stderr)) {
      throw new SecretResolutionError("1Password CLI is not signed in \u2014 run `op signin` and retry.", "OP_NOT_SIGNED_IN");
    }
    throw new SecretResolutionError(`op read failed for ${opRef}: ${String(result.stderr || "").trim().slice(0, 160)}`, "OP_READ_FAILED");
  }
  const secret = String(result.stdout || "").trim();
  if (!secret) throw new SecretResolutionError(`op read returned an empty value for ${opRef}`, "OP_EMPTY");
  return secret;
}
function resolveOpRef(opRef, { opRead = defaultOpRead } = {}) {
  if (opCache.has(opRef)) return opCache.get(opRef);
  const secret = opRead(opRef);
  opCache.set(opRef, secret);
  return secret;
}
function materialize(rawValue, opts) {
  const ref = extractOpRef(rawValue);
  return ref ? resolveOpRef(ref, opts) : unquote(rawValue);
}
function readDotenvVar(file, varName) {
  try {
    if (!fs3.existsSync(file)) return null;
    const m = fs3.readFileSync(file, "utf8").match(new RegExp(`^${varName}=(.+)$`, "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
function readShellRcVar(varName, home) {
  const files = [".zshrc", ".bashrc", ".bash_profile", ".profile"].map((f) => path3.join(home, f));
  for (const rc of files) {
    try {
      if (!fs3.existsSync(rc)) continue;
      const m = fs3.readFileSync(rc, "utf8").match(new RegExp(`^\\s*export\\s+${varName}=(.+)$`, "m"));
      if (m) return m[1].trim();
    } catch {
      continue;
    }
  }
  return null;
}
function rawCandidate(varName, { env, cwd, home }) {
  const direct = env?.[varName];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const files = [path3.join(home, ".construct", "config.env"), path3.join(home, ".env"), path3.join(cwd, ".env")];
  for (const file of files) {
    const value = readDotenvVar(file, varName);
    if (value) return value;
  }
  const alt = discoverAlternateRawForVar(varName, { home });
  if (alt) return alt;
  return readShellRcVar(varName, home);
}
function resolveSecret(varName, { env = process.env, cwd = process.cwd(), allowAmbient = true, opRead } = {}) {
  const direct = env?.[varName];
  if (typeof direct === "string" && direct.length > 0) return materialize(direct, { opRead });
  if (!allowAmbient) return null;
  const home = os3.homedir();
  const raw = rawCandidate(varName, { env, cwd, home });
  return raw ? materialize(raw, { opRead }) : null;
}
function resolveFirstSecret(varNames, opts = {}) {
  for (const name of varNames) {
    const value = resolveSecret(name, opts);
    if (value) return value;
  }
  return null;
}
function hasSecret(varName, { env = process.env, cwd = process.cwd() } = {}) {
  const home = os3.homedir();
  const raw = rawCandidate(varName, { env, cwd, home });
  return typeof raw === "string" && raw.length > 0;
}
function hasAnySecret(varNames, opts = {}) {
  return varNames.some((name) => hasSecret(name, opts));
}
var OP_READ_TIMEOUT_MS, opCache, SecretResolutionError;
var init_secret_resolver = __esm({
  "lib/providers/secret-resolver.mjs"() {
    init_credential_sources();
    OP_READ_TIMEOUT_MS = 5e3;
    opCache = /* @__PURE__ */ new Map();
    SecretResolutionError = class extends Error {
      constructor(message, code) {
        super(message);
        this.name = "SecretResolutionError";
        this.code = code;
      }
    };
  }
});

// lib/host-capabilities.mjs
import { execFileSync, execSync } from "node:child_process";
import fs4 from "node:fs";
import os4 from "node:os";
import path4 from "node:path";
function commandVersion(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { stdio: ["ignore", "pipe", "ignore"], timeout: 5e3 }).toString().trim().split(/\r?\n/, 1)[0];
  } catch {
    return null;
  }
}
function parseClaudeVersion(raw) {
  const match = String(raw || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}
function versionAtLeast(version, minimum) {
  if (!version) return false;
  for (const part of ["major", "minor", "patch"]) {
    if (version[part] > minimum[part]) return true;
    if (version[part] < minimum[part]) return false;
  }
  return true;
}
function detectVsCodeAvailability(homeDir2 = os4.homedir()) {
  const settingsCandidates = (() => {
    const platform = os4.platform();
    if (platform === "darwin") {
      return [
        path4.join(homeDir2, "Library", "Application Support", "Code", "User", "settings.json"),
        path4.join(homeDir2, "Library", "Application Support", "Code - Insiders", "User", "settings.json")
      ];
    }
    if (platform === "linux") {
      return [
        path4.join(homeDir2, ".config", "Code", "User", "settings.json"),
        path4.join(homeDir2, ".config", "Code - Insiders", "User", "settings.json")
      ];
    }
    if (platform === "win32") {
      const appData = process.env.APPDATA ?? path4.join(homeDir2, "AppData", "Roaming");
      return [
        path4.join(appData, "Code", "User", "settings.json"),
        path4.join(appData, "Code - Insiders", "User", "settings.json")
      ];
    }
    return [];
  })();
  const version = commandVersion("code") || commandVersion("code-insiders");
  const hasSettings = settingsCandidates.some((candidate) => fs4.existsSync(candidate));
  return { version, hasSettings };
}
function detectCursorAvailability(homeDir2 = os4.homedir()) {
  const version = commandVersion("cursor") || commandVersion("cursor-agent");
  const hasConfig = fs4.existsSync(path4.join(homeDir2, ".cursor", "mcp.json"));
  return { version, hasConfig };
}
function detectCopilotAvailability(homeDir2 = os4.homedir()) {
  const promptsDir = path4.join(homeDir2, ".github", "prompts");
  const instructionsPath = path4.join(homeDir2, ".github", "copilot-instructions.md");
  const hasFiles = fs4.existsSync(promptsDir) || fs4.existsSync(instructionsPath);
  return { hasFiles };
}
function detectHostCapabilities() {
  const claudeRaw = commandVersion("claude");
  const claudeVersion = parseClaudeVersion(claudeRaw);
  const claudeTeamsSupported = versionAtLeast(claudeVersion, { major: 2, minor: 1, patch: 32 });
  const tmuxRaw = commandVersion("tmux", ["-V"]);
  const opencodeRaw = commandVersion("opencode");
  const codexRaw = commandVersion("codex");
  const vscode = detectVsCodeAvailability();
  const cursor = detectCursorAvailability();
  const copilot = detectCopilotAvailability();
  return [
    {
      host: "Claude Code",
      availability: claudeRaw ? "installed" : "missing",
      version: claudeRaw,
      orchestration: claudeTeamsSupported ? "full-multi-agent" : "primary-plus-subagents",
      capability: "full-native",
      promptableWorkers: claudeTeamsSupported,
      sharedTaskRuntime: claudeTeamsSupported,
      lifecycleHooks: ["SubagentStop", "TeammateIdle", "TaskCreated", "TaskCompleted", "Stop"],
      notes: claudeTeamsSupported ? [
        "Best host for full multi-agent orchestration.",
        "Enable CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1.",
        tmuxRaw ? "tmux split-pane display is available." : "tmux is not installed; use in-process teammate mode or install tmux/iTerm2 integration."
      ] : ["Upgrade Claude Code to 2.1.32 or newer for Agent Teams."]
    },
    {
      host: "OpenCode",
      availability: opencodeRaw ? "installed" : "missing",
      version: opencodeRaw,
      orchestration: "primary-plus-subagents",
      capability: "full-native",
      promptableWorkers: false,
      sharedTaskRuntime: "tracker-plus-plan",
      lifecycleHooks: ["session.error", "session.idle", "tool.execute.before", "tool.execute.after"],
      notes: [
        "Primary agents are promptable; subagents are bounded worker sessions.",
        "Construct uses tracker state, plan.md, task permissions, and plugins to coordinate parallel worker execution.",
        "Use NEEDS_MAIN_INPUT to route user questions back to the primary persona."
      ]
    },
    {
      host: "Codex",
      availability: codexRaw ? "installed" : "missing",
      version: codexRaw,
      orchestration: "profile-and-mcp",
      capability: "mcp-orchestrated",
      promptableWorkers: false,
      sharedTaskRuntime: "tracker-plus-plan",
      lifecycleHooks: [],
      notes: [
        "Run a full multi-specialist chain via the `orchestration_run` MCP tool (start `construct dashboard`).",
        "Use Construct profiles, MCP project/memory tools, and the active session for single-pass work."
      ]
    },
    {
      host: "VS Code",
      availability: vscode.version || vscode.hasSettings ? "installed" : "missing",
      version: vscode.version,
      orchestration: "copilot-mcp",
      capability: "mcp-orchestrated",
      promptableWorkers: false,
      sharedTaskRuntime: "editor-session",
      lifecycleHooks: [],
      notes: [
        "Run a full multi-specialist chain via the `orchestration_run` MCP tool in Copilot agent mode (start `construct dashboard`).",
        "Construct's MCP servers load from `.vscode/mcp.json` (project) and the user-profile `mcp.json` (global, only when it already exists)."
      ]
    },
    {
      host: "Cursor",
      availability: cursor.version || cursor.hasConfig ? "installed" : "missing",
      version: cursor.version,
      orchestration: "mcp-only",
      capability: "mcp-orchestrated",
      promptableWorkers: false,
      sharedTaskRuntime: "editor-session",
      lifecycleHooks: [],
      notes: [
        "Run a full multi-specialist chain via the `orchestration_run` MCP tool (start `construct dashboard`).",
        "Construct manages Cursor MCP registrations in `.cursor/mcp.json` (project) and `~/.cursor/mcp.json` (global, when it already exists)."
      ]
    },
    {
      host: "Copilot",
      availability: copilot.hasFiles ? "installed" : "missing",
      version: null,
      orchestration: "prompt-profiles",
      capability: "mcp-orchestrated",
      promptableWorkers: false,
      sharedTaskRuntime: "editor-session",
      lifecycleHooks: [],
      notes: [
        "Copilot agent mode runs Construct's MCP tools \u2014 use `orchestration_run` for a real multi-specialist chain (start `construct dashboard`).",
        "Construct also writes reusable prompt profiles under `.github/prompts/` for single-pass role work."
      ]
    }
  ];
}
function formatHostCapabilitiesJson(hosts = detectHostCapabilities()) {
  return JSON.stringify(hosts, null, 2) + "\n";
}
function printHostCapabilities(hosts = detectHostCapabilities()) {
  console.log("Construct orchestration host capabilities:");
  for (const host of hosts) {
    console.log("");
    console.log(`${host.host}: ${host.availability}${host.version ? ` (${host.version})` : ""}`);
    console.log(`  capability: ${host.capability}`);
    console.log(`  orchestration: ${host.orchestration}`);
    console.log(`  promptable workers: ${host.promptableWorkers === true ? "yes" : "no"}`);
    console.log(`  shared task runtime: ${host.sharedTaskRuntime === true ? "native" : host.sharedTaskRuntime || "none"}`);
    if (host.lifecycleHooks.length) console.log(`  lifecycle hooks: ${host.lifecycleHooks.join(", ")}`);
    for (const note of host.notes) console.log(`  - ${note}`);
  }
}
var init_host_capabilities = __esm({
  "lib/host-capabilities.mjs"() {
    init_opencode_config();
    if (import.meta.url === `file://${process.argv[1]}`) {
      const args = new Set(process.argv.slice(2));
      if (args.has("--json")) {
        process.stdout.write(formatHostCapabilitiesJson());
      } else {
        printHostCapabilities();
      }
    }
  }
});

// lib/env-config.mjs
var init_env_config = __esm({
  "lib/env-config.mjs"() {
  }
});

// lib/opencode-config.mjs
var init_opencode_config = __esm({
  "lib/opencode-config.mjs"() {
    init_host_capabilities();
    init_env_config();
  }
});

// lib/mcp/tool-budget.mjs
var init_tool_budget = __esm({
  "lib/mcp/tool-budget.mjs"() {
  }
});

// lib/model-free-selector.mjs
var model_free_selector_exports = {};
__export(model_free_selector_exports, {
  isFreeModel: () => isFreeModel,
  isTextOutputModel: () => isTextOutputModel,
  pollFreeModels: () => pollFreeModels,
  preferFreeValue: () => preferFreeValue,
  score: () => score,
  selectForTier: () => selectForTier,
  topForTier: () => topForTier
});
async function pollFreeModels(apiKey) {
  if (!apiKey) {
    console.error(
      "Error: OPENROUTER_API_KEY is not set. Cannot poll free models."
    );
    return [];
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data;
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    if (!res.ok) {
      console.error(
        `Error: OpenRouter models endpoint returned ${res.status} ${res.statusText}`
      );
      return [];
    }
    data = await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(
        "Error: OpenRouter request timed out after 10 seconds."
      );
    } else {
      console.error(`Error: Failed to fetch OpenRouter models \u2014 ${err.message}`);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
  const models = (data?.data ?? []).filter(
    (m) => m?.pricing?.prompt === "0" && m?.pricing?.completion === "0"
  ).filter(isTextOutputModel).map((m) => ({
    id: `openrouter/${m.id}`,
    name: m.name ?? m.id,
    contextLength: m.context_length ?? 0,
    isFree: true
  }));
  return models.sort((a, b) => score(b, "standard") - score(a, "standard"));
}
function isTextOutputModel(model = {}) {
  const arch = model.architecture || {};
  let output = arch.output_modalities;
  if (!Array.isArray(output) && typeof arch.modality === "string" && arch.modality.includes("->")) {
    output = arch.modality.split("->")[1].split("+").map((s) => s.trim());
  }
  if (Array.isArray(output) && output.length) {
    return output.includes("text") && !output.includes("image");
  }
  return true;
}
function score(model, tier) {
  const { id, contextLength } = model;
  let s = 0;
  if (contextLength >= 128e3) s += 40;
  else if (contextLength >= 32e3) s += 20;
  else if (contextLength >= 16e3) s += 10;
  if (id.includes("gemma-4")) s += 30;
  if (id.includes("gemma-3")) s += 25;
  if (id.includes("gpt-4o")) s += 25;
  if (id.includes("nemotron-3-super")) s += 20;
  if (id.includes("llama-3.3-70b")) s += 20;
  if (id.includes("qwen3") && contextLength >= 32e3) s += 20;
  if (id.includes("deepseek-r1")) s += 20;
  if (id.includes("deepseek-v3")) s += 15;
  if (tier === "reasoning" && (id.includes("deepseek-r1") || id.includes("nemotron-3-super") || id.includes("qwen3"))) {
    s += 15;
  }
  return s;
}
function selectForTier(freeModels, tier, registryFallbacks = []) {
  const minContext = tier === "fast" ? 8e3 : tier === "standard" ? 16e3 : 32e3;
  if (freeModels && freeModels.length > 0) {
    const candidates = freeModels.filter((m) => m.contextLength >= minContext).map((m) => ({ ...m, tierScore: score(m, tier) })).sort((a, b) => b.tierScore - a.tierScore);
    if (candidates[0]?.id) return candidates[0].id;
  }
  return registryFallbacks[0] ?? null;
}
function topForTier(freeModels, tier, n = 3) {
  if (!freeModels || freeModels.length === 0) return [];
  const minContext = tier === "fast" ? 8e3 : tier === "standard" ? 16e3 : 32e3;
  return freeModels.filter((m) => m.contextLength >= minContext).map((m) => ({ ...m, tierScore: score(m, tier) })).sort((a, b) => b.tierScore - a.tierScore).slice(0, n);
}
function isFreeModel(modelId = "") {
  return /:free$/i.test(modelId);
}
function preferFreeValue(primary, fallback, registryDefault, builtinDefault) {
  if (primary && isFreeModel(primary)) return primary;
  if (fallback && isFreeModel(fallback)) return fallback;
  if (registryDefault && isFreeModel(registryDefault))
    return registryDefault;
  if (builtinDefault && isFreeModel(builtinDefault))
    return builtinDefault;
  return primary ?? fallback ?? registryDefault ?? builtinDefault ?? null;
}
var OPENROUTER_MODELS_URL, FETCH_TIMEOUT_MS;
var init_model_free_selector = __esm({
  "lib/model-free-selector.mjs"() {
    OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
    FETCH_TIMEOUT_MS = 1e4;
  }
});

// lib/provider-capabilities.js
import { join } from "node:path";
import { homedir } from "node:os";
var CAPABILITY_CACHE_PATH, CAPABILITY_CACHE_TTL_MS;
var init_provider_capabilities = __esm({
  "lib/provider-capabilities.js"() {
    CAPABILITY_CACHE_PATH = join(homedir(), ".cx", "provider-capabilities.json");
    CAPABILITY_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
  }
});

// lib/model-router.mjs
import fs5 from "node:fs";
import path5 from "node:path";
import { spawnSync as spawnSync2 } from "child_process";
function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}
function hasCopilotCredential() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return false;
  const candidates = [
    path5.join(home, ".construct", "auth", "github-copilot.json"),
    path5.join(home, ".config", "github-copilot", "apps.json"),
    path5.join(home, ".config", "github-copilot", "hosts.json")
  ];
  for (const file of candidates) {
    try {
      if (!fs5.existsSync(file)) continue;
      const data = JSON.parse(fs5.readFileSync(file, "utf8"));
      if (file.endsWith("github-copilot.json")) {
        if (data && (data.oauth_token || data.token || data.refresh_token || data.refresh)) return true;
      } else {
        for (const entry of Object.values(data || {})) {
          if (entry && (entry.oauth_token || entry.token)) return true;
        }
      }
    } catch {
    }
  }
  return false;
}
function isProviderConfigured(familyId, env) {
  const varNames = PROVIDER_ENV_MAP[familyId];
  if (!varNames?.length) return false;
  if (familyId === "ollama") {
    try {
      const r = spawnSync2("curl", ["-s", "--connect-timeout", "1", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:11434/api/tags"], { encoding: "utf8", timeout: 3e3 });
      if (r.status === 0 && r.stdout?.trim() === "200") return true;
    } catch {
    }
    try {
      const r = spawnSync2("ollama", ["--version"], { encoding: "utf8", timeout: 2e3 });
      if (r.status === 0) return true;
    } catch {
    }
  }
  if (hasAnySecret(varNames, { env })) return true;
  if (familyId === "github-copilot") {
    if (hasCopilotCredential()) return true;
    try {
      const r = spawnSync2("gh", ["auth", "status"], { encoding: "utf8", timeout: 3e3 });
      return r.status === 0;
    } catch {
      return false;
    }
  }
  return false;
}
function getProviderModelCatalog({ env = process.env } = {}) {
  const providers = PROVIDER_FAMILY_TIERS.map((family) => {
    const tiers = family.resolve({});
    const options = {
      reasoning: uniqueStrings([...family.options?.reasoning ?? [], tiers.reasoning]),
      standard: uniqueStrings([...family.options?.standard ?? [], tiers.standard]),
      fast: uniqueStrings([...family.options?.fast ?? [], tiers.fast])
    };
    return {
      id: family.id,
      label: family.label,
      tiers,
      options,
      local: family.local === true,
      requiresEnv: Array.isArray(family.requiresEnv) ? family.requiresEnv : [],
      pricingHint: family.pricingHint ?? null,
      configured: isProviderConfigured(family.id, env)
    };
  });
  const tierOptions = {
    reasoning: uniqueStrings(providers.flatMap((provider) => provider.options.reasoning)),
    standard: uniqueStrings(providers.flatMap((provider) => provider.options.standard)),
    fast: uniqueStrings(providers.flatMap((provider) => provider.options.fast))
  };
  return { providers, tierOptions };
}
function isChatModelAvailable(modelId, { env = process.env, excludeFamilies = [] } = {}) {
  if (!modelId || typeof modelId !== "string") {
    return { ok: false, reason: "missing", modelId: modelId || null };
  }
  const family = matchProviderFamily(modelId);
  if (!family) {
    return { ok: false, reason: "unknown_family", modelId };
  }
  if (excludeFamilies.includes(family.id)) {
    return { ok: false, reason: "excluded", modelId, provider: family.id };
  }
  if (!isProviderConfigured(family.id, env)) {
    return { ok: false, reason: "provider_not_configured", modelId, provider: family.id };
  }
  if (LENIENT_MODEL_FAMILIES.has(family.id)) {
    return { ok: true, modelId, provider: family.id };
  }
  const { providers } = getProviderModelCatalog({ env });
  const provider = providers.find((p) => p.id === family.id);
  if (!provider) {
    return { ok: false, reason: "unknown_family", modelId };
  }
  const known = uniqueStrings([
    ...provider.options?.reasoning ?? [],
    ...provider.options?.standard ?? [],
    ...provider.options?.fast ?? [],
    provider.tiers?.reasoning,
    provider.tiers?.standard,
    provider.tiers?.fast
  ]);
  if (known.includes(modelId)) {
    return { ok: true, modelId, provider: family.id };
  }
  return { ok: false, reason: "model_not_available", modelId, provider: family.id };
}
function availabilityNotice(rejected) {
  if (!rejected?.modelId) return null;
  const label = rejected.modelId;
  if (rejected.reason === "provider_not_configured") {
    const family = rejected.provider || "";
    if (family.startsWith("openrouter")) {
      return `Saved ${label} \u2014 OpenRouter not configured. Set OPENROUTER_API_KEY in ~/.construct/config.env or run \`construct creds set openrouter\`.`;
    }
    return `Saved ${label} \u2014 provider not configured.`;
  }
  if (rejected.reason === "model_not_available") {
    return `Pinned ${label} \u2014 not available on your account.`;
  }
  if (rejected.reason === "unknown_family") {
    return `Pinned ${label} \u2014 unrecognized model id.`;
  }
  return `Pinned ${label} \u2014 unavailable.`;
}
function recommendTierModel(tier, { env = process.env, excludeFamilies = [] } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  for (const provider of providers) {
    if (!provider.configured || excludeFamilies.includes(provider.id)) continue;
    const candidates = uniqueStrings([
      provider.tiers?.[tier],
      ...provider.options?.[tier] ?? []
    ]);
    for (const id of candidates) {
      const check = isChatModelAvailable(id, { env, excludeFamilies });
      if (check.ok) return { id, provider: provider.label, tier };
    }
  }
  return null;
}
function resolveValidatedChatModel({ env = process.env, requested = null, excludeFamilies = [] } = {}) {
  const rejections = [];
  if (requested) {
    const check = isChatModelAvailable(requested, { env, excludeFamilies });
    if (check.ok) {
      return { id: requested, source: "explicit", notice: null, rejected: [] };
    }
    rejections.push(check);
  }
  const pinOrder = [
    ["standard", env.CX_MODEL_STANDARD],
    ["reasoning", env.CX_MODEL_REASONING],
    ["fast", env.CX_MODEL_FAST]
  ];
  for (const [tier, pin] of pinOrder) {
    if (!pin) continue;
    const check = isChatModelAvailable(pin, { env, excludeFamilies });
    if (check.ok) {
      const notice2 = rejections.length ? `${availabilityNotice(rejections[0])} Using ${pin}.` : null;
      return { id: pin, source: "pin", tier, notice: notice2, rejected: rejections };
    }
    rejections.push(check);
  }
  const standard = recommendTierModel("standard", { env, excludeFamilies });
  if (standard) {
    const notice2 = rejections.length ? `${availabilityNotice(rejections[0])} Using ${standard.id} (${standard.provider}).` : null;
    return { id: standard.id, source: "recommended", tier: "standard", notice: notice2, rejected: rejections };
  }
  const anyTier = recommendTierModel("reasoning", { env, excludeFamilies }) || recommendTierModel("fast", { env, excludeFamilies });
  if (anyTier) {
    const notice2 = rejections.length ? `${availabilityNotice(rejections[0])} Using ${anyTier.id} (${anyTier.provider}).` : null;
    return { id: anyTier.id, source: "recommended", tier: anyTier.tier, notice: notice2, rejected: rejections };
  }
  const notice = rejections.length ? availabilityNotice(rejections[0]) : null;
  return { id: null, source: null, notice, rejected: rejections };
}
function matchProviderFamily(modelId) {
  return PROVIDER_FAMILY_TIERS.find((entry) => entry.test(modelId));
}
function familyDescriptor(family, env) {
  const requiresEnv = PROVIDER_ENV_MAP[family.id] || (Array.isArray(family.requiresEnv) ? family.requiresEnv : []);
  const local = family.local === true;
  const configured = isProviderConfigured(family.id, env);
  return {
    id: family.id,
    label: family.label,
    local,
    requiresEnv,
    tiers: family.resolve({}),
    configured
  };
}
function describeModelFamily(modelId, { env = process.env } = {}) {
  const family = matchProviderFamily(modelId);
  if (!family) return null;
  return familyDescriptor(family, env);
}
function flattenText(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}
function classifyProviderFailure(input) {
  const error = input?.error && typeof input.error === "object" ? input.error : input;
  const text = flattenText([
    error?.message,
    error?.name,
    error?.code,
    error?.status,
    error?.statusCode,
    input?.message,
    input?.error
  ]);
  if (!text) return null;
  const provider = [
    error?.provider,
    input?.provider,
    input?.model?.provider,
    input?.session?.provider
  ].find((value) => typeof value === "string" && value) || null;
  const patterns = [
    { kind: "rate_limit", retryable: true, test: /\b429\b|rate limit|usage limits?|too many requests|quota exceeded|weekly limit|monthly limit|daily limit/i },
    { kind: "provider_unavailable", retryable: true, test: /model unavailable|model.*overloaded|ProviderModelNotFoundError|model.*not found|no such model/i },
    { kind: "provider_unavailable", retryable: true, test: /service unavailable|temporarily unavailable|upstream error|server error|\b5\d\d\b/i },
    { kind: "transient_network", retryable: true, test: /timeout|timed out|ETIMEDOUT|ECONNRESET|network error|fetch failed/i },
    { kind: "auth_error", retryable: false, test: /unauthorized|forbidden|invalid api key|authentication failed/i }
  ];
  for (const pattern of patterns) {
    if (pattern.test.test(text)) {
      return { kind: pattern.kind, provider, retryable: pattern.retryable };
    }
  }
  return null;
}
var MODEL_OPERATING_PROFILES, PROVIDER_FAMILY_TIERS, PROVIDER_ENV_MAP, LENIENT_MODEL_FAMILIES, PROVIDER_COOLDOWN_MS;
var init_model_router = __esm({
  "lib/model-router.mjs"() {
    init_secret_resolver();
    init_credential_sources();
    init_opencode_config();
    init_tool_budget();
    init_model_free_selector();
    init_provider_capabilities();
    init_provider_capabilities();
    MODEL_OPERATING_PROFILES = Object.freeze({
      balanced: {
        id: "balanced",
        label: "Balanced",
        maxPromptTokens: 3e3,
        learnedPatternsTokens: 200,
        taskPacketTokens: 150,
        contextDigestTokens: 200,
        hostConstraintsTokens: 75,
        roleFlavorTokens: 600,
        retrievalFirst: false,
        preferCompressedRoleGuidance: false
      },
      small: {
        id: "small",
        label: "Small-model",
        maxPromptTokens: 1800,
        learnedPatternsTokens: 120,
        taskPacketTokens: 110,
        contextDigestTokens: 120,
        hostConstraintsTokens: 40,
        roleFlavorTokens: 280,
        retrievalFirst: true,
        preferCompressedRoleGuidance: true
      }
    });
    PROVIDER_FAMILY_TIERS = [
      {
        id: "anthropic",
        label: "Anthropic (direct)",
        test: (modelId) => /^anthropic\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "anthropic/claude-opus-4-6",
          standard: standard ?? "anthropic/claude-sonnet-4-6",
          fast: fast ?? "anthropic/claude-haiku-4-5-20251001"
        }),
        options: {
          reasoning: ["anthropic/claude-opus-4-6", "anthropic/claude-sonnet-4-6"],
          standard: ["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-6"],
          fast: ["anthropic/claude-haiku-4-5-20251001", "anthropic/claude-sonnet-4-6"]
        }
      },
      {
        id: "openrouter-anthropic",
        label: "Anthropic via OpenRouter",
        test: (modelId) => /^openrouter\/anthropic\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "openrouter/anthropic/claude-opus-4-6",
          standard: standard ?? "openrouter/anthropic/claude-sonnet-4-6",
          fast: fast ?? "openrouter/anthropic/claude-haiku-4-5-20251001"
        }),
        options: {
          reasoning: ["openrouter/anthropic/claude-opus-4-6", "openrouter/anthropic/claude-sonnet-4-6"],
          standard: ["openrouter/anthropic/claude-sonnet-4-6", "openrouter/anthropic/claude-opus-4-6"],
          fast: ["openrouter/anthropic/claude-haiku-4-5-20251001", "openrouter/anthropic/claude-sonnet-4-6"]
        }
      },
      {
        id: "openrouter-google",
        label: "Google via OpenRouter",
        test: (modelId) => /^openrouter\/google\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "openrouter/google/gemini-2.5-pro",
          standard: standard ?? "openrouter/google/gemini-2.0-flash-001",
          fast: fast ?? "openrouter/google/gemini-2.0-flash-001"
        }),
        options: {
          reasoning: ["openrouter/google/gemini-2.5-pro", "openrouter/google/gemini-2.5-flash"],
          standard: ["openrouter/google/gemini-2.0-flash-001", "openrouter/google/gemini-2.5-flash"],
          fast: ["openrouter/google/gemini-2.0-flash-001", "openrouter/google/gemma-4-26b-a4b-it:free"]
        }
      },
      {
        id: "openrouter-deepseek",
        label: "DeepSeek via OpenRouter",
        test: (modelId) => /^openrouter\/deepseek\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "openrouter/deepseek/deepseek-r1",
          standard: standard ?? "openrouter/deepseek/deepseek-v3",
          fast: fast ?? standard ?? "openrouter/qwen/qwen3-coder:free"
        }),
        options: {
          reasoning: ["openrouter/deepseek/deepseek-r1", "openrouter/deepseek/deepseek-v3"],
          standard: ["openrouter/deepseek/deepseek-v3", "openrouter/deepseek/deepseek-r1"],
          fast: ["openrouter/qwen/qwen3-coder:free", "openrouter/deepseek/deepseek-v3"]
        }
      },
      {
        id: "openrouter-qwen",
        label: "Qwen via OpenRouter",
        test: (modelId) => /^openrouter\/qwen\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "openrouter/qwen/qwen3-coder",
          standard: standard ?? "openrouter/qwen/qwen3-coder:free",
          fast: fast ?? "openrouter/qwen/qwen2.5-coder-32b-instruct"
        }),
        options: {
          reasoning: ["openrouter/qwen/qwen3-coder", "openrouter/qwen/qwen3-coder:free"],
          standard: ["openrouter/qwen/qwen3-coder:free", "openrouter/qwen/qwen3-coder"],
          fast: ["openrouter/qwen/qwen2.5-coder-32b-instruct", "openrouter/qwen/qwen3-coder:free"]
        }
      },
      {
        id: "github-copilot",
        label: "GitHub Copilot",
        test: (modelId) => /^github-copilot\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "github-copilot/gpt-5.5",
          standard: standard ?? "github-copilot/gpt-5.4",
          fast: fast ?? "github-copilot/gpt-5.4-mini"
        }),
        options: {
          reasoning: ["github-copilot/gpt-5.5", "github-copilot/gpt-5.4", "github-copilot/claude-opus-4.8"],
          standard: ["github-copilot/gpt-5.4", "github-copilot/gpt-4o", "github-copilot/claude-sonnet-4.6"],
          fast: ["github-copilot/gpt-5.4-mini", "github-copilot/gpt-4o-mini"]
        }
      },
      {
        id: "openai",
        label: "OpenAI",
        test: (modelId) => /^openai\//.test(modelId) || /^openrouter\/openai\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => {
          const prefix = /^openrouter\//.test(reasoning || standard || fast || "") ? "openrouter/openai" : "openai";
          return {
            reasoning: reasoning ?? `${prefix}/gpt-5.4`,
            standard: standard ?? `${prefix}/gpt-5.1`,
            fast: fast ?? `${prefix}/gpt-5.1-mini`
          };
        },
        options: {
          reasoning: ["openai/gpt-5.4", "openrouter/openai/gpt-5.4", "openai/gpt-5.1"],
          standard: ["openai/gpt-5.1", "openrouter/openai/gpt-5.1", "openai/gpt-5.1-mini"],
          fast: ["openai/gpt-5.1-mini", "openrouter/openai/gpt-5.1-mini", "openai/gpt-5.1"]
        }
      },
      {
        id: "openrouter-llama",
        label: "Meta Llama via OpenRouter",
        test: (modelId) => /^openrouter\/meta-llama\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "openrouter/meta-llama/llama-3.1-405b-instruct",
          standard: standard ?? "openrouter/meta-llama/llama-3.3-70b-instruct",
          fast: fast ?? "openrouter/meta-llama/llama-3.3-70b-instruct:free"
        }),
        options: {
          reasoning: ["openrouter/meta-llama/llama-3.1-405b-instruct", "openrouter/meta-llama/llama-3.3-70b-instruct"],
          standard: ["openrouter/meta-llama/llama-3.3-70b-instruct", "openrouter/meta-llama/llama-3.3-70b-instruct:free"],
          fast: ["openrouter/meta-llama/llama-3.3-70b-instruct:free", "openrouter/meta-llama/llama-3.3-70b-instruct"]
        }
      },
      {
        id: "ollama",
        label: "Ollama (local)",
        test: (modelId) => /^ollama\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "ollama/llama3.1:70b",
          standard: standard ?? "ollama/llama3.1:8b",
          fast: fast ?? "ollama/llama3.2:3b"
        }),
        options: {
          reasoning: ["ollama/llama3.1:70b", "ollama/qwen2.5:32b", "ollama/deepseek-r1:32b"],
          standard: ["ollama/llama3.1:8b", "ollama/qwen2.5:7b", "ollama/mistral:7b"],
          fast: ["ollama/llama3.2:3b", "ollama/phi3:mini", "ollama/qwen2.5:3b"]
        },
        local: true,
        requiresEnv: ["OLLAMA_BASE_URL"],
        pricingHint: "free \xB7 runs locally"
      },
      {
        id: "local",
        label: "Local OpenAI-compatible server",
        test: (modelId) => /^local\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "local/custom-large",
          standard: standard ?? "local/custom-medium",
          fast: fast ?? "local/custom-small"
        }),
        options: {
          reasoning: ["local/custom-large"],
          standard: ["local/custom-medium"],
          fast: ["local/custom-small"]
        },
        local: true,
        requiresEnv: ["LOCAL_LLM_BASE_URL"],
        pricingHint: "free \xB7 runs locally"
      }
    ];
    PROVIDER_ENV_MAP = {
      "anthropic": ["ANTHROPIC_API_KEY"],
      "openrouter-anthropic": ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
      "openrouter-google": ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
      "openrouter-deepseek": ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
      "openrouter-qwen": ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
      "github-copilot": ["GITHUB_TOKEN", "GH_TOKEN"],
      "openai": ["OPENAI_API_KEY"],
      "openrouter-llama": ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
      "ollama": ["OLLAMA_BASE_URL", "OLLAMA_HOST"],
      "local": ["LOCAL_LLM_BASE_URL"]
    };
    LENIENT_MODEL_FAMILIES = /* @__PURE__ */ new Set([
      "openrouter-anthropic",
      "openrouter-google",
      "openrouter-deepseek",
      "openrouter-qwen",
      "openrouter-llama",
      "openai",
      "anthropic",
      "ollama",
      "local"
    ]);
    PROVIDER_COOLDOWN_MS = 5 * 60 * 1e3;
  }
});

// lib/providers/copilot-auth.mjs
var copilot_auth_exports = {};
__export(copilot_auth_exports, {
  COPILOT_API_BASE: () => COPILOT_API_BASE,
  __resetCopilotCache: () => __resetCopilotCache,
  copilotApiHeaders: () => copilotApiHeaders,
  getCopilotToken: () => getCopilotToken,
  hasStoredCredential: () => hasStoredCredential,
  listCopilotModels: () => listCopilotModels,
  loadStoredOAuth: () => loadStoredOAuth,
  persistOAuth: () => persistOAuth,
  pollForAccessToken: () => pollForAccessToken,
  preflightCopilotSession: () => preflightCopilotSession,
  requestDeviceCode: () => requestDeviceCode
});
import fs6 from "node:fs";
import path6 from "node:path";
import os5 from "node:os";
function normalizeToken(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, "");
}
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os5.homedir();
}
function constructStorePath() {
  return path6.join(homeDir(), ".construct", "auth", "github-copilot.json");
}
function appsStorePath() {
  return path6.join(homeDir(), ".config", "github-copilot", "apps.json");
}
function hostsStorePath() {
  return path6.join(homeDir(), ".config", "github-copilot", "hosts.json");
}
function readJson(file) {
  try {
    if (!fs6.existsSync(file)) return null;
    return JSON.parse(fs6.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(file, data, mode) {
  fs6.mkdirSync(path6.dirname(file), { recursive: true, mode: 448 });
  fs6.writeFileSync(file, JSON.stringify(data, null, 2), { mode });
}
function loadStoredOAuth() {
  const own = readJson(constructStorePath());
  if (own && own.oauth_token) {
    return {
      oauthToken: normalizeToken(own.oauth_token),
      refreshToken: normalizeToken(own.refresh_token) || null,
      oauthExpiresAt: own.oauth_expires_at || null,
      user: own.user || null
    };
  }
  for (const file of [appsStorePath(), hostsStorePath()]) {
    const data = readJson(file);
    if (!data) continue;
    for (const entry of Object.values(data)) {
      const token = normalizeToken(entry?.oauth_token || entry?.token);
      if (token) return { oauthToken: token, refreshToken: null, oauthExpiresAt: null, user: entry?.user || null };
    }
  }
  return null;
}
function hasStoredCredential() {
  return loadStoredOAuth() != null;
}
function persistOAuth({ accessToken, refreshToken, expiresAt, user }) {
  const cleanAccess = normalizeToken(accessToken);
  const cleanRefresh = normalizeToken(refreshToken) || null;
  const own = readJson(constructStorePath()) || {};
  writeJson(constructStorePath(), {
    ...own,
    type: "oauth",
    oauth_token: cleanAccess,
    refresh_token: cleanRefresh || own.refresh_token || null,
    oauth_expires_at: expiresAt || null,
    user: user || own.user || null,
    rotated_at: (/* @__PURE__ */ new Date()).toISOString()
  }, 384);
  const apps = readJson(appsStorePath()) || {};
  apps[`github.com:${CLIENT_ID}`] = { user: user || apps[`github.com:${CLIENT_ID}`]?.user || "unknown", oauth_token: cleanAccess, githubAppId: CLIENT_ID };
  writeJson(appsStorePath(), apps, 384);
}
async function postJson(url, body, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...EDITOR_HEADERS },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
  }
  return { ok: res.ok, status: res.status, json, text };
}
async function requestDeviceCode({ fetchImpl = fetch } = {}) {
  const { ok, json, status, text } = await postJson(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: "read:user" }, fetchImpl);
  if (!ok || !json?.device_code) {
    throw new Error(`Copilot device-code request failed (HTTP ${status}): ${(text || "").slice(0, 160)}`);
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    interval: json.interval || 5,
    expiresIn: json.expires_in || 900
  };
}
async function pollForAccessToken({ deviceCode, interval = 5, expiresIn = 900, fetchImpl = fetch, now = Date.now, onPending } = {}) {
  const deadline = now() + expiresIn * 1e3;
  let waitMs = interval * 1e3;
  while (now() < deadline) {
    const { json } = await postJson(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    }, fetchImpl);
    if (json?.access_token) {
      return {
        accessToken: normalizeToken(json.access_token),
        refreshToken: normalizeToken(json.refresh_token) || null,
        expiresAt: json.expires_in ? Math.floor(now() / 1e3) + json.expires_in : null
      };
    }
    if (json?.error === "slow_down") waitMs += 5e3;
    else if (json?.error && json.error !== "authorization_pending") {
      throw new Error(`Copilot authorization failed: ${json.error_description || json.error}`);
    }
    if (typeof onPending === "function") onPending();
    await sleep(waitMs);
  }
  throw new Error("Copilot authorization timed out \u2014 the device code expired before approval.");
}
async function refreshAccessToken(refreshToken, { fetchImpl, now }) {
  const { json } = await postJson(ACCESS_TOKEN_URL, {
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  }, fetchImpl);
  if (!json?.access_token) throw new Error("Copilot token refresh failed \u2014 re-run `construct creds login copilot`.");
  return {
    accessToken: normalizeToken(json.access_token),
    refreshToken: normalizeToken(json.refresh_token) || refreshToken,
    expiresAt: json.expires_in ? Math.floor(now() / 1e3) + json.expires_in : null
  };
}
async function exchangeForSessionToken(accessToken, { fetchImpl }) {
  const res = await fetchImpl(COPILOT_TOKEN_URL, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, ...EDITOR_HEADERS }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Copilot token exchange failed (HTTP ${res.status}). Your GitHub account may lack an active Copilot subscription, or the login expired \u2014 re-run \`construct creds login copilot\`. ${(body || "").slice(0, 160)}`);
    err.code = "COPILOT_EXCHANGE_FAILED";
    throw err;
  }
  return res.json();
}
async function getCopilotToken({ fetchImpl = fetch, now = Date.now } = {}) {
  const nowS = Math.floor(now() / 1e3);
  if (sessionCache && sessionCache.expiresAt > nowS + SESSION_REFRESH_BUFFER_S) {
    return sessionCache.token;
  }
  const stored = loadStoredOAuth();
  if (!stored?.oauthToken) {
    const err = new Error("GitHub Copilot is not authenticated \u2014 run `construct creds login copilot`.");
    err.code = "COPILOT_NOT_AUTHENTICATED";
    throw err;
  }
  let accessToken = stored.oauthToken;
  if (stored.oauthExpiresAt && stored.oauthExpiresAt <= nowS && stored.refreshToken) {
    const refreshed = await refreshAccessToken(stored.refreshToken, { fetchImpl, now });
    accessToken = refreshed.accessToken;
    persistOAuth({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt, user: stored.user });
  }
  const session = await exchangeForSessionToken(accessToken, { fetchImpl });
  if (!session?.token) {
    const err = new Error("Copilot token exchange returned no token.");
    err.code = "COPILOT_EXCHANGE_EMPTY";
    throw err;
  }
  const sessionToken = normalizeToken(session.token);
  if (!sessionToken) {
    const err = new Error("Copilot token exchange returned an empty token.");
    err.code = "COPILOT_EXCHANGE_EMPTY";
    throw err;
  }
  sessionCache = { token: sessionToken, expiresAt: session.expires_at || nowS + 1500 };
  return sessionCache.token;
}
function copilotApiHeaders() {
  return { ...EDITOR_HEADERS, "X-Github-Api-Version": "2023-07-07" };
}
async function listCopilotModels({ fetchImpl = fetch } = {}) {
  const token = await getCopilotToken({ fetchImpl });
  const res = await fetchImpl(`${COPILOT_API_BASE}/models`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...copilotApiHeaders() }
  });
  if (!res.ok) throw new Error(`Copilot models request failed (HTTP ${res.status}).`);
  const data = await res.json();
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return items.map((m) => m?.id || m?.model).filter(Boolean);
}
function __resetCopilotCache() {
  sessionCache = null;
}
async function preflightCopilotSession({ fetchImpl = fetch } = {}) {
  __resetCopilotCache();
  try {
    await getCopilotToken({ fetchImpl });
    return { ok: true };
  } catch (err) {
    __resetCopilotCache();
    return { ok: false, message: err.message || String(err) };
  }
}
var CLIENT_ID, DEVICE_CODE_URL, ACCESS_TOKEN_URL, COPILOT_TOKEN_URL, COPILOT_API_BASE, SESSION_REFRESH_BUFFER_S, EDITOR_HEADERS, sessionCache, sleep;
var init_copilot_auth = __esm({
  "lib/providers/copilot-auth.mjs"() {
    CLIENT_ID = "Iv1.b507a08c87ecfe98";
    DEVICE_CODE_URL = "https://github.com/login/device/code";
    ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
    COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
    COPILOT_API_BASE = "https://api.githubcopilot.com";
    SESSION_REFRESH_BUFFER_S = 300;
    EDITOR_HEADERS = {
      "Editor-Version": "vscode/1.90.0",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "Copilot-Integration-Id": "vscode-chat",
      "User-Agent": "GitHubCopilotChat/0.26.7"
    };
    sessionCache = null;
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  }
});

// apps/chat/engine/models.mjs
var models_exports = {};
__export(models_exports, {
  describeChatModel: () => describeChatModel,
  listChatModels: () => listChatModels,
  recommendChatModel: () => recommendChatModel,
  resolveChatModel: () => resolveChatModel,
  resolveChatModelSelection: () => resolveChatModelSelection,
  resolveChatModelSelectionAsync: () => resolveChatModelSelectionAsync,
  resolveFreeOpenRouterModel: () => resolveFreeOpenRouterModel,
  resolveSessionModel: () => resolveSessionModel
});
function listChatModels({ env = process.env } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  for (const provider of providers) {
    for (const tier of ["reasoning", "standard", "fast"]) {
      for (const id of provider.options?.[tier] || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        models.push({
          id,
          label: id,
          provider: provider.id,
          configured: provider.configured,
          local: provider.local === true,
          suitable: true,
          tier,
          available: isChatModelAvailable(id, { env }).ok
        });
      }
    }
  }
  return models.sort((a, b) => Number(b.configured) - Number(a.configured) || a.id.localeCompare(b.id));
}
function recommendChatModel({ env = process.env } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  const configured = providers.find((p) => p.configured);
  if (!configured) return null;
  const id = configured.tiers?.standard || configured.tiers?.fast || null;
  if (!id) return null;
  const check = isChatModelAvailable(id, { env });
  if (!check.ok) return null;
  return { id, reason: `configured provider ${configured.label}` };
}
function resolveChatModelSelection({ env = process.env, requested = null, excludeFamilies = [] } = {}) {
  return resolveValidatedChatModel({ env, requested, excludeFamilies });
}
async function resolveFreeOpenRouterModel({ env = process.env, tier = "standard", exclude = [] } = {}) {
  const apiKey = resolveFirstSecret(["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"], { env });
  if (!apiKey) return null;
  const excludeSet = new Set(Array.isArray(exclude) ? exclude : []);
  const { pollFreeModels: pollFreeModels2, topForTier: topForTier2 } = await Promise.resolve().then(() => (init_model_free_selector(), model_free_selector_exports));
  const freeModels = await pollFreeModels2(apiKey);
  for (const candidate of topForTier2(freeModels, tier, 20)) {
    const modelId = candidate.id.startsWith("openrouter/") ? candidate.id : `openrouter/${candidate.id}`;
    if (excludeSet.has(modelId)) continue;
    if (isChatModelAvailable(modelId, { env }).ok) return modelId;
  }
  return null;
}
async function resolveSessionModel(session, { env = process.env, exclude = [], tier = "standard" } = {}) {
  if (session?.modelMode === "free-router") {
    const merged = [.../* @__PURE__ */ new Set([...getExcludeFromSession(session), ...exclude])];
    return resolveFreeOpenRouterModel({ env, tier, exclude: merged });
  }
  return session?.model || session?.savedModel || null;
}
function getExcludeFromSession(session) {
  if (!session?.failedModels) return [];
  return session.failedModels instanceof Set ? [...session.failedModels] : [];
}
async function resolveChatModelSelectionAsync({
  env = process.env,
  requested = null,
  fetchImpl = fetch
} = {}) {
  let resolution = resolveValidatedChatModel({ env, requested });
  if (!resolution.id?.startsWith("github-copilot/")) return resolution;
  const { preflightCopilotSession: preflightCopilotSession2 } = await Promise.resolve().then(() => (init_copilot_auth(), copilot_auth_exports));
  const probe = await preflightCopilotSession2({ fetchImpl });
  if (probe.ok) return resolution;
  const fallback = resolveValidatedChatModel({ env, requested: null, excludeFamilies: ["github-copilot"] });
  if (fallback.id) {
    return {
      ...fallback,
      notice: `GitHub Copilot session failed (${probe.message}). Using ${fallback.id}.`
    };
  }
  return {
    id: null,
    source: null,
    notice: `GitHub Copilot session failed: ${probe.message}`,
    rejected: resolution.rejected
  };
}
function resolveChatModel(opts = {}) {
  return resolveChatModelSelection(opts).id;
}
function describeChatModel(modelId, { env = process.env } = {}) {
  return describeModelFamily(modelId, { env });
}
var init_models = __esm({
  "apps/chat/engine/models.mjs"() {
    init_model_router();
    init_secret_resolver();
  }
});

// lib/project-root.mjs
import fs7 from "node:fs";
import path7 from "node:path";
import os6 from "node:os";
import { createHash } from "node:crypto";
function findProjectRoot(start = process.cwd()) {
  let dir = path7.resolve(start);
  const stop = path7.resolve(HOME);
  while (true) {
    if (MARKERS.some((m) => fs7.existsSync(path7.join(dir, m)))) return dir;
    if (dir === stop) return null;
    const parent = path7.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function projectIdFor(projectRoot) {
  if (!projectRoot) return null;
  return createHash("sha256").update(path7.resolve(projectRoot)).digest("hex").slice(0, 12);
}
function resolveProjectScope(cwd = process.cwd()) {
  if (cache.has(cwd)) return cache.get(cwd);
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    cache.set(cwd, null);
    return null;
  }
  const result = {
    projectRoot,
    projectId: projectIdFor(projectRoot),
    cxDir: path7.join(projectRoot, ".cx")
  };
  cache.set(cwd, result);
  return result;
}
function resolveProjectScopedPath(basename, { cwd, ensureDir = true } = {}) {
  const scope = resolveProjectScope(cwd ?? process.cwd());
  const dir = scope ? scope.cxDir : path7.join(HOME, ".cx");
  if (ensureDir && !fs7.existsSync(dir)) fs7.mkdirSync(dir, { recursive: true });
  return path7.join(dir, basename);
}
var HOME, MARKERS, cache;
var init_project_root = __esm({
  "lib/project-root.mjs"() {
    HOME = os6.homedir();
    MARKERS = [".cx", ".construct"];
    cache = /* @__PURE__ */ new Map();
  }
});

// apps/chat/tui/index.jsx
import React3, { useState, useRef, useCallback, useEffect, useMemo, createContext, useContext } from "react";
import { render, Box as Box3, Text as Text3, useApp, useInput, useStdout } from "ink";

// lib/chat/tui/usage.mjs
function addInto(target, tokens = {}) {
  for (const key of Object.keys(target)) {
    if (Number.isFinite(tokens[key])) target[key] += tokens[key];
  }
}
function addUsage(session, event) {
  if (!session || !event) return;
  session.turns += 1;
  addInto(session.tokens, event.tokens || {});
  if (event.cost && Number.isFinite(event.cost.amount)) {
    session.cost.amount += event.cost.amount;
    if (event.cost.currency) session.cost.currency = event.cost.currency;
  }
  if (event.subAgent && event.tokens) {
    const prev = session.bySubAgent.get(event.subAgent) || { input: 0, output: 0, total: 0 };
    addInto(prev, event.tokens);
    session.bySubAgent.set(event.subAgent, prev);
  }
  session.history.push({ tokens: event.tokens || null, cost: event.cost || null, model: event.model || null });
}
function formatTokens(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 1e3) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}
function formatCost(cost) {
  if (!cost || !Number.isFinite(cost.amount)) return null;
  if (cost.amount === 0) return "$0";
  const digits = cost.amount < 0.01 ? 4 : cost.amount < 1 ? 3 : 2;
  return `~$${cost.amount.toFixed(digits)}`;
}
function usageParts(event) {
  const t = event.tokens || {};
  const parts = [];
  if (Number.isFinite(t.input)) parts.push(`prompt ${formatTokens(t.input)}`);
  if (Number.isFinite(t.output)) parts.push(`output ${formatTokens(t.output)}`);
  if (Number.isFinite(t.reasoning) && t.reasoning > 0) parts.push(`reasoning ${formatTokens(t.reasoning)}`);
  if (Number.isFinite(t.cacheRead) && t.cacheRead > 0) parts.push(`cache\u2193 ${formatTokens(t.cacheRead)}`);
  if (Number.isFinite(t.cacheWrite) && t.cacheWrite > 0) parts.push(`cache\u2191 ${formatTokens(t.cacheWrite)}`);
  if (Number.isFinite(t.total)) parts.push(`total ${formatTokens(t.total)}`);
  const cost = formatCost(event.cost);
  if (cost) parts.push(cost);
  if (event.context && Number.isFinite(event.context.used) && Number.isFinite(event.context.size)) {
    parts.push(`ctx ${formatTokens(event.context.used)}/${formatTokens(event.context.size)}`);
  }
  if (event.model) parts.push(`model ${event.model}`);
  return parts;
}
function formatUsageFooter(event, colors = {}) {
  const dim = colors.dim || "";
  const reset = colors.reset || "";
  const parts = usageParts(event);
  if (!parts.length) return `${dim}[usage] (host reported no token counts)${reset}`;
  return `${dim}[usage] ${parts.join(" \xB7 ")}${reset}`;
}
function formatUsagePanel(session, colors = {}) {
  const dim = colors.dim || "";
  const bold = colors.bold || "";
  const reset = colors.reset || "";
  const lines = [];
  lines.push(`${bold}session usage${reset} ${dim}(${session.turns} turn${session.turns === 1 ? "" : "s"})${reset}`);
  const t = session.tokens;
  const totalParts = [];
  if (t.input) totalParts.push(`prompt ${formatTokens(t.input)}`);
  if (t.output) totalParts.push(`output ${formatTokens(t.output)}`);
  if (t.reasoning) totalParts.push(`reasoning ${formatTokens(t.reasoning)}`);
  if (t.cacheRead) totalParts.push(`cache\u2193 ${formatTokens(t.cacheRead)}`);
  if (t.cacheWrite) totalParts.push(`cache\u2191 ${formatTokens(t.cacheWrite)}`);
  if (t.total) totalParts.push(`total ${formatTokens(t.total)}`);
  const cost = formatCost(session.cost);
  if (cost) totalParts.push(cost);
  lines.push(totalParts.length ? `  ${totalParts.join(" \xB7 ")}` : `  ${dim}no token counts reported yet${reset}`);
  if (session.bySubAgent.size) {
    lines.push(`${dim}  by sub-agent:${reset}`);
    for (const [name, st] of session.bySubAgent) {
      lines.push(`    ${name}: prompt ${formatTokens(st.input)} \xB7 output ${formatTokens(st.output)} \xB7 total ${formatTokens(st.total)}`);
    }
  }
  return lines.join("\n");
}

// lib/chat/transparency.mjs
var CHANNEL_BY_TYPE = {
  thinking: "thinking",
  text: "message",
  plan: "path",
  tool_call: "tools",
  tool_update: "tools",
  usage: "observability",
  specialist: "specialists",
  permission: "permission",
  error: "error",
  done: "system"
};
function channelFor(event) {
  return CHANNEL_BY_TYPE[event?.type] || "system";
}
function isVisible(event, layers) {
  const channel = channelFor(event);
  if (channel === "message" || channel === "permission" || channel === "error" || channel === "system") return true;
  return Boolean(layers[channel]);
}

// apps/chat/tui/turn-state.mjs
function createTurnState() {
  return {
    assistant: "",
    thinking: "",
    tools: [],
    plan: [],
    route: [],
    permissions: [],
    error: null,
    rendered: false,
    stopReason: null,
    lastUsage: null
  };
}
function applyTurnEvent(state, event, { session = null } = {}) {
  switch (event?.type) {
    case "text":
      state.assistant += event.text || "";
      state.rendered = true;
      break;
    case "thinking":
      state.thinking += event.text || "";
      state.rendered = true;
      break;
    case "plan":
      state.plan = Array.isArray(event.entries) ? event.entries : [];
      state.rendered = true;
      break;
    case "tool_call": {
      state.tools.push({
        id: event.id,
        title: event.title || event.kind || "tool",
        status: "pending",
        input: event.input ?? null
      });
      state.rendered = true;
      break;
    }
    case "tool_update": {
      const existing = state.tools.find((t) => t.id === event.id);
      if (existing) existing.status = event.status || existing.status;
      else state.tools.push({ id: event.id, title: event.id || "tool", status: event.status || "pending" });
      state.rendered = true;
      break;
    }
    case "usage":
      if (session) addUsage(session.usage, event);
      state.lastUsage = event;
      break;
    case "permission": {
      const title = event.toolCall?.title || event.toolCall?.callID || "tool";
      state.permissions.push({ title, detail: event.options?.length ? `${event.options.length} options` : "decision" });
      state.rendered = true;
      break;
    }
    case "error":
      state.error = event.message || "error";
      state.rendered = true;
      break;
    case "done":
      state.stopReason = event.stopReason || "end_turn";
      break;
    default:
      break;
  }
  return state;
}
async function runTurnInto(driver, text, opts, { session = null, layers = null, onUpdate = () => {
} } = {}) {
  const state = createTurnState();
  for await (const event of driver.prompt(text, opts)) {
    if (layers && !isVisible(event, layers)) continue;
    applyTurnEvent(state, event, { session });
    onUpdate(state, event);
  }
  return state;
}

// lib/chat/openrouter-fallback.mjs
init_model_router();
var MAX_FALLBACK_ATTEMPTS = 3;
function parseOpenRouterError(error) {
  const text = typeof error === "string" ? error : String(error?.message || error || "");
  let raw = text;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const body = JSON.parse(jsonMatch[0]);
      raw = body?.error?.metadata?.raw || body?.error?.message || text;
    }
  } catch {
  }
  let summary = raw;
  if (/rate[- ]?limit|429|temporarily rate-limited/i.test(raw)) {
    summary = raw.replace(/^Provider returned error\.?\s*/i, "").trim() || "rate-limited upstream";
  } else if (/unavailable for free|paid version is available/i.test(raw)) {
    summary = "free tier retired \u2014 use a different free model or paid slug";
  } else if (/Failed after \d+ attempts/i.test(text)) {
    summary = raw || "provider error after retries";
  }
  return { raw, summary, text };
}
function ensureFailedModels(session) {
  if (!session.failedModels) session.failedModels = /* @__PURE__ */ new Set();
  return session.failedModels;
}
function recordFailedModel(session, modelId) {
  if (!modelId) return;
  ensureFailedModels(session).add(modelId);
}
function getExcludeList(session) {
  return [...ensureFailedModels(session)];
}
function shouldAttemptFreeFallback(session, modelId) {
  if (session?.modelMode === "free-router") return true;
  return typeof modelId === "string" && /:free$/i.test(modelId);
}
async function handleOpenRouterFailure({ session, error, env = process.env, currentModel }) {
  const parsed = parseOpenRouterError(error);
  const classified = classifyProviderFailure({ error: { message: parsed.text || parsed.raw } });
  if (!classified?.retryable) return null;
  if (!shouldAttemptFreeFallback(session, currentModel)) return null;
  recordFailedModel(session, currentModel);
  const exclude = getExcludeList(session);
  const { resolveFreeOpenRouterModel: resolveFreeOpenRouterModel2 } = await Promise.resolve().then(() => (init_models(), models_exports));
  const next = await resolveFreeOpenRouterModel2({ env, tier: "standard", exclude });
  if (!next || next === currentModel) return null;
  const short = (id) => id.replace(/^openrouter\//, "");
  return {
    modelId: next,
    notice: `${short(currentModel)} failed (${parsed.summary}). Switched to ${short(next)}. Retry or /model to pick manually.`
  };
}
async function runTurnWithFallback({
  driver,
  text,
  session,
  layers,
  env,
  promptOptions = {},
  runTurnInto: runTurnInto2,
  onUpdate = () => {
  }
}) {
  let model = session.model;
  let lastState = null;
  let lastNotice = null;
  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    lastState = await runTurnInto2(
      driver,
      text,
      { ...promptOptions, model, turnOverlay: promptOptions.turnOverlay },
      { session, layers, onUpdate }
    );
    if (!lastState.error) {
      return { state: lastState, model, notice: lastNotice };
    }
    const fallback = await handleOpenRouterFailure({
      session,
      error: lastState.error,
      env,
      currentModel: model
    });
    if (!fallback) break;
    model = fallback.modelId;
    session.model = model;
    lastNotice = fallback.notice;
  }
  return { state: lastState, model, notice: lastNotice };
}

// lib/chat/export.mjs
init_project_root();
import fs8 from "node:fs";
import path8 from "node:path";

// lib/chat/tui/turn-present.mjs
function summarizeToolCalls(tools = []) {
  const groups = /* @__PURE__ */ new Map();
  for (const t of tools) {
    const title = t.title || t.kind || "tool";
    if (!groups.has(title)) {
      groups.set(title, { title, count: 0, status: "completed", refs: [] });
    }
    const g = groups.get(title);
    g.count += 1;
    if (t.status === "failed") g.status = "failed";
    else if (t.status === "pending" && g.status !== "failed") g.status = "pending";
    else if (t.status === "in_progress" && g.status === "completed") g.status = "in_progress";
    const ref = t.input?.path || t.input?.pattern || t.input?.glob || t.input?.name;
    if (ref) {
      const s = String(ref);
      if (!g.refs.includes(s)) g.refs.push(s);
    }
  }
  return [...groups.values()];
}
function summarizeSources(sources = []) {
  if (!sources?.length) {
    return { total: 0, byTool: {}, refs: [] };
  }
  const byTool = {};
  const refs = [];
  for (const s of sources) {
    byTool[s.tool] = (byTool[s.tool] || 0) + 1;
    if (s.ref && !refs.includes(s.ref)) refs.push(s.ref);
  }
  return { total: sources.length, byTool, refs };
}
function formatRefsInline(refs, { max = 3 } = {}) {
  if (!refs?.length) return "";
  if (refs.length <= max) return refs.join(", ");
  const shown = refs.slice(0, max);
  return `${shown.join(", ")} +${refs.length - max} more`;
}
function formatSourceToolCounts(byTool) {
  const entries = Object.entries(byTool || {});
  if (!entries.length) return "";
  return entries.map(([tool, n]) => `${tool} ${n}`).join("  ");
}
function contextRows(overlay, { layers = null } = {}) {
  if (!overlay) return [];
  const rows = [];
  if (overlay.intent) rows.push({ label: "intent", value: overlay.intent });
  if (overlay.workCategory) rows.push({ label: "category", value: overlay.workCategory });
  if (overlay.specialists?.length && layers?.specialists !== false) {
    rows.push({ label: "route", value: overlay.specialists.join(" \u2192 ") });
  }
  if (overlay.externalResearch?.required) {
    const shape = overlay.externalResearch.shape ? ` (${overlay.externalResearch.shape})` : "";
    rows.push({ label: "research", value: `required${shape}` });
  }
  return rows;
}
function splitSourceLines(refs, { limit = 4 } = {}) {
  if (!refs?.length) return { lines: ["none yet"], hidden: 0, total: 0 };
  const shown = refs.slice(0, limit);
  return {
    lines: shown,
    hidden: Math.max(0, refs.length - limit),
    total: refs.length
  };
}
function toolGroupLabel(group) {
  const count = group.count > 1 ? ` \xD7${group.count}` : "";
  const refs = formatRefsInline(group.refs, { max: 2 });
  return refs ? `${group.title}${count}  ${refs}` : `${group.title}${count}`;
}

// lib/chat/export.mjs
function exportDir({ cwd }) {
  const base = resolveProjectScopedPath("chat-sessions", { cwd, ensureDir: true });
  const dir = path8.join(base, "exports");
  fs8.mkdirSync(dir, { recursive: true });
  return dir;
}
function turnToMarkdown(turn) {
  const lines = [`## you`, "", turn.userText || "", ""];
  const src = summarizeSources(turn.sources || []);
  if (src.total) {
    lines.push(`sources: ${src.refs.join(", ")}`, "");
  }
  lines.push("## construct", "", turn.assistant || "(no answer)", "");
  return lines.join("\n");
}
function exportTurns(turnBlocks, { scope = "last", cwd = process.cwd() } = {}) {
  const turns = turnBlocks.filter((item) => item.kind === "turn").map((item) => item.block);
  if (!turns.length) return { ok: false, error: "no turns to export" };
  let selected = turns;
  if (scope === "last") selected = [turns[turns.length - 1]];
  else if (scope === "turn" && turns.length) selected = [turns[turns.length - 1]];
  const body = selected.map(turnToMarkdown).join("\n---\n\n");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const file = path8.join(exportDir({ cwd }), `${stamp}-${scope}-answer.md`);
  fs8.writeFileSync(file, `${body}
`, "utf8");
  return { ok: true, path: file, count: selected.length };
}

// lib/chat/config.mjs
import fs9 from "node:fs";
init_project_root();
var LAYER_KEYS = ["thinking", "path", "specialists", "tools", "observability"];
var PERMISSION_MODES = ["ask", "allow_once", "allow_always", "reject"];
var SANDBOX_LEVELS = ["read-only", "workspace-write", "danger-full-access"];
var INSPECTOR_MODES = ["off", "auto", "on"];
var THEME_MODES = ["auto", "light", "dark"];
var DEFAULTS = Object.freeze({
  host: null,
  model: null,
  modelMode: "pinned",
  layers: Object.freeze(Object.fromEntries(LAYER_KEYS.map((k) => [k, true]))),
  thinking: true,
  permissionMode: "allow_once",
  sandbox: null,
  ui: Object.freeze({ ascii: false, inspector: "auto", theme: "auto" })
});
var CONFIG_BASENAME = "chat-config.json";
function saveChatConfig(config, { cwd = process.cwd() } = {}) {
  const target = resolveProjectScopedPath(CONFIG_BASENAME, { cwd, ensureDir: true });
  const persisted = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] == null) continue;
    persisted[key] = key === "layers" ? { ...config.layers } : key === "ui" ? { ...config.ui } : config[key];
  }
  fs9.writeFileSync(target, `${JSON.stringify(persisted, null, 2)}
`);
  return target;
}
function validateSetting(key, rawValue) {
  switch (key) {
    case "host":
      return { ok: true, value: String(rawValue) };
    case "model":
      return { ok: true, value: String(rawValue) };
    case "thinking": {
      const v = parseBool(rawValue);
      return v == null ? { ok: false, error: "thinking must be on/off" } : { ok: true, value: v };
    }
    case "permissionMode":
    case "permission":
      return PERMISSION_MODES.includes(rawValue) ? { ok: true, key: "permissionMode", value: rawValue } : { ok: false, error: `permission must be one of: ${PERMISSION_MODES.join(", ")}` };
    case "sandbox":
      return SANDBOX_LEVELS.includes(rawValue) ? { ok: true, value: rawValue } : { ok: false, error: `sandbox must be one of: ${SANDBOX_LEVELS.join(", ")}` };
    case "ascii": {
      const v = parseBool(rawValue);
      return v == null ? { ok: false, error: "ascii must be on/off" } : { ok: true, key: "ui.ascii", value: v };
    }
    case "inspector":
      return INSPECTOR_MODES.includes(String(rawValue).toLowerCase()) ? { ok: true, key: "ui.inspector", value: String(rawValue).toLowerCase() } : { ok: false, error: `inspector must be one of: ${INSPECTOR_MODES.join(", ")}` };
    case "theme":
      return THEME_MODES.includes(String(rawValue).toLowerCase()) ? { ok: true, key: "ui.theme", value: String(rawValue).toLowerCase() } : { ok: false, error: `theme must be one of: ${THEME_MODES.join(", ")}` };
    default:
      if (LAYER_KEYS.includes(key)) {
        const v = parseBool(rawValue);
        return v == null ? { ok: false, error: `${key} must be on/off` } : { ok: true, key: `layers.${key}`, value: v };
      }
      return { ok: false, error: `unknown setting: ${key}` };
  }
}
function parseBool(v) {
  if (v === true || v === false) return v;
  const s = String(v).toLowerCase();
  if (["on", "true", "1", "yes", "show"].includes(s)) return true;
  if (["off", "false", "0", "no", "hide"].includes(s)) return false;
  return null;
}

// lib/chat/session-settings.mjs
function applySessionSetting(session, layers, key, rawValue, { cwd, hostId = "construct" } = {}) {
  const result = validateSetting(key, rawValue);
  if (!result.ok) return result;
  const targetKey = result.key || key;
  if (targetKey.startsWith("layers.")) {
    const layer = targetKey.slice("layers.".length);
    layers[layer] = result.value;
    session.layers = { ...layers };
  } else if (targetKey === "thinking") {
    layers.thinking = result.value;
    session.layers = { ...layers };
    session.thinking = result.value;
  } else if (targetKey === "model") {
    session.model = result.value;
    session.modelMode = "pinned";
    session.savedModel = result.value;
  } else if (targetKey === "permissionMode") {
    session.permissionMode = result.value;
  } else if (targetKey === "sandbox") {
    session.sandbox = result.value;
  } else if (targetKey === "ui.ascii") {
    session.ui = { ...session.ui || { ascii: false, inspector: "auto", theme: "auto" }, ascii: result.value };
  } else if (targetKey === "ui.inspector") {
    session.ui = { ...session.ui || { ascii: false, inspector: "auto", theme: "auto" }, inspector: result.value };
  } else if (targetKey === "ui.theme") {
    session.ui = { ...session.ui || { ascii: false, inspector: "auto", theme: "auto" }, theme: result.value };
  }
  try {
    saveChatConfig({
      host: hostId,
      model: session.modelMode === "pinned" ? session.model : null,
      modelMode: session.modelMode || "pinned",
      layers,
      thinking: layers?.thinking,
      permissionMode: session.permissionMode,
      sandbox: session.sandbox,
      ui: session.ui
    }, { cwd });
  } catch {
  }
  return { ok: true, key: targetKey, value: result.value };
}

// lib/chat/model-picker.mjs
init_secret_resolver();
init_model_router();
init_models();

// lib/chat/list-picker.mjs
function filterPickerItems(items = [], query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = [item.id, item.label, item.detail, item.tag].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}
function pickerStartIndex(items, selectedId, idKey = "id") {
  if (!items?.length) return 0;
  const idx = items.findIndex((item) => item[idKey] === selectedId);
  return idx >= 0 ? idx : 0;
}
function windowPickerItems(items, index, windowSize = 12) {
  if (!items?.length) return { items: [], offset: 0 };
  const size = Math.max(5, windowSize);
  let start = Math.max(0, index - Math.floor(size / 2));
  if (start + size > items.length) start = Math.max(0, items.length - size);
  return { items: items.slice(start, start + size), offset: start };
}
function clampPickerIndex(state) {
  const visible = filterPickerItems(state.items, state.query);
  const max = Math.max(0, visible.length - 1);
  return { ...state, index: Math.min(state.index, max) };
}
function createListPickerState({
  kind,
  title,
  items,
  selectedId = null,
  context = null,
  query = ""
} = {}) {
  const visible = filterPickerItems(items, query);
  return {
    kind,
    title,
    items,
    query,
    index: pickerStartIndex(visible, selectedId),
    context
  };
}
function getPickerVisibleItems(state) {
  return filterPickerItems(state?.items || [], state?.query || "");
}
function getPickerSelectedItem(state) {
  const visible = getPickerVisibleItems(state);
  return visible[state?.index ?? 0] || null;
}
function movePickerIndex(state, delta) {
  const visible = getPickerVisibleItems(state);
  if (!visible.length) return state;
  const next = Math.max(0, Math.min(visible.length - 1, (state.index ?? 0) + delta));
  return { ...state, index: next };
}
function appendPickerQuery(state, char) {
  if (!char) return state;
  return clampPickerIndex({ ...state, query: `${state.query || ""}${char}`, index: 0 });
}
function backspacePickerQuery(state) {
  return clampPickerIndex({ ...state, query: (state.query || "").slice(0, -1), index: 0 });
}
function reducePickerKey(state, { char, key } = {}) {
  if (!state) return { state: null, action: "none" };
  if (key?.escape) return { state: null, action: "cancel" };
  if (key?.return) return { state, action: "commit" };
  if (key?.upArrow) return { state: movePickerIndex(state, -1), action: "none" };
  if (key?.downArrow) return { state: movePickerIndex(state, 1), action: "none" };
  if (key?.backspace || key?.delete) return { state: backspacePickerQuery(state), action: "none" };
  if (char && !key?.ctrl && !key?.meta) return { state: appendPickerQuery(state, char), action: "none" };
  return { state, action: "none" };
}
function pickerViewport(state, windowSize = 14) {
  const visible = getPickerVisibleItems(state);
  const clamped = clampPickerIndex({ ...state, items: visible });
  return windowPickerItems(visible, clamped.index, windowSize);
}

// lib/chat/model-picker.mjs
var FREE_ROUTER_ITEM_ID = "__free_router__";
var FREE_PICKER_LIMIT = 18;
function sortModelsForPicker(models = []) {
  return [...models].sort(
    (a, b) => Number(Boolean(b.action === "free-router")) - Number(Boolean(a.action === "free-router")) || Number(Boolean(b.isFree)) - Number(Boolean(a.isFree)) || Number(b.suitable !== false) - Number(a.suitable !== false) || Number(Boolean(b.isProviderDefault)) - Number(Boolean(a.isProviderDefault)) || String(a.label || a.id).localeCompare(String(b.label || b.id))
  );
}
function shortModelLabel(id) {
  if (!id) return id;
  const name = id.replace(/^openrouter\//, "");
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}
function catalogItem(model) {
  const id = model.id;
  const isFree = id.includes(":free") || model.isFree === true;
  return {
    id,
    label: model.label || (isFree ? shortModelLabel(id) : id),
    tag: model.action === "free-router" ? "router" : isFree ? "free" : model.local ? "local" : model.tier || null,
    detail: model.detail || model.name || (model.configured === false ? "not configured" : null),
    isFree,
    action: model.action || null,
    suitable: model.suitable
  };
}
function configuredTierPickerItems({ env = process.env } = {}) {
  const { providers } = getProviderModelCatalog({ env });
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  for (const provider of providers) {
    if (!provider.configured) continue;
    for (const tier of ["reasoning", "standard", "fast"]) {
      const id = provider.tiers?.[tier];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push(catalogItem({
        id,
        label: id,
        name: `${provider.label} \xB7 ${tier}`,
        tier,
        configured: true,
        suitable: true,
        isProviderDefault: tier === "standard"
      }));
    }
  }
  return { items, seen };
}
async function loadModelPickerItems(_driver, { env = process.env, currentModel = null, modelMode = "pinned" } = {}) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const hasOpenRouter = hasAnySecret(["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"], { env });
  items.push({
    id: FREE_ROUTER_ITEM_ID,
    label: "OpenRouter free router \u2014 auto-pick best standard model",
    tag: "router",
    detail: hasOpenRouter ? "auto-pick on launch + retry on failure; not pinned" : "needs OPENROUTER_API_KEY in ~/.construct/config.env",
    action: "free-router",
    configured: hasOpenRouter,
    disabled: !hasOpenRouter
  });
  seen.add(FREE_ROUTER_ITEM_ID);
  if (hasOpenRouter) {
    try {
      const apiKey = resolveFirstSecret(["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"], { env });
      if (!apiKey) throw new Error("missing");
      const { pollFreeModels: pollFreeModels2, topForTier: topForTier2 } = await Promise.resolve().then(() => (init_model_free_selector(), model_free_selector_exports));
      const freeLive = await pollFreeModels2(apiKey);
      for (const f of topForTier2(freeLive, "standard", FREE_PICKER_LIMIT)) {
        const id = f.id?.startsWith("openrouter/") ? f.id : `openrouter/${f.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(catalogItem({
          id,
          label: shortModelLabel(id),
          name: f.name || id,
          detail: id,
          isFree: true,
          configured: true,
          suitable: true
        }));
      }
    } catch {
    }
  }
  const tierItems = configuredTierPickerItems({ env });
  for (const item of tierItems.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  if (currentModel && modelMode !== "free-router" && !seen.has(currentModel)) {
    items.push(catalogItem({
      id: currentModel,
      label: currentModel,
      name: "current session",
      configured: true,
      suitable: true
    }));
  }
  return sortModelsForPicker(items);
}
async function resolveModelPickerSelection(item, { env = process.env } = {}) {
  if (!item) return null;
  if (item.action === "free-router" || item.id === FREE_ROUTER_ITEM_ID) {
    const modelId = await resolveFreeOpenRouterModel({ env, tier: "standard" });
    return modelId ? { mode: "free-router", modelId } : null;
  }
  return { mode: "pinned", modelId: item.id };
}
function commitPickerModel(session, selection, { cwd, hostId = "construct", layers = null } = {}) {
  const normalized = typeof selection === "string" ? { mode: "pinned", modelId: selection } : selection;
  if (!normalized?.modelId && normalized?.mode !== "free-router") return null;
  session.modelMode = normalized.mode || "pinned";
  session.model = normalized.modelId;
  session.savedModel = session.modelMode === "pinned" ? normalized.modelId : null;
  try {
    saveChatConfig({
      host: hostId,
      model: session.modelMode === "pinned" ? session.model : null,
      modelMode: session.modelMode,
      layers: layers || session.layers,
      thinking: (layers || session.layers)?.thinking,
      permissionMode: session.permissionMode,
      sandbox: session.sandbox,
      ui: session.ui
    }, { cwd });
  } catch {
  }
  return normalized;
}
function pickerSelectedId(session) {
  if (session?.modelMode === "free-router") return FREE_ROUTER_ITEM_ID;
  return session?.savedModel || session?.model || null;
}
function formatModelHeader(session) {
  if (session?.modelMode === "free-router") {
    const slug = session.model ? session.model.replace(/^openrouter\//, "") : "(resolving\u2026)";
    return { label: `free router \u2192 ${slug}`, isRouter: true };
  }
  return { label: session?.model || "(no model)", isRouter: false };
}

// lib/chat/commands.mjs
var HELP = [
  ["/help", "show this help"],
  ["/model [id]", "show or set the model (no id opens a searchable picker)"],
  ["/models", "open the searchable model picker"],
  ["/free", "set OpenRouter free-router mode (--free equivalent)"],
  ["/export [last|session]", "write plain markdown answer to .cx/chat-sessions/exports/"],
  ["/set <key> <on|off|value>", "change a setting (thinking, tools, path, specialists, observability, permission, sandbox, model)"],
  ["/settings", "show current settings"],
  ["/layers", "show transparency layers"],
  ["/usage", "show session token and cost breakdown"],
  ["/host", "show the active host"],
  ["/clear", "clear the screen"],
  ["/inspect", "toggle turn inspector panel (on/off/auto)"],
  ["/exit", "quit"]
];
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}
function sortBySuitability(models) {
  return [...models].sort((a, b) => Number(b.suitable !== false) - Number(a.suitable !== false) || Number(Boolean(b.isProviderDefault)) - Number(Boolean(a.isProviderDefault)));
}
function modelTags(m, colors) {
  const tags = [];
  if (m.isProviderDefault) tags.push("provider default");
  if (m.imageOutput) tags.push("image \u2014 not for chat");
  else if (m.suitable === false) tags.push("non-text");
  else if (m.toolCall === false) tags.push("no tools");
  return tags.length ? `${colors.dim} (${tags.join(", ")})${colors.reset}` : "";
}
function createCommands({ driver, host, hostId = host, version, cwd = process.cwd(), turnBlocksRef = null } = {}) {
  async function handle(input, ctx) {
    const { output, colors, layers, session, rl, onClear } = ctx;
    const [cmd, ...rest] = input.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "/exit":
      case "/quit":
        return false;
      case "/help":
        output.write(`${colors.bold}commands${colors.reset}
`);
        for (const [name, desc] of HELP) output.write(`  ${colors.cyan}${name.padEnd(28)}${colors.reset}${colors.dim}${desc}${colors.reset}
`);
        break;
      case "/host": {
        const mode = session.modelMode === "free-router" ? "free-router" : "pinned";
        output.write(`${colors.dim}engine:${colors.reset} ${host} (owned loop)${version ? ` (${version})` : ""}  ${colors.dim}model:${colors.reset} ${session.model || "(default)"}  ${colors.dim}mode:${colors.reset} ${mode}
`);
        output.write(`${colors.dim}construct runs the loop itself; switch models with /model${colors.reset}
`);
        break;
      }
      case "/models":
        await showModels(output, colors, session);
        break;
      case "/free": {
        const { resolveFreeOpenRouterModel: resolveFreeOpenRouterModel2 } = await Promise.resolve().then(() => (init_models(), models_exports));
        const freeId = await resolveFreeOpenRouterModel2({ env: process.env, tier: "standard" });
        if (!freeId) {
          output.write(`${colors.red}OpenRouter free router needs OPENROUTER_API_KEY${colors.reset}
`);
          break;
        }
        commitPickerModel(session, { mode: "free-router", modelId: freeId }, { cwd, hostId, layers: session.layers });
        output.write(`${colors.green}model mode:${colors.reset} free-router \u2192 ${freeId} ${colors.dim}(saved)${colors.reset}
`);
        break;
      }
      case "/export": {
        const scope = arg === "session" ? "session" : "last";
        const blocks = turnBlocksRef?.() || [];
        const result = exportTurns(blocks, { scope, cwd });
        if (!result.ok) output.write(`${colors.red}${result.error}${colors.reset}
`);
        else output.write(`${colors.green}exported${colors.reset} ${result.count} turn(s) to ${result.path}
`);
        break;
      }
      case "/model":
        await setModel(output, colors, session, rl, arg, ctx.ask);
        break;
      case "/set":
        applySetting(output, colors, session, layers, rest);
        break;
      case "/settings":
        showSettings(output, colors, session, layers);
        break;
      case "/layers":
        output.write(`${colors.dim}layers:${colors.reset} ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? "on" : "off"}`).join("  ")}
`);
        output.write(`${colors.dim}toggle with: /set <layer> on|off${colors.reset}
`);
        break;
      case "/usage":
        output.write(formatUsagePanel(session.usage, colors) + "\n");
        break;
      case "/inspect": {
        session.inspectorForced = session.inspectorForced === true ? false : session.inspectorForced === false ? null : true;
        const label = session.inspectorForced === true ? "on" : session.inspectorForced === false ? "off" : "auto";
        output.write(`${colors.green}inspector:${colors.reset} ${label}
`);
        break;
      }
      case "/clear":
        if (typeof onClear === "function") onClear();
        else output.write("\x1B[2J\x1B[H");
        break;
      default:
        output.write(`${colors.dim}unknown command: ${cmd} \u2014 try /help${colors.reset}
`);
    }
    return true;
  }
  async function listModelsSafe() {
    if (typeof driver.listModels !== "function") return null;
    try {
      return await driver.listModels();
    } catch {
      return null;
    }
  }
  async function showModels(output, colors, session) {
    const models = await listModelsSafe();
    if (!models) {
      output.write(`${colors.dim}this host does not expose a model list${colors.reset}
`);
      return;
    }
    if (!models.length) {
      output.write(`${colors.dim}no models reported by the host${colors.reset}
`);
      return;
    }
    output.write(`${colors.bold}available models${colors.reset} ${colors.dim}(${models.length})${colors.reset}
`);
    for (const m of sortBySuitability(models)) {
      const marker = session.model === m.id ? `${colors.green}\u25CF${colors.reset}` : " ";
      output.write(`  ${marker} ${m.id}${modelTags(m, colors)}
`);
    }
  }
  async function setModel(output, colors, session, rl, arg, askFn = null) {
    if (arg) {
      commitModel(output, colors, session, arg);
      return;
    }
    const models = await listModelsSafe();
    if (!models || !models.length) {
      output.write(`${colors.dim}no models to pick from; set one with /model <id>${colors.reset}
`);
      return;
    }
    output.write(`${colors.bold}select a model${colors.reset}
`);
    const ordered = sortBySuitability(models);
    ordered.forEach((m, i) => {
      const marker = session.model === m.id ? `${colors.green}\u25CF${colors.reset}` : " ";
      output.write(`  ${marker} ${String(i + 1).padStart(2)}. ${m.id}${modelTags(m, colors)}
`);
    });
    const prompt = `${colors.green}model #${colors.reset} `;
    const answer = rl ? (await ask(rl, prompt)).trim() : askFn ? String(await askFn(prompt)).trim() : "";
    if (!answer) {
      output.write(`${colors.dim}${rl || askFn ? "cancelled" : "pick one with /model <id>"}${colors.reset}
`);
      return;
    }
    const idx = Number(answer) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= ordered.length) {
      output.write(`${colors.red}invalid selection${colors.reset}
`);
      return;
    }
    commitModel(output, colors, session, ordered[idx].id);
  }
  function commitModel(output, colors, session, id) {
    commitPickerModel(session, { mode: "pinned", modelId: id }, { cwd, hostId, layers: session.layers });
    output.write(`${colors.green}model set:${colors.reset} ${id} ${colors.dim}(pinned, saved)${colors.reset}
`);
  }
  function applySetting(output, colors, session, layers, parts) {
    if (parts.length < 2) {
      output.write(`${colors.dim}usage: /set <key> <value>  (keys: ${[...LAYER_KEYS, "thinking", "permission", "sandbox", "model", "ascii", "inspector"].join(", ")})${colors.reset}
`);
      output.write(`${colors.dim}or run /set alone in the Ink UI for a searchable picker${colors.reset}
`);
      return;
    }
    const [key, ...valueParts] = parts;
    const value = valueParts.join(" ");
    if (key === "host") {
      output.write(`${colors.dim}host can only be changed by relaunching: construct chat --host ${value}${colors.reset}
`);
      return;
    }
    const result = applySessionSetting(session, layers, key, value, { cwd, hostId });
    if (!result.ok) {
      output.write(`${colors.red}${result.error}${colors.reset}
`);
      return;
    }
    output.write(`${colors.green}set:${colors.reset} ${result.key} = ${result.value} ${colors.dim}(saved)${colors.reset}
`);
  }
  function showSettings(output, colors, session, layers) {
    output.write(`${colors.bold}settings${colors.reset}
`);
    output.write(`  ${colors.cyan}host${colors.reset}        ${host}
`);
    output.write(`  ${colors.cyan}model${colors.reset}       ${session.model || "(host default)"} ${colors.dim}(${session.modelMode || "pinned"})${colors.reset}
`);
    output.write(`  ${colors.cyan}thinking${colors.reset}    ${layers.thinking ? "on" : "off"}
`);
    output.write(`  ${colors.cyan}layers${colors.reset}      ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? "on" : "off"}`).join("  ")}
`);
    const perm = session.permissionMode || "allow_once";
    output.write(`  ${colors.cyan}permission${colors.reset}  ${perm} ${colors.dim}(${PERMISSION_MODES.join("/")})${colors.reset}
`);
    output.write(`  ${colors.cyan}ascii${colors.reset}       ${session.ui?.ascii ? "on" : "off"} ${colors.dim}(glyph fallback for limited terminals)${colors.reset}
`);
    output.write(`  ${colors.cyan}inspector${colors.reset}   ${session.ui?.inspector || "auto"} ${colors.dim}(off/auto/on \u2014 per-turn detail panel)${colors.reset}
`);
    output.write(`  ${colors.cyan}sandbox${colors.reset}     ${session.sandbox || "(host default)"} ${colors.dim}(${SANDBOX_LEVELS.join("/")})${colors.reset}
`);
    output.write(`  ${colors.dim}chat sandbox gates tools in this session; isolated project copies use \`construct sandbox create\`${colors.reset}
`);
  }
  function persist(session, layers = session.layers) {
    try {
      saveChatConfig({
        host: hostId,
        model: session.modelMode === "pinned" ? session.model : null,
        modelMode: session.modelMode || "pinned",
        layers,
        thinking: layers?.thinking,
        permissionMode: session.permissionMode,
        sandbox: session.sandbox,
        ui: session.ui
      }, { cwd });
    } catch {
    }
  }
  return { handle };
}
function createCollectWriter() {
  const parts = [];
  return {
    stream: { write(chunk) {
      parts.push(String(chunk));
    } },
    text() {
      return parts.join("");
    }
  };
}
var PLAIN_COLORS = Object.freeze({ bold: "", dim: "", reset: "", cyan: "", green: "", red: "", yellow: "" });

// lib/term-format.mjs
var CODES = { bold: "1", dim: "2", reset: "0", red: "31", green: "32", yellow: "33", cyan: "36" };
var PALETTE_KEYS = Object.keys(CODES);
var EMPTY_PALETTE = Object.freeze(Object.fromEntries(PALETTE_KEYS.map((k) => [k, ""])));
function stripAnsi(text) {
  return String(text).replace(/\[[0-9;]*m/g, "");
}

// lib/chat/permission-prompt.mjs
function parsePermissionKey(char) {
  if (!char) return null;
  const c = char.toLowerCase();
  if (c === "a") return "allow_always";
  if (c === "n" || c === "r") return "reject";
  if (c === "y") return "allow";
  return null;
}

// lib/chat/tui/turn-block.mjs
function createTurnBlock(userText) {
  return {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userText: String(userText),
    overlay: null,
    thinking: "",
    tools: [],
    assistant: "",
    usage: null,
    sources: [],
    notices: [],
    closed: false
  };
}
function overlayToContext(overlay) {
  if (!overlay) return null;
  return {
    intent: overlay.intent || null,
    workCategory: overlay.workCategory || null,
    specialists: Array.isArray(overlay.specialists) ? [...overlay.specialists] : [],
    externalResearch: overlay.externalResearch || null,
    riskFlags: overlay.riskFlags || [],
    track: overlay.track || null
  };
}
function applyOverlayToTurn(turn, overlay) {
  if (!turn || !overlay) return turn;
  turn.overlay = overlayToContext(overlay);
  return turn;
}
function recordSource(turn, { tool, ref }) {
  if (!turn || !tool || !ref) return;
  const key = `${tool}:${ref}`;
  if (turn.sources.some((s) => `${s.tool}:${s.ref}` === key)) return;
  turn.sources.push({ tool, ref, ts: Date.now() });
}
function sourceFromToolEvent(event) {
  if (!event) return null;
  const title = event.title || event.kind || "";
  if (title === "read" || title === "grep" || title === "glob") {
    const path9 = event.input?.path || event.input?.pattern || event.input?.glob;
    if (path9) return { tool: title, ref: String(path9) };
  }
  if (title === "construct_tool") {
    const name = event.input?.name;
    if (name) return { tool: "construct_tool", ref: String(name) };
  }
  return null;
}
function turnBlocksFromTranscript(entries = []) {
  const blocks = [];
  let current = null;
  for (const entry of entries) {
    if (entry.kind && entry.block) {
      blocks.push(entry.block);
      if (entry.kind === "turn") current = entry.block;
      continue;
    }
    if (entry.role === "you" || entry.role === "user") {
      current = createTurnBlock(entry.text);
      blocks.push({ kind: "turn", block: current });
      continue;
    }
    if (!current) {
      if (entry.role === "construct") blocks.push({ kind: "legacy", role: "assistant", text: entry.text });
      continue;
    }
    if (entry.role === "thinking") current.thinking = entry.text;
    else if (entry.role === "construct") current.assistant = entry.text;
  }
  return blocks;
}
function applyEventToTurn(turn, event, state = null) {
  if (!turn || !event) return turn;
  switch (event.type) {
    case "thinking":
      turn.thinking = state?.thinking ?? `${turn.thinking || ""}${event.text || ""}`;
      break;
    case "text":
      turn.assistant = state?.assistant ?? `${turn.assistant || ""}${event.text || ""}`;
      break;
    case "tool_call": {
      const src = sourceFromToolEvent(event);
      if (src) recordSource(turn, src);
      const existing = turn.tools.find((t) => t.id === event.id);
      if (existing) {
        existing.input = event.input ?? existing.input;
      } else {
        turn.tools.push({
          id: event.id,
          title: event.title || event.kind || "tool",
          status: "pending",
          input: event.input ?? null
        });
      }
      break;
    }
    case "tool_update": {
      const t = turn.tools.find((x) => x.id === event.id);
      if (t) t.status = event.status || t.status;
      else turn.tools.push({ id: event.id, title: event.id, status: event.status || "pending" });
      break;
    }
    case "usage":
      turn.usage = event;
      break;
    default:
      break;
  }
  return turn;
}
function formatTurnUsageLine(usage, colors = {}) {
  return formatUsageFooter(usage, colors).replace(/^\[usage\] /, "");
}
function finalizeTurn(turn) {
  if (!turn) return turn;
  turn.closed = true;
  if (turn.overlay?.externalResearch?.required && !turn.sources?.length) {
    const msg = "Answer produced without recorded sources \u2014 treat as unverified";
    if (!turn.notices.includes(msg)) turn.notices.push(msg);
  }
  return turn;
}
function shouldShowInspector({ uiInspector = "auto", turn = null, forced = null } = {}) {
  if (forced != null) return forced;
  const mode = uiInspector || "auto";
  if (mode === "on") return true;
  if (mode === "off") return false;
  if (!turn) return false;
  return Boolean(turn.overlay?.specialists?.length || turn.tools?.length || turn.thinking);
}

// lib/chat/tui/color-scheme.mjs
function schemeFromColorFgBg(value) {
  const parts = String(value).split(";").map((p) => parseInt(p, 10)).filter((n) => !Number.isNaN(n));
  if (!parts.length) return null;
  const bg = parts.length >= 2 ? parts[1] : parts[parts.length - 1];
  if (bg === 7 || bg === 15) return "light";
  if (bg >= 0 && bg <= 6) return "dark";
  if (bg === 8) return "dark";
  if (bg >= 9 && bg <= 14) return "light";
  return null;
}
function detectTerminalColorScheme(env = process.env) {
  const fromFgBg = env.COLORFGBG ? schemeFromColorFgBg(env.COLORFGBG) : null;
  if (fromFgBg) return fromFgBg;
  return "dark";
}
function resolveTerminalColorScheme(env = process.env, configTheme = null) {
  const envTheme = String(env.CX_CHAT_THEME || env.CONSTRUCT_CHAT_THEME || "").trim().toLowerCase();
  if (envTheme === "light" || envTheme === "dark") return envTheme;
  const saved = String(configTheme || "").trim().toLowerCase();
  if (saved === "light" || saved === "dark") return saved;
  return detectTerminalColorScheme(env);
}

// lib/chat/tui/presentation.mjs
var DARK_SEMANTIC = Object.freeze({
  text: { ink: "white", code: "37" },
  muted: { ink: "gray", code: "90" },
  accent: { ink: "cyan", code: "36" },
  accentAlt: { ink: "magenta", code: "35" },
  ok: { ink: "green", code: "32" },
  warn: { ink: "yellow", code: "33" },
  danger: { ink: "red", code: "31" },
  badgeFg: { ink: "black", code: "30" }
});
var LIGHT_SEMANTIC = Object.freeze({
  text: { ink: "black", code: "30" },
  muted: { ink: "gray", code: "90" },
  accent: { ink: "blue", code: "34" },
  accentAlt: { ink: "magenta", code: "35" },
  ok: { ink: "green", code: "32" },
  warn: { ink: "rgb(161,98,7)", code: "33" },
  danger: { ink: "red", code: "31" },
  badgeFg: { ink: "white", code: "97" }
});
function semanticForScheme(scheme = "dark") {
  return scheme === "light" ? LIGHT_SEMANTIC : DARK_SEMANTIC;
}
function inkPalette({ scheme = "dark" } = {}) {
  const semantic = semanticForScheme(scheme);
  return Object.fromEntries(Object.entries(semantic).map(([k, v]) => [k, v.ink]));
}

// apps/chat/tui/theme.mjs
var UNICODE_GLYPHS = {
  brand: "\u25C6",
  dot: "\u25CF",
  arrow: "\u2192",
  caret: "\u25B8",
  gutter: "\u2502",
  block: "\u2588",
  track: "\u2591",
  toolDone: "\u2713",
  toolFail: "\u2717",
  toolBusy: "\u25B8",
  toolPending: "\xB7"
};
var ASCII_GLYPHS = {
  brand: "*",
  dot: "o",
  arrow: "->",
  caret: ">",
  gutter: "|",
  block: "#",
  track: "-",
  toolDone: "+",
  toolFail: "x",
  toolBusy: ">",
  toolPending: "."
};
var BRAILLE_SPINNER = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var ASCII_SPINNER = ["|", "/", "-", "\\"];
var DEFAULT_THEME = createTheme({ ascii: false });
var palette = DEFAULT_THEME.palette;
var glyphs = DEFAULT_THEME.glyphs;
var spinnerFrames = DEFAULT_THEME.spinnerFrames;
function createTheme({ ascii = false, scheme = "dark" } = {}) {
  return {
    scheme,
    palette: inkPalette({ scheme }),
    glyphs: ascii ? { ...ASCII_GLYPHS } : { ...UNICODE_GLYPHS },
    spinnerFrames: ascii ? [...ASCII_SPINNER] : [...BRAILLE_SPINNER]
  };
}
function toolGlyph(status, theme = DEFAULT_THEME) {
  const g = theme.glyphs;
  if (status === "completed") return g.toolDone;
  if (status === "failed") return g.toolFail;
  if (status === "in_progress") return g.toolBusy;
  return g.toolPending;
}
function toolColor(status, theme = DEFAULT_THEME) {
  const p = theme.palette;
  if (status === "completed") return p.ok;
  if (status === "failed") return p.danger;
  if (status === "in_progress") return p.warn;
  return p.muted;
}
function splitModel(id) {
  if (!id) return { provider: "", name: "(no model)" };
  const idx = id.indexOf("/");
  if (idx === -1) return { provider: "", name: id };
  return { provider: id.slice(0, idx), name: id.slice(idx + 1) };
}
function meter(used, size, width = 18, theme = DEFAULT_THEME) {
  const g = theme.glyphs;
  const ratio = size > 0 ? Math.max(0, Math.min(1, used / size)) : 0;
  const filled = Math.round(ratio * width);
  return { bar: g.block.repeat(filled) + g.track.repeat(Math.max(0, width - filled)), ratio };
}
function ratioColor(ratio, theme = DEFAULT_THEME) {
  const p = theme.palette;
  if (ratio >= 0.85) return p.danger;
  if (ratio >= 0.6) return p.warn;
  return p.ok;
}
function percent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

// apps/chat/tui/turn-ui.jsx
import React from "react";
import { Box, Text } from "ink";

// lib/chat/tui/markdown.mjs
function parseMarkdownLines(text, { width = 80 } = {}) {
  if (!text) return [];
  const lines = String(text).split("\n");
  const out = [];
  let inFence = false;
  let fenceBuf = [];
  let tableBuf = [];
  const flushTable = () => {
    if (!tableBuf.length) return;
    out.push(...renderTable(tableBuf, width));
    tableBuf = [];
  };
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      flushTable();
      if (inFence) {
        out.push(...fenceBuf.map((l) => ({ type: "code", text: l })));
        fenceBuf = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }
    if (isTableRow(line)) {
      tableBuf.push(line);
      continue;
    }
    flushTable();
    if (/^---+\s*$/.test(line.trim())) {
      out.push({ type: "rule" });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      out.push({ type: "heading", level: heading[1].length, text: stripInline(heading[2]) });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      const indent = Math.floor(bullet[1].length / 2);
      out.push({ type: "bullet", indent, text: stripInline(bullet[2]) });
      continue;
    }
    if (line.trim() === "") {
      out.push({ type: "blank" });
      continue;
    }
    out.push({ type: "paragraph", text: stripInline(line) });
  }
  flushTable();
  if (inFence && fenceBuf.length) out.push(...fenceBuf.map((l) => ({ type: "code", text: l })));
  return out;
}
function isTableRow(line) {
  const t = line.trim();
  return t.includes("|") && !/^[\s|:-]+$/.test(t.replace(/\|/g, ""));
}
function renderTable(rows, width) {
  const parsed = rows.filter((r) => !/^\s*\|?[\s:-]+\|/.test(r)).map((r) => r.split("|").map((c) => stripInline(c.trim())).filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === "")));
  if (!parsed.length) return rows.map((r) => ({ type: "paragraph", text: r }));
  const cols = Math.max(...parsed.map((r) => r.length));
  const colWidth = Math.max(8, Math.floor((width - cols - 1) / cols));
  const out = [{ type: "paragraph", text: "" }];
  for (const row of parsed) {
    const cells = row.map((c) => truncate(c, colWidth));
    while (cells.length < cols) cells.push("");
    out.push({ type: "paragraph", text: cells.join(" | ") });
  }
  return out;
}
function truncate(s, max) {
  if (s.length <= max) return s.padEnd(max);
  return `${s.slice(0, max - 1)}\u2026`;
}
function stripInline(s) {
  return String(s).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[(.+?)\]\([^)]+\)/g, "$1");
}

// apps/chat/tui/turn-ui.jsx
import { jsx, jsxs } from "react/jsx-runtime";
var LABEL_WIDTH = 10;
function Rule({ width, color, palette: palette2 }) {
  const muted = color || palette2?.muted || "gray";
  return /* @__PURE__ */ jsx(Text, { color: muted, children: "\u2500".repeat(Math.max(1, width)) });
}
function TurnSection({ title, width, palette: palette2, glyphs: glyphs2, children, marginTop = 1, marginBottom = 1 }) {
  if (!children) return null;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop, marginBottom, width, children: [
    /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: `${glyphs2.gutter} ${title}` }),
    /* @__PURE__ */ jsx(Box, { flexDirection: "column", paddingLeft: 2, marginTop: 0, children })
  ] });
}
function ContextRow({ label, value, palette: palette2, valueColor }) {
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "row", marginBottom: 0, children: [
    /* @__PURE__ */ jsx(Box, { width: LABEL_WIDTH, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: label }) }),
    /* @__PURE__ */ jsx(Text, { color: valueColor || void 0, wrap: "wrap", children: value })
  ] });
}
function TurnContextBar({ turn, width, layers, palette: palette2, glyphs: glyphs2, variant = "compact" }) {
  const o = turn?.overlay;
  const src = summarizeSources(turn?.sources || []);
  const rows = contextRows(o, { layers });
  if (!rows.length && !src.total && !o) return null;
  const sourceSplit = splitSourceLines(src.refs, { limit: variant === "compact" ? 4 : 12 });
  const toolCounts = formatSourceToolCounts(src.byTool);
  return /* @__PURE__ */ jsxs(TurnSection, { title: "turn context", width, palette: palette2, glyphs: glyphs2, marginTop: 0, marginBottom: 0, children: [
    rows.map((row) => /* @__PURE__ */ jsx(
      ContextRow,
      {
        label: row.label,
        value: row.value,
        palette: palette2,
        valueColor: row.label === "research" ? palette2.warn : row.label === "route" ? palette2.accentAlt : void 0
      },
      row.label
    )),
    /* @__PURE__ */ jsx(
      ContextRow,
      {
        label: "sources",
        value: src.total ? `${src.total} consulted${toolCounts ? ` (${toolCounts})` : ""}` : "none yet",
        palette: palette2
      }
    ),
    sourceSplit.lines.map((line) => /* @__PURE__ */ jsx(Box, { paddingLeft: LABEL_WIDTH, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: line }) }, line)),
    sourceSplit.hidden > 0 ? /* @__PURE__ */ jsx(Box, { paddingLeft: LABEL_WIDTH, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: `+${sourceSplit.hidden} more` }) }) : null
  ] });
}
function ToolTimeline({ tools, width, layers, palette: palette2, theme, variant = "compact" }) {
  if (!tools?.length || layers?.tools === false) return null;
  const groups = summarizeToolCalls(tools);
  const totalCalls = tools.length;
  return /* @__PURE__ */ jsx(
    TurnSection,
    {
      title: variant === "compact" ? `tools (${totalCalls} call${totalCalls === 1 ? "" : "s"}, ${groups.length} kind${groups.length === 1 ? "" : "s"})` : `tools (${totalCalls})`,
      width,
      palette: palette2,
      glyphs: theme.glyphs,
      marginTop: 1,
      marginBottom: 1,
      children: groups.map((group) => /* @__PURE__ */ jsx(Text, { color: toolColor(group.status, theme), wrap: "wrap", children: `${toolGlyph(group.status, theme)} ${toolGroupLabel(group)}` }, group.title))
    }
  );
}
function ToolDetailList({ tools, width, theme }) {
  if (!tools?.length) return null;
  const { palette: palette2 } = theme;
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", paddingLeft: 2, children: tools.map((tool) => {
    const ref = tool.input?.path || tool.input?.pattern || tool.input?.glob || tool.input?.name;
    const detail = ref ? `  ${ref}` : "";
    return /* @__PURE__ */ jsx(Text, { color: toolColor(tool.status, theme), wrap: "wrap", children: `${toolGlyph(tool.status, theme)} ${tool.title || "tool"}${detail}` }, tool.id);
  }) });
}
function MarkdownMessage({ text, width, palette: palette2, isError = false }) {
  if (!text) return null;
  const parts = parseMarkdownLines(text, { width: Math.max(20, width - 2) });
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", paddingLeft: 1, marginTop: 0, width, children: parts.map((part, i) => {
    if (part.type === "heading") {
      return /* @__PURE__ */ jsx(Box, { marginTop: i > 0 ? 1 : 0, children: /* @__PURE__ */ jsx(Text, { bold: true, color: isError ? palette2.danger : palette2.text, wrap: "wrap", children: part.text }) }, i);
    }
    if (part.type === "bullet") {
      const pad = "  ".repeat(part.indent || 0);
      return /* @__PURE__ */ jsx(Text, { wrap: "wrap", children: `${pad}${"\u2022"} ${part.text}` }, i);
    }
    if (part.type === "code") {
      return /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: `  ${part.text}` }, i);
    }
    if (part.type === "rule") {
      return /* @__PURE__ */ jsx(Rule, { width: Math.min(width, 40), palette: palette2 }, i);
    }
    if (part.type === "blank") return /* @__PURE__ */ jsx(Box, { height: 1 }, i);
    return /* @__PURE__ */ jsx(Text, { color: isError ? palette2.danger : void 0, wrap: "wrap", children: part.text || "" }, i);
  }) });
}
function TurnThinking({ text, width, layers, palette: palette2, glyphs: glyphs2 }) {
  if (!text || layers?.thinking === false) return null;
  return /* @__PURE__ */ jsx(TurnSection, { title: "thinking", width, palette: palette2, glyphs: glyphs2, marginTop: 1, marginBottom: 1, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: text }) });
}
function TurnUsageFooter({ usage, width, layers, palette: palette2, glyphs: glyphs2 }) {
  if (!usage || layers?.observability === false) return null;
  const line = stripAnsi(formatTurnUsageLine(usage, {}));
  return /* @__PURE__ */ jsx(TurnSection, { title: "turn usage", width, palette: palette2, glyphs: glyphs2, marginTop: 1, marginBottom: 0, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: line }) });
}
function SystemNotice({ text, palette: palette2 }) {
  if (!text) return null;
  return /* @__PURE__ */ jsx(Box, { marginTop: 1, marginBottom: 1, children: /* @__PURE__ */ jsx(Text, { color: palette2.warn, wrap: "wrap", children: text }) });
}
function TurnView({
  turn,
  width,
  layers,
  liveAssistant = "",
  liveThinking = "",
  working = false,
  theme
}) {
  const { palette: palette2, glyphs: glyphs2 } = theme;
  const assistant = liveAssistant || turn.assistant || "";
  const thinking = liveThinking || turn.thinking || "";
  const isError = typeof assistant === "string" && assistant.startsWith("[error]");
  const hasPreflight = turn.overlay || turn.sources?.length || turn.tools?.length || thinking;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 2, width, children: [
    /* @__PURE__ */ jsx(Box, { marginBottom: 1, children: /* @__PURE__ */ jsx(Text, { backgroundColor: palette2.ok, color: palette2.badgeFg, bold: true, children: " you " }) }),
    /* @__PURE__ */ jsx(Box, { paddingLeft: 1, marginBottom: hasPreflight ? 1 : 0, children: /* @__PURE__ */ jsx(Text, { wrap: "wrap", children: turn.userText }) }),
    hasPreflight ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, paddingX: 1, children: [
      /* @__PURE__ */ jsx(Rule, { width: Math.min(width - 4, 52), palette: palette2 }),
      /* @__PURE__ */ jsxs(Box, { marginY: 1, children: [
        /* @__PURE__ */ jsx(TurnContextBar, { turn, width: width - 2, layers, palette: palette2, glyphs: glyphs2, variant: "compact" }),
        /* @__PURE__ */ jsx(TurnThinking, { text: thinking, width: width - 2, layers, palette: palette2, glyphs: glyphs2 }),
        /* @__PURE__ */ jsx(ToolTimeline, { tools: turn.tools, width: width - 2, layers, palette: palette2, theme, variant: "compact" })
      ] }),
      /* @__PURE__ */ jsx(Rule, { width: Math.min(width - 4, 52), palette: palette2 })
    ] }) : null,
    assistant || working ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop: 1, marginBottom: 1, children: [
      /* @__PURE__ */ jsx(Box, { marginBottom: 1, children: /* @__PURE__ */ jsx(Text, { backgroundColor: palette2.accent, color: palette2.badgeFg, bold: true, children: " construct " }) }),
      assistant ? /* @__PURE__ */ jsx(MarkdownMessage, { text: assistant, width, palette: palette2, isError }) : null,
      working && !assistant ? /* @__PURE__ */ jsx(Text, { color: palette2.warn, children: `${glyphs2.block} working\u2026` }) : null,
      working && assistant ? /* @__PURE__ */ jsx(Text, { color: palette2.warn, children: glyphs2.block }) : null
    ] }) : null,
    /* @__PURE__ */ jsx(TurnUsageFooter, { usage: turn.usage, width, layers, palette: palette2, glyphs: glyphs2 }),
    (turn.notices || []).map((n, i) => /* @__PURE__ */ jsx(SystemNotice, { text: n, palette: palette2 }, i))
  ] });
}
function PanelSection({ title, children, marginTop = 1, palette: palette2 }) {
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop, children: [
    /* @__PURE__ */ jsx(Text, { color: palette2.accent, children: title }),
    children
  ] });
}
function SessionDock({
  width,
  session,
  layers,
  working,
  model,
  modelMode,
  savedModel,
  sandbox,
  permissionMode,
  ctx,
  spin,
  theme
}) {
  const { palette: palette2, glyphs: glyphs2 } = theme;
  const u = session.usage;
  const t = u.tokens || {};
  const ledger = [];
  if (t.input) ledger.push(["prompt", formatTokens(t.input)]);
  if (t.output) ledger.push(["output", formatTokens(t.output)]);
  if (t.reasoning) ledger.push(["reasoning", formatTokens(t.reasoning)]);
  if (t.total) ledger.push(["total", formatTokens(t.total)]);
  if (u.cost?.amount > 0) ledger.push(["cost", `~$${u.cost.amount.toFixed(u.cost.amount < 1 ? 3 : 2)}`]);
  const ctxMeter = ctx?.size ? meter(ctx.used, ctx.size, Math.max(10, width - 8), theme) : null;
  const { label } = formatModelHeader({ model, modelMode, savedModel });
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width, borderStyle: "round", borderColor: palette2.accent, paddingX: 1, children: [
    /* @__PURE__ */ jsx(Text, { color: palette2.accent, bold: true, children: `${glyphs2.brand} session` }),
    /* @__PURE__ */ jsxs(PanelSection, { title: "model", marginTop: 1, palette: palette2, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: palette2.text, wrap: "wrap", children: label || "(none)" }),
      sandbox || permissionMode ? /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: [sandbox, permissionMode].filter(Boolean).join(` ${glyphs2.gutter} `) }) : null
    ] }),
    /* @__PURE__ */ jsx(PanelSection, { title: "layers", palette: palette2, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: LAYER_KEYS.map((k) => `${k}=${layers?.[k] ? "on" : "off"}`).join(`  ${glyphs2.gutter}  `) }) }),
    /* @__PURE__ */ jsx(PanelSection, { title: "context", palette: palette2, children: ctxMeter ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx(Text, { color: ratioColor(ctxMeter.ratio, theme), children: ctxMeter.bar }),
      /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: `${formatTokens(ctx.used)}/${formatTokens(ctx.size)}  ${percent(ctxMeter.ratio)}` })
    ] }) : /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: "not reported yet" }) }),
    /* @__PURE__ */ jsx(PanelSection, { title: `usage ${glyphs2.gutter} ${u.turns} turn${u.turns === 1 ? "" : "s"}`, palette: palette2, children: ledger.length ? ledger.map(([k, v]) => /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: k }),
      /* @__PURE__ */ jsx(Text, { children: v })
    ] }, k)) : /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: "no tokens yet" }) }),
    /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsx(Text, { color: working ? palette2.warn : palette2.ok, children: working ? `${spin} working\u2026` : `${glyphs2.dot} idle` }) })
  ] });
}
function TurnInspector({
  width,
  turn,
  layers,
  permissions,
  plan,
  lastTurnUsage,
  theme
}) {
  const { palette: palette2, glyphs: glyphs2 } = theme;
  if (!turn) {
    return /* @__PURE__ */ jsx(Box, { flexDirection: "column", width, borderStyle: "round", borderColor: palette2.muted, paddingX: 1, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: "no active turn \u2014 submit a prompt or toggle /inspect" }) });
  }
  const turnUsage = lastTurnUsage && layers?.observability ? stripAnsi(formatUsageFooter(lastTurnUsage, {})).replace(/^\[usage\] /, "") : null;
  const src = summarizeSources(turn.sources || []);
  const groups = summarizeToolCalls(turn.tools || []);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width, borderStyle: "round", borderColor: palette2.accentAlt, paddingX: 1, children: [
    /* @__PURE__ */ jsx(Text, { color: palette2.accentAlt, bold: true, children: `${glyphs2.brand} inspector` }),
    contextRows(turn.overlay, { layers }).length > 0 ? /* @__PURE__ */ jsx(PanelSection, { title: "policy", marginTop: 1, palette: palette2, children: contextRows(turn.overlay, { layers }).map((row) => /* @__PURE__ */ jsx(ContextRow, { label: row.label, value: row.value, palette: palette2 }, row.label)) }) : null,
    src.total > 0 ? /* @__PURE__ */ jsx(PanelSection, { title: `sources (${src.total})`, palette: palette2, children: src.refs.map((ref) => /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: ref }, ref)) }) : null,
    turn.thinking && layers?.thinking !== false ? /* @__PURE__ */ jsx(PanelSection, { title: "thinking", palette: palette2, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: turn.thinking }) }) : null,
    groups.length > 0 && layers?.tools !== false ? /* @__PURE__ */ jsxs(PanelSection, { title: `tools (${turn.tools.length} calls)`, palette: palette2, children: [
      groups.map((g) => /* @__PURE__ */ jsx(Text, { color: toolColor(g.status, theme), wrap: "wrap", children: `${toolGlyph(g.status, theme)} ${toolGroupLabel(g)}` }, g.title)),
      /* @__PURE__ */ jsx(ToolDetailList, { tools: turn.tools, width: width - 2, theme })
    ] }) : null,
    layers?.path && plan?.length > 0 ? /* @__PURE__ */ jsx(PanelSection, { title: "plan", palette: palette2, children: plan.map((entry, i) => /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: `${entry.status === "completed" ? glyphs2.toolDone : glyphs2.toolPending} ${entry.content}` }, `${entry.content}-${i}`)) }) : null,
    permissions?.length > 0 ? /* @__PURE__ */ jsx(PanelSection, { title: "permissions", palette: palette2, children: permissions.slice(-5).map((entry, i) => /* @__PURE__ */ jsx(Text, { color: palette2.warn, wrap: "wrap", children: `${glyphs2.gutter} ${entry.title}` }, `${entry.title}-${i}`)) }) : null,
    turnUsage ? /* @__PURE__ */ jsx(PanelSection, { title: "this turn", palette: palette2, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: turnUsage }) }) : null,
    turn.assistant ? /* @__PURE__ */ jsx(PanelSection, { title: "answer (raw)", palette: palette2, children: /* @__PURE__ */ jsxs(Text, { wrap: "wrap", children: [
      turn.assistant.slice(0, 800),
      turn.assistant.length > 800 ? "\u2026" : ""
    ] }) }) : null
  ] });
}
var TransparencyPanel = SessionDock;

// apps/chat/tui/picker-ui.jsx
import React2 from "react";
import { Box as Box2, Text as Text2 } from "ink";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function ListPickerOverlay({ picker, width, theme, currentId = null, markerId = null }) {
  const { palette: palette2, glyphs: glyphs2 } = theme;
  if (!picker?.items?.length) return null;
  const visible = getPickerVisibleItems(picker);
  const { items, offset } = pickerViewport(picker, 14);
  const queryLine = picker.query ? `filter: ${picker.query}` : "type to search";
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginY: 1, borderStyle: "round", borderColor: palette2.accent, paddingX: 1, width: Math.min(width, 80), children: [
    /* @__PURE__ */ jsx2(Text2, { color: palette2.accent, bold: true, children: picker.title || "select" }),
    /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: `${queryLine}   ${glyphs2.gutter}   \u2191/\u2193 move   enter select   esc cancel` }),
    !visible.length ? /* @__PURE__ */ jsx2(Text2, { color: palette2.warn, children: "no matches \u2014 backspace to edit filter" }) : items.map((item, i) => {
      const absolute = offset + i;
      const selected = absolute === picker.index;
      const marked = markerId && item.id === markerId || currentId && item.id === currentId;
      const muted = item.disabled && !selected;
      return /* @__PURE__ */ jsxs2(Text2, { color: selected ? palette2.accent : muted ? palette2.muted : void 0, bold: selected, wrap: "wrap", children: [
        `${selected ? glyphs2.caret : " "} ${String(absolute + 1).padStart(2)}. ${marked ? `${glyphs2.dot} ` : "  "}${item.label || item.id}`,
        item.tag ? /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: ` [${item.tag}]` }) : null,
        item.detail ? /* @__PURE__ */ jsx2(Text2, { color: item.disabled ? palette2.warn : palette2.muted, children: ` \u2014 ${item.detail}` }) : null
      ] }, `${item.id}-${absolute}`);
    }),
    visible.length > items.length ? /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: `${offset + 1}-${offset + items.length} of ${visible.length} shown (${picker.items.length} total)` }) : visible.length ? /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: `${visible.length} item${visible.length === 1 ? "" : "s"}` }) : null
  ] });
}

// lib/chat/command-suggest.mjs
var SLASH_COMMANDS = Object.freeze([
  "/help",
  "/model",
  "/models",
  "/free",
  "/set",
  "/settings",
  "/layers",
  "/usage",
  "/host",
  "/clear",
  "/inspect",
  "/export",
  "/exit"
]);
var SETTING_KEYS = Object.freeze([
  "thinking",
  "path",
  "specialists",
  "tools",
  "observability",
  "permission",
  "sandbox",
  "model",
  "ascii",
  "inspector"
]);
function slashCommandMatches(input) {
  const trimmed = String(input || "").trimStart();
  if (!trimmed.startsWith("/")) return [];
  const token = trimmed.split(/\s+/)[0].toLowerCase();
  if (!token || token === "/") return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((cmd) => cmd.startsWith(token));
}
function slashCommandGhost(input) {
  const matches = slashCommandMatches(input);
  if (!matches.length) return "";
  const trimmed = String(input || "").trimStart();
  const token = trimmed.split(/\s+/)[0];
  const best = matches.find((cmd) => cmd.startsWith(token.toLowerCase())) || matches[0];
  if (best.length <= token.length) return "";
  return best.slice(token.length);
}
function completeSlashCommand(input) {
  const trimmed = String(input || "").trimStart();
  if (!trimmed.startsWith("/")) return input;
  const parts = trimmed.split(/\s+/);
  const token = parts[0];
  const matches = slashCommandMatches(token);
  if (!matches.length) return input;
  const lower = token.toLowerCase();
  const exact = matches.find((cmd) => cmd === lower);
  const best = exact || matches.find((cmd) => cmd.startsWith(lower)) || matches[0];
  const rest = parts.slice(1).join(" ");
  const completed = rest ? `${best} ${rest}` : `${best} `;
  const prefix = input.startsWith(" ") ? input.slice(0, input.indexOf("/")) : "";
  return `${prefix}${completed}`;
}
function cycleSlashCommand(input, direction = 1) {
  const matches = slashCommandMatches(input);
  if (!matches.length) return input;
  const trimmed = String(input || "").trimStart();
  const token = trimmed.split(/\s+/)[0].toLowerCase();
  const idx = Math.max(0, matches.findIndex((cmd) => cmd.startsWith(token)));
  const next = matches[(idx + direction + matches.length) % matches.length];
  const prefix = input.startsWith(" ") ? input.slice(0, input.indexOf("/")) : "";
  return `${prefix}${next} `;
}
function setKeyMatches(input) {
  const trimmed = String(input || "").trimStart();
  const m = trimmed.match(/^\/set\s+(\S*)$/i);
  if (!m) return [];
  const partial = (m[1] || "").toLowerCase();
  if (!partial) return [...SETTING_KEYS];
  return SETTING_KEYS.filter((k) => k.startsWith(partial));
}
function completeSetKey(input) {
  const trimmed = String(input || "").trimStart();
  const m = trimmed.match(/^\/set\s+(\S*)$/i);
  if (!m) return input;
  const partial = m[1] || "";
  const matches = setKeyMatches(input);
  if (!matches.length) return input;
  const best = matches.find((k) => k.startsWith(partial.toLowerCase())) || matches[0];
  return `/set ${best} `;
}
function commandSuggestHint(input) {
  if (!String(input || "").trimStart().startsWith("/")) return "";
  const cmdMatches = slashCommandMatches(input);
  if (cmdMatches.length && !input.trim().includes(" ")) {
    return cmdMatches.slice(0, 6).join("  ");
  }
  const setMatches = setKeyMatches(input);
  if (setMatches.length) return setMatches.slice(0, 8).join("  ");
  return "";
}
function applyTabCompletion(input) {
  const setDone = completeSetKey(input);
  if (setDone !== input) return setDone;
  return completeSlashCommand(input);
}

// apps/chat/tui/index.jsx
init_models();

// lib/chat/picker-catalog.mjs
var PERMISSION_PICKER_ITEMS = Object.freeze([
  { id: "allow", label: "Allow once", detail: "y" },
  { id: "allow_always", label: "Allow always", detail: "a" },
  { id: "reject", label: "Reject", detail: "n" }
]);
var BOOL_PICKER_ITEMS = Object.freeze([
  { id: "on", label: "on", detail: "true" },
  { id: "off", label: "off", detail: "false" }
]);
function settingKeyPickerItems() {
  return [
    { id: "thinking", label: "thinking", tag: "bool" },
    ...LAYER_KEYS.map((k) => ({ id: k, label: k, tag: "layer" })),
    { id: "permission", label: "permission mode", tag: "enum" },
    { id: "sandbox", label: "sandbox", tag: "enum" },
    { id: "inspector", label: "inspector panel", tag: "enum" },
    { id: "ascii", label: "ascii glyphs", tag: "bool" },
    { id: "theme", label: "color theme", tag: "enum" },
    { id: "model", label: "model", tag: "model" }
  ];
}
function enumPickerItems(key) {
  if (key === "permission") return PERMISSION_MODES.map((v) => ({ id: v, label: v }));
  if (key === "sandbox") return SANDBOX_LEVELS.map((v) => ({ id: v, label: v }));
  if (key === "inspector") return INSPECTOR_MODES.map((v) => ({ id: v, label: v }));
  if (key === "theme") return ["auto", "light", "dark"].map((v) => ({ id: v, label: v }));
  return [];
}
function isBoolSetting(key) {
  return key === "thinking" || key === "ascii" || LAYER_KEYS.includes(key);
}
function isEnumSetting(key) {
  return key === "permission" || key === "sandbox" || key === "inspector" || key === "theme";
}

// apps/chat/tui/index.jsx
import { Fragment, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var ChatThemeContext = createContext(createTheme());
function useChatTheme() {
  return useContext(ChatThemeContext);
}
function HeaderBar({ cols, session, sandbox, permissionMode, working, spin }) {
  const { palette: palette2, glyphs: glyphs2 } = useChatTheme();
  const { label, isRouter } = formatModelHeader(session);
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
    /* @__PURE__ */ jsxs3(Box3, { width: cols, justifyContent: "space-between", children: [
      /* @__PURE__ */ jsxs3(Box3, { children: [
        /* @__PURE__ */ jsx3(Text3, { color: palette2.accent, bold: true, children: `${glyphs2.brand} construct` }),
        /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: `  ${glyphs2.gutter}  chat` })
      ] }),
      /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", alignItems: "flex-end", children: [
        /* @__PURE__ */ jsxs3(Box3, { children: [
          /* @__PURE__ */ jsx3(Text3, { bold: true, color: palette2.text, children: label || "(no model)" }),
          /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: `   ${sandbox}  ${glyphs2.gutter}  ${permissionMode}  ` }),
          /* @__PURE__ */ jsx3(Text3, { color: working ? palette2.warn : palette2.ok, children: working ? spin : glyphs2.dot })
        ] }),
        isRouter ? /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, wrap: "wrap", children: "free-router mode \u2014 re-picks on launch and on failure" }) : null,
        session.modelNotice ? /* @__PURE__ */ jsx3(Text3, { color: palette2.warn, wrap: "wrap", children: session.modelNotice }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsx3(Rule, { width: cols, palette: palette2 })
  ] });
}
function EmptyState({ model, savedModel }) {
  const { palette: palette2, glyphs: glyphs2 } = useChatTheme();
  const { provider, name } = splitModel(model);
  const saved = savedModel && savedModel !== model ? splitModel(savedModel) : null;
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", paddingY: 1, children: [
    /* @__PURE__ */ jsx3(Text3, { color: palette2.accent, bold: true, children: `${glyphs2.brand} welcome to construct chat` }),
    /* @__PURE__ */ jsx3(Box3, { marginTop: 1, children: /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, wrap: "wrap", children: "Each turn shows route, tools, and sources inline before the answer. Session metrics live in the dock on the right; /inspect opens per-turn detail." }) }),
    /* @__PURE__ */ jsxs3(Box3, { marginTop: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: "To get going" }),
      /* @__PURE__ */ jsx3(Text3, { color: palette2.text, children: `  ${glyphs2.caret} ask a question or describe the change you want` }),
      /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: `  ${glyphs2.caret} shift+enter newline   tab completes /commands   /model /set open searchable pickers` })
    ] }),
    name && name !== "(no model)" ? /* @__PURE__ */ jsxs3(Box3, { marginTop: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsxs3(Box3, { children: [
        /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: `active model ` }),
        /* @__PURE__ */ jsx3(Text3, { color: palette2.text, bold: true, children: provider ? `${provider}/${name}` : name })
      ] }),
      saved ? /* @__PURE__ */ jsx3(Box3, { marginTop: 0, children: /* @__PURE__ */ jsx3(Text3, { color: palette2.warn, wrap: "wrap", children: `saved ${saved.provider ? `${saved.provider}/` : ""}${saved.name} \u2014 OpenRouter unavailable; /model to change` }) }) : null
    ] }) : /* @__PURE__ */ jsx3(Box3, { marginTop: 1, children: /* @__PURE__ */ jsx3(Text3, { color: palette2.warn, children: `${glyphs2.caret} no model selected \u2014 set one with /model or a provider key` }) })
  ] });
}
function ConversationColumn({
  width,
  turnBlocks,
  activeTurn,
  liveAssistant,
  liveThinking,
  layers,
  working,
  model,
  savedModel,
  theme
}) {
  if (!turnBlocks.length && !activeTurn) {
    return /* @__PURE__ */ jsx3(Box3, { flexDirection: "column", width, paddingRight: 2, children: /* @__PURE__ */ jsx3(EmptyState, { model, savedModel }) });
  }
  const completed = activeTurn ? turnBlocks.slice(0, -1) : turnBlocks;
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", width, paddingRight: 2, children: [
    completed.map((item) => item.kind === "turn" ? /* @__PURE__ */ jsx3(TurnView, { turn: item.block, width, layers, theme }, item.block.id) : null),
    activeTurn ? /* @__PURE__ */ jsx3(
      TurnView,
      {
        turn: activeTurn,
        width,
        layers,
        liveAssistant,
        liveThinking,
        working,
        theme
      }
    ) : null
  ] });
}
function Footer({
  cols,
  input,
  working,
  notice,
  permissionActive,
  listPickerActive,
  pickerQuery,
  ghost,
  suggestHint
}) {
  const { palette: palette2, glyphs: glyphs2 } = useChatTheme();
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx3(Rule, { width: cols, palette: palette2 }),
    notice ? /* @__PURE__ */ jsx3(Text3, { color: palette2.warn, children: notice }) : null,
    suggestHint && !listPickerActive && !permissionActive ? /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, wrap: "wrap", children: `tab complete   ${suggestHint}` }) : null,
    /* @__PURE__ */ jsxs3(Box3, { children: [
      /* @__PURE__ */ jsx3(Text3, { color: palette2.accent, bold: true, children: permissionActive ? `${glyphs2.caret} permission ` : listPickerActive ? `${glyphs2.caret} pick ` : `you ${glyphs2.caret} ` }),
      listPickerActive ? /* @__PURE__ */ jsx3(Text3, { color: palette2.text, children: pickerQuery || "" }) : /* @__PURE__ */ jsxs3(Fragment, { children: [
        /* @__PURE__ */ jsx3(Text3, { color: palette2.text, children: input }),
        ghost ? /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: ghost }) : null
      ] }),
      !permissionActive && !listPickerActive && !working ? /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: glyphs2.block }) : null
    ] }),
    /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: permissionActive ? "\u2191/\u2193 move   enter select   y/a/n shortcut   esc cancel" : listPickerActive ? "type to filter   \u2191/\u2193 move   enter select   esc cancel" : `enter send   tab complete   shift+enter newline   ${glyphs2.gutter}   /help  Ctrl-C ${working ? "cancel" : "exit"}` })
  ] });
}
function cycleInspectorForced(current) {
  if (current === null || current === void 0) return true;
  if (current === true) return false;
  return null;
}
function inspectorLabel(forced) {
  if (forced === true) return "on";
  if (forced === false) return "off";
  return "auto";
}
function App({
  driver,
  session,
  layers,
  planTurn,
  persist,
  cwd,
  permissionBridge,
  env = process.env,
  initialTurnBlocks = [],
  initialTranscript = []
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns || 100;
  const [uiEpoch, setUiEpoch] = useState(0);
  const theme = useMemo(() => createTheme({
    ascii: Boolean(session.ui?.ascii),
    scheme: resolveTerminalColorScheme(env, session.ui?.theme)
  }), [uiEpoch, session.ui?.ascii, session.ui?.theme, env]);
  const { spinnerFrames: spinnerFrames2 } = theme;
  const commands = useMemo(
    () => createCommands({
      driver,
      host: "construct",
      hostId: "construct",
      cwd,
      turnBlocksRef: () => turnBlocksRef.current
    }),
    [driver, cwd]
  );
  const seedBlocks = initialTurnBlocks?.length ? initialTurnBlocks : turnBlocksFromTranscript(initialTranscript);
  const [turnBlocks, setTurnBlocks] = useState(seedBlocks);
  const turnBlocksRef = useRef(seedBlocks);
  turnBlocksRef.current = turnBlocks;
  const [activeTurn, setActiveTurn] = useState(null);
  const [liveAssistant, setLiveAssistant] = useState("");
  const [liveThinking, setLiveThinking] = useState("");
  const [plan, setPlan] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [lastTurnUsage, setLastTurnUsage] = useState(null);
  const [working, setWorking] = useState(false);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState(session.modelNotice || "");
  const [ctx, setCtx] = useState(null);
  const [frame, setFrame] = useState(0);
  const [listPicker, setListPicker] = useState(null);
  const [, forceTick] = useState(0);
  const busy = useRef(false);
  const inputHistory = useRef([]);
  const historyPos = useRef(-1);
  const activeTurnRef = useRef(null);
  const inspectorTurn = activeTurn || turnBlocks.filter((b) => b.kind === "turn").slice(-1)[0]?.block || null;
  const showInspector = shouldShowInspector({
    uiInspector: session.ui?.inspector,
    turn: inspectorTurn,
    forced: session.inspectorForced ?? null
  });
  const dockWidth = Math.min(36, Math.max(28, Math.floor(cols * 0.15)));
  const inspectorWidth = Math.min(42, Math.max(30, Math.floor(cols * 0.34)));
  const panelWidth = showInspector ? inspectorWidth : dockWidth;
  const convWidth = Math.max(20, cols - panelWidth - 2);
  const spin = spinnerFrames2[frame];
  const inputGhost = useMemo(() => {
    if (listPicker || !input.trimStart().startsWith("/")) return "";
    return slashCommandGhost(input);
  }, [input, listPicker]);
  const inputSuggestHint = useMemo(() => {
    if (listPicker || !input.trimStart().startsWith("/")) return "";
    return commandSuggestHint(input);
  }, [input, listPicker]);
  const openModelPicker = useCallback(async () => {
    const items = await loadModelPickerItems(driver, {
      env,
      currentModel: session.model,
      modelMode: session.modelMode || "pinned"
    });
    if (!items.length) {
      setNotice("no models to pick from \u2014 use /model <id>");
      return;
    }
    setListPicker(createListPickerState({
      kind: "model",
      title: "Select a model",
      items,
      selectedId: pickerSelectedId(session)
    }));
    setNotice("");
  }, [driver, env, session.model]);
  const openSettingKeyPicker = useCallback(() => {
    setListPicker(createListPickerState({
      kind: "setting-key",
      title: "Select a setting",
      items: settingKeyPickerItems()
    }));
    setNotice("");
  }, []);
  const commitListPicker = useCallback(async () => {
    if (!listPicker) return;
    const item = getPickerSelectedItem(listPicker);
    if (!item) return;
    if (listPicker.kind === "model") {
      if (item.disabled) {
        setNotice(item.detail || "OpenRouter not configured \u2014 set OPENROUTER_API_KEY in ~/.construct/config.env");
        return;
      }
      const selection = await resolveModelPickerSelection(item, { env });
      if (!selection) {
        setNotice("free router unavailable \u2014 set OPENROUTER_API_KEY in ~/.construct/config.env");
        setListPicker(null);
        return;
      }
      commitPickerModel(session, selection, { cwd, layers: session.layers });
      const label = selection.mode === "free-router" ? `free-router \u2192 ${selection.modelId}` : selection.modelId;
      setNotice(`model set: ${label} (saved)`);
      setListPicker(null);
      setUiEpoch((n) => n + 1);
      return;
    }
    if (listPicker.kind === "permission") {
      listPicker.context?.resolve?.(item.id);
      setListPicker(null);
      return;
    }
    if (listPicker.kind === "setting-key") {
      const key = item.id;
      if (key === "model") {
        setListPicker(null);
        await openModelPicker();
        return;
      }
      if (isBoolSetting(key)) {
        setListPicker(createListPickerState({
          kind: "setting-value",
          title: `Set ${key}`,
          items: BOOL_PICKER_ITEMS,
          context: { key }
        }));
        return;
      }
      if (isEnumSetting(key)) {
        const selectedId = key === "inspector" ? session.ui?.inspector : key === "theme" ? session.ui?.theme : key === "permission" ? session.permissionMode : session.sandbox;
        setListPicker(createListPickerState({
          kind: "setting-value",
          title: `Set ${key}`,
          items: enumPickerItems(key),
          selectedId,
          context: { key }
        }));
        return;
      }
    }
    if (listPicker.kind === "setting-value") {
      const key = listPicker.context?.key;
      const result = applySessionSetting(session, layers, key, item.id, { cwd });
      if (!result.ok) setNotice(result.error || "invalid setting");
      else setNotice(`set: ${result.key} = ${result.value} (saved)`);
      setListPicker(null);
      setUiEpoch((n) => n + 1);
    }
  }, [cwd, env, layers, listPicker, openModelPicker, session]);
  useEffect(() => {
    if (permissionBridge) {
      permissionBridge.prompt = (req) => new Promise((resolve) => {
        setListPicker(createListPickerState({
          kind: "permission",
          title: `Allow "${req.tool || "tool"}"?`,
          items: PERMISSION_PICKER_ITEMS,
          context: { resolve, req }
        }));
      });
      return () => {
        permissionBridge.prompt = null;
      };
    }
    return void 0;
  }, [permissionBridge]);
  useEffect(() => {
    if (!working) return void 0;
    const timer = setInterval(() => setFrame((f) => (f + 1) % spinnerFrames2.length), 90);
    return () => clearInterval(timer);
  }, [working, spinnerFrames2.length]);
  const bumpTurnBlocks = useCallback((turn) => {
    setTurnBlocks((prev) => {
      const idx = prev.findIndex((b) => b.kind === "turn" && b.block.id === turn.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { kind: "turn", block: { ...turn } };
        return next;
      }
      return [...prev, { kind: "turn", block: { ...turn } }];
    });
  }, []);
  const resolvePermission = useCallback((decision) => {
    if (listPicker?.kind === "permission") {
      listPicker.context?.resolve?.(decision);
      setListPicker(null);
    }
  }, [listPicker]);
  const toggleInspector = useCallback(() => {
    session.inspectorForced = cycleInspectorForced(session.inspectorForced ?? null);
    setNotice(`inspector: ${inspectorLabel(session.inspectorForced)}`);
    setUiEpoch((n) => n + 1);
  }, [session]);
  const handleCommand = useCallback(async (text) => {
    const trimmed = text.trim();
    if (trimmed === "/inspect") {
      toggleInspector();
      return;
    }
    if (trimmed === "/model" || trimmed === "/models") {
      await openModelPicker();
      return;
    }
    if (trimmed === "/free") {
      const id = await resolveFreeOpenRouterModel({ env, tier: "standard" });
      if (!id) {
        setNotice("OpenRouter free router needs OPENROUTER_API_KEY");
        return;
      }
      commitPickerModel(session, { mode: "free-router", modelId: id }, { cwd, layers: session.layers });
      setNotice(`free-router mode \u2192 ${id} (saved)`);
      setUiEpoch((n) => n + 1);
      return;
    }
    if (trimmed.startsWith("/export")) {
      const scope = trimmed.split(/\s+/)[1] === "session" ? "session" : "last";
      const result = exportTurns(turnBlocksRef.current, { scope, cwd });
      setNotice(result.ok ? `exported to ${result.path}` : result.error || "export failed");
      return;
    }
    if (trimmed === "/set") {
      openSettingKeyPicker();
      return;
    }
    const out = createCollectWriter();
    const keep = await commands.handle(text, {
      output: out.stream,
      colors: PLAIN_COLORS,
      layers,
      session,
      rl: null,
      onClear: () => {
        setTurnBlocks([]);
        setActiveTurn(null);
        setNotice("");
        setPlan([]);
        setPermissions([]);
      }
    });
    const msg = stripAnsi(out.text()).trim();
    if (msg) {
      const t = createTurnBlock("");
      t.assistant = msg;
      setTurnBlocks((prev) => [...prev, { kind: "turn", block: t }]);
    }
    setUiEpoch((n) => n + 1);
    if (!keep) exit();
  }, [commands, env, exit, layers, openModelPicker, openSettingKeyPicker, session, toggleInspector]);
  const submit = useCallback(async (text) => {
    if (!text.trim() || busy.current) return;
    if (text.startsWith("/")) {
      await handleCommand(text);
      return;
    }
    busy.current = true;
    setWorking(true);
    setNotice("");
    if (!inputHistory.current.length || inputHistory.current[inputHistory.current.length - 1] !== text) {
      inputHistory.current.push(text);
    }
    historyPos.current = -1;
    setLiveAssistant("");
    setLiveThinking("");
    setPlan([]);
    setPermissions([]);
    setLastTurnUsage(null);
    const turn = createTurnBlock(text);
    activeTurnRef.current = turn;
    setActiveTurn({ ...turn });
    setTurnBlocks((prev) => [...prev, { kind: "turn", block: turn }]);
    let overlay = null;
    try {
      overlay = await planTurn?.(text, { turnBlocks: turnBlocksRef.current });
      if (overlay) applyOverlayToTurn(turn, overlay);
      bumpTurnBlocks(turn);
    } catch {
    }
    try {
      const { state, model, notice: fallbackNotice } = await runTurnWithFallback({
        driver,
        text,
        session,
        layers,
        env,
        promptOptions: {
          permissionMode: session.permissionMode,
          sandbox: session.sandbox,
          turnOverlay: overlay
        },
        runTurnInto,
        onUpdate: (s, event) => {
          if (persist?.event) {
            try {
              persist.event(event);
            } catch {
            }
          }
          applyEventToTurn(turn, event, s);
          if (event.type === "text") setLiveAssistant(s.assistant);
          else if (event.type === "thinking") setLiveThinking(s.thinking);
          else if (event.type === "plan") setPlan([...s.plan]);
          else if (event.type === "permission") setPermissions([...s.permissions]);
          else if (event.type === "usage") {
            if (event.context) setCtx(event.context);
            setLastTurnUsage(s.lastUsage);
            forceTick((n) => n + 1);
          }
          bumpTurnBlocks(turn);
        }
      });
      if (model && model !== session.model) session.model = model;
      if (fallbackNotice) setNotice(fallbackNotice);
      if (state.assistant) turn.assistant = state.assistant;
      else if (state.error) turn.assistant = `[error] ${parseOpenRouterError(state.error).summary}`;
      else if (!state.rendered) turn.assistant = "[no output] check that a model is selected and the provider is authenticated";
      finalizeTurn(turn);
      bumpTurnBlocks(turn);
      if (persist?.transcriptBlock) {
        try {
          persist.transcriptBlock(turn);
        } catch {
        }
      }
    } catch (err) {
      turn.assistant = `[error] ${parseOpenRouterError(err.message).summary}`;
      finalizeTurn(turn);
      bumpTurnBlocks(turn);
    } finally {
      setLiveAssistant("");
      setLiveThinking("");
      setActiveTurn(null);
      activeTurnRef.current = null;
      setWorking(false);
      busy.current = false;
    }
  }, [bumpTurnBlocks, driver, handleCommand, layers, persist, planTurn, session]);
  useInput((char, key) => {
    if (listPicker) {
      if (listPicker.kind === "permission") {
        const shortcut = parsePermissionKey(char);
        if (shortcut) {
          resolvePermission(shortcut);
          return;
        }
      }
      const { state, action } = reducePickerKey(listPicker, { char, key });
      if (action === "cancel") {
        setListPicker(null);
        return;
      }
      if (action === "commit") {
        commitListPicker();
        return;
      }
      if (state) setListPicker(state);
      return;
    }
    if (key.ctrl && char === "c") {
      if (busy.current) {
        try {
          driver.cancel?.();
        } catch {
        }
      } else exit();
      return;
    }
    if (key.ctrl && char === "o") {
      toggleInspector();
      return;
    }
    if (key.return && (key.shift || key.meta)) {
      setInput((v) => `${v}
`);
      return;
    }
    if (key.tab) {
      setInput((v) => applyTabCompletion(v));
      return;
    }
    if (key.return) {
      const text = input;
      setInput("");
      submit(text);
      return;
    }
    const slashMode = input.trimStart().startsWith("/") && !input.trim().includes(" ");
    if (key.upArrow) {
      if (slashMode && slashCommandMatches(input).length > 1) {
        setInput((v) => cycleSlashCommand(v, -1));
        return;
      }
      const hist = inputHistory.current;
      if (!hist.length) return;
      const next = historyPos.current < 0 ? hist.length - 1 : Math.max(0, historyPos.current - 1);
      historyPos.current = next;
      setInput(hist[next]);
      return;
    }
    if (key.downArrow) {
      if (slashMode && slashCommandMatches(input).length > 1) {
        setInput((v) => cycleSlashCommand(v, 1));
        return;
      }
      const hist = inputHistory.current;
      if (!hist.length || historyPos.current < 0) return;
      const next = historyPos.current + 1;
      if (next >= hist.length) {
        historyPos.current = -1;
        setInput("");
        return;
      }
      historyPos.current = next;
      setInput(hist[next]);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) setInput((v) => v + char);
  });
  return /* @__PURE__ */ jsx3(ChatThemeContext.Provider, { value: theme, children: /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx3(HeaderBar, { cols, session, sandbox: session.sandbox, permissionMode: session.permissionMode, working, spin }),
    listPicker ? /* @__PURE__ */ jsx3(
      ListPickerOverlay,
      {
        picker: listPicker,
        width: convWidth,
        theme,
        currentId: listPicker.kind === "model" ? pickerSelectedId(session) : null,
        markerId: listPicker.kind === "model" && session.modelMode !== "free-router" ? session.model : null
      }
    ) : null,
    /* @__PURE__ */ jsxs3(Box3, { children: [
      /* @__PURE__ */ jsx3(
        ConversationColumn,
        {
          width: convWidth,
          turnBlocks,
          activeTurn,
          liveAssistant,
          liveThinking,
          layers,
          working,
          model: session.model,
          savedModel: session.savedModel,
          theme
        }
      ),
      showInspector ? /* @__PURE__ */ jsx3(
        TurnInspector,
        {
          width: panelWidth,
          turn: inspectorTurn,
          layers,
          permissions,
          plan,
          lastTurnUsage,
          theme
        }
      ) : /* @__PURE__ */ jsx3(
        SessionDock,
        {
          width: panelWidth,
          session,
          layers,
          working,
          model: session.model,
          modelMode: session.modelMode,
          savedModel: session.savedModel,
          sandbox: session.sandbox,
          permissionMode: session.permissionMode,
          ctx,
          spin,
          theme
        }
      )
    ] }),
    /* @__PURE__ */ jsx3(
      Footer,
      {
        cols,
        input,
        working,
        notice,
        permissionActive: listPicker?.kind === "permission",
        listPickerActive: Boolean(listPicker),
        pickerQuery: listPicker?.query || "",
        ghost: inputGhost,
        suggestHint: inputSuggestHint
      }
    )
  ] }) });
}
function runInkChat({
  driver,
  session,
  layers,
  planTurn = null,
  persist = null,
  cwd = process.cwd(),
  permissionBridge = null,
  env = process.env,
  initialTurnBlocks = [],
  initialTranscript = []
} = {}) {
  const instance = render(
    /* @__PURE__ */ jsx3(
      App,
      {
        driver,
        session,
        layers,
        env,
        planTurn,
        persist,
        cwd,
        permissionBridge,
        initialTurnBlocks,
        initialTranscript
      }
    )
  );
  return instance.waitUntilExit();
}
var index_default = runInkChat;
export {
  App,
  EmptyState,
  HeaderBar,
  SessionDock,
  TransparencyPanel,
  TurnContextBar,
  TurnInspector,
  TurnView,
  createTheme,
  index_default as default,
  runInkChat
};
