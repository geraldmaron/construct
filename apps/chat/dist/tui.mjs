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
function hasSecret(varName, { env = process.env, cwd = process.cwd(), allowAmbient = true } = {}) {
  const direct = env?.[varName];
  if (typeof direct === "string" && direct.length > 0) return true;
  if (!allowAmbient) return false;
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

// lib/ollama/installed-models.mjs
import { spawnSync as spawnSync2 } from "node:child_process";
function ollamaBaseUrl(env = process.env) {
  const fromEnv = resolveFirstSecret(["OLLAMA_BASE_URL", "OLLAMA_HOST"], { env, allowAmbient: true });
  const base = (fromEnv || "http://localhost:11434").replace(/\/+$/, "");
  return base.endsWith("/v1") ? base.slice(0, -3) : base;
}
function parseTagsResponse(body) {
  const data = typeof body === "string" ? JSON.parse(body) : body;
  const names = (data?.models || []).map((entry) => entry?.name || entry?.model).filter(Boolean);
  return new Set(names);
}
function listViaTagsApi(baseUrl) {
  const url = `${baseUrl}/api/tags`;
  const r = spawnSync2("curl", ["-s", "--connect-timeout", "2", url], { encoding: "utf8", timeout: 4e3 });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try {
    return parseTagsResponse(r.stdout);
  } catch {
    return null;
  }
}
function listViaCli() {
  const r = spawnSync2("ollama", ["list"], { encoding: "utf8", timeout: 5e3 });
  if (r.status !== 0) return null;
  const names = r.stdout.trim().split("\n").slice(1).map((line) => line.split(/\s+/).filter(Boolean)[0]).filter(Boolean);
  return new Set(names);
}
function toOllamaNativeModelId(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  return modelId.replace(/^ollama\//, "");
}
function listInstalledOllamaModels({ env = process.env, now: now2 = Date.now(), refresh = false } = {}) {
  if (!refresh && cache.models && now2 - cache.at < CACHE_MS) {
    return { models: cache.models, listable: cache.listable };
  }
  const baseUrl = ollamaBaseUrl(env);
  let models = listViaTagsApi(baseUrl);
  if (!models) models = listViaCli();
  if (!models) {
    cache = { at: now2, models: null, listable: false };
    return { models: null, listable: false };
  }
  cache = { at: now2, models, listable: true };
  return { models, listable: true };
}
function isOllamaModelInstalled(modelId, opts = {}) {
  const native = toOllamaNativeModelId(modelId);
  if (!native) return null;
  const { models, listable } = listInstalledOllamaModels(opts);
  if (!listable || !models) return null;
  return models.has(native);
}
var CACHE_MS, cache;
var init_installed_models = __esm({
  "lib/ollama/installed-models.mjs"() {
    init_secret_resolver();
    CACHE_MS = 2500;
    cache = { at: 0, models: null, listable: false };
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
var CREDENTIAL_ENV_KEYS;
var init_env_config = __esm({
  "lib/env-config.mjs"() {
    init_credential_catalog();
    init_secret_resolver();
    CREDENTIAL_ENV_KEYS = new Set(
      API_KEY_CREDENTIALS.flatMap((entry) => entry.envVars)
    );
  }
});

// lib/opencode-config.mjs
import path5 from "node:path";
import os5 from "node:os";
function getOpenCodeConfigDir() {
  return path5.join(os5.homedir(), ".config", "opencode");
}
function getCanonicalOpenCodeConfigPath() {
  return path5.join(getOpenCodeConfigDir(), "opencode.json");
}
function findOpenCodeConfigPath() {
  return getCanonicalOpenCodeConfigPath();
}
var init_opencode_config = __esm({
  "lib/opencode-config.mjs"() {
    init_host_capabilities();
    init_env_config();
  }
});

// lib/mcp/tool-budget.mjs
function isLocalModel(model) {
  const m = (model || "").toLowerCase();
  if (m.startsWith("local/")) return true;
  return m.includes("ollama") || m.includes("localhost") || m.includes("127.0.0.1");
}
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

// lib/config/schema.mjs
function checkType(value, expected) {
  if (Array.isArray(expected)) return expected.some((t) => checkType(value, t));
  if (expected === "null") return value === null;
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  return typeof value === expected;
}
function validateField(value, rule, path37) {
  const errors = [];
  if (value === void 0) {
    if (rule.required) errors.push(`${path37}: required field missing`);
    return errors;
  }
  if (!checkType(value, rule.type)) {
    errors.push(`${path37}: expected type ${JSON.stringify(rule.type)}, got ${value === null ? "null" : typeof value}`);
    return errors;
  }
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(`${path37}: must be one of ${JSON.stringify(rule.enum)}, got ${JSON.stringify(value)}`);
  }
  if (rule.maxLength && typeof value === "string" && value.length > rule.maxLength) {
    errors.push(`${path37}: exceeds maxLength ${rule.maxLength}`);
  }
  if (rule.fields && checkType(value, "object")) {
    for (const [key, subRule] of Object.entries(rule.fields)) {
      errors.push(...validateField(value[key], subRule, `${path37}.${key}`));
    }
  }
  return errors;
}
function validateProjectConfig(raw) {
  const errors = [];
  if (!checkType(raw, "object")) {
    return { valid: false, errors: ["root: must be an object"] };
  }
  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    errors.push(...validateField(raw[key], rule, key));
  }
  if (raw.version !== void 0 && raw.version !== CONFIG_SCHEMA_VERSION) {
    errors.push(`version: expected ${CONFIG_SCHEMA_VERSION}, got ${raw.version}`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
var CONFIG_SCHEMA_VERSION, DEPLOYMENT_MODES, MCP_BROKER_VALUES, DEFAULT_PROFILE_ID, SURFACES, INGEST_STRATEGIES, INGEST_FALLBACKS, INGEST_ORCHESTRATIONS, ORCHESTRATION_WORKER_BACKENDS, ORCHESTRATION_STORES, CHAIN_OF_THOUGHT_MODES, HOOK_OUTPUT_MODES, DEFAULT_PROJECT_CONFIG, FIELD_RULES;
var init_schema = __esm({
  "lib/config/schema.mjs"() {
    CONFIG_SCHEMA_VERSION = 1;
    DEPLOYMENT_MODES = ["solo", "team", "enterprise"];
    MCP_BROKER_VALUES = ["auto", "on", "off"];
    DEFAULT_PROFILE_ID = "rnd";
    SURFACES = ["claude", "opencode", "codex", "copilot", "vscode", "cursor"];
    INGEST_STRATEGIES = ["adapter", "provider", "docling-remote"];
    INGEST_FALLBACKS = ["none", "provider", "adapter"];
    INGEST_ORCHESTRATIONS = ["prompt-only", "orchestrated"];
    ORCHESTRATION_WORKER_BACKENDS = ["inline", "provider"];
    ORCHESTRATION_STORES = ["filesystem", "sqlite", "postgres"];
    CHAIN_OF_THOUGHT_MODES = ["hidden", "surface", "telemetry_only"];
    HOOK_OUTPUT_MODES = ["auto", "silent", "stderr", "stdout"];
    DEFAULT_PROJECT_CONFIG = Object.freeze({
      version: CONFIG_SCHEMA_VERSION,
      alias: "Construct",
      deployment: Object.freeze({
        mode: "solo",
        mcpBroker: "auto",
        projectName: null,
        tenantId: null
      }),
      providers: Object.freeze({}),
      profile: DEFAULT_PROFILE_ID,
      autoEmbed: false,
      ingest: Object.freeze({
        strategy: "adapter",
        fallback: "none",
        orchestration: "prompt-only"
      }),
      orchestration: Object.freeze({
        workerBackend: "inline",
        store: "filesystem",
        chainOfThought: "hidden"
      }),
      telemetry: Object.freeze({
        enabled: true
      }),
      hooks: Object.freeze({
        outputMode: "auto"
      }),
      models: Object.freeze({
        visibility: Object.freeze({
          mode: "all_configured",
          include: [],
          exclude: [],
          providers: {}
        }),
        catalog: Object.freeze({
          liveOpenRouter: true,
          maxLiveFree: 24
        })
      }),
      roleSelection: Object.freeze({
        primary: null,
        secondary: null,
        perConversationOverride: true
      }),
      hosts: Object.freeze(Object.fromEntries(SURFACES.map((s) => [s, Object.freeze({ enabled: true })]))),
      resources: Object.freeze({
        disk: Object.freeze({
          tracesMaxDays: 30,
          intakeArchiveMaxItems: 500,
          intakeArchiveMaxDays: 90,
          taskGraphsMaxItems: 200,
          taskGraphsMaxDays: 90,
          workerLogsMaxMb: 100,
          workerLogsMaxDays: 14,
          sessionsMaxItems: 100,
          backupsMaxDays: 60,
          handoffsMaxDays: 30,
          handoffsMaxItems: 50,
          totalCxMaxMb: 2e3
        }),
        process: Object.freeze({
          embedDaemonMaxRssMb: 800,
          mcpServerMaxRssMb: 250,
          workerReplicaMaxRssMb: 256
        })
      })
    });
    FIELD_RULES = {
      $schema: { type: "string", required: false },
      version: { type: "number", required: true },
      alias: { type: "string", required: false, maxLength: 120 },
      deployment: {
        type: "object",
        required: false,
        fields: {
          mode: { type: "string", enum: DEPLOYMENT_MODES },
          mcpBroker: { type: "string", enum: MCP_BROKER_VALUES },
          projectName: { type: ["string", "null"] },
          tenantId: { type: ["string", "null"] }
        }
      },
      providers: { type: "object", required: false },
      profile: { type: "string", required: false, maxLength: 40 },
      autoEmbed: { type: "boolean", required: false },
      ingest: {
        type: "object",
        required: false,
        fields: {
          strategy: { type: "string", enum: INGEST_STRATEGIES },
          fallback: { type: "string", enum: INGEST_FALLBACKS },
          orchestration: { type: "string", enum: INGEST_ORCHESTRATIONS }
        }
      },
      orchestration: {
        type: "object",
        required: false,
        fields: {
          workerBackend: { type: "string", enum: ORCHESTRATION_WORKER_BACKENDS },
          store: { type: "string", enum: ORCHESTRATION_STORES },
          chainOfThought: { type: "string", enum: CHAIN_OF_THOUGHT_MODES }
        }
      },
      telemetry: {
        type: "object",
        required: false,
        fields: {
          enabled: { type: "boolean" }
        }
      },
      hooks: {
        type: "object",
        required: false,
        fields: {
          outputMode: { type: "string", enum: HOOK_OUTPUT_MODES }
        }
      },
      roleSelection: {
        type: "object",
        required: false,
        fields: {
          primary: { type: ["string", "null"], maxLength: 50 },
          secondary: { type: ["string", "null"], maxLength: 50 },
          perConversationOverride: { type: "boolean" }
        }
      },
      resources: { type: "object", required: false },
      hosts: {
        type: "object",
        required: false,
        fields: Object.fromEntries(SURFACES.map((s) => [s, {
          type: "object",
          required: false,
          fields: {
            enabled: { type: "boolean", required: false }
          }
        }]))
      },
      costs: {
        type: "object",
        required: false,
        fields: {
          billingMode: { type: "string", enum: ["metered", "subscription", "mixed"] },
          enforce: { type: "boolean" },
          budgets: { type: "object" },
          providers: { type: "object", required: false }
        }
      },
      models: {
        type: "object",
        required: false,
        fields: {
          visibility: {
            type: "object",
            required: false,
            fields: {
              mode: { type: "string", enum: ["all_configured", "tier_defaults", "explicit"] },
              include: { type: "array" },
              exclude: { type: "array" },
              providers: { type: "object" }
            }
          },
          catalog: {
            type: "object",
            required: false,
            fields: {
              liveOpenRouter: { type: "boolean" },
              maxLiveFree: { type: "number" }
            }
          }
        }
      }
    };
  }
});

// lib/config/project-config.mjs
import fs5 from "node:fs";
import path6 from "node:path";
function findProjectConfigPath(cwd = process.cwd()) {
  let dir = path6.resolve(cwd);
  const root = path6.parse(dir).root;
  while (dir !== root) {
    const candidate = path6.join(dir, PROJECT_CONFIG_FILENAME);
    if (fs5.existsSync(candidate)) return candidate;
    if (fs5.existsSync(path6.join(dir, ".git"))) {
      const inGitRoot = path6.join(dir, PROJECT_CONFIG_FILENAME);
      return fs5.existsSync(inGitRoot) ? inGitRoot : null;
    }
    dir = path6.dirname(dir);
  }
  return null;
}
function interpolateSecrets(value, env = process.env) {
  if (typeof value === "string") {
    const match = value.match(ENV_POINTER_RE);
    if (!match) return value;
    const resolved = env[match[1]];
    return resolved === void 0 ? null : resolved;
  }
  if (Array.isArray(value)) return value.map((v) => interpolateSecrets(v, env));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateSecrets(v, env);
    return out;
  }
  return value;
}
function deepMerge(base, override) {
  if (override === void 0) return base;
  if (override === null || typeof override !== "object" || Array.isArray(override)) return override;
  const out = Array.isArray(base) ? [...base || []] : { ...base || {} };
  for (const [k, v] of Object.entries(override)) {
    out[k] = deepMerge(base?.[k], v);
  }
  return out;
}
function loadProjectConfig(cwd = process.cwd(), env = process.env) {
  const configPath = findProjectConfigPath(cwd);
  if (!configPath) {
    return {
      path: null,
      raw: null,
      config: structuredClone(DEFAULT_PROJECT_CONFIG),
      source: "default",
      errors: []
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs5.readFileSync(configPath, "utf8"));
  } catch (err) {
    return {
      path: configPath,
      raw: null,
      config: structuredClone(DEFAULT_PROJECT_CONFIG),
      source: "invalid",
      errors: [`failed to parse ${configPath}: ${err.message}`]
    };
  }
  const validation = validateProjectConfig(raw);
  if (!validation.valid) {
    return {
      path: configPath,
      raw,
      config: structuredClone(DEFAULT_PROJECT_CONFIG),
      source: "invalid",
      errors: validation.errors
    };
  }
  const merged = deepMerge(structuredClone(DEFAULT_PROJECT_CONFIG), raw);
  const resolved = interpolateSecrets(merged, env);
  return {
    path: configPath,
    raw,
    config: resolved,
    source: "file",
    errors: []
  };
}
var PROJECT_CONFIG_FILENAME, ENV_POINTER_RE;
var init_project_config = __esm({
  "lib/config/project-config.mjs"() {
    init_schema();
    PROJECT_CONFIG_FILENAME = "construct.config.json";
    ENV_POINTER_RE = /^\$([A-Z_][A-Z0-9_]*)$/;
  }
});

// lib/models/catalog.mjs
import fs6 from "node:fs";
import path7 from "node:path";
import os6 from "node:os";
function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}
function cachePath(homeDir2 = os6.homedir()) {
  return path7.join(homeDir2, ".cx", CACHE_FILENAME);
}
function resolveModelsConfig(projectConfig = {}) {
  const models = projectConfig?.models && typeof projectConfig.models === "object" ? projectConfig.models : {};
  const visibility = { ...DEFAULT_MODELS_CONFIG.visibility, ...models.visibility || {} };
  const catalog = { ...DEFAULT_MODELS_CONFIG.catalog, ...models.catalog || {} };
  if (!MODEL_VISIBILITY_MODES.includes(visibility.mode)) {
    visibility.mode = DEFAULT_MODELS_CONFIG.visibility.mode;
  }
  visibility.include = Array.isArray(visibility.include) ? visibility.include : [];
  visibility.exclude = Array.isArray(visibility.exclude) ? visibility.exclude : [];
  visibility.providers = visibility.providers && typeof visibility.providers === "object" ? visibility.providers : {};
  catalog.maxLiveFree = Number.isFinite(catalog.maxLiveFree) ? catalog.maxLiveFree : DEFAULT_MODELS_CONFIG.catalog.maxLiveFree;
  catalog.liveOpenRouter = catalog.liveOpenRouter !== false;
  return { visibility, catalog };
}
function readLiveCatalogCache({ homeDir: homeDir2 = os6.homedir(), maxAgeMs = CACHE_TTL_MS } = {}) {
  const file = cachePath(homeDir2);
  try {
    if (!fs6.existsSync(file)) return null;
    const parsed = JSON.parse(fs6.readFileSync(file, "utf8"));
    if (!parsed?.fetchedAt || !Array.isArray(parsed.models)) return null;
    if (Date.now() - parsed.fetchedAt > maxAgeMs) return null;
    return parsed.models;
  } catch {
    return null;
  }
}
function writeLiveCatalogCache(models, { homeDir: homeDir2 = os6.homedir() } = {}) {
  const file = cachePath(homeDir2);
  fs6.mkdirSync(path7.dirname(file), { recursive: true });
  fs6.writeFileSync(file, JSON.stringify({
    fetchedAt: Date.now(),
    models: models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      isFree: m.isFree === true
    }))
  }, null, 2));
}
async function refreshLiveOpenRouterCatalog({ env = process.env, homeDir: homeDir2 = os6.homedir() } = {}) {
  const apiKey = resolveFirstSecret(["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"], { env });
  if (!apiKey) return [];
  const models = await pollFreeModels(apiKey);
  writeLiveCatalogCache(models, { homeDir: homeDir2 });
  return models;
}
function providerFamilyEnabled(providerId, visibility) {
  const map = visibility.providers || {};
  if (Object.keys(map).length === 0) return true;
  if (map[providerId] === false) return false;
  if (providerId.startsWith("openrouter") && map.openrouter === false) return false;
  return map[providerId] !== false;
}
function collectTierDefaultIds(registryModels = {}) {
  const ids = [];
  for (const tier of ["reasoning", "standard", "fast"]) {
    const def = registryModels[tier];
    if (typeof def === "string") ids.push(def);
    else if (def && typeof def === "object") {
      if (def.primary) ids.push(def.primary);
      if (Array.isArray(def.fallback)) ids.push(...def.fallback);
    }
  }
  return uniqueStrings(ids);
}
function mergeLiveModelsIntoProviders(providers, liveModels = [], { maxLiveFree = 24 } = {}) {
  if (!liveModels.length) return providers;
  const liveIds = liveModels.slice(0, maxLiveFree).map((m) => m.id?.startsWith("openrouter/") ? m.id : `openrouter/${m.id}`);
  return providers.map((provider) => {
    if (provider.id !== "openrouter" && !provider.id.startsWith("openrouter")) return provider;
    const options = {
      reasoning: uniqueStrings([...provider.options?.reasoning ?? [], ...liveIds]),
      standard: uniqueStrings([...provider.options?.standard ?? [], ...liveIds]),
      fast: uniqueStrings([...provider.options?.fast ?? [], ...liveIds])
    };
    return { ...provider, options, liveModelCount: liveIds.length };
  });
}
function applyModelVisibilityFilter(catalog, {
  visibility = DEFAULT_MODELS_CONFIG.visibility,
  registryModels = {},
  activeModelId = null
} = {}) {
  const includeSet = new Set(visibility.include || []);
  const excludeSet = new Set(visibility.exclude || []);
  const tierDefaults = collectTierDefaultIds(registryModels);
  const modelAllowed = (modelId, providerId) => {
    if (!modelId) return false;
    if (modelId === activeModelId) return true;
    if (excludeSet.has(modelId)) return false;
    if (!providerFamilyEnabled(providerId, visibility)) return false;
    if (visibility.mode === "explicit") {
      return includeSet.has(modelId);
    }
    if (visibility.mode === "tier_defaults") {
      return tierDefaults.includes(modelId);
    }
    return true;
  };
  const providers = catalog.providers.filter((provider) => providerFamilyEnabled(provider.id, visibility)).map((provider) => {
    const options = {};
    for (const tier of ["reasoning", "standard", "fast"]) {
      options[tier] = (provider.options?.[tier] ?? []).filter((id) => modelAllowed(id, provider.id));
    }
    const tiers = { ...provider.tiers };
    for (const tier of ["reasoning", "standard", "fast"]) {
      if (tiers[tier] && !modelAllowed(tiers[tier], provider.id)) {
        tiers[tier] = options[tier]?.[0] ?? null;
      }
    }
    return { ...provider, options, tiers };
  });
  const tierOptions = {
    reasoning: uniqueStrings(providers.flatMap((p) => p.options.reasoning)),
    standard: uniqueStrings(providers.flatMap((p) => p.options.standard)),
    fast: uniqueStrings(providers.flatMap((p) => p.options.fast))
  };
  return { providers, tierOptions, visibility, activeModelId };
}
function loadModelsCatalogContext({ cwd = process.cwd(), env = process.env, homeDir: homeDir2 = os6.homedir() } = {}) {
  const { config } = loadProjectConfig(cwd, env);
  const modelsConfig = resolveModelsConfig(config);
  let registryModels = {};
  try {
    const registryPath = path7.join(cwd, "specialists", "registry.json");
    if (fs6.existsSync(registryPath)) {
      registryModels = JSON.parse(fs6.readFileSync(registryPath, "utf8")).models ?? {};
    }
  } catch {
  }
  const liveModels = modelsConfig.catalog.liveOpenRouter ? readLiveCatalogCache({ homeDir: homeDir2 }) ?? [] : [];
  return { modelsConfig, registryModels, liveModels };
}
var MODEL_VISIBILITY_MODES, DEFAULT_MODELS_CONFIG, CACHE_FILENAME, CACHE_TTL_MS;
var init_catalog = __esm({
  "lib/models/catalog.mjs"() {
    init_model_free_selector();
    init_secret_resolver();
    init_project_config();
    MODEL_VISIBILITY_MODES = ["all_configured", "tier_defaults", "explicit"];
    DEFAULT_MODELS_CONFIG = Object.freeze({
      visibility: Object.freeze({
        mode: "all_configured",
        include: [],
        exclude: [],
        providers: {}
      }),
      catalog: Object.freeze({
        liveOpenRouter: true,
        maxLiveFree: 24
      })
    });
    CACHE_FILENAME = "model-catalog-cache.json";
    CACHE_TTL_MS = 10 * 60 * 1e3;
  }
});

// lib/provider-capabilities-anthropic.js
var provider_capabilities_anthropic_exports = {};
__export(provider_capabilities_anthropic_exports, {
  anthropicCapabilities: () => anthropicCapabilities,
  capabilities: () => capabilities
});
function anthropicCapabilities(modelId = "") {
  const contextWindow = resolveContextWindow(modelId);
  return {
    cacheControl: true,
    cacheMechanism: "annotation",
    cacheTTL: { "5m": 3e5, "1h": 12e5 },
    // tokens
    structuredOutput: true,
    maxContextWindow: contextWindow,
    tokenRatio: 3.5,
    // ~3.5 chars per token for Claude
    annotationFormat: "anthropic",
    annotationHeaders: {
      "anthropic-version": "2024-10-22"
    },
    cacheAnchoring: "system-message",
    // where to place the cache_control
    breakpointPlacement: "after-static"
    // place breakpoint after static content
  };
}
function resolveContextWindow(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (id.includes("opus-4")) return 2e5;
  if (id.includes("sonnet-4")) return 2e5;
  if (id.includes("haiku-4")) return 2e5;
  if (id.includes("3-5-sonnet")) return 2e5;
  if (id.includes("3-5-haiku")) return 2e5;
  return 2e5;
}
async function capabilities(modelId) {
  return anthropicCapabilities(modelId);
}
var init_provider_capabilities_anthropic = __esm({
  "lib/provider-capabilities-anthropic.js"() {
    init_provider_capabilities();
  }
});

// lib/provider-capabilities-google.js
var provider_capabilities_google_exports = {};
__export(provider_capabilities_google_exports, {
  capabilities: () => capabilities2,
  googleCapabilities: () => googleCapabilities
});
function googleCapabilities(modelId = "") {
  const contextWindow = resolveGoogleContextWindow(modelId);
  return {
    cacheControl: true,
    cacheMechanism: "resource",
    // uses cachedContent API
    cacheTTL: { "5m": null, "1h": 12e5 },
    // Gemini uses 1h TTL
    structuredOutput: true,
    maxContextWindow: contextWindow,
    tokenRatio: 4,
    // ~4 chars per token for Gemini
    annotationFormat: "google",
    annotationHeaders: null,
    // Gemini uses separate API endpoint
    cachedContentEndpoint: "https://generativelanguage.googleapis.com/v1",
    cacheAnchoring: "cached-content"
    // reference by name
  };
}
function resolveGoogleContextWindow(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (id.includes("gemini-1.5-pro")) return 1e6;
  if (id.includes("gemini-1.5-flash")) return 1e6;
  if (id.includes("gemini-2.0-pro")) return 1e6;
  if (id.includes("gemini-2.0-flash")) return 1e6;
  if (id.includes("gemini-2.5-pro")) return 1e6;
  if (id.includes("gemini-2.5-flash")) return 1e6;
  if (id.includes("gemini-pro")) return 3e4;
  if (id.includes("gemini-flash")) return 3e4;
  if (id.includes("gemma")) return 8e3;
  return 1e6;
}
async function capabilities2(modelId) {
  return googleCapabilities(modelId);
}
var init_provider_capabilities_google = __esm({
  "lib/provider-capabilities-google.js"() {
    init_provider_capabilities();
  }
});

// lib/provider-capabilities-openai.js
var provider_capabilities_openai_exports = {};
__export(provider_capabilities_openai_exports, {
  capabilities: () => capabilities3,
  openaiCapabilities: () => openaiCapabilities
});
function openaiCapabilities(modelId = "") {
  const contextWindow = resolveOpenAIContextWindow(modelId);
  return {
    cacheControl: false,
    // automatic — no annotations
    cacheMechanism: "automatic",
    cacheTTL: null,
    // invisible to caller
    structuredOutput: true,
    maxContextWindow: contextWindow,
    tokenRatio: 4,
    // ~4 chars per token for GPT models
    annotationFormat: "openai",
    annotationHeaders: null,
    cacheAnchoring: "prefix",
    // stable prefix caching
    notes: "OpenAI caches repeated prefixes automatically; no explicit cache_control needed"
  };
}
function resolveOpenAIContextWindow(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (id.includes("gpt-4o") || id.includes("gpt-4.1")) return 128e3;
  if (id.includes("gpt-4-turbo")) return 128e3;
  if (id.includes("gpt-4")) return 8e3;
  if (id.includes("gpt-3.5")) return 16e3;
  if (id.includes("gpt-3")) return 4e3;
  if (id.includes("o1")) return 2e5;
  if (id.includes("o3")) return 2e5;
  return 128e3;
}
async function capabilities3(modelId) {
  return openaiCapabilities(modelId);
}
var init_provider_capabilities_openai = __esm({
  "lib/provider-capabilities-openai.js"() {
    init_provider_capabilities();
  }
});

// lib/provider-capabilities-deepseek.js
var provider_capabilities_deepseek_exports = {};
__export(provider_capabilities_deepseek_exports, {
  capabilities: () => capabilities4,
  deepseekCapabilities: () => deepseekCapabilities
});
function deepseekCapabilities(modelId = "") {
  const contextWindow = resolveDeepSeekContextWindow(modelId);
  return {
    cacheControl: false,
    cacheMechanism: "none",
    cacheTTL: null,
    structuredOutput: false,
    maxContextWindow: contextWindow,
    tokenRatio: 3,
    // ~3 chars per token for DeepSeek
    annotationFormat: "none",
    annotationHeaders: null,
    cacheAnchoring: "none",
    notes: "DeepSeek has no prompt caching support via standard APIs"
  };
}
function resolveDeepSeekContextWindow(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (id.includes("deepseek-v3") || id.includes("deepseek-chat")) return 64e3;
  if (id.includes("deepseek-coder")) return 16e3;
  if (id.includes("deepseek-r1")) return 64e3;
  return 64e3;
}
async function capabilities4(modelId) {
  return deepseekCapabilities(modelId);
}
var init_provider_capabilities_deepseek = __esm({
  "lib/provider-capabilities-deepseek.js"() {
    init_provider_capabilities();
  }
});

// lib/provider-capabilities-generic.js
var provider_capabilities_generic_exports = {};
__export(provider_capabilities_generic_exports, {
  capabilities: () => capabilities5,
  genericCapabilities: () => genericCapabilities
});
function genericCapabilities(modelId = "") {
  return {
    cacheControl: false,
    cacheMechanism: "none",
    cacheTTL: null,
    structuredOutput: false,
    maxContextWindow: 2e5,
    // conservative default
    tokenRatio: 4,
    // ~4 chars per token (conservative)
    annotationFormat: "none",
    annotationHeaders: null,
    cacheAnchoring: "none",
    notes: "Generic provider \u2014 no special capabilities detected"
  };
}
async function capabilities5(modelId) {
  return genericCapabilities(modelId);
}
var init_provider_capabilities_generic = __esm({
  "lib/provider-capabilities-generic.js"() {
    init_provider_capabilities();
  }
});

// lib/provider-capabilities.js
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
function resolveAdapterKey(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (/^anthropic\//.test(id) || /^openrouter\/anthropic\//.test(id)) return "anthropic";
  if (/^google\//.test(id) || /^openrouter\/google\//.test(id)) return "google";
  if (/^openai\//.test(id) || /^openrouter\/openai\//.test(id) || /^github-copilot\//.test(id)) return "openai";
  if (/^deepseek\//.test(id) || /^openrouter\/deepseek\//.test(id)) return "deepseek";
  return "generic";
}
function readCapabilityCache() {
  try {
    if (!existsSync(CAPABILITY_CACHE_PATH)) return {};
    const cached2 = JSON.parse(readFileSync(CAPABILITY_CACHE_PATH, "utf8"));
    if (cached2?.fetchedAt && Date.now() - cached2.fetchedAt < CAPABILITY_CACHE_TTL_MS) {
      return cached2.capabilities || {};
    }
  } catch {
  }
  return {};
}
function getCache() {
  if (_cache === null) _cache = readCapabilityCache();
  return _cache;
}
async function resolveProviderCapabilities(modelId) {
  const adapterKey = resolveAdapterKey(modelId);
  const loader = ADAPTERS[adapterKey] || ADAPTERS.generic;
  try {
    const { capabilities: capabilities6 } = await loader();
    return capabilities6(modelId);
  } catch {
    const { capabilities: capabilities6 } = await ADAPTERS.generic();
    return capabilities6(modelId);
  }
}
function resolveProviderCapabilitiesSync(modelId) {
  const adapterKey = resolveAdapterKey(modelId);
  const cache3 = getCache();
  if (cache3[adapterKey]) return cache3[adapterKey];
  return {
    cacheControl: false,
    cacheMechanism: "none",
    cacheTTL: null,
    structuredOutput: false,
    maxContextWindow: 2e5,
    tokenRatio: 4,
    annotationFormat: "none",
    annotationHeaders: null
  };
}
var CAPABILITY_CACHE_PATH, CAPABILITY_CACHE_TTL_MS, ADAPTERS, _cache;
var init_provider_capabilities = __esm({
  "lib/provider-capabilities.js"() {
    CAPABILITY_CACHE_PATH = join(homedir(), ".cx", "provider-capabilities.json");
    CAPABILITY_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
    ADAPTERS = {
      anthropic: () => Promise.resolve().then(() => (init_provider_capabilities_anthropic(), provider_capabilities_anthropic_exports)),
      "anthropic-direct": () => Promise.resolve().then(() => (init_provider_capabilities_anthropic(), provider_capabilities_anthropic_exports)),
      google: () => Promise.resolve().then(() => (init_provider_capabilities_google(), provider_capabilities_google_exports)),
      openai: () => Promise.resolve().then(() => (init_provider_capabilities_openai(), provider_capabilities_openai_exports)),
      deepseek: () => Promise.resolve().then(() => (init_provider_capabilities_deepseek(), provider_capabilities_deepseek_exports)),
      generic: () => Promise.resolve().then(() => (init_provider_capabilities_generic(), provider_capabilities_generic_exports))
    };
    _cache = null;
  }
});

// lib/model-router.mjs
var model_router_exports = {};
__export(model_router_exports, {
  MODEL_OPERATING_PROFILES: () => MODEL_OPERATING_PROFILES,
  MODEL_TIER_BY_WORK_CATEGORY: () => MODEL_TIER_BY_WORK_CATEGORY,
  PROVIDER_FAMILY_TIERS: () => PROVIDER_FAMILY_TIERS,
  applyFreePreferenceToTierSet: () => applyFreePreferenceToTierSet,
  applyFreeSameFamilyPreferenceToTierSet: () => applyFreeSameFamilyPreferenceToTierSet,
  applyToEnv: () => applyToEnv,
  classifyProviderFailure: () => classifyProviderFailure,
  describeModelFamily: () => describeModelFamily,
  formatModelStatus: () => formatModelStatus,
  getModelForTier: () => getModelForTier,
  getModelSource: () => getModelSource,
  getProviderModelCatalog: () => getProviderModelCatalog,
  inferTierModelsFromSelection: () => inferTierModelsFromSelection,
  isChatModelAvailable: () => isChatModelAvailable,
  isProviderOnCooldown: () => isProviderOnCooldown,
  listModelFamilies: () => listModelFamilies,
  readCurrentModels: () => readCurrentModels,
  readOpenRouterApiKeyFromOpenCodeConfig: () => readOpenRouterApiKeyFromOpenCodeConfig,
  readProviderCooldowns: () => readProviderCooldowns,
  resetEnv: () => resetEnv,
  resolveCapabilityTier: () => resolveCapabilityTier,
  resolveExecutionContractModelMetadata: () => resolveExecutionContractModelMetadata,
  resolveFallbackAction: () => resolveFallbackAction,
  resolveModelOperatingProfile: () => resolveModelOperatingProfile,
  resolveModelTiers: () => resolveModelTiers,
  resolveProviderCapabilities: () => resolveProviderCapabilities,
  resolveProviderCapabilitiesSync: () => resolveProviderCapabilitiesSync,
  resolveTiersForPrimary: () => resolveTiersForPrimary,
  resolveValidatedChatModel: () => resolveValidatedChatModel,
  selectFallbackModel: () => selectFallbackModel,
  selectLocalEditorModel: () => selectLocalEditorModel,
  selectModelTierForWorkCategory: () => selectModelTierForWorkCategory,
  setModelWithTierInference: () => setModelWithTierInference,
  setTierModel: () => setTierModel,
  validateModelTiers: () => validateModelTiers,
  writeProviderCooldown: () => writeProviderCooldown
});
import fs7 from "node:fs";
import path8 from "node:path";
import { spawnSync as spawnSync3 } from "child_process";
function uniqueStrings2(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}
function normalizeModelOperatingProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "default") return "balanced";
  return MODEL_OPERATING_PROFILES[normalized] ? normalized : null;
}
function parseModelSizeB(model) {
  const size = String(model || "").toLowerCase().match(/(?:[:/-])(\d+(?:\.\d+)?)b\b/);
  return size ? parseFloat(size[1]) : null;
}
function inferSmallModelProfile(selectedModel) {
  const model = String(selectedModel || "").toLowerCase();
  if (!model) return false;
  if (/^(ollama|local)\//.test(model)) {
    const size = parseModelSizeB(model);
    if (size !== null && size <= 34) return true;
  }
  if (/^(anthropic|openrouter\/anthropic)\/.*haiku/.test(model)) return true;
  if (/gpt-5\.1-mini|gemma-3|gemma-4|phi3:mini/.test(model)) return true;
  return false;
}
function resolveModelOperatingProfile({
  envValues = {},
  selectedModel = null
} = {}) {
  const explicit = normalizeModelOperatingProfile(
    envValues.CONSTRUCT_MODEL_PROFILE ?? envValues.constructModelProfile
  );
  if (explicit) return MODEL_OPERATING_PROFILES[explicit];
  if (inferSmallModelProfile(selectedModel)) return MODEL_OPERATING_PROFILES.small;
  return MODEL_OPERATING_PROFILES.balanced;
}
function resolveCapabilityTier({ model, verdict = null } = {}) {
  if (!isLocalModel(model)) return "full";
  if (verdict === "COLLAPSED") return "floor";
  const size = parseModelSizeB(model);
  if (size === null) return "floor";
  if (size >= 24) return "mid";
  return "floor";
}
function selectLocalEditorModel(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const sized = candidates.map((m) => ({ m, size: parseModelSizeB(m) }));
  const pick = (arr) => {
    const band = arr.filter((x) => x.size !== null && x.size >= 7 && x.size <= 34).sort((a, b) => a.size - b.size);
    if (band.length) return band[0].m;
    const anySized = arr.filter((x) => x.size !== null).sort((a, b) => a.size - b.size);
    return anySized.length ? anySized[0].m : arr[0].m;
  };
  const coders = sized.filter((x) => CODE_MODEL_RE.test(x.m));
  return coders.length ? pick(coders) : pick(sized);
}
function hasCopilotCredential() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return false;
  const candidates = [
    path8.join(home, ".construct", "auth", "github-copilot.json"),
    path8.join(home, ".config", "github-copilot", "apps.json"),
    path8.join(home, ".config", "github-copilot", "hosts.json")
  ];
  for (const file of candidates) {
    try {
      if (!fs7.existsSync(file)) continue;
      const data = JSON.parse(fs7.readFileSync(file, "utf8"));
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
function isProviderConfigured(familyId, env, { allowAmbient = true } = {}) {
  const varNames = PROVIDER_ENV_MAP[familyId];
  if (!varNames?.length) return false;
  if (familyId === "ollama") {
    try {
      const r = spawnSync3("curl", ["-s", "--connect-timeout", "1", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:11434/api/tags"], { encoding: "utf8", timeout: 3e3 });
      if (r.status === 0 && r.stdout?.trim() === "200") return true;
    } catch {
    }
    try {
      const r = spawnSync3("ollama", ["--version"], { encoding: "utf8", timeout: 2e3 });
      if (r.status === 0) return true;
    } catch {
    }
  }
  if (hasAnySecret(varNames, { env, allowAmbient })) return true;
  if (familyId === "github-copilot") {
    if (hasCopilotCredential()) return true;
    try {
      const r = spawnSync3("gh", ["auth", "status"], { encoding: "utf8", timeout: 3e3 });
      return r.status === 0;
    } catch {
      return false;
    }
  }
  return false;
}
function getProviderModelCatalog({
  env = process.env,
  cwd = process.cwd(),
  activeModelId = null,
  registryModels: registryModelsOverride = null
} = {}) {
  const baseProviders = PROVIDER_FAMILY_TIERS.map((family) => {
    const tiers = family.resolve({});
    const options = {
      reasoning: uniqueStrings2([...family.options?.reasoning ?? [], tiers.reasoning]),
      standard: uniqueStrings2([...family.options?.standard ?? [], tiers.standard]),
      fast: uniqueStrings2([...family.options?.fast ?? [], tiers.fast])
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
  const { modelsConfig, registryModels, liveModels } = loadModelsCatalogContext({ cwd, env });
  const mergedProviders = mergeLiveModelsIntoProviders(
    baseProviders,
    liveModels,
    { maxLiveFree: modelsConfig.catalog.maxLiveFree }
  );
  const tierOptionsRaw = {
    reasoning: uniqueStrings2(mergedProviders.flatMap((provider) => provider.options.reasoning)),
    standard: uniqueStrings2(mergedProviders.flatMap((provider) => provider.options.standard)),
    fast: uniqueStrings2(mergedProviders.flatMap((provider) => provider.options.fast))
  };
  return applyModelVisibilityFilter(
    { providers: mergedProviders, tierOptions: tierOptionsRaw },
    {
      visibility: modelsConfig.visibility,
      registryModels: registryModelsOverride ?? registryModels,
      activeModelId
    }
  );
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
  if (family.id === "ollama") {
    const nativeModel = toOllamaNativeModelId(modelId);
    const installed = isOllamaModelInstalled(modelId, { env });
    if (installed === true) {
      return { ok: true, modelId, provider: family.id };
    }
    if (installed === false) {
      return {
        ok: false,
        reason: "model_not_pulled",
        modelId,
        provider: family.id,
        nativeModel,
        pullCommand: `ollama pull ${nativeModel}`
      };
    }
    return { ok: true, modelId, provider: family.id };
  }
  if (LENIENT_MODEL_FAMILIES.has(family.id)) {
    return { ok: true, modelId, provider: family.id };
  }
  const { providers } = getProviderModelCatalog({ env });
  const provider = providers.find((p) => p.id === family.id);
  if (!provider) {
    return { ok: false, reason: "unknown_family", modelId };
  }
  const known = uniqueStrings2([
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
  if (rejected.reason === "model_not_pulled") {
    const native = rejected.nativeModel || toOllamaNativeModelId(label);
    return `Pinned ${label} \u2014 not installed locally. Run \`ollama pull ${native}\` or \`construct ollama pull ${native}\`.`;
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
    const candidates = uniqueStrings2([
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
function resolveTiersForPrimary(primaryModelId) {
  if (!primaryModelId || typeof primaryModelId !== "string") return null;
  const family = matchProviderFamily(primaryModelId);
  if (!family) return null;
  return family.resolve({ reasoning: void 0, standard: void 0, fast: void 0 });
}
function familyDescriptor(family, env, { allowAmbient = true } = {}) {
  const requiresEnv = PROVIDER_ENV_MAP[family.id] || (Array.isArray(family.requiresEnv) ? family.requiresEnv : []);
  const local = family.local === true;
  const configured = isProviderConfigured(family.id, env, { allowAmbient });
  return {
    id: family.id,
    label: family.label,
    local,
    requiresEnv,
    tiers: family.resolve({}),
    configured
  };
}
function describeModelFamily(modelId, { env = process.env, allowAmbient = true } = {}) {
  const family = matchProviderFamily(modelId);
  if (!family) return null;
  return familyDescriptor(family, env, { allowAmbient });
}
function listModelFamilies({ env = process.env, allowAmbient = true } = {}) {
  return PROVIDER_FAMILY_TIERS.map((family) => familyDescriptor(family, env, { allowAmbient }));
}
function readOpenRouterApiKeyFromOpenCodeConfig(configPath = findOpenCodeConfigPath()) {
  return readRawFromOpenCodeProvider("openrouter", configPath) || "";
}
function readEnvAssignments(envPath) {
  const tierKeys = {
    reasoning: "CX_MODEL_REASONING",
    standard: "CX_MODEL_STANDARD",
    fast: "CX_MODEL_FAST"
  };
  const envValues = {};
  if (fs7.existsSync(envPath)) {
    for (const line of fs7.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      envValues[k] = v;
    }
  }
  return Object.fromEntries(
    Object.entries(tierKeys).map(([tier, key]) => [tier, envValues[key] || null])
  );
}
function extractPrimary(def) {
  if (typeof def === "string") return def;
  if (def && typeof def === "object")
    return def.primary ?? def.fallback?.[0] ?? null;
  return null;
}
function getRegistryDefaults(registryModels = {}) {
  return {
    reasoning: extractPrimary(registryModels.reasoning) ?? null,
    standard: extractPrimary(registryModels.standard) ?? null,
    fast: extractPrimary(registryModels.fast) ?? null
  };
}
function normalizeEnvAssignments(envValues = {}) {
  return {
    reasoning: envValues.reasoning ?? envValues.CX_MODEL_REASONING ?? envValues.CONSTRUCT_MODEL_REASONING ?? null,
    standard: envValues.standard ?? envValues.CX_MODEL_STANDARD ?? envValues.CONSTRUCT_MODEL_STANDARD ?? null,
    fast: envValues.fast ?? envValues.CX_MODEL_FAST ?? envValues.CONSTRUCT_MODEL_FAST ?? null
  };
}
function flattenText(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}
function providerKey(modelId = "") {
  if (typeof modelId !== "string" || !modelId) return "";
  return modelId.replace(/^openrouter\//, "").split("/")[0] || "";
}
function resolveTierDefinition(definition) {
  if (!definition || typeof definition !== "object") return { primary: null, fallback: [] };
  return {
    primary: extractPrimary(definition),
    fallback: Array.isArray(definition.fallback) ? definition.fallback.filter((entry) => typeof entry === "string" && entry) : []
  };
}
function readProviderCooldowns(cooldownPath) {
  try {
    const raw = fs7.readFileSync(cooldownPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
  }
  return {};
}
function writeProviderCooldown(cooldownPath, provider, now2 = Date.now()) {
  if (!provider) return;
  const existing = readProviderCooldowns(cooldownPath);
  existing[provider] = now2 + PROVIDER_COOLDOWN_MS;
  fs7.mkdirSync(path8.dirname(cooldownPath), { recursive: true });
  fs7.writeFileSync(cooldownPath, JSON.stringify(existing, null, 2));
}
function isProviderOnCooldown(cooldownPath, provider, now2 = Date.now()) {
  if (!provider) return false;
  const state = readProviderCooldowns(cooldownPath);
  const expiresAt = state[provider];
  return typeof expiresAt === "number" && now2 < expiresAt;
}
function selectFallbackModel({
  hookInput,
  envPath,
  cooldownPath,
  registryModels = {},
  now: now2 = Date.now()
} = {}) {
  const classified = classifyProviderFailure(hookInput);
  if (!classified || !classified.retryable) return null;
  const failingProvider = providerKey(classified.provider || "");
  if (failingProvider && isProviderOnCooldown(cooldownPath, failingProvider, now2)) return null;
  const currentModels = readCurrentModels(envPath, registryModels);
  const action = resolveFallbackAction({
    failure: classified,
    currentModels,
    registryModels
  });
  if (!action) return null;
  const candidateProvider = providerKey(action.targetModel);
  if (candidateProvider && isProviderOnCooldown(cooldownPath, candidateProvider, now2)) return null;
  return { targetModel: action.targetModel, tier: action.tier, reason: action.reason };
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
function resolveFallbackAction({
  failure,
  requestedTier = null,
  workCategory = null,
  currentModels = null,
  registryModels = {}
} = {}) {
  const classified = failure && typeof failure === "object" ? failure : classifyProviderFailure(failure);
  if (!classified || !classified.retryable) return null;
  const tier = requestedTier ?? selectModelTierForWorkCategory(workCategory) ?? "standard";
  const tierDef = resolveTierDefinition(registryModels[tier]);
  const currentModel = currentModels && typeof currentModels === "object" ? currentModels[tier]?.model ?? currentModels[tier] ?? null : null;
  const currentProvider = providerKey(currentModel || "");
  const failingProvider = providerKey(classified.provider || "");
  const candidates = [tierDef.primary, ...tierDef.fallback].filter((modelId) => typeof modelId === "string" && modelId).filter((modelId) => modelId !== currentModel).filter((modelId) => {
    const candidateProvider = providerKey(modelId);
    if (!candidateProvider) return true;
    if (failingProvider && candidateProvider === failingProvider) return false;
    if (currentProvider && candidateProvider === currentProvider) return false;
    return true;
  });
  const targetModel = candidates[0] ?? null;
  if (!targetModel) return null;
  return { action: "apply-models", reason: classified.kind, targetModel, tier };
}
function resolveTierAssignments(envValues = {}, registryModels = {}) {
  const normalizedEnv = normalizeEnvAssignments(envValues);
  const explicitSources = envValues?.sources && typeof envValues.sources === "object" ? envValues.sources : {};
  const defaults = getRegistryDefaults(registryModels);
  const tiers = {};
  for (const tier of ["reasoning", "standard", "fast"]) {
    if (explicitSources[tier]) {
      tiers[tier] = { model: normalizedEnv[tier] ?? defaults[tier], source: explicitSources[tier] };
    } else if (normalizedEnv[tier]) {
      tiers[tier] = { model: normalizedEnv[tier], source: "env override" };
    } else if (defaults[tier]) {
      tiers[tier] = { model: defaults[tier], source: "registry" };
    } else {
      tiers[tier] = { model: null, source: "not configured" };
    }
  }
  return tiers;
}
function selectModelTierForWorkCategory(workCategory = "") {
  return MODEL_TIER_BY_WORK_CATEGORY[workCategory] ?? null;
}
function resolveExecutionContractModelMetadata({
  envValues = {},
  registryModels = {},
  requestedTier = null,
  workCategory = null
} = {}) {
  const tiers = resolveTierAssignments(envValues, registryModels);
  const selectedTier = requestedTier ?? selectModelTierForWorkCategory(workCategory);
  const selected = selectedTier ? tiers[selectedTier] : null;
  const profile = resolveModelOperatingProfile({
    envValues,
    selectedModel: selected?.model ?? null
  });
  return {
    version: "v1",
    workCategory: workCategory ?? null,
    requestedTier: requestedTier ?? null,
    selectedTier: selectedTier ?? null,
    selectedModel: selected?.model ?? null,
    selectedModelSource: selected?.source ?? null,
    profile,
    tiers
  };
}
function inferTierModelsFromSelection(selectedModel, { registryModels = {}, existing = {} } = {}) {
  if (!selectedModel) return null;
  const family = matchProviderFamily(selectedModel);
  if (!family) return null;
  const registryDefaults = getRegistryDefaults(registryModels);
  const current = {
    reasoning: existing.reasoning ?? null,
    standard: existing.standard ?? null,
    fast: existing.fast ?? null
  };
  const seeded = {
    reasoning: current.reasoning === selectedModel ? selectedModel : current.reasoning,
    standard: current.standard === selectedModel ? selectedModel : current.standard,
    fast: current.fast === selectedModel ? selectedModel : current.fast
  };
  const derived = family.resolve(seeded);
  return {
    reasoning: derived.reasoning ?? registryDefaults.reasoning,
    standard: derived.standard ?? registryDefaults.standard,
    fast: derived.fast ?? registryDefaults.fast
  };
}
function applyFreePreferenceToTierSet(tierSet, { registryModels = {} } = {}) {
  const defaults = getRegistryDefaults(registryModels);
  return {
    reasoning: preferFreeValue(tierSet.reasoning, tierSet.standard, defaults.reasoning, null),
    standard: preferFreeValue(tierSet.standard, tierSet.fast, defaults.standard, null),
    fast: preferFreeValue(tierSet.fast, tierSet.standard, defaults.fast, null)
  };
}
function applyFreeSameFamilyPreferenceToTierSet(tierSet, selectedModel) {
  const family = matchProviderFamily(selectedModel);
  if (!family) return tierSet;
  const sameFamily = family.resolve({ reasoning: null, standard: null, fast: null });
  const next = { ...tierSet };
  for (const tier of ["reasoning", "standard", "fast"]) {
    if (tierSet[tier] === selectedModel) continue;
    const candidate = sameFamily[tier];
    if (candidate && isFreeModel(candidate)) next[tier] = candidate;
  }
  return next;
}
function applyToEnv(envPath, selections) {
  const existing = fs7.existsSync(envPath) ? fs7.readFileSync(envPath, "utf8") : "";
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const commentMarker = "# Auto-set by construct models --apply on";
  const tierMap = {
    reasoning: "CX_MODEL_REASONING",
    standard: "CX_MODEL_STANDARD",
    fast: "CX_MODEL_FAST"
  };
  let lines = existing.split("\n");
  lines = lines.filter((l) => {
    const trimmed = l.trim();
    if (trimmed.startsWith(commentMarker)) return false;
    const key = trimmed.split("=")[0];
    if (Object.values(tierMap).includes(key)) return false;
    return true;
  });
  const modelLines = [`${commentMarker} ${date}`];
  for (const [tier, envKey] of Object.entries(tierMap)) {
    if (selections[tier]) modelLines.push(`${envKey}=${selections[tier]}`);
  }
  const insertIdx = lines.findLastIndex((l) => l.trim() !== "") + 1;
  lines.splice(insertIdx === 0 ? lines.length : insertIdx, 0, "", ...modelLines);
  fs7.writeFileSync(envPath, lines.join("\n"));
}
function resetEnv(envPath) {
  if (!fs7.existsSync(envPath)) return;
  const commentMarker = "# Auto-set by construct models --apply on";
  const tierKeys = /* @__PURE__ */ new Set(["CX_MODEL_REASONING", "CX_MODEL_STANDARD", "CX_MODEL_FAST"]);
  const lines = fs7.readFileSync(envPath, "utf8").split("\n");
  const filtered = lines.filter((l) => {
    const trimmed = l.trim();
    if (trimmed.startsWith(commentMarker)) return false;
    const key = trimmed.split("=")[0];
    if (tierKeys.has(key)) return false;
    return true;
  });
  fs7.writeFileSync(envPath, filtered.join("\n"));
}
function setTierModel(envPath, tier, modelId) {
  applyToEnv(envPath, { [tier]: modelId });
}
function setModelWithTierInference(envPath, tier, modelId, registryModels = {}, options = {}) {
  const existing = readEnvAssignments(envPath);
  existing[tier] = modelId;
  const inferred = inferTierModelsFromSelection(modelId, { registryModels, existing }) || existing;
  inferred[tier] = modelId;
  let resolved = inferred;
  if (options.preferFreeSameFamily) {
    resolved = applyFreeSameFamilyPreferenceToTierSet(resolved, modelId);
  } else if (options.preferFree) {
    resolved = applyFreePreferenceToTierSet(resolved, { registryModels });
  }
  resolved[tier] = modelId;
  applyToEnv(envPath, resolved);
  return resolved;
}
function resolveModelTiers(options = {}) {
  const {
    env = process.env,
    registryPath = null,
    strict = false
  } = options;
  let registryModels = {};
  if (registryPath && fs7.existsSync(registryPath)) {
    try {
      const registry = JSON.parse(fs7.readFileSync(registryPath, "utf8"));
      registryModels = registry.models ?? {};
    } catch (err) {
      return {
        models: { reasoning: null, standard: null, fast: null },
        sources: { reasoning: "not configured", standard: "not configured", fast: "not configured" },
        configured: 0,
        complete: false,
        errors: [`Failed to read registry: ${err.message}`]
      };
    }
  }
  const tiers = resolveTierAssignments(normalizeEnvAssignments(env), registryModels);
  const models = {};
  const sources = {};
  for (const tier of ["reasoning", "standard", "fast"]) {
    models[tier] = tiers[tier].model;
    sources[tier] = tiers[tier].source;
  }
  const configured = Object.values(models).filter(Boolean).length;
  const errors = strict && configured < 3 ? [`Missing configuration for tiers: ${["reasoning", "standard", "fast"].filter((t) => !models[t]).join(", ")}`] : null;
  return {
    models,
    sources,
    configured,
    complete: configured === 3,
    errors
  };
}
function getModelForTier(tier, options = {}) {
  return resolveModelTiers(options).models[tier];
}
function getModelSource(tier, options = {}) {
  return resolveModelTiers(options).sources[tier] || "unknown";
}
function validateModelTiers(options = {}) {
  const resolved = resolveModelTiers({ ...options, strict: true });
  const unconfigured = Object.entries(resolved.sources).filter(([, source]) => source === "not configured").map(([tier]) => tier);
  return {
    valid: resolved.complete && !resolved.errors,
    errors: resolved.errors,
    warnings: unconfigured.length > 0 ? [`Unconfigured tier${unconfigured.length === 1 ? "" : "s"}: ${unconfigured.join(", ")}. Run 'construct models --apply' or set CX_MODEL_<TIER>.`] : [],
    resolution: resolved
  };
}
function formatModelStatus(options = {}) {
  const resolved = resolveModelTiers(options);
  let output = "Model Configuration:\n\n";
  for (const tier of ["reasoning", "standard", "fast"]) {
    const model = resolved.models[tier];
    const source = resolved.sources[tier];
    const icon = source === "not configured" ? "!" : "ok";
    output += `${icon} ${tier.padEnd(10)} ${model ?? "(not configured)"}
`;
    output += `  Source: ${source}

`;
  }
  return output;
}
function readCurrentModels(envPath, registryModels = {}) {
  const envValues = arguments.length > 2 ? arguments[2] : {};
  const fileAssignments = readEnvAssignments(envPath);
  const mergedAssignments = {
    ...fileAssignments,
    ...Object.fromEntries(
      Object.entries(normalizeEnvAssignments(envValues)).filter(([, value]) => value)
    )
  };
  const tiers = resolveTierAssignments(mergedAssignments, registryModels);
  const result = { sources: {} };
  for (const tier of ["reasoning", "standard", "fast"]) {
    result[tier] = tiers[tier].model;
    result.sources[tier] = tiers[tier].source;
  }
  return result;
}
var MODEL_TIER_BY_WORK_CATEGORY, MODEL_OPERATING_PROFILES, CODE_MODEL_RE, PROVIDER_FAMILY_TIERS, PROVIDER_ENV_MAP, LENIENT_MODEL_FAMILIES, PROVIDER_COOLDOWN_MS;
var init_model_router = __esm({
  "lib/model-router.mjs"() {
    init_secret_resolver();
    init_installed_models();
    init_credential_sources();
    init_opencode_config();
    init_tool_budget();
    init_model_free_selector();
    init_catalog();
    init_provider_capabilities();
    init_provider_capabilities();
    MODEL_TIER_BY_WORK_CATEGORY = {
      visual: "standard",
      deep: "reasoning",
      quick: "fast",
      writing: "fast",
      analysis: "standard"
    };
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
    CODE_MODEL_RE = /coder|codellama|starcoder|deepseek-coder|devstral/i;
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
        id: "openrouter",
        label: "OpenRouter (general)",
        test: (modelId) => /^openrouter\//.test(modelId),
        resolve: ({ reasoning, standard, fast }) => ({
          reasoning: reasoning ?? "openrouter/qwen/qwen3-coder",
          standard: standard ?? "openrouter/qwen/qwen3-coder:free",
          fast: fast ?? "openrouter/qwen/qwen3-coder:free"
        }),
        options: {
          reasoning: ["openrouter/openrouter/free", "openrouter/qwen/qwen3-coder", "openrouter/deepseek/deepseek-r1"],
          standard: ["openrouter/openrouter/free", "openrouter/qwen/qwen3-coder:free", "openrouter/google/gemini-2.0-flash-001"],
          fast: ["openrouter/openrouter/free", "openrouter/qwen/qwen3-coder:free", "openrouter/meta-llama/llama-3.3-70b-instruct:free"]
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
      "openrouter": ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
      "ollama": ["OLLAMA_BASE_URL", "OLLAMA_HOST"],
      "local": ["LOCAL_LLM_BASE_URL"]
    };
    LENIENT_MODEL_FAMILIES = /* @__PURE__ */ new Set([
      "openrouter-anthropic",
      "openrouter-google",
      "openrouter-deepseek",
      "openrouter-qwen",
      "openrouter-llama",
      "openrouter",
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
import fs8 from "node:fs";
import path9 from "node:path";
import os7 from "node:os";
function normalizeToken(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, "");
}
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os7.homedir();
}
function constructStorePath() {
  return path9.join(homeDir(), ".construct", "auth", "github-copilot.json");
}
function appsStorePath() {
  return path9.join(homeDir(), ".config", "github-copilot", "apps.json");
}
function hostsStorePath() {
  return path9.join(homeDir(), ".config", "github-copilot", "hosts.json");
}
function readJson(file) {
  try {
    if (!fs8.existsSync(file)) return null;
    return JSON.parse(fs8.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(file, data, mode) {
  fs8.mkdirSync(path9.dirname(file), { recursive: true, mode: 448 });
  fs8.writeFileSync(file, JSON.stringify(data, null, 2), { mode });
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
async function pollForAccessToken({ deviceCode, interval = 5, expiresIn = 900, fetchImpl = fetch, now: now2 = Date.now, onPending } = {}) {
  const deadline = now2() + expiresIn * 1e3;
  let waitMs = interval * 1e3;
  while (now2() < deadline) {
    const { json } = await postJson(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    }, fetchImpl);
    if (json?.access_token) {
      return {
        accessToken: normalizeToken(json.access_token),
        refreshToken: normalizeToken(json.refresh_token) || null,
        expiresAt: json.expires_in ? Math.floor(now2() / 1e3) + json.expires_in : null
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
async function refreshAccessToken(refreshToken, { fetchImpl, now: now2 }) {
  const { json } = await postJson(ACCESS_TOKEN_URL, {
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  }, fetchImpl);
  if (!json?.access_token) throw new Error("Copilot token refresh failed \u2014 re-run `construct creds login copilot`.");
  return {
    accessToken: normalizeToken(json.access_token),
    refreshToken: normalizeToken(json.refresh_token) || refreshToken,
    expiresAt: json.expires_in ? Math.floor(now2() / 1e3) + json.expires_in : null
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
async function getCopilotToken({ fetchImpl = fetch, now: now2 = Date.now } = {}) {
  const nowS = Math.floor(now2() / 1e3);
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
    const refreshed = await refreshAccessToken(stored.refreshToken, { fetchImpl, now: now2 });
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
    sleep = (ms) => new Promise((resolve4) => setTimeout(resolve4, ms));
  }
});

// apps/chat/engine/models.mjs
var models_exports = {};
__export(models_exports, {
  describeChatModel: () => describeChatModel,
  listChatModels: () => listChatModels,
  recommendChatModel: () => recommendChatModel,
  refreshLiveOpenRouterCatalog: () => refreshLiveOpenRouterCatalog,
  resolveChatModel: () => resolveChatModel,
  resolveChatModelSelection: () => resolveChatModelSelection,
  resolveChatModelSelectionAsync: () => resolveChatModelSelectionAsync,
  resolveFreeOpenRouterModel: () => resolveFreeOpenRouterModel,
  resolveSessionModel: () => resolveSessionModel
});
function listChatModels({ env = process.env, cwd = process.cwd(), activeModelId = null } = {}) {
  const { providers } = getProviderModelCatalog({ env, cwd, activeModelId });
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
    init_catalog();
  }
});

// lib/project-root.mjs
import fs10 from "node:fs";
import path11 from "node:path";
import os8 from "node:os";
import { createHash } from "node:crypto";
function findProjectRoot(start = process.cwd()) {
  let dir = path11.resolve(start);
  const stop = path11.resolve(HOME);
  while (true) {
    if (MARKERS.some((m) => fs10.existsSync(path11.join(dir, m)))) return dir;
    if (dir === stop) return null;
    const parent = path11.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function projectIdFor(projectRoot) {
  if (!projectRoot) return null;
  return createHash("sha256").update(path11.resolve(projectRoot)).digest("hex").slice(0, 12);
}
function resolveProjectScope(cwd = process.cwd()) {
  if (cache2.has(cwd)) return cache2.get(cwd);
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    cache2.set(cwd, null);
    return null;
  }
  const result = {
    projectRoot,
    projectId: projectIdFor(projectRoot),
    cxDir: path11.join(projectRoot, ".cx")
  };
  cache2.set(cwd, result);
  return result;
}
function resolveProjectScopedPath(basename, { cwd, ensureDir = true } = {}) {
  const scope = resolveProjectScope(cwd ?? process.cwd());
  const dir = scope ? scope.cxDir : path11.join(HOME, ".cx");
  if (ensureDir && !fs10.existsSync(dir)) fs10.mkdirSync(dir, { recursive: true });
  return path11.join(dir, basename);
}
var HOME, MARKERS, cache2;
var init_project_root = __esm({
  "lib/project-root.mjs"() {
    HOME = os8.homedir();
    MARKERS = [".cx", ".construct"];
    cache2 = /* @__PURE__ */ new Map();
  }
});

// lib/tags/vocabulary.mjs
var init_vocabulary = __esm({
  "lib/tags/vocabulary.mjs"() {
  }
});

// lib/doc-stamp.mjs
var init_doc_stamp = __esm({
  "lib/doc-stamp.mjs"() {
    init_vocabulary();
  }
});

// lib/project-init-shared.mjs
import fs13 from "node:fs";
import path13 from "node:path";
function ensureCxDir(rootDir) {
  const cxDir = path13.join(rootDir, ".cx");
  const contextPath = path13.join(cxDir, "context.md");
  if (!fs13.existsSync(cxDir)) {
    fs13.mkdirSync(cxDir, { recursive: true });
  }
  if (!fs13.existsSync(contextPath)) {
    fs13.writeFileSync(contextPath, buildContextMarkdown(), "utf8");
  }
  return cxDir;
}
function buildContextMarkdown() {
  return `<!--
.cx/context.md \u2014 concise resumable project context for human and agent handoff.

Keep this file under 100 lines. Update it when reality changes, and prune stale bullets
instead of letting it turn into a historical log. Durable task status belongs in Beads;
\`plan.md\` holds the current plan; use the single-writer rule when parallel sessions are active.
-->

# Project Context

> Required project state. Keep this file current enough that a new session can resume work quickly.

## What was in progress

## Open issues
None

## Recent Decisions

## Architecture Notes

## Open Questions
`;
}
var init_project_init_shared = __esm({
  "lib/project-init-shared.mjs"() {
    init_doc_stamp();
  }
});

// lib/intake/quarantine.mjs
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync, readFileSync as readFileSync2, writeFileSync as writeFileSync2, rmSync } from "node:fs";
import path14 from "node:path";
function quarantineDir(rootDir) {
  return path14.join(rootDir, QUEUE_SUBDIR, "quarantine");
}
function shouldQuarantine(triage) {
  if (!triage || triage.intakeType === "unknown") {
    return { quarantine: false };
  }
  const confidence = typeof triage.confidence === "number" ? triage.confidence : 1;
  if (confidence < QUARANTINE_CONFIDENCE_THRESHOLD) {
    return { quarantine: true, reason: `confidence ${confidence.toFixed(2)} < ${QUARANTINE_CONFIDENCE_THRESHOLD}` };
  }
  if (Array.isArray(triage.candidates) && triage.candidates.length >= 2) {
    const margin = triage.candidates[0].score - triage.candidates[1].score;
    if (margin < QUARANTINE_MARGIN_THRESHOLD) {
      return { quarantine: true, reason: `margin ${margin.toFixed(2)} < ${QUARANTINE_MARGIN_THRESHOLD}` };
    }
  }
  return { quarantine: false };
}
function writeQuarantinePacket(rootDir, packet, quarantineReason) {
  const dir = quarantineDir(rootDir);
  mkdirSync2(dir, { recursive: true });
  const id = packet.id;
  if (!id) throw new Error("writeQuarantinePacket: packet.id required");
  const filePath = path14.join(dir, `${id}.json`);
  const payload = {
    ...packet,
    status: "quarantined",
    quarantinedAt: (/* @__PURE__ */ new Date()).toISOString(),
    quarantineReason: quarantineReason || null
  };
  writeFileSync2(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { id, filePath };
}
var QUEUE_SUBDIR, QUARANTINE_CONFIDENCE_THRESHOLD, QUARANTINE_MARGIN_THRESHOLD;
var init_quarantine = __esm({
  "lib/intake/quarantine.mjs"() {
    QUEUE_SUBDIR = ".cx/intake";
    QUARANTINE_CONFIDENCE_THRESHOLD = 0.6;
    QUARANTINE_MARGIN_THRESHOLD = 0.2;
  }
});

// lib/intake/filesystem-queue.mjs
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readdirSync as readdirSync2, readFileSync as readFileSync3, rmSync as rmSync2, writeFileSync as writeFileSync3 } from "node:fs";
import path15 from "node:path";
function queueRoot(rootDir) {
  return path15.join(rootDir, QUEUE_SUBDIR2);
}
function pendingDir(rootDir) {
  return path15.join(queueRoot(rootDir), "pending");
}
function processedDir(rootDir) {
  return path15.join(queueRoot(rootDir), "processed");
}
function skippedDir(rootDir) {
  return path15.join(queueRoot(rootDir), "skipped");
}
function slugify(value) {
  return String(value || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function timestamp() {
  counter = (counter + 1) % 1e3;
  const c = String(counter).padStart(3, "0");
  return `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 23)}-${c}`;
}
var QUEUE_SUBDIR2, counter, FilesystemIntakeQueue;
var init_filesystem_queue = __esm({
  "lib/intake/filesystem-queue.mjs"() {
    init_project_init_shared();
    init_quarantine();
    QUEUE_SUBDIR2 = ".cx/intake";
    counter = 0;
    FilesystemIntakeQueue = class {
      constructor(rootDir) {
        if (!rootDir) throw new Error("FilesystemIntakeQueue: rootDir is required");
        this.rootDir = rootDir;
      }
      enqueue(entry) {
        if (!entry?.intake?.sourcePath) throw new Error("enqueue: entry.intake.sourcePath is required");
        ensureCxDir(this.rootDir);
        const ts = timestamp();
        const slug = slugify(path15.basename(entry.intake.sourcePath, path15.extname(entry.intake.sourcePath)));
        const id = `${ts}-${slug}`;
        const quarantineDecision = shouldQuarantine(entry?.triage);
        if (quarantineDecision.quarantine) {
          const packet = { id, createdAt: (/* @__PURE__ */ new Date()).toISOString(), ...entry };
          const written = writeQuarantinePacket(this.rootDir, packet, quarantineDecision.reason);
          return { id: written.id, filePath: written.filePath, route: "quarantine", reason: quarantineDecision.reason };
        }
        const dir = pendingDir(this.rootDir);
        mkdirSync3(dir, { recursive: true });
        const filePath = path15.join(dir, `${id}.json`);
        const payload = { id, createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "pending", ...entry };
        writeFileSync3(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
        return { id, filePath, route: "pending" };
      }
      listPending() {
        const dir = pendingDir(this.rootDir);
        if (!existsSync3(dir)) return [];
        return readdirSync2(dir).filter((name) => name.endsWith(".json")).map((name) => {
          const filePath = path15.join(dir, name);
          try {
            const data = JSON.parse(readFileSync3(filePath, "utf8"));
            return { ...data, filePath };
          } catch {
            return null;
          }
        }).filter(Boolean).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      }
      count() {
        const dir = pendingDir(this.rootDir);
        if (!existsSync3(dir)) return 0;
        return readdirSync2(dir).filter((name) => name.endsWith(".json")).length;
      }
      read(id) {
        const dirs = [
          pendingDir(this.rootDir),
          processedDir(this.rootDir),
          skippedDir(this.rootDir),
          quarantineDir(this.rootDir)
        ];
        for (const dir of dirs) {
          const filePath = path15.join(dir, `${id}.json`);
          if (existsSync3(filePath)) {
            const data = JSON.parse(readFileSync3(filePath, "utf8"));
            return { ...data, filePath };
          }
        }
        return null;
      }
      markProcessed(id, { processedBy = "unknown", notes = "" } = {}) {
        const src = path15.join(pendingDir(this.rootDir), `${id}.json`);
        if (!existsSync3(src)) throw new Error(`markProcessed: no pending entry ${id}`);
        const data = JSON.parse(readFileSync3(src, "utf8"));
        data.status = "processed";
        data.processedAt = (/* @__PURE__ */ new Date()).toISOString();
        data.processedBy = processedBy;
        if (notes) data.notes = notes;
        const dst = path15.join(processedDir(this.rootDir), `${id}.json`);
        ensureCxDir(this.rootDir);
        mkdirSync3(path15.dirname(dst), { recursive: true });
        writeFileSync3(dst, JSON.stringify(data, null, 2) + "\n", "utf8");
        rmSync2(src);
        return { id, filePath: dst };
      }
      markSkipped(id, { skippedBy = "unknown", reason = "" } = {}) {
        const src = path15.join(pendingDir(this.rootDir), `${id}.json`);
        if (!existsSync3(src)) throw new Error(`markSkipped: no pending entry ${id}`);
        const data = JSON.parse(readFileSync3(src, "utf8"));
        data.status = "skipped";
        data.skippedAt = (/* @__PURE__ */ new Date()).toISOString();
        data.skippedBy = skippedBy;
        if (reason) data.reason = reason;
        const dst = path15.join(skippedDir(this.rootDir), `${id}.json`);
        ensureCxDir(this.rootDir);
        mkdirSync3(path15.dirname(dst), { recursive: true });
        writeFileSync3(dst, JSON.stringify(data, null, 2) + "\n", "utf8");
        rmSync2(src);
        return { id, filePath: dst };
      }
      reopen(id) {
        for (const dir of [processedDir(this.rootDir), skippedDir(this.rootDir)]) {
          const src = path15.join(dir, `${id}.json`);
          if (!existsSync3(src)) continue;
          const data = JSON.parse(readFileSync3(src, "utf8"));
          data.status = "pending";
          delete data.processedAt;
          delete data.processedBy;
          delete data.notes;
          delete data.skippedAt;
          delete data.skippedBy;
          delete data.reason;
          const dst = path15.join(pendingDir(this.rootDir), `${id}.json`);
          ensureCxDir(this.rootDir);
          mkdirSync3(path15.dirname(dst), { recursive: true });
          writeFileSync3(dst, JSON.stringify(data, null, 2) + "\n", "utf8");
          rmSync2(src);
          return { id, filePath: dst, from: path15.basename(dir) };
        }
        throw new Error(`reopen: no processed or skipped entry ${id}`);
      }
    };
  }
});

// lib/intake/git-queue.mjs
import path16 from "node:path";
import fs14 from "fs";
import { execSync as execSync3 } from "node:child_process";
function slugify2(value) {
  return String(value || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function timestamp2() {
  counter2 = (counter2 + 1) % 1e3;
  const c = String(counter2).padStart(3, "0");
  return `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 23)}-${c}`;
}
var counter2, GitIntakeQueue;
var init_git_queue = __esm({
  "lib/intake/git-queue.mjs"() {
    init_quarantine();
    counter2 = 0;
    GitIntakeQueue = class {
      constructor({ project, rootDir = process.cwd() } = {}) {
        this.project = project;
        this.inboxRoot = path16.join(rootDir, ".cx", "team-inbox");
        this._ensureDirs();
      }
      _ensureDirs() {
        ["pending", "claimed", "processed", "skipped", "quarantine"].forEach((dir) => {
          fs14.mkdirSync(path16.join(this.inboxRoot, dir), { recursive: true });
        });
      }
      _gitAddAndCommit(filePath, message) {
        try {
          execSync3(`git add "${filePath}"`, { stdio: "ignore" });
          execSync3(`git commit -m "${message}"`, { stdio: "ignore" });
        } catch (err) {
        }
      }
      async enqueue(entry) {
        const ts = timestamp2();
        const slug = slugify2(path16.basename(entry.intake.sourcePath, path16.extname(entry.intake.sourcePath)));
        const id = `${ts}-${slug}`;
        const triage = entry.triage || {};
        const quarantineDecision = shouldQuarantine(triage);
        const subDir = quarantineDecision.quarantine ? "quarantine" : "pending";
        const filePath = path16.join(this.inboxRoot, subDir, `${id}.json`);
        const data = {
          id,
          project: this.project,
          status: subDir === "quarantine" ? "quarantined" : "pending",
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          ...entry
        };
        fs14.writeFileSync(filePath, JSON.stringify(data, null, 2));
        this._gitAddAndCommit(filePath, `Enqueue task ${id}`);
        return { id, route: subDir === "quarantine" ? "quarantine" : "pending", reason: quarantineDecision.reason };
      }
      async listPending({ limit = 100 } = {}) {
        const pendingDir2 = path16.join(this.inboxRoot, "pending");
        return fs14.readdirSync(pendingDir2).filter((f) => f.endsWith(".json")).slice(0, limit).map((f) => JSON.parse(fs14.readFileSync(path16.join(pendingDir2, f), "utf8")));
      }
      async count() {
        const pendingDir2 = path16.join(this.inboxRoot, "pending");
        return fs14.readdirSync(pendingDir2).filter((f) => f.endsWith(".json")).length;
      }
      async read(id) {
        for (const dir of ["pending", "claimed", "processed", "skipped", "quarantine"]) {
          const searchPath = dir === "claimed" ? path16.join(this.inboxRoot, dir) : path16.join(this.inboxRoot, dir, `${id}.json`);
          if (dir !== "claimed" && fs14.existsSync(searchPath)) {
            return JSON.parse(fs14.readFileSync(searchPath, "utf8"));
          }
        }
        return null;
      }
      async claim({ claimedBy }) {
        if (!claimedBy) throw new Error("claim: claimedBy is required");
        try {
          execSync3("git pull --rebase", { stdio: "ignore" });
        } catch (e) {
        }
        const pendingDir2 = path16.join(this.inboxRoot, "pending");
        const files = fs14.readdirSync(pendingDir2).filter((f) => f.endsWith(".json")).sort();
        if (files.length === 0) return null;
        const fileName = files[0];
        const pendingPath2 = path16.join(pendingDir2, fileName);
        const workerDir = path16.join(this.inboxRoot, "claimed", claimedBy);
        fs14.mkdirSync(workerDir, { recursive: true });
        const claimedPath = path16.join(workerDir, fileName);
        try {
          fs14.renameSync(pendingPath2, claimedPath);
          const data = JSON.parse(fs14.readFileSync(claimedPath, "utf8"));
          data.status = "claimed";
          data.claimedBy = claimedBy;
          data.claimedAt = (/* @__PURE__ */ new Date()).toISOString();
          fs14.writeFileSync(claimedPath, JSON.stringify(data, null, 2));
          execSync3(`git add .cx/team-inbox/pending/${fileName} .cx/team-inbox/claimed/${claimedBy}/${fileName}`, { stdio: "ignore" });
          execSync3(`git commit -m "Claim task ${data.id} by ${claimedBy}"`, { stdio: "ignore" });
          execSync3("git push", { stdio: "ignore" });
          return data;
        } catch (err) {
          console.error(`Failed to claim ${fileName}: ${err.message}`);
          return null;
        }
      }
      async markProcessed(id, { processedBy = "unknown", notes = "" } = {}) {
        let foundPath = null;
        let currentDir = null;
        const dirs = ["pending", "claimed"];
        for (const d of dirs) {
          const dirPath = path16.join(this.inboxRoot, d);
          if (d === "claimed") {
            const workers = fs14.readdirSync(dirPath);
            for (const w of workers) {
              const p = path16.join(dirPath, w, `${id}.json`);
              if (fs14.existsSync(p)) {
                foundPath = p;
                currentDir = path16.join(d, w);
                break;
              }
            }
          } else {
            const p = path16.join(dirPath, `${id}.json`);
            if (fs14.existsSync(p)) {
              foundPath = p;
              currentDir = d;
              break;
            }
          }
          if (foundPath) break;
        }
        if (!foundPath) throw new Error(`markProcessed: no entry ${id} found`);
        const data = JSON.parse(fs14.readFileSync(foundPath, "utf8"));
        data.status = "processed";
        data.processedBy = processedBy;
        data.processedAt = (/* @__PURE__ */ new Date()).toISOString();
        data.notes = notes;
        const processedPath = path16.join(this.inboxRoot, "processed", `${id}.json`);
        fs14.renameSync(foundPath, processedPath);
        fs14.writeFileSync(processedPath, JSON.stringify(data, null, 2));
        this._gitAddAndCommit(this.inboxRoot, `Mark task ${id} as processed`);
        try {
          execSync3("git push", { stdio: "ignore" });
        } catch (e) {
        }
        return { id };
      }
      // markSkipped and reopen would follow similar logic...
    };
  }
});

// lib/deployment-mode.mjs
function isValidDeploymentMode(value) {
  return typeof value === "string" && DEPLOYMENT_MODES2.includes(value);
}
function getDeploymentMode(env = process.env, { cwd } = {}) {
  const raw = env?.[DEPLOYMENT_MODE_ENV_KEY];
  if (raw) {
    const trimmed = String(raw).trim().toLowerCase();
    return isValidDeploymentMode(trimmed) ? trimmed : DEFAULT_DEPLOYMENT_MODE;
  }
  try {
    const { config } = loadProjectConfig(cwd, env);
    const fromConfig = config?.deployment?.mode;
    if (typeof fromConfig === "string" && isValidDeploymentMode(fromConfig)) return fromConfig;
  } catch {
  }
  return DEFAULT_DEPLOYMENT_MODE;
}
var DEPLOYMENT_MODES2, DEFAULT_DEPLOYMENT_MODE, DEPLOYMENT_MODE_ENV_KEY;
var init_deployment_mode = __esm({
  "lib/deployment-mode.mjs"() {
    init_project_config();
    DEPLOYMENT_MODES2 = ["solo", "team", "enterprise"];
    DEFAULT_DEPLOYMENT_MODE = "solo";
    DEPLOYMENT_MODE_ENV_KEY = "CONSTRUCT_DEPLOYMENT_MODE";
  }
});

// lib/intake/queue.mjs
import path17 from "node:path";
function resolveBackend(env) {
  const override = env?.[INTAKE_QUEUE_BACKEND_ENV_KEY];
  if (override === "filesystem" || override === "git") return override;
  const mode = getDeploymentMode(env);
  return mode === "solo" ? "filesystem" : "git";
}
function resolveProject(rootDir, env) {
  const explicit = env?.[INTAKE_PROJECT_ENV_KEY];
  if (explicit && explicit.trim()) return explicit.trim();
  return path17.basename(path17.resolve(rootDir)).trim() || "construct";
}
function createIntakeQueue(rootDir, env = process.env, opts = {}) {
  const backend = opts.backend || resolveBackend(env);
  if (backend === "filesystem") return new FilesystemIntakeQueue(rootDir);
  if (backend === "git" || backend === "postgres") {
    const project = opts.project ?? resolveProject(rootDir, env);
    return new GitIntakeQueue({ project, rootDir });
  }
  throw new Error(`Unknown intake queue backend: ${backend}`);
}
var INTAKE_QUEUE_BACKEND_ENV_KEY, INTAKE_PROJECT_ENV_KEY;
var init_queue = __esm({
  "lib/intake/queue.mjs"() {
    init_filesystem_queue();
    init_git_queue();
    init_deployment_mode();
    INTAKE_QUEUE_BACKEND_ENV_KEY = "CONSTRUCT_INTAKE_QUEUE_BACKEND";
    INTAKE_PROJECT_ENV_KEY = "CONSTRUCT_PROJECT_NAME";
  }
});

// lib/intake/tables/rnd.mjs
var INTAKE_TYPES, STAGES, UNKNOWN_TRIAGE, CLASSIFICATION_TABLE, rnd_default;
var init_rnd = __esm({
  "lib/intake/tables/rnd.mjs"() {
    INTAKE_TYPES = [
      "user-signal",
      "bug",
      "requirement",
      "research",
      "experiment",
      "eval-finding",
      "architecture",
      "incident",
      "launch-asset",
      "ops",
      "security",
      "legal-compliance",
      "memo",
      "transcript",
      "raw-data",
      "unknown"
    ];
    STAGES = [
      "signal",
      "framing",
      "hypothesis",
      "research",
      "artifact",
      "design",
      "implementation",
      "evaluation",
      "release",
      "operations",
      "unknown"
    ];
    UNKNOWN_TRIAGE = {
      intakeType: "unknown",
      rdStage: "unknown",
      primaryOwner: "orchestrator",
      recommendedChain: ["orchestrator"],
      recommendedAction: "summarize",
      risk: "low",
      requiresApproval: false
    };
    CLASSIFICATION_TABLE = [
      {
        intakeType: "security",
        keywords: ["security", "secret", "cve", "vulnerability", "vuln", "exploit", "leak", "auth bypass", "privilege escalation", "sqli", "xss", "csrf", "rce"],
        rdStage: "operations",
        primaryOwner: "security",
        recommendedChain: ["security", "engineer", "reviewer"],
        recommendedAction: "diagnose",
        risk: "high",
        requiresApproval: true
      },
      {
        intakeType: "incident",
        keywords: ["incident", "outage", "slo breach", "sla breach", "latency spike", "availability", "down", "p0 ", "p1 ", "pagerduty", "5xx", "oncall"],
        rdStage: "operations",
        primaryOwner: "sre",
        recommendedChain: ["sre", "debugger", "platform-engineer"],
        recommendedAction: "create-runbook",
        risk: "high",
        requiresApproval: true
      },
      {
        intakeType: "legal-compliance",
        keywords: ["gdpr", "ccpa", "hipaa", "sox", "soc2", "license", "lawsuit", "dpa", "data retention", "pii", "subpoena", "compliance audit"],
        rdStage: "operations",
        primaryOwner: "legal-compliance",
        recommendedChain: ["legal-compliance", "security", "product-manager"],
        recommendedAction: "clarify",
        risk: "high",
        requiresApproval: true
      },
      {
        intakeType: "architecture",
        keywords: ["architecture", "adr", "rfc", "interface", "tradeoff", "boundary", "system design", "data model", "api contract", "migration plan"],
        rdStage: "design",
        primaryOwner: "architect",
        recommendedChain: ["architect", "devil-advocate", "engineer"],
        recommendedAction: "draft-rfc",
        risk: "medium",
        requiresApproval: false
      },
      {
        intakeType: "eval-finding",
        keywords: ["eval", "evaluation", "hallucination", "judge", "trace", "score regression", "recall@", "precision@", "mrr", "ndcg", "failure case", "rubric"],
        rdStage: "evaluation",
        primaryOwner: "evaluator",
        recommendedChain: ["evaluator", "ai-engineer", "trace-reviewer"],
        recommendedAction: "evaluate",
        risk: "medium",
        requiresApproval: false
      },
      {
        intakeType: "bug",
        keywords: ["bug", "broken", "error", "stack trace", "regression", "crash", "exception", "fails", "failing", "throws", "not working", "reproduce", "repro:"],
        rdStage: "implementation",
        primaryOwner: "debugger",
        recommendedChain: ["debugger", "engineer", "qa", "reviewer"],
        recommendedAction: "diagnose",
        risk: "medium",
        requiresApproval: false
      },
      {
        intakeType: "experiment",
        keywords: ["hypothesis", "experiment", "spike", "prototype", "falsifiable", "research question", "a/b test", "pilot"],
        rdStage: "hypothesis",
        primaryOwner: "rd-lead",
        recommendedChain: ["rd-lead", "researcher", "evaluator"],
        recommendedAction: "create-experiment",
        risk: "low",
        requiresApproval: false
      },
      {
        intakeType: "launch-asset",
        keywords: ["release", "changelog", "version bump", "ship", "launch", "rollout", "cut a release", "rc1", "rc2", "release candidate"],
        rdStage: "release",
        primaryOwner: "release-manager",
        recommendedChain: ["release-manager", "qa", "docs-keeper"],
        recommendedAction: "release-review",
        risk: "medium",
        requiresApproval: false
      },
      {
        intakeType: "research",
        keywords: ["competitor", "market", "pricing", "positioning", "industry", "state of the art", "literature", "benchmark study", "desk research"],
        rdStage: "research",
        primaryOwner: "business-strategist",
        recommendedChain: ["business-strategist", "researcher", "product-manager"],
        recommendedAction: "research",
        risk: "low",
        requiresApproval: false
      },
      {
        intakeType: "user-signal",
        keywords: ["customer", "feedback", "pain point", "user says", "user feedback", "support ticket", "churn", "nps", "usability", "frustrated"],
        rdStage: "signal",
        primaryOwner: "product-manager",
        recommendedChain: ["product-manager", "ux-researcher", "researcher"],
        recommendedAction: "clarify",
        risk: "low",
        requiresApproval: false
      },
      {
        intakeType: "requirement",
        keywords: ["acceptance criteria", "requirement", "must have", "should have", "feature request", "prd", "use case", "success metric"],
        rdStage: "framing",
        primaryOwner: "product-manager",
        recommendedChain: ["product-manager", "architect", "engineer"],
        recommendedAction: "draft-prd",
        risk: "low",
        requiresApproval: false
      },
      {
        intakeType: "ops",
        keywords: ["runbook", "cron", "scheduled job", "maintenance", "backup", "restore", "capacity plan", "cost optimization", "dependency upgrade"],
        rdStage: "operations",
        primaryOwner: "operations",
        recommendedChain: ["operations", "sre", "engineer"],
        recommendedAction: "create-runbook",
        risk: "low",
        requiresApproval: false
      },
      {
        intakeType: "memo",
        keywords: ["memo", "decision memo", "for your information", "fyi", "action item", "action items", "status update", "weekly update", "announcement", "heads up", "team update", "decided to", "proposal to"],
        rdStage: "artifact",
        primaryOwner: "docs-keeper",
        recommendedChain: ["docs-keeper", "reviewer"],
        recommendedAction: "summarize",
        risk: "low",
        requiresApproval: false
      },
      {
        intakeType: "transcript",
        keywords: ["transcript", "webvtt", "meeting notes", "meeting minutes", "minutes of", "attendees", "call notes", "stand-up notes", "standup notes", "recording of", "speaker 1", "speaker 2"],
        rdStage: "signal",
        primaryOwner: "researcher",
        recommendedChain: ["researcher", "data-analyst"],
        recommendedAction: "summarize",
        risk: "low",
        requiresApproval: false
      },
      {
        intakeType: "raw-data",
        keywords: ["dataset", "raw data", "data dump", "csv export", "data export", "column names", "field names", "rows and columns", "records export", "telemetry export", "json export"],
        rdStage: "research",
        primaryOwner: "data-analyst",
        recommendedChain: ["data-analyst", "data-engineer"],
        recommendedAction: "summarize",
        risk: "low",
        requiresApproval: false
      }
    ];
    rnd_default = { INTAKE_TYPES, STAGES, CLASSIFICATION_TABLE, UNKNOWN_TRIAGE };
  }
});

// lib/intake/tables/operations.mjs
var init_operations = __esm({
  "lib/intake/tables/operations.mjs"() {
  }
});

// lib/intake/tables/creative.mjs
var init_creative = __esm({
  "lib/intake/tables/creative.mjs"() {
  }
});

// lib/intake/tables/research.mjs
var init_research = __esm({
  "lib/intake/tables/research.mjs"() {
  }
});

// lib/intake/classify.mjs
import path18 from "node:path";
function formatTriageLine(sourcePath, triage) {
  const basename = sourcePath ? path18.basename(sourcePath) : "(unknown source)";
  if (!triage || triage.intakeType === "unknown") {
    return `${basename} \u2192 unclassified \xB7 owner: ${triage?.primaryOwner ?? "orchestrator"} \xB7 next: ${triage?.recommendedAction ?? "summarize"}`;
  }
  const ownerLabel = triage.primaryOwner ?? "unassigned";
  return `${basename} \u2192 ${triage.intakeType} / ${triage.rdStage} \xB7 owner: ${ownerLabel} \xB7 next: ${triage.recommendedAction}`;
}
var INTAKE_TYPES2, RD_STAGES;
var init_classify = __esm({
  "lib/intake/classify.mjs"() {
    init_rnd();
    init_operations();
    init_creative();
    init_research();
    INTAKE_TYPES2 = rnd_default.INTAKE_TYPES;
    RD_STAGES = rnd_default.STAGES;
  }
});

// lib/policy/engine.mjs
import path19 from "node:path";
import { fileURLToPath } from "node:url";
var MODULE_DIR, DEFAULT_MANIFEST_PATH;
var init_engine = __esm({
  "lib/policy/engine.mjs"() {
    MODULE_DIR = path19.dirname(fileURLToPath(import.meta.url));
    DEFAULT_MANIFEST_PATH = path19.join(MODULE_DIR, "..", "..", "specialists", "role-manifests.json");
  }
});

// lib/telemetry/ingest.mjs
var init_ingest = __esm({
  "lib/telemetry/ingest.mjs"() {
  }
});

// lib/telemetry/client.mjs
var init_client = __esm({
  "lib/telemetry/client.mjs"() {
    init_ingest();
    init_project_init_shared();
  }
});

// lib/logging/rotate.mjs
var LIMITS;
var init_rotate = __esm({
  "lib/logging/rotate.mjs"() {
    LIMITS = {
      // Trace shards under .cx/traces/<date>.jsonl — capped below GitHub's
      // 100 MB single-file ceiling. Bead construct-1vv5.
      trace: {
        maxBytes: 100 * 1024 * 1024,
        maxSegments: 0,
        // keep all history; rotation is for the size cap, not retention
        gzip: false,
        envOverride: "CONSTRUCT_TRACE_MAX_MB"
      },
      // OS-supervised stdout log at ~/.cx/runtime/embed-daemon.log. Bead
      // construct-88i. Rotation is poll-style via the daemon scheduler.
      "embed-daemon-log": {
        maxBytes: 50 * 1024 * 1024,
        maxSegments: 5,
        gzip: true,
        envOverride: "CONSTRUCT_EMBED_LOG_MAX_MB"
      },
      // Per-edit audit of file reads. High traffic in active sessions.
      // ~/.cx/audit-reads.jsonl.
      "audit-reads": {
        maxBytes: 25 * 1024 * 1024,
        maxSegments: 4,
        gzip: true,
        envOverride: "CONSTRUCT_AUDIT_READS_MAX_MB"
      },
      // Per-skill-call telemetry. ~/.cx/skill-calls.jsonl.
      "skill-calls": {
        maxBytes: 25 * 1024 * 1024,
        maxSegments: 4,
        gzip: true,
        envOverride: "CONSTRUCT_SKILL_CALLS_MAX_MB"
      },
      // Per-hook fire/block/error telemetry. ~/.cx/hook-calls.jsonl.
      "hook-calls": {
        maxBytes: 25 * 1024 * 1024,
        maxSegments: 4,
        gzip: true,
        envOverride: "CONSTRUCT_HOOK_CALLS_MAX_MB"
      },
      // Rule path reference telemetry. ~/.cx/rule-calls.jsonl.
      "rule-calls": {
        maxBytes: 10 * 1024 * 1024,
        maxSegments: 2,
        gzip: true,
        envOverride: "CONSTRUCT_RULE_CALLS_MAX_MB"
      },
      // Legacy-lock fallback firings on the beads write path. ~/.cx/beads-fallback.jsonl.
      "beads-fallback": {
        maxBytes: 5 * 1024 * 1024,
        maxSegments: 2,
        gzip: true,
        envOverride: "CONSTRUCT_BEADS_FALLBACK_MAX_MB"
      },
      // Agent-dispatch log written by `lib/hooks/agent-tracker.mjs`. Path: ~/.cx/agent-log.jsonl.
      "agent-log": {
        maxBytes: 25 * 1024 * 1024,
        maxSegments: 4,
        gzip: true,
        envOverride: "CONSTRUCT_AGENT_LOG_MAX_MB"
      },
      // Pending role invocations across all projects. ~/.cx/role-pending.jsonl.
      "role-pending": {
        maxBytes: 10 * 1024 * 1024,
        maxSegments: 2,
        gzip: true,
        envOverride: "CONSTRUCT_ROLE_PENDING_MAX_MB"
      },
      // Intent verifications. ~/.cx/intent-verifications.jsonl.
      "intent-verifications": {
        maxBytes: 10 * 1024 * 1024,
        maxSegments: 2,
        gzip: true,
        envOverride: "CONSTRUCT_INTENT_VERIFICATIONS_MAX_MB"
      },
      // Contract postcondition violations. ~/.cx/contract-violations.jsonl.
      "contract-violations": {
        maxBytes: 10 * 1024 * 1024,
        maxSegments: 2,
        gzip: true,
        envOverride: "CONSTRUCT_CONTRACT_VIOLATIONS_MAX_MB"
      },
      // Bash-output warning flags appended by the bash-output-logger hook on
      // every Bash tool use over the size threshold. ~/.cx/warn-flags.txt.
      "bash-warn-flags": {
        maxBytes: 5 * 1024 * 1024,
        maxSegments: 2,
        gzip: false,
        envOverride: "CONSTRUCT_BASH_WARN_FLAGS_MAX_MB"
      },
      // Per-turn cost ledger written by the Stop hook. Cross-project (so the
      // user has one place to see spend across every project) — each entry
      // carries a projectId tag so readers can split by project. Path:
      // ~/.cx/session-cost.jsonl.
      "session-cost": {
        maxBytes: 25 * 1024 * 1024,
        maxSegments: 4,
        gzip: true,
        envOverride: "CONSTRUCT_SESSION_COST_MAX_MB"
      },
      // Tamper-evident audit trail of every mutation Construct (or a dispatched
      // subagent) makes. Project-scoped. Path: <project>/.cx/audit-trail.jsonl.
      "audit-trail": {
        maxBytes: 50 * 1024 * 1024,
        maxSegments: 4,
        gzip: true,
        envOverride: "CONSTRUCT_AUDIT_TRAIL_MAX_MB"
      },
      // Pending typecheck queue written by the edit-accumulator hook on every
      // Edit/Write of a TS/JS file. Path: ~/.cx/pending-typecheck.txt.
      "edit-accumulator": {
        maxBytes: 5 * 1024 * 1024,
        maxSegments: 2,
        gzip: false,
        envOverride: "CONSTRUCT_EDIT_ACCUMULATOR_MAX_MB"
      }
    };
  }
});

// lib/resources/budget.mjs
var init_budget = __esm({
  "lib/resources/budget.mjs"() {
    init_project_config();
  }
});

// lib/worker/trace.mjs
var init_trace = __esm({
  "lib/worker/trace.mjs"() {
    init_client();
    init_project_init_shared();
    init_rotate();
    init_budget();
  }
});

// lib/mcp/broker.mjs
function isBrokered(env = process.env) {
  const override = env?.CONSTRUCT_MCP_BROKER;
  if (override === "on") return true;
  if (override === "off") return false;
  const mode = env?.CONSTRUCT_DEPLOYMENT_MODE || "solo";
  return mode === "team" || mode === "enterprise";
}
var init_broker = __esm({
  "lib/mcp/broker.mjs"() {
    init_engine();
    init_trace();
  }
});

// lib/profiles/loader.mjs
import { existsSync as existsSync4, readFileSync as readFileSync4, readdirSync as readdirSync3 } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function loadProfile(id) {
  if (!id || typeof id !== "string") return null;
  const path37 = join2(PROFILES_DIR, `${id}.json`);
  if (!existsSync4(path37)) return null;
  try {
    const raw = JSON.parse(readFileSync4(path37, "utf8"));
    return raw;
  } catch {
    return null;
  }
}
function loadCustomProfile(cwd) {
  if (!cwd) return null;
  const path37 = join2(cwd, ".cx", "profile.json");
  if (!existsSync4(path37)) return null;
  try {
    const raw = JSON.parse(readFileSync4(path37, "utf8"));
    if (raw && raw.custom === true) return raw;
    return null;
  } catch {
    return null;
  }
}
function resolveActiveProfile(cwd, configProfileId = null) {
  if (configProfileId) {
    const p = loadProfile(configProfileId);
    if (p) return p;
  }
  const custom = loadCustomProfile(cwd);
  if (custom) return custom;
  const fromConfig = readProfileFromProjectConfig(cwd);
  if (fromConfig) {
    const p = loadProfile(fromConfig);
    if (p) return p;
  }
  return loadProfile(DEFAULT_PROFILE_ID2) ?? minimalRndFallback();
}
function readProfileFromProjectConfig(cwd) {
  if (!cwd) return null;
  const p = join2(cwd, "construct.config.json");
  if (!existsSync4(p)) return null;
  try {
    const raw = JSON.parse(readFileSync4(p, "utf8"));
    return typeof raw?.profile === "string" ? raw.profile : null;
  } catch {
    return null;
  }
}
function minimalRndFallback() {
  return {
    id: "rnd",
    displayName: "Software R&D",
    roles: [],
    intake: { types: [], stages: [] },
    docTemplates: [],
    hooks: { sessionReflect: "on", sessionOptimize: "on" },
    rebrand: { intakeQueueLabel: "R&D intake queue", signalNoun: "signal" }
  };
}
var MODULE_DIR2, REPO_ROOT, PROFILES_DIR, DEFAULT_PROFILE_ID2;
var init_loader = __esm({
  "lib/profiles/loader.mjs"() {
    MODULE_DIR2 = dirname(fileURLToPath2(import.meta.url));
    REPO_ROOT = resolve(MODULE_DIR2, "..", "..");
    PROFILES_DIR = join2(REPO_ROOT, "profiles");
    DEFAULT_PROFILE_ID2 = "rnd";
  }
});

// lib/profiles/rebrand.mjs
function getRebrand(rootDir) {
  if (!rootDir || typeof rootDir !== "string") return { ...DEFAULT_REBRAND };
  try {
    const profile = resolveActiveProfile(rootDir);
    const rb = profile?.rebrand;
    if (!rb || typeof rb !== "object") return { ...DEFAULT_REBRAND };
    const intakeQueueLabel = typeof rb.intakeQueueLabel === "string" && rb.intakeQueueLabel.trim() ? rb.intakeQueueLabel.trim() : DEFAULT_REBRAND.intakeQueueLabel;
    const signalNoun = typeof rb.signalNoun === "string" && rb.signalNoun.trim() ? rb.signalNoun.trim() : DEFAULT_REBRAND.signalNoun;
    return { intakeQueueLabel, signalNoun };
  } catch {
    return { ...DEFAULT_REBRAND };
  }
}
var DEFAULT_REBRAND;
var init_rebrand = __esm({
  "lib/profiles/rebrand.mjs"() {
    init_loader();
    DEFAULT_REBRAND = Object.freeze({
      intakeQueueLabel: "Intake queue",
      signalNoun: "signal"
    });
  }
});

// lib/daemons/contract.mjs
var DEFAULT_MAX_RUNTIME_MS;
var init_contract = __esm({
  "lib/daemons/contract.mjs"() {
    DEFAULT_MAX_RUNTIME_MS = 24 * 60 * 60 * 1e3;
  }
});

// lib/resources/process-budget.mjs
var init_process_budget = __esm({
  "lib/resources/process-budget.mjs"() {
    init_project_config();
    init_contract();
  }
});

// lib/parity.mjs
import path20 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var MODULE_DIR3, ROOT_DIR;
var init_parity = __esm({
  "lib/parity.mjs"() {
    MODULE_DIR3 = path20.dirname(fileURLToPath3(import.meta.url));
    ROOT_DIR = path20.resolve(MODULE_DIR3, "..");
  }
});

// lib/embedded-contract/workflow-defs.mjs
var DEFS, WORKFLOW_TYPES;
var init_workflow_defs = __esm({
  "lib/embedded-contract/workflow-defs.mjs"() {
    DEFS = {
      "evidence-ingest": {
        tier: "fast",
        defaultApprovalMode: "proposal-only",
        chain: ["researcher", "data-analyst"],
        outputSchema: null,
        description: "Ingest and structure raw evidence (notes, documents, signals) into a normalized summary."
      },
      "proposal-review": {
        tier: "standard",
        defaultApprovalMode: "requires-human-approval",
        chain: ["reviewer", "devil-advocate"],
        outputSchema: "review-report",
        description: "Review a proposal for correctness, risk, and hidden assumptions before acceptance."
      },
      "prd-draft": {
        tier: "standard",
        defaultApprovalMode: "proposal-only",
        chain: ["product-manager", "architect"],
        outputSchema: "decision",
        description: "Draft a product requirements document from a problem statement and supporting evidence."
      },
      "architecture-review": {
        tier: "reasoning",
        defaultApprovalMode: "requires-human-approval",
        chain: ["architect", "security", "devil-advocate"],
        outputSchema: "review-report",
        description: "Review an architecture or design for trade-offs, failure modes, and security exposure."
      },
      "risk-review": {
        tier: "reasoning",
        defaultApprovalMode: "requires-human-approval",
        chain: ["devil-advocate", "security", "legal-compliance"],
        outputSchema: "review-report",
        description: "Stress-test a plan for risk: failure modes, security, and compliance exposure."
      },
      "research-synthesis": {
        tier: "reasoning",
        defaultApprovalMode: "proposal-only",
        chain: ["researcher", "data-analyst", "evaluator"],
        outputSchema: null,
        description: "Synthesize multiple sources into a cited, evidence-graded research summary."
      },
      "transcript-process": {
        tier: "fast",
        defaultApprovalMode: "proposal-only",
        chain: ["researcher", "data-analyst"],
        outputSchema: null,
        description: "Process a meeting/call transcript into a summary, decisions, and action items."
      },
      "data-structure": {
        tier: "standard",
        defaultApprovalMode: "proposal-only",
        chain: ["data-analyst", "data-engineer"],
        outputSchema: null,
        description: "Parse, validate, and profile a raw dataset into a structured, described shape."
      },
      "memo-draft": {
        tier: "fast",
        defaultApprovalMode: "proposal-only",
        chain: ["docs-keeper", "reviewer"],
        outputSchema: null,
        description: "Draft a decision or status memo from a problem statement and context."
      },
      "structure-notes": {
        tier: "fast",
        defaultApprovalMode: "proposal-only",
        chain: ["orchestrator", "researcher"],
        outputSchema: null,
        description: "Structure an unclassified brain-dump or rough notes into a normalized summary with extracted intents."
      }
    };
    WORKFLOW_TYPES = Object.keys(DEFS);
  }
});

// lib/artifact-manifest.mjs
import fs15 from "node:fs";
import path21 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
function manifestPathForRoot(root) {
  return path21.join(root, "specialists", "artifact-manifest.json");
}
function findConstructRoot(startPath = process.cwd()) {
  let current = path21.resolve(startPath);
  while (true) {
    const manifest = manifestPathForRoot(current);
    if (fs15.existsSync(manifest)) return current;
    const parent = path21.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (fs15.existsSync(manifestPathForRoot(PACKAGE_ROOT))) return PACKAGE_ROOT;
  return null;
}
function loadArtifactManifest({ rootDir, force = false, cwd = process.cwd() } = {}) {
  const resolvedRoot = rootDir ?? findConstructRoot(cwd) ?? PACKAGE_ROOT;
  if (cached && !force && cachedRoot === resolvedRoot) return cached;
  const p = manifestPathForRoot(resolvedRoot);
  if (!fs15.existsSync(p)) {
    cached = EMPTY_MANIFEST;
    cachedRoot = resolvedRoot;
    return cached;
  }
  cached = JSON.parse(fs15.readFileSync(p, "utf8"));
  cachedRoot = resolvedRoot;
  return cached;
}
function artifactTypes(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  return Object.keys(manifest.artifacts ?? {});
}
function structureRequirementsFromManifest(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  const out = {};
  for (const [type, entry] of Object.entries(manifest.artifacts ?? {})) {
    if (entry.structureRequirements?.length) out[type] = entry.structureRequirements;
  }
  return out;
}
function visualRequirementsFromManifest(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  const out = {};
  for (const [type, entry] of Object.entries(manifest.artifacts ?? {})) {
    if (entry.visualRequirements?.length) out[type] = entry.visualRequirements;
  }
  return out;
}
var PACKAGE_ROOT, EMPTY_MANIFEST, cached, cachedRoot;
var init_artifact_manifest = __esm({
  "lib/artifact-manifest.mjs"() {
    PACKAGE_ROOT = path21.resolve(path21.dirname(fileURLToPath4(import.meta.url)), "..");
    EMPTY_MANIFEST = { version: 1, artifacts: {} };
    cached = null;
    cachedRoot = null;
  }
});

// lib/artifact-type-from-path.mjs
var KNOWN;
var init_artifact_type_from_path = __esm({
  "lib/artifact-type-from-path.mjs"() {
    init_artifact_manifest();
    KNOWN = new Set(artifactTypes());
  }
});

// lib/artifact-reviewers.mjs
var init_artifact_reviewers = __esm({
  "lib/artifact-reviewers.mjs"() {
    init_artifact_manifest();
    init_artifact_type_from_path();
  }
});

// lib/specialists/postconditions.mjs
function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isLaterOrEqual(a, b) {
  const ta = a instanceof Date ? a.getTime() : Date.parse(a);
  const tb = b instanceof Date ? b.getTime() : Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta >= tb;
}
var ROOT_CAUSE_SOURCES, POSTCONDITIONS;
var init_postconditions = __esm({
  "lib/specialists/postconditions.mjs"() {
    ROOT_CAUSE_SOURCES = /* @__PURE__ */ new Set(["reproduction", "trace", "test"]);
    POSTCONDITIONS = {
      "cx-reviewer": [
        {
          id: "reviewer.findings-or-explicit-clear",
          description: 'Reviewer must either return at least one finding or explicitly state "no issues found at: <paths>".',
          check: (p) => isNonEmptyArray(p?.findings) || isNonEmptyArray(p?.noIssuesFoundAt) || isNonEmptyString(p?.noIssuesFoundStatement),
          reason: 'Reviewer output rubber-stamped: empty findings and no explicit "no issues found at: <paths>" statement.'
        }
      ],
      "cx-security": [
        {
          id: "security.threat-model-not-post-hoc",
          description: "Threat model must be updated at or after the contract start (not retrofitted).",
          check: (p) => {
            if (!p?.threatModelUpdatedAt || !p?.contractStart) return false;
            return isLaterOrEqual(p.threatModelUpdatedAt, p.contractStart);
          },
          reason: "Threat model missing or older than the contract start \u2014 likely retrofitted after implementation."
        }
      ],
      "cx-debugger": [
        {
          id: "debugger.root-cause-confirmed-via",
          description: "Root cause must be confirmed via reproduction, trace, or test (not inferred).",
          check: (p) => typeof p?.rootCauseConfirmedVia === "string" && ROOT_CAUSE_SOURCES.has(p.rootCauseConfirmedVia),
          reason: `rootCauseConfirmedVia must be one of: ${[...ROOT_CAUSE_SOURCES].join(", ")}.`
        }
      ],
      "cx-docs-keeper": [
        {
          id: "docs-keeper.cross-doc-coherence-check-ran",
          description: "Docs-keeper must run the cross-doc coherence check and attach a named diff.",
          check: (p) => p?.crossDocCoherenceCheckRan === true && isNonEmptyString(p?.coherenceDiff),
          reason: "crossDocCoherenceCheckRan must be true AND coherenceDiff must be a non-empty named diff."
        }
      ],
      "cx-designer": [
        {
          id: "designer.accessibility-check-ran",
          description: "Designer must run the accessibility check before handoff (no post-hoc a11y).",
          check: (p) => p?.accessibilityCheckRan === true,
          reason: "accessibilityCheckRan must be true \u2014 accessibility review is a precondition for any visual deliverable."
        }
      ]
    };
  }
});

// lib/contracts/violation-log.mjs
import { join as join3, dirname as dirname2 } from "node:path";
import { homedir as homedir2 } from "node:os";
var CX_DIR, LAST_AGENT;
var init_violation_log = __esm({
  "lib/contracts/violation-log.mjs"() {
    init_rotate();
    init_project_root();
    CX_DIR = join3(homedir2(), ".cx");
    LAST_AGENT = join3(CX_DIR, "last-agent.json");
  }
});

// lib/contracts/validate.mjs
import { join as join4, dirname as dirname3, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";
var REPO_ROOT2, CONTRACTS_PATH, CONTRACTS_SCHEMA_PATH, REGISTRY_PATH;
var init_validate = __esm({
  "lib/contracts/validate.mjs"() {
    init_artifact_reviewers();
    init_artifact_type_from_path();
    init_postconditions();
    init_violation_log();
    REPO_ROOT2 = resolve2(dirname3(fileURLToPath5(import.meta.url)), "..", "..");
    CONTRACTS_PATH = join4(REPO_ROOT2, "specialists", "contracts.json");
    CONTRACTS_SCHEMA_PATH = join4(REPO_ROOT2, "specialists", "contracts.schema.json");
    REGISTRY_PATH = join4(REPO_ROOT2, "specialists", "registry.json");
  }
});

// lib/templates/visual-requirements.mjs
var LEGACY_STRUCTURE, STRUCTURE_REQUIREMENTS, VISUAL_REQUIREMENTS;
var init_visual_requirements = __esm({
  "lib/templates/visual-requirements.mjs"() {
    init_validate();
    init_artifact_manifest();
    LEGACY_STRUCTURE = {
      "persona-artifact": ["Goals", "Frustrations", "Decision rights", "Output contract", "Failure modes", "Evidence"],
      "skill-artifact": ["What this skill produces", "When to invoke it", "Competency rubric", "Failure modes", "Worked example"],
      "research-finding": ["SOURCES", "FINDINGS", "INFERENCES", "CONFIDENCE", "GAPS", "RECOMMENDATION"]
    };
    STRUCTURE_REQUIREMENTS = {
      ...structureRequirementsFromManifest(),
      ...LEGACY_STRUCTURE
    };
    VISUAL_REQUIREMENTS = {
      ...visualRequirementsFromManifest()
    };
  }
});

// lib/registry/validate.mjs
import path22 from "node:path";
import { fileURLToPath as fileURLToPath6 } from "node:url";
var MODULE_DIR4, REPO_ROOT3, REGISTRY_PATH2, STALE_MS;
var init_validate2 = __esm({
  "lib/registry/validate.mjs"() {
    init_workflow_defs();
    init_visual_requirements();
    MODULE_DIR4 = path22.dirname(fileURLToPath6(import.meta.url));
    REPO_ROOT3 = path22.resolve(MODULE_DIR4, "..", "..");
    REGISTRY_PATH2 = path22.join(REPO_ROOT3, "registry", "capabilities.json");
    STALE_MS = 90 * 24 * 60 * 60 * 1e3;
  }
});

// lib/host-disposition.mjs
import fs16 from "node:fs";
import path23 from "node:path";
function isConstructPackageRepo(dir) {
  try {
    const pkgPath = path23.join(dir, "package.json");
    if (!fs16.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs16.readFileSync(pkgPath, "utf8"));
    if (!pkg) return false;
    if (pkg.name === "construct" || pkg.name === "@geraldmaron/construct") return true;
    return pkg.bin && (pkg.bin === "bin/construct" || typeof pkg.bin === "object" && pkg.bin.construct === "bin/construct");
  } catch {
    return false;
  }
}
var init_host_disposition = __esm({
  "lib/host-disposition.mjs"() {
  }
});

// lib/init/detect-existing-structure.mjs
var init_detect_existing_structure = __esm({
  "lib/init/detect-existing-structure.mjs"() {
  }
});

// lib/specialist-contracts.mjs
import { dirname as dirname4, join as join5, resolve as resolve3 } from "node:path";
import { fileURLToPath as fileURLToPath7 } from "node:url";
var MODULE_DIR5, REPO_ROOT4, CONTRACTS_PATH2;
var init_specialist_contracts = __esm({
  "lib/specialist-contracts.mjs"() {
    MODULE_DIR5 = dirname4(fileURLToPath7(import.meta.url));
    REPO_ROOT4 = resolve3(MODULE_DIR5, "..");
    CONTRACTS_PATH2 = join5(REPO_ROOT4, "specialists", "contracts.json");
  }
});

// lib/telemetry/intent-verifications.mjs
import os9 from "node:os";
import path24 from "node:path";
var DEFAULT_LOG_PATH;
var init_intent_verifications = __esm({
  "lib/telemetry/intent-verifications.mjs"() {
    init_rotate();
    init_project_root();
    DEFAULT_LOG_PATH = path24.join(os9.homedir(), ".cx", "intent-verifications.jsonl");
  }
});

// lib/intent-classifier.mjs
var init_intent_classifier = __esm({
  "lib/intent-classifier.mjs"() {
    init_model_router();
    init_env_config();
    init_intent_verifications();
  }
});

// lib/orchestration/routing-tables.mjs
import { fileURLToPath as fileURLToPath8 } from "node:url";
var REGISTRY_PATH3;
var init_routing_tables = __esm({
  "lib/orchestration/routing-tables.mjs"() {
    init_project_root();
    REGISTRY_PATH3 = fileURLToPath8(new URL("../../specialists/registry.json", import.meta.url));
  }
});

// lib/orchestration-policy.mjs
var init_orchestration_policy = __esm({
  "lib/orchestration-policy.mjs"() {
    init_specialist_contracts();
    init_intent_classifier();
    init_routing_tables();
    init_artifact_manifest();
    init_routing_tables();
  }
});

// lib/workflow-state.mjs
import fs17 from "node:fs";
import path25 from "node:path";
import { execSync as execSync4 } from "node:child_process";
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
  return (/* @__PURE__ */ new Date()).toISOString();
}
function slugify3(value) {
  return String(value || "workflow").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "workflow";
}
function projectName(root) {
  try {
    const remote = execSync4("git remote get-url origin", { cwd: root, timeout: 3e3, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const match = remote.match(/[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
    if (match) return match[1];
  } catch {
  }
  return path25.basename(root);
}
function workflowPath(root = process.cwd()) {
  return path25.join(root, ".cx", "workflow.json");
}
function defaultWorkflow(root = process.cwd(), title = "Untitled workflow", specRef = null) {
  const id = `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}-${slugify3(title)}`;
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
function loadWorkflow(root = process.cwd()) {
  const file = workflowPath(root);
  if (!fs17.existsSync(file)) return null;
  return normalizeWorkflow(JSON.parse(fs17.readFileSync(file, "utf8")));
}
function saveWorkflow(workflow, root = process.cwd()) {
  const file = workflowPath(root);
  fs17.mkdirSync(path25.dirname(file), { recursive: true });
  const normalized = {
    ...normalizeWorkflow(structuredClone(workflow)),
    updatedAt: now()
  };
  fs17.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}
`, "utf8");
  return normalized;
}
function initWorkflow(root = process.cwd(), title = "Untitled workflow", specRef = null) {
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
function addTask(root, options) {
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
function parseCommaSeparated(value) {
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}
function slugifyTitle(title, usedKeys) {
  const base = slugify3(title);
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
  const usedKeys = /* @__PURE__ */ new Set();
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
      acceptanceCriteria = defaultAcceptanceCriteria.length ? defaultAcceptanceCriteria : [`Complete: ${title}`];
    } else if (defaultAcceptanceCriteria.length) {
      acceptanceCriteria = [...acceptanceCriteria, ...defaultAcceptanceCriteria];
    }
    const key = slugifyTitle(title, usedKeys);
    usedKeys.add(key);
    tasks.push({ title, phase, owner, files, dependsOn, readFirst, doNotChange, acceptanceCriteria });
  }
  return tasks;
}
function extractTasksFromPlan(markdown, options = {}) {
  const rich = parseRichSections(markdown, options);
  if (rich !== null) return rich;
  const phase = normalizePhase(options.phase || "implement");
  const owner = options.owner || "cx-engineer";
  const readFirst = options.readFirst || [];
  const doNotChange = options.doNotChange || [];
  const acceptanceCriteria = options.acceptanceCriteria || [];
  return String(markdown || "").split("\n").map((line) => line.trim()).map((line) => {
    const checkbox = /^[-*]\s+\[[ xX]\]\s+(.+)$/.exec(line);
    if (checkbox) return checkbox[1].trim();
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (numbered) return numbered[1].trim();
    return null;
  }).filter(Boolean).map((title) => ({
    title,
    phase,
    owner,
    readFirst,
    doNotChange,
    acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : [`Complete: ${title}`]
  }));
}
function addTasksFromPlan(root, markdown, options = {}) {
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
function updateTask(root, key, patch) {
  const workflow = loadWorkflow(root);
  if (!workflow) throw new Error("No .cx/workflow.json found. Run `construct workflow init` first.");
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== void 0));
  let found = false;
  workflow.tasks = (workflow.tasks || []).map((task) => {
    if (task.key !== key) return task;
    found = true;
    const notes = cleanPatch.note ? [...task.notes || [], { at: now(), note: cleanPatch.note }] : task.notes || [];
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
          `Cannot mark implement-phase task "${key}" as done without verification evidence. Add cx-reviewer and cx-qa results to task.verification before marking done.`
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
function transitionPhase(root, phase, status = "in-progress") {
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
function alignmentFindings(workflow) {
  if (!workflow) {
    return [{
      severity: "HIGH",
      issue: "No .cx/workflow.json found",
      fix: 'Run `construct workflow init "<title>"` at the project root.'
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
function summarizeWorkflow(workflow) {
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
function approveWorkflow(root = process.cwd(), note = "Approved by Executive") {
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
function approveTask(root = process.cwd(), key, note = "Approved by Executive") {
  const workflow = loadWorkflow(root);
  if (!workflow) throw new Error("Workflow not found");
  const task = workflow.tasks.find((t) => t.key === key);
  if (!task) throw new Error(`Task ${key} not found`);
  task.status = "todo";
  if (!task.notes) task.notes = [];
  task.notes.push({ date: now(), text: note });
  workflow.updatedAt = now();
  saveWorkflow(root, workflow);
  return workflow;
}
function runWorkflowCli(argv = process.argv.slice(2), root = process.cwd()) {
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
    if (!title) throw new Error('Usage: construct workflow add --title="..." [--phase=implement] [--owner=cx-engineer]');
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
      tokenBudget: options.tokenBudget ? Number(options.tokenBudget) : void 0
    });
    console.log("Task added.");
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "from-plan") {
    const file = options._[0] || options.file;
    if (!file) throw new Error("Usage: construct workflow from-plan plan.md [--phase=implement] [--owner=cx-engineer]");
    const markdown = fs17.readFileSync(path25.resolve(root, file), "utf8");
    const { workflow, count } = addTasksFromPlan(root, markdown, {
      phase: options.phase,
      owner: options.owner,
      readFirst: splitList(options.readFirst),
      doNotChange: splitList(options.doNotChange),
      acceptanceCriteria: splitList(options.acceptance),
      workflowTitle: options.title
    });
    console.log(`Imported ${count} task${count === 1 ? "" : "s"} from ${file}.`);
    console.log(summarizeWorkflow(workflow));
    return;
  }
  if (command === "task") {
    const key = options.task || options.key || options._[0];
    if (!key) throw new Error('Usage: construct workflow task todo:1 --status=in-progress [--note="..."]');
    const workflow = updateTask(root, key, {
      status: options.status,
      owner: options.owner,
      phase: options.phase,
      note: options.note,
      verification: options.verification ? splitList(options.verification) : void 0,
      overlays: options.overlays ? splitList(options.overlays) : void 0,
      challengeRequired: options.challengeRequired !== void 0 ? options.challengeRequired === "true" : void 0,
      challengeStatus: options.challengeStatus !== void 0 ? options.challengeStatus : void 0
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
var PHASES, VALID_STATUS;
var init_workflow_state = __esm({
  "lib/workflow-state.mjs"() {
    init_orchestration_policy();
    PHASES = ["research", "plan", "implement", "validate", "operate"];
    VALID_STATUS = /* @__PURE__ */ new Set(["todo", "in-progress", "blocked", "blocked_needs_user", "blocked_needs_executive", "done", "skipped"]);
    if (import.meta.url === `file://${process.argv[1]}`) {
      try {
        runWorkflowCli(process.argv.slice(2), process.cwd());
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
    }
  }
});

// lib/oracle/org-graph.mjs
import path26 from "node:path";
import { fileURLToPath as fileURLToPath9 } from "node:url";
var MODULE_DIR6, PACKAGE_ROOT2;
var init_org_graph = __esm({
  "lib/oracle/org-graph.mjs"() {
    init_workflow_state();
    init_validate2();
    init_host_disposition();
    MODULE_DIR6 = path26.dirname(fileURLToPath9(import.meta.url));
    PACKAGE_ROOT2 = path26.resolve(MODULE_DIR6, "../..");
  }
});

// lib/audit-skills.mjs
var init_audit_skills = __esm({
  "lib/audit-skills.mjs"() {
  }
});

// lib/telemetry/skill-calls.mjs
import os10 from "node:os";
import path27 from "node:path";
var DEFAULT_LOG_PATH2;
var init_skill_calls = __esm({
  "lib/telemetry/skill-calls.mjs"() {
    init_rotate();
    init_project_root();
    DEFAULT_LOG_PATH2 = path27.join(os10.homedir(), ".cx", "skill-calls.jsonl");
  }
});

// lib/role-preload.mjs
var init_role_preload = __esm({
  "lib/role-preload.mjs"() {
    init_skill_calls();
  }
});

// lib/audit-specialists.mjs
var init_audit_specialists = __esm({
  "lib/audit-specialists.mjs"() {
    init_audit_skills();
    init_artifact_manifest();
    init_role_preload();
  }
});

// lib/oracle/artifact-gate.mjs
var init_artifact_gate = __esm({
  "lib/oracle/artifact-gate.mjs"() {
    init_audit_specialists();
    init_artifact_type_from_path();
    init_artifact_reviewers();
    init_host_disposition();
  }
});

// lib/graph/store.mjs
import path28 from "node:path";
var STORE_SUBDIR;
var init_store = __esm({
  "lib/graph/store.mjs"() {
    STORE_SUBDIR = path28.join(".cx", "graph");
  }
});

// lib/graph/build-from-registry.mjs
var init_build_from_registry = __esm({
  "lib/graph/build-from-registry.mjs"() {
    init_workflow_defs();
    init_validate2();
    init_store();
  }
});

// lib/oracle/read-model.mjs
var RECENT_MS, CENSUS_STALE_MS;
var init_read_model = __esm({
  "lib/oracle/read-model.mjs"() {
    init_parity();
    init_validate2();
    init_host_disposition();
    init_detect_existing_structure();
    init_org_graph();
    init_artifact_gate();
    init_store();
    init_build_from_registry();
    RECENT_MS = 24 * 60 * 60 * 1e3;
    CENSUS_STALE_MS = 7 * 24 * 60 * 60 * 1e3;
  }
});

// lib/oracle/routing.mjs
var init_routing = __esm({
  "lib/oracle/routing.mjs"() {
  }
});

// lib/oracle/synthesize.mjs
var init_synthesize = __esm({
  "lib/oracle/synthesize.mjs"() {
    init_org_graph();
    init_routing();
  }
});

// lib/oracle/policy.mjs
var init_policy = __esm({
  "lib/oracle/policy.mjs"() {
  }
});

// lib/install/stage-project.mjs
import { spawnSync as spawnSync4 } from "node:child_process";
import { existsSync as existsSync5, copyFileSync, writeFileSync as writeFileSync4, mkdirSync as mkdirSync4, chmodSync } from "node:fs";
import path29 from "node:path";
function stageProjectAdapters({ projectRoot, packageRoot, pkgVersion, log, hosts = null }) {
  if (!projectRoot) throw new Error("stageProjectAdapters: projectRoot is required");
  if (!packageRoot) throw new Error("stageProjectAdapters: packageRoot is required");
  const emit2 = typeof log === "function" ? log : () => {
  };
  const templateDir = path29.join(packageRoot, "templates", "distribution");
  const syncScript = path29.join(packageRoot, "scripts", "sync-specialists.mjs");
  ensureProjectLauncher({ projectRoot, templateDir, pkgVersion });
  emit2(`staged .construct/ launcher in ${projectRoot}`);
  if (!existsSync5(syncScript)) {
    emit2(`sync-specialists.mjs not found at ${syncScript}; skipping adapter sync`);
    return { staged: true, synced: false };
  }
  const syncArgs = [syncScript, "--project"];
  if (Array.isArray(hosts) && hosts.length > 0) syncArgs.push(`--hosts=${hosts.join(",")}`);
  emit2(`syncing project adapters into ${projectRoot}/.claude/`);
  const result = spawnSync4(process.execPath, syncArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, CONSTRUCT_PROJECT_ROOT: projectRoot }
  });
  if (result.status !== 0) {
    emit2(`sync failed (exit ${result.status}); project left in a clean state`);
    return { staged: true, synced: false };
  }
  return { staged: true, synced: true };
}
function ensureProjectLauncher({ projectRoot, templateDir, pkgVersion }) {
  const dotConstruct = path29.join(projectRoot, ".construct");
  mkdirSync4(dotConstruct, { recursive: true });
  mkdirSync4(path29.join(dotConstruct, "cache", "bin"), { recursive: true });
  const versionPath = path29.join(dotConstruct, "version");
  if (!existsSync5(versionPath) && pkgVersion) {
    writeFileSync4(versionPath, pkgVersion + "\n");
  }
  const copies = [
    ["run.mjs", 420],
    ["bootstrap.sh", 493],
    ["bootstrap.ps1", 420]
  ];
  for (const [name, mode] of copies) {
    const src = path29.join(templateDir, name);
    const dst = path29.join(dotConstruct, name);
    if (!existsSync5(src)) continue;
    copyFileSync(src, dst);
    try {
      chmodSync(dst, mode);
    } catch {
    }
  }
}
var init_stage_project = __esm({
  "lib/install/stage-project.mjs"() {
  }
});

// lib/adapters-sync.mjs
import path30 from "node:path";
import { fileURLToPath as fileURLToPath10 } from "node:url";
function resolveAdapterHosts({ forceAll = false, extra = [] } = {}) {
  if (forceAll) return ["claude", "opencode", "codex", "vscode", "cursor"];
  const hosts = new Set(extra);
  for (const entry of detectHostCapabilities()) {
    if (entry.availability !== "installed") continue;
    const id = HOST_ID_MAP[entry.host];
    if (id) hosts.add(id);
  }
  if (hosts.size === 0) hosts.add("claude");
  return [...hosts];
}
function syncProjectAdapters({
  projectRoot = process.cwd(),
  packageRoot = PKG_ROOT,
  hosts = null,
  log = () => {
  }
} = {}) {
  const resolvedHosts = hosts ?? resolveAdapterHosts({ forceAll: isConstructPackageRepo(projectRoot) });
  return stageProjectAdapters({
    projectRoot,
    packageRoot,
    pkgVersion: null,
    log,
    hosts: resolvedHosts
  });
}
function runAdaptersScript({ cwd = process.cwd(), hosts = null } = {}) {
  const result = syncProjectAdapters({ projectRoot: cwd, hosts, log: (m) => process.stdout.write(`[adapters] ${m}
`) });
  return result.synced ? 0 : 1;
}
var MODULE_DIR7, PKG_ROOT, HOST_ID_MAP;
var init_adapters_sync = __esm({
  "lib/adapters-sync.mjs"() {
    init_host_capabilities();
    init_host_disposition();
    init_stage_project();
    MODULE_DIR7 = path30.dirname(fileURLToPath10(import.meta.url));
    PKG_ROOT = path30.resolve(MODULE_DIR7, "..");
    HOST_ID_MAP = {
      "Claude Code": "claude",
      OpenCode: "opencode",
      Codex: "codex",
      "VS Code": "vscode",
      Cursor: "cursor",
      Copilot: "copilot"
    };
    if (import.meta.url === `file://${process.argv[1]}`) {
      const args = new Set(process.argv.slice(2));
      const forceAll = args.has("--all-hosts");
      const hosts = forceAll ? resolveAdapterHosts({ forceAll: true }) : null;
      const code = runAdaptersScript({ cwd: process.cwd(), hosts });
      process.exit(code);
    }
  }
});

// lib/oracle/verdicts.mjs
import fs18 from "node:fs";
import path31 from "node:path";
function verdictsDir(projectDir) {
  return path31.join(projectDir, ".cx", "oracle", "verdicts");
}
function readLatestVerdict(projectDir) {
  const dir = verdictsDir(projectDir);
  if (!fs18.existsSync(dir)) return null;
  const files = fs18.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return null;
  try {
    const data = JSON.parse(fs18.readFileSync(path31.join(dir, files[files.length - 1]), "utf8"));
    return data.latest ?? data;
  } catch {
    return null;
  }
}
var init_verdicts = __esm({
  "lib/oracle/verdicts.mjs"() {
  }
});

// lib/beads-lock.mjs
import path32 from "node:path";
import { fileURLToPath as fileURLToPath11 } from "node:url";
var __dirname, ROOT_DIR2;
var init_beads_lock = __esm({
  "lib/beads-lock.mjs"() {
    __dirname = path32.dirname(fileURLToPath11(import.meta.url));
    ROOT_DIR2 = path32.resolve(__dirname, "..");
  }
});

// lib/beads-optimistic.mjs
import path33 from "node:path";
import { fileURLToPath as fileURLToPath12 } from "node:url";
var __dirname2;
var init_beads_optimistic = __esm({
  "lib/beads-optimistic.mjs"() {
    __dirname2 = path33.dirname(fileURLToPath12(import.meta.url));
  }
});

// lib/beads-client.mjs
import path34 from "node:path";
import { fileURLToPath as fileURLToPath13 } from "node:url";
var __dirname3;
var init_beads_client = __esm({
  "lib/beads-client.mjs"() {
    init_beads_lock();
    init_beads_optimistic();
    init_beads_lock();
    init_beads_optimistic();
    __dirname3 = path34.dirname(fileURLToPath13(import.meta.url));
  }
});

// lib/oracle/issues.mjs
var init_issues = __esm({
  "lib/oracle/issues.mjs"() {
    init_beads_client();
    init_routing();
  }
});

// lib/oracle/dispatch.mjs
var init_dispatch = __esm({
  "lib/oracle/dispatch.mjs"() {
    init_routing();
  }
});

// lib/storage/file-lock.mjs
var init_file_lock = __esm({
  "lib/storage/file-lock.mjs"() {
  }
});

// lib/outcomes/record.mjs
var init_record = __esm({
  "lib/outcomes/record.mjs"() {
    init_file_lock();
    init_project_init_shared();
  }
});

// lib/outcomes/aggregate.mjs
var DAY_MS;
var init_aggregate = __esm({
  "lib/outcomes/aggregate.mjs"() {
    init_record();
    DAY_MS = 24 * 60 * 60 * 1e3;
  }
});

// lib/roles/event-bus.mjs
var init_event_bus = __esm({
  "lib/roles/event-bus.mjs"() {
    init_project_root();
  }
});

// lib/roles/manifest.mjs
import { dirname as dirname5, join as join6 } from "node:path";
import { fileURLToPath as fileURLToPath14 } from "node:url";
var __dirname4, MANIFEST_PATH;
var init_manifest = __esm({
  "lib/roles/manifest.mjs"() {
    __dirname4 = dirname5(fileURLToPath14(import.meta.url));
    MANIFEST_PATH = join6(__dirname4, "..", "..", "specialists", "role-manifests.json");
  }
});

// lib/roles/router.mjs
var init_router = __esm({
  "lib/roles/router.mjs"() {
    init_routing_tables();
    init_manifest();
  }
});

// lib/roles/gateway.mjs
var DEFAULTS2;
var init_gateway = __esm({
  "lib/roles/gateway.mjs"() {
    init_event_bus();
    init_router();
    init_beads_client();
    DEFAULTS2 = {
      thresholdHits: 2,
      thresholdWindowMs: 10 * 60 * 1e3,
      cooldownMs: 30 * 60 * 1e3,
      rateCeilingPerHour: 3,
      pendingTtlMs: 14 * 24 * 60 * 60 * 1e3
    };
  }
});

// lib/oracle/execute.mjs
var init_execute = __esm({
  "lib/oracle/execute.mjs"() {
    init_adapters_sync();
    init_host_disposition();
    init_aggregate();
    init_gateway();
    init_validate2();
    init_dispatch();
    init_routing();
  }
});

// lib/oracle/actions.mjs
import fs19 from "node:fs";
import path35 from "node:path";
import { fileURLToPath as fileURLToPath15 } from "node:url";
function pendingPath(projectDir) {
  return path35.join(projectDir, ".cx", "oracle", "pending.jsonl");
}
function listPending(projectDir) {
  const file = pendingPath(projectDir);
  if (!fs19.existsSync(file)) return [];
  return fs19.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}
var MODULE_DIR8;
var init_actions = __esm({
  "lib/oracle/actions.mjs"() {
    init_read_model();
    init_synthesize();
    init_policy();
    init_host_disposition();
    init_adapters_sync();
    init_verdicts();
    init_issues();
    init_dispatch();
    init_execute();
    init_routing();
    MODULE_DIR8 = path35.dirname(fileURLToPath15(import.meta.url));
  }
});

// lib/oracle/index.mjs
import fs20 from "node:fs";
import path36 from "node:path";
import { homedir as homedir3 } from "node:os";
function runtimeDir(homeDir2 = homedir3()) {
  return path36.join(homeDir2, ".cx", "runtime", "oracle");
}
function lastTickPath(homeDir2 = homedir3()) {
  return path36.join(runtimeDir(homeDir2), "last-tick.json");
}
function readLastTick(homeDir2 = homedir3()) {
  const file = lastTickPath(homeDir2);
  if (!fs20.existsSync(file)) return null;
  try {
    return JSON.parse(fs20.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
var init_oracle = __esm({
  "lib/oracle/index.mjs"() {
    init_contract();
    init_process_budget();
    init_actions();
  }
});

// lib/intake/session-prelude.mjs
var session_prelude_exports = {};
__export(session_prelude_exports, {
  buildBrokerStatusLine: () => buildBrokerStatusLine,
  buildIntakePrelude: () => buildIntakePrelude,
  buildOraclePrelude: () => buildOraclePrelude,
  buildSessionPrelude: () => buildSessionPrelude,
  formatOracleDockDetail: () => formatOracleDockDetail,
  readOracleDockState: () => readOracleDockState
});
import { homedir as osHomedir } from "node:os";
function buildIntakePrelude({ cwd, env = process.env } = {}) {
  if (!cwd) return "";
  try {
    const queue = createIntakeQueue(cwd, env);
    const pending = queue.listPending();
    if (!pending.length) return "";
    const { intakeQueueLabel, signalNoun } = getRebrand(cwd);
    const recent = pending.slice(-3).map((p) => {
      const src = p.intake?.sourcePath || p.id;
      return `- ${formatTriageLine(src, p.triage)}`;
    });
    const heading = intakeQueueLabel.replace(/\s+queue$/i, "");
    return `
## Pending ${heading} (${pending.length})
${recent.join("\n")}
Each packet at \`.cx/intake/pending/<id>.json\` carries the new ${signalNoun}, a triage block (intakeType, rdStage, primaryOwner, recommendedChain, recommendedAction, risk), related existing docs, and an excerpt. Process via the recommended chain, then close via \`construct intake done <id>\`.
`;
  } catch {
    return "";
  }
}
function buildBrokerStatusLine({ env = process.env } = {}) {
  const active = isBrokered(env);
  const mode = env?.CONSTRUCT_DEPLOYMENT_MODE || "solo";
  if (!active) {
    return `MCP broker: off \xB7 deployment mode: ${mode} (set CONSTRUCT_MCP_BROKER=on to engage in solo mode).`;
  }
  return `MCP broker: on \xB7 deployment mode: ${mode}. High-risk actions may return \`ApprovalRequired\` \u2014 surface the question to the user; never bypass.`;
}
function buildSessionPrelude({ cwd, env = process.env } = {}) {
  const intake = buildIntakePrelude({ cwd, env });
  const broker = buildBrokerStatusLine({ env });
  const oracle = buildOraclePrelude({ cwd, env });
  if (!intake && !broker && !oracle) return "";
  const parts = [];
  if (intake) parts.push(intake.trim());
  if (oracle) parts.push(oracle.trim());
  if (broker) parts.push(broker);
  return parts.join("\n\n");
}
function buildOraclePrelude({ cwd, env = process.env, homeDir: homeDir2 } = {}) {
  if (!cwd) return "";
  if (env.CONSTRUCT_ORACLE === "off" || env.CONSTRUCT_ORACLE === "0") return "";
  try {
    const home = homeDir2 ?? osHomedir();
    const last = readLastTick(home);
    const verdict = readLatestVerdict(cwd);
    const pending = listPending(cwd).filter((p) => p.status === "pending");
    const v = verdict?.verdict ?? last?.verdict ?? "unknown";
    if (v === "healthy" && pending.length === 0) return "";
    const lines = [`
## Oracle overseer \xB7 verdict: **${v}**`];
    const gapSource = verdict?.gaps ?? last?.gaps ?? [];
    const top = gapSource.filter((g) => g.severity === "high").slice(0, 3);
    for (const g of top) lines.push(`- [${g.severity}] ${g.id}: ${g.detail}`);
    if (pending.length) {
      lines.push(`Pending approvals (${pending.length}): \`construct oracle pending\``);
    }
    lines.push("Review: `construct oracle review` \xB7 Approve: `construct oracle approve <id>`\n");
    return lines.join("\n");
  } catch {
    return "";
  }
}
function readOracleDockState({ cwd, env = process.env, homeDir: homeDir2 } = {}) {
  if (!cwd || env.CONSTRUCT_ORACLE === "off" || env.CONSTRUCT_ORACLE === "0") {
    return { visible: false, verdict: null, pendingCount: 0, topGaps: [], summary: "" };
  }
  try {
    const home = homeDir2 ?? osHomedir();
    const last = readLastTick(home);
    const verdictDoc = readLatestVerdict(cwd);
    const pending = listPending(cwd).filter((p) => p.status === "pending");
    const verdict = verdictDoc?.verdict ?? last?.verdict ?? "unknown";
    const gapSource = verdictDoc?.gaps ?? last?.gaps ?? [];
    const topGaps = gapSource.filter((g) => g.severity === "high").slice(0, 3);
    const visible = verdict !== "healthy" || pending.length > 0;
    const parts = [`verdict ${verdict}`];
    if (pending.length) parts.push(`${pending.length} pending`);
    return {
      visible,
      verdict,
      pendingCount: pending.length,
      topGaps,
      summary: parts.join(" \xB7 ")
    };
  } catch {
    return { visible: false, verdict: null, pendingCount: 0, topGaps: [], summary: "" };
  }
}
function formatOracleDockDetail(state) {
  if (!state?.visible) return "Oracle: healthy \u2014 no pending approvals.";
  const lines = [`Oracle overseer \xB7 ${state.summary}`];
  for (const g of state.topGaps || []) {
    lines.push(`  [${g.severity}] ${g.id}: ${g.detail}`);
  }
  if (state.pendingCount > 0) {
    lines.push("  Pending: construct oracle pending");
  }
  lines.push("  Review: construct oracle review");
  return lines.join("\n");
}
var init_session_prelude = __esm({
  "lib/intake/session-prelude.mjs"() {
    init_queue();
    init_classify();
    init_broker();
    init_rebrand();
    init_oracle();
    init_actions();
    init_verdicts();
  }
});

// apps/chat/tui/index.jsx
import React4, { useState, useRef, useCallback, useEffect, useMemo, createContext, useContext } from "react";
import { render, Box as Box4, Text as Text4, useApp, useInput, useStdout } from "ink";

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
  const ollamaMissing = raw.match(/model ['"]([^'"]+)['"] not found/i);
  if (ollamaMissing) {
    const native = ollamaMissing[1];
    summary = `Ollama model '${native}' is not installed locally. Pull it with: ollama pull ${native} (or: construct ollama pull ${native})`;
  } else if (/rate[- ]?limit|429|temporarily rate-limited/i.test(raw)) {
    summary = raw.replace(/^Provider returned error\.?\s*/i, "").trim() || "rate-limited upstream";
  } else if (/unavailable for free|paid version is available/i.test(raw)) {
    summary = "free tier retired \u2014 use a different free model or paid slug";
  } else if (/Failed after \d+ attempts/i.test(text)) {
    summary = raw || "provider error after retries";
  } else if (/OLLAMA_MODEL_NOT_PULLED|not installed locally/i.test(raw)) {
    summary = raw;
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
function isOllamaNotPulledError(error) {
  const text = typeof error === "string" ? error : String(error?.message || error || "");
  return error?.code === "OLLAMA_MODEL_NOT_PULLED" || /not installed locally/i.test(text);
}
async function handleOllamaNotPulledFailure({ session, error, env = process.env, currentModel }) {
  if (!isOllamaNotPulledError(error)) return null;
  if (typeof currentModel !== "string" || !currentModel.startsWith("ollama/")) return null;
  recordFailedModel(session, currentModel);
  const excludeFamilies = typeof currentModel === "string" && currentModel.startsWith("ollama/") ? ["ollama"] : [];
  const next = resolveValidatedChatModel({ env, requested: null, excludeFamilies });
  if (!next?.id || next.id === currentModel) return null;
  const parsed = parseOpenRouterError(error);
  return {
    modelId: next.id,
    notice: `${parsed.summary} Switched to ${next.id} for this turn.`
  };
}
async function handleModelFailure(opts) {
  const openRouter = await handleOpenRouterFailure(opts);
  if (openRouter) return openRouter;
  return handleOllamaNotPulledFailure(opts);
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
    const fallback = await handleModelFailure({
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

// lib/chat/session-context.mjs
import fs9 from "node:fs";
import path10 from "node:path";
import { execSync as execSync2 } from "node:child_process";
function buildPlanContext({ session, cwd = process.cwd(), turnBlocks = [], text = "" } = {}) {
  const turns = turnBlocks.filter((item) => item.kind === "turn");
  const lastTurn = turns.length ? turns[turns.length - 1].block : null;
  let workingBranch = null;
  try {
    workingBranch = execSync2("git branch --show-current", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
  }
  let projectSummary = null;
  const contextPath = path10.join(cwd, ".cx", "context.md");
  try {
    if (fs9.existsSync(contextPath)) {
      projectSummary = fs9.readFileSync(contextPath, "utf8").slice(0, 500);
    }
  } catch {
  }
  const trimmed = String(text).trim();
  const vagueFollowUp = /^(tell me more|what about|continue|go on|explain|elaborate|and\?)/i.test(trimmed);
  const projectQuestion = /\b(what is this project|what('s| is) this (repo|project|codebase)|describe this project)\b/i.test(trimmed);
  return {
    turnIndex: session?.usage?.turns ?? 0,
    priorIntent: lastTurn?.overlay?.intent ?? null,
    priorWorkCategory: lastTurn?.overlay?.workCategory ?? null,
    workingBranch,
    projectSummary,
    vagueFollowUp: vagueFollowUp && (session?.usage?.turns ?? 0) > 0,
    projectQuestion
  };
}

// lib/chat/export.mjs
init_project_root();
import fs11 from "node:fs";
import path12 from "node:path";

// lib/chat/present.mjs
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
    if (typeof s === "string") {
      if (!refs.includes(s)) refs.push(s);
      continue;
    }
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
function contextRows(overlay, { layers = null } = {}) {
  if (!overlay) return [];
  const rows = [];
  if (overlay.intent) rows.push({ label: "intent", value: overlay.intent });
  if (overlay.workCategory) rows.push({ label: "category", value: overlay.workCategory });
  if (overlay.track) rows.push({ label: "track", value: overlay.track });
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
function formatRouteStrip(overlay, { layers = null } = {}) {
  if (!overlay) return null;
  const showSpecialists = layers?.specialists !== false;
  const chain = showSpecialists && Array.isArray(overlay.specialists) ? [...overlay.specialists] : [];
  const intent = overlay.intent || null;
  const track = overlay.track || null;
  const gates = formatGateRows(overlay);
  const summary = overlay.dispatchSummary || null;
  const chainLine = showSpecialists ? chain.length ? chain.join(" \u2192 ") : "direct" : null;
  return { chain, intent, track, gates, summary, chainLine };
}
function formatRouteLogLine(overlay, { layers = null } = {}) {
  const strip = formatRouteStrip(overlay, { layers });
  if (!strip) return "";
  const parts = [];
  if (strip.intent) parts.push(`intent=${strip.intent}`);
  if (strip.track) parts.push(`track=${strip.track}`);
  if (strip.chainLine) parts.push(strip.chainLine);
  return parts.join(" \xB7 ");
}
function formatGateRows(overlay) {
  if (!overlay) return [];
  const rows = [];
  if (overlay.externalResearch?.required) {
    const detail = overlay.externalResearch.shape || overlay.externalResearch.reason || "yes";
    rows.push({ label: "research", value: `required (${detail})` });
  }
  if (overlay.framingChallenge?.required) {
    rows.push({ label: "framing", value: "challenge required" });
  }
  if (overlay.docAuthoring?.docType) {
    rows.push({ label: "doc", value: `${overlay.docAuthoring.docType} \u2192 ${overlay.docAuthoring.owner || "unknown"}` });
  }
  if (overlay.artifactReview?.requiredReviewers?.length) {
    rows.push({
      label: "reviewers",
      value: overlay.artifactReview.requiredReviewers.join(", ")
    });
  }
  return rows;
}

// lib/chat/export.mjs
function exportDir({ cwd }) {
  const base = resolveProjectScopedPath("chat-sessions", { cwd, ensureDir: true });
  const dir = path12.join(base, "exports");
  fs11.mkdirSync(dir, { recursive: true });
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
  const file = path12.join(exportDir({ cwd }), `${stamp}-${scope}-answer.md`);
  fs11.writeFileSync(file, `${body}
`, "utf8");
  return { ok: true, path: file, count: selected.length };
}

// lib/chat/config.mjs
import fs12 from "node:fs";
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
  ui: Object.freeze({ ascii: false, inspector: "off", theme: "auto" })
});
var CONFIG_BASENAME = "chat-config.json";
function saveChatConfig(config, { cwd = process.cwd() } = {}) {
  const target = resolveProjectScopedPath(CONFIG_BASENAME, { cwd, ensureDir: true });
  const persisted = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] == null) continue;
    persisted[key] = key === "layers" ? { ...config.layers } : key === "ui" ? { ...config.ui } : config[key];
  }
  fs12.writeFileSync(target, `${JSON.stringify(persisted, null, 2)}
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
    session.modelNotice = null;
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
init_catalog();
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
  if (idx >= 0 && !items[idx]?.disabled) return idx;
  const firstEnabled = items.findIndex((item) => !item.disabled);
  if (firstEnabled >= 0) return firstEnabled;
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
  let idx = state.index ?? 0;
  for (let step = 0; step < visible.length; step++) {
    idx = Math.max(0, Math.min(visible.length - 1, idx + delta));
    if (!visible[idx]?.disabled) return { ...state, index: idx };
    if (delta < 0 && idx === 0 || delta > 0 && idx === visible.length - 1) break;
  }
  return { ...state, index: idx };
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
    suitable: model.suitable,
    disabled: model.disabled === true
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
      const availability = isChatModelAvailable(id, { env });
      const notPulled = availability.reason === "model_not_pulled";
      items.push(catalogItem({
        id,
        label: id,
        name: `${provider.label} \xB7 ${tier}`,
        tier,
        configured: availability.ok,
        suitable: availability.ok,
        isProviderDefault: tier === "standard",
        disabled: !availability.ok,
        detail: notPulled ? `not installed \u2014 run ollama pull ${availability.nativeModel || id.replace(/^ollama\//, "")}` : availability.ok ? null : availability.reason?.replace(/_/g, " ") || "unavailable"
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
      await refreshLiveOpenRouterCatalog({ env });
      const apiKey = resolveFirstSecret(["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"], { env });
      if (!apiKey) throw new Error("missing");
      const { pollFreeModels: pollFreeModels2, topForTier: topForTier2 } = await Promise.resolve().then(() => (init_model_free_selector(), model_free_selector_exports));
      const { isChatModelAvailable: isChatModelAvailable2 } = await Promise.resolve().then(() => (init_model_router(), model_router_exports));
      const freeLive = await pollFreeModels2(apiKey);
      for (const f of topForTier2(freeLive, "standard", FREE_PICKER_LIMIT)) {
        const id = f.id?.startsWith("openrouter/") ? f.id : `openrouter/${f.id}`;
        if (seen.has(id)) continue;
        if (!isChatModelAvailable2(id, { env }).ok) continue;
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
  session.modelNotice = null;
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
  const active = session?.model || "(no model)";
  const saved = session?.savedModel;
  if (saved && saved !== session?.model) {
    return { label: active, savedPin: saved, isRouter: false };
  }
  return { label: active, isRouter: false };
}
function formatPickerLine(item, colors, { selected = false } = {}) {
  const marker = selected ? `${colors.green}\u25CF${colors.reset}` : " ";
  const tag = item.tag ? `${colors.dim} [${item.tag}]${colors.reset}` : "";
  const disabled = item.disabled ? `${colors.dim} (unavailable)${colors.reset}` : "";
  const detail = item.detail ? `
      ${colors.dim}${item.detail}${colors.reset}` : "";
  return `  ${marker} ${item.label || item.id}${tag}${disabled}${detail}`;
}
async function promptModelPickerTerminal({
  output,
  colors,
  session,
  rl = null,
  askFn = null,
  env = process.env,
  cwd = process.cwd(),
  hostId = "construct",
  layers = session?.layers
} = {}) {
  const items = await loadModelPickerItems(null, {
    env,
    currentModel: session?.model,
    modelMode: session?.modelMode || "pinned"
  });
  if (!items.length) {
    output.write(`${colors.dim}no models to pick from \u2014 set a provider key in ~/.construct/config.env or use /model <id>${colors.reset}
`);
    return null;
  }
  const selectedId = pickerSelectedId(session);
  output.write(`${colors.bold}select a model${colors.reset}
`);
  output.write(`${colors.dim}enter a number, or press enter to cancel${colors.reset}
`);
  items.forEach((item2, i) => {
    output.write(`${String(i + 1).padStart(2)}.${formatPickerLine(item2, colors, { selected: item2.id === selectedId })}
`);
  });
  const prompt = `${colors.green}model #${colors.reset} `;
  const answer = rl ? (await new Promise((resolve4) => rl.question(prompt, resolve4))).trim() : askFn ? String(await askFn(prompt)).trim() : "";
  if (!answer) {
    output.write(`${colors.dim}${rl || askFn ? "cancelled" : "pick one with /model <id> or use the Ink UI for search"}${colors.reset}
`);
    return null;
  }
  const idx = Number(answer) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
    output.write(`${colors.red}invalid selection${colors.reset}
`);
    return null;
  }
  const item = items[idx];
  if (item.disabled) {
    output.write(`${colors.red}${item.detail || "model not available"}${colors.reset}
`);
    return null;
  }
  const selection = await resolveModelPickerSelection(item, { env });
  if (!selection?.modelId && selection?.mode !== "free-router") {
    output.write(`${colors.red}could not resolve model${colors.reset}
`);
    return null;
  }
  commitPickerModel(session, selection, { cwd, hostId, layers });
  const label = selection.mode === "free-router" ? `free-router \u2192 ${selection.modelId}` : selection.modelId;
  output.write(`${colors.green}model set:${colors.reset} ${label} ${colors.dim}(saved)${colors.reset}
`);
  return selection;
}

// lib/chat/demo-guide.mjs
function formatDemoStepLine(step, colors = {}) {
  const dim = colors.dim || "";
  const reset = colors.reset || "";
  const bold = colors.bold || "";
  const lines = [`${bold}Step ${step.index}${reset}: ${step.title || "prompt"}`];
  if (step.prompt) lines.push(`${step.prompt}`);
  if (step.command) lines.push(`${dim}command: ${step.command}${reset}`);
  return lines.join("\n");
}
function formatDemoStepsList(guide, colors = {}) {
  const dim = colors.dim || "";
  const reset = colors.reset || "";
  const bold = colors.bold || "";
  const lines = [`${bold}Demo steps${reset}`];
  guide.script.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step.title || step.prompt?.slice(0, 50) || "step"}`);
  });
  lines.push(`${dim}Use /demo next for the next prompt${reset}`);
  return lines.join("\n");
}
function registerDemoCommands(HELP2, demoGuide) {
  if (!demoGuide) return HELP2;
  return [
    ...HELP2.slice(0, 1),
    ["/demo [next|steps|reset]", "walk the active demo script"],
    ...HELP2.slice(1)
  ];
}
function handleDemoCommand(arg, { demoGuide, output, colors }) {
  if (!demoGuide) {
    output.write(`${colors.dim}No active demo. Launch with \`construct demo <name>\`.${colors.reset}
`);
    return;
  }
  const action = (arg || "steps").toLowerCase();
  if (action === "reset") {
    demoGuide.reset();
    output.write(`${colors.green}Demo reset to step 1.${colors.reset}
`);
    return;
  }
  if (action === "next") {
    const step = demoGuide.next();
    if (!step) {
      output.write(`${colors.dim}Demo complete \u2014 all steps shown.${colors.reset}
`);
      return;
    }
    output.write(`
${formatDemoStepLine(step, colors)}

`);
    return;
  }
  output.write(`${formatDemoStepsList(demoGuide, colors)}
`);
  const peek = demoGuide.peek();
  if (peek) {
    output.write(`${colors.dim}Next: /demo next \u2192 ${peek.title || "step"}${colors.reset}
`);
  }
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
  ["/oracle", "show Oracle overseer verdict and pending approvals"],
  ["/host", "show the active host"],
  ["/clear", "clear the screen"],
  ["/inspect", "toggle turn inspector panel (on/off/auto)"],
  ["/exit", "quit"]
];
function createCommands({ driver, host, hostId = host, version, cwd = process.cwd(), env = process.env, turnBlocksRef = null, demoGuide = null } = {}) {
  async function handle(input, ctx) {
    const { output, colors, layers, session, rl, onClear } = ctx;
    const runtimeEnv = ctx.env || env;
    const [cmd, ...rest] = input.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    const activeGuide = demoGuide || session?.demoGuide || null;
    switch (cmd) {
      case "/exit":
      case "/quit":
        return false;
      case "/help":
        output.write(`${colors.bold}commands${colors.reset}
`);
        for (const [name, desc] of registerDemoCommands(HELP, activeGuide)) {
          output.write(`  ${colors.cyan}${name.padEnd(28)}${colors.reset}${colors.dim}${desc}${colors.reset}
`);
        }
        break;
      case "/demo":
        handleDemoCommand(arg, { demoGuide: activeGuide, output, colors });
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
      case "/model":
        if (arg) {
          commitPickerModel(session, { mode: "pinned", modelId: arg }, { cwd, hostId, layers: session.layers });
          output.write(`${colors.green}model set:${colors.reset} ${arg} ${colors.dim}(pinned, saved)${colors.reset}
`);
          break;
        }
        await promptModelPickerTerminal({
          output,
          colors,
          session,
          rl,
          askFn: ctx.ask,
          env: runtimeEnv,
          cwd,
          hostId,
          layers: session.layers
        });
        break;
      case "/free": {
        const { resolveFreeOpenRouterModel: resolveFreeOpenRouterModel2 } = await Promise.resolve().then(() => (init_models(), models_exports));
        const freeId = await resolveFreeOpenRouterModel2({ env: runtimeEnv, tier: "standard" });
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
      case "/oracle": {
        const { readOracleDockState: readOracleDockState2, formatOracleDockDetail: formatOracleDockDetail2 } = await Promise.resolve().then(() => (init_session_prelude(), session_prelude_exports));
        const state = readOracleDockState2({ cwd, env: runtimeEnv });
        output.write(`${colors.bold}oracle${colors.reset}
`);
        output.write(`${formatOracleDockDetail2(state)}
`);
        break;
      }
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
    track: overlay.track || null,
    contractChain: Array.isArray(overlay.contractChain) ? overlay.contractChain.map((edge) => ({ ...edge })) : [],
    dispatchReasons: overlay.dispatchReasons ? { ...overlay.dispatchReasons } : null,
    triggers: Array.isArray(overlay.triggers) ? overlay.triggers.map((t) => ({ ...t })) : [],
    dispatchSummary: overlay.dispatchSummary || null
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
    const path37 = event.input?.path || event.input?.pattern || event.input?.glob;
    if (path37) return { tool: title, ref: String(path37) };
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

// lib/brand-tokens.mjs
var INK = Object.freeze({
  ink: "#0a0c10",
  inkStrong: "#16191f",
  inkBody: "#23272e",
  muted: "#565c66",
  faint: "#9499a2",
  hairline: "#e3e4e8",
  hairlineStrong: "#cdd0d6",
  surface: "#fafafa",
  surfaceAlt: "#f3f4f6",
  paper: "#ffffff",
  navy: "#0c1018"
});
var FONTS = Object.freeze({
  sans: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"
});
var STATUS = Object.freeze({
  ok: "#98c379",
  warn: "#e5c07b",
  danger: "#e06c75"
});
var BRAND_TOKENS = Object.freeze({
  ink: Object.freeze({
    default: INK.ink,
    strong: INK.inkStrong,
    body: INK.inkBody,
    muted: INK.muted,
    faint: INK.faint
  }),
  line: Object.freeze({
    hairline: INK.hairline,
    hairlineStrong: INK.hairlineStrong
  }),
  surface: Object.freeze({
    default: INK.surface,
    alt: INK.surfaceAlt,
    paper: INK.paper
  }),
  navy: INK.navy,
  typography: Object.freeze({
    fontSans: "Plus Jakarta Sans",
    fontDisplay: "Plus Jakarta Sans",
    fontMono: "IBM Plex Mono",
    fontStack: FONTS.sans,
    fontStackMono: FONTS.mono,
    weight: Object.freeze({
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700
    }),
    size: Object.freeze({
      micro: "8pt",
      small: "8.5pt",
      meta: "9pt",
      body: "10pt",
      h4: "8.5pt",
      h3: "11pt",
      h2: "13pt",
      h1: "17pt",
      subtitle: "11.5pt",
      title: "24pt"
    })
  }),
  layout: Object.freeze({
    figureMaxWidth: "74%",
    slideAspect: "16 / 9"
  })
});
var BRAND = Object.freeze({
  accent: INK.ink,
  accentWarm: INK.ink,
  navy: INK.navy,
  ink: INK.inkStrong,
  muted: INK.muted,
  surface: INK.surface,
  surfaceAlt: INK.surfaceAlt,
  tableHeader: INK.surfaceAlt
});

// lib/chat/design-tokens.mjs
var CHAT_DARK = Object.freeze({
  bg: INK.navy,
  surface: "#101620",
  border: INK.muted,
  text: "#e8eaed",
  muted: "#8a9199",
  accent: "#e8eaed",
  accentAlt: INK.hairlineStrong,
  ...STATUS
});
var CHAT_LIGHT = Object.freeze({
  bg: "#f8f9fb",
  surface: INK.surfaceAlt,
  border: INK.hairlineStrong,
  text: INK.ink,
  muted: INK.muted,
  accent: INK.inkStrong,
  accentAlt: INK.muted,
  ok: "#15803d",
  warn: "#a16207",
  danger: STATUS.danger
});
var TERMINAL_DARK = Object.freeze({
  text: { ink: "white", code: "37" },
  muted: { ink: "gray", code: "90" },
  accent: { ink: "whiteBright", code: "97" },
  accentAlt: { ink: "gray", code: "90" },
  brandAccent: { ink: "whiteBright", code: "97" },
  surface: { ink: "gray", code: "90" },
  surfaceMuted: { ink: "gray", code: "90" },
  border: { ink: "gray", code: "90" },
  ok: { ink: "green", code: "32" },
  warn: { ink: "yellow", code: "33" },
  danger: { ink: "red", code: "31" },
  badgeFg: { ink: "black", code: "30" }
});
var TERMINAL_LIGHT = Object.freeze({
  text: { ink: "black", code: "30" },
  muted: { ink: "gray", code: "90" },
  accent: { ink: "black", code: "30" },
  accentAlt: { ink: "gray", code: "90" },
  brandAccent: { ink: "black", code: "30" },
  surface: { ink: "gray", code: "90" },
  surfaceMuted: { ink: "gray", code: "90" },
  border: { ink: "gray", code: "90" },
  ok: { ink: "green", code: "32" },
  warn: { ink: "rgb(161,98,7)", code: "33" },
  danger: { ink: "red", code: "31" },
  badgeFg: { ink: "white", code: "97" }
});
function chatTerminalSemantic(scheme = "dark") {
  return scheme === "light" ? TERMINAL_LIGHT : TERMINAL_DARK;
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
var ASCII_GLYPHS = Object.freeze({
  spinner: ["|", "/", "-", "\\"],
  bullet: "*",
  check: "OK",
  cross: "X",
  arrow: "->",
  boxH: "-",
  boxV: "|"
});
var UNICODE_GLYPHS = Object.freeze({
  spinner: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"],
  bullet: "\u2022",
  check: "\u2713",
  cross: "\u2717",
  arrow: "\u2192",
  boxH: "\u2500",
  boxV: "\u2502"
});
var DARK_SEMANTIC = Object.freeze(chatTerminalSemantic("dark"));
var LIGHT_SEMANTIC = Object.freeze(chatTerminalSemantic("light"));
function semanticForScheme(scheme = "dark") {
  return scheme === "light" ? LIGHT_SEMANTIC : DARK_SEMANTIC;
}
function inkPalette({ scheme = "dark" } = {}) {
  const semantic = semanticForScheme(scheme);
  return Object.fromEntries(Object.entries(semantic).map(([k, v]) => [k, v.ink]));
}

// apps/chat/tui/theme.mjs
var UNICODE_GLYPHS2 = {
  brand: "\u25C6",
  dot: "\u25CF",
  arrow: "\u2192",
  caret: "\u25B8",
  gutter: "\u2502",
  block: "\u2588",
  track: "\u2591",
  ruleHeavy: "\u2550",
  toolDone: "\u2713",
  toolFail: "\u2717",
  toolBusy: "\u25B8",
  toolPending: "\xB7"
};
var ASCII_GLYPHS2 = {
  brand: "*",
  dot: "o",
  arrow: "->",
  caret: ">",
  gutter: "|",
  block: "#",
  track: "-",
  ruleHeavy: "=",
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
    glyphs: ascii ? { ...ASCII_GLYPHS2 } : { ...UNICODE_GLYPHS2 },
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
import React2 from "react";
import { Box as Box2, Text as Text2 } from "ink";

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
init_session_prelude();

// apps/chat/tui/event-log-ui.jsx
import React from "react";
import { Box, Text } from "ink";
import { jsx, jsxs } from "react/jsx-runtime";
function LogLine({ tag, channel, children, palette: palette2, channelColor, width }) {
  return /* @__PURE__ */ jsxs(Box, { width, flexDirection: "row", children: [
    /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: `${tag} ` }),
    /* @__PURE__ */ jsx(Text, { color: channelColor || palette2.accent, bold: true, children: `${channel} ` }),
    /* @__PURE__ */ jsx(Box, { flexGrow: 1, children })
  ] });
}
function routeSummary(overlay) {
  if (!overlay) return null;
  const line = formatRouteLogLine(overlay);
  return line || null;
}
function sourceRefs(sources) {
  const src = summarizeSources(sources || []);
  return src.refs || [];
}
function SystemLogLine({ text, width, palette: palette2 }) {
  if (!text) return null;
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", marginBottom: 1, width, children: /* @__PURE__ */ jsx(LogLine, { tag: "\u2014", channel: "SYS", palette: palette2, channelColor: palette2.warn, width, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: text }) }) });
}
function CompactTurnLog({
  turn,
  width,
  layers,
  turnIndex,
  liveAssistant = "",
  liveThinking = "",
  working = false,
  theme
}) {
  const { palette: palette2 } = theme;
  const tag = `T${turnIndex}`;
  const assistant = liveAssistant || turn.assistant || "";
  const thinking = liveThinking || turn.thinking || "";
  const isError = assistant.startsWith("[error]");
  const toolGroups = summarizeToolCalls(turn.tools || []);
  const refs = sourceRefs(turn.sources);
  const srcLimit = 8;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, width, children: [
    /* @__PURE__ */ jsx(LogLine, { tag, channel: "YOU", palette: palette2, width, children: /* @__PURE__ */ jsx(Text, { wrap: "wrap", children: turn.userText }) }),
    turn.overlay && layers?.specialists !== false && routeSummary(turn.overlay) ? /* @__PURE__ */ jsx(LogLine, { tag, channel: "ROUTE", palette: palette2, channelColor: palette2.accentAlt, width, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: routeSummary(turn.overlay) }) }) : null,
    thinking && layers?.thinking !== false ? /* @__PURE__ */ jsx(Box, { flexDirection: "column", marginLeft: 2, marginBottom: 0, children: /* @__PURE__ */ jsx(LogLine, { tag, channel: "THINK", palette: palette2, width, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: thinking }) }) }) : null,
    toolGroups.length > 0 && layers?.tools !== false ? /* @__PURE__ */ jsx(LogLine, { tag, channel: "TOOL", palette: palette2, width, children: /* @__PURE__ */ jsx(Text, { wrap: "wrap", children: toolGroups.map((g, i) => /* @__PURE__ */ jsx(Text, { color: toolColor(g.status, theme), children: `${i > 0 ? " " : ""}${toolGlyph(g.status, theme)} ${g.title}${g.count > 1 ? ` \xD7${g.count}` : ""}` }, g.title)) }) }) : null,
    refs.length > 0 ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginLeft: 2, children: [
      /* @__PURE__ */ jsx(LogLine, { tag, channel: "SRC", palette: palette2, width, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: refs.slice(0, srcLimit).join("\n") }) }),
      refs.length > srcLimit ? /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: `  +${refs.length - srcLimit} more` }) : null
    ] }) : null,
    assistant || working ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop: 0, children: [
      /* @__PURE__ */ jsx(LogLine, { tag, channel: "OUT", palette: palette2, channelColor: palette2.ok, width, children: working && !assistant ? /* @__PURE__ */ jsx(Text, { color: palette2.warn, children: "working\u2026" }) : null }),
      assistant ? /* @__PURE__ */ jsx(Box, { marginLeft: 2, flexDirection: "column", children: /* @__PURE__ */ jsx(CompactMarkdown, { text: assistant, width: width - 4, palette: palette2, isError }) }) : null
    ] }) : null,
    turn.usage && layers?.observability !== false ? /* @__PURE__ */ jsx(LogLine, { tag, channel: "USAGE", palette: palette2, width, children: /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: stripAnsi(formatTurnUsageLine(turn.usage)) }) }) : null
  ] });
}
function CompactMarkdown({ text, width, palette: palette2, isError = false }) {
  const parts = parseMarkdownLines(text, { width: Math.max(20, width - 2) });
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: parts.map((part, i) => {
    if (part.type === "heading") {
      return /* @__PURE__ */ jsx(Text, { bold: true, color: isError ? palette2.danger : palette2.text, wrap: "wrap", children: part.text }, i);
    }
    if (part.type === "bullet") {
      return /* @__PURE__ */ jsx(Text, { wrap: "wrap", children: `${"  ".repeat(part.indent || 0)}\u2022 ${part.text}` }, i);
    }
    if (part.type === "code") {
      return /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: part.text }, i);
    }
    if (part.type === "blank") return /* @__PURE__ */ jsx(Box, { height: 1 }, i);
    return /* @__PURE__ */ jsx(Text, { color: isError ? palette2.danger : void 0, wrap: "wrap", children: part.text || "" }, i);
  }) });
}
function RouteRailPanel({ overlay, width, palette: palette2, glyphs: glyphs2 }) {
  if (!overlay) return null;
  const risks = overlay.riskFlags ? Object.entries(overlay.riskFlags).filter(([, v]) => v).map(([k]) => k) : [];
  const chain = overlay.specialists || [];
  const gates = formatGateRows(overlay);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop: 1, children: [
    /* @__PURE__ */ jsx(Text, { color: palette2.accent, children: "route" }),
    overlay.track ? /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: "track" }),
      /* @__PURE__ */ jsx(Text, { children: overlay.track })
    ] }) : null,
    overlay.intent ? /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: "intent" }),
      /* @__PURE__ */ jsx(Text, { children: overlay.intent })
    ] }) : null,
    risks.length ? /* @__PURE__ */ jsx(Text, { color: palette2.warn, wrap: "wrap", children: `risk: ${risks.join(", ")}` }) : null,
    chain.length ? /* @__PURE__ */ jsx(Text, { wrap: "wrap", children: chain.join(` ${glyphs2.arrow} `) }) : /* @__PURE__ */ jsx(Text, { color: palette2.muted, children: "immediate \u2014 Construct responds directly" }),
    overlay.dispatchSummary ? /* @__PURE__ */ jsx(Text, { color: palette2.muted, wrap: "wrap", children: overlay.dispatchSummary }) : null,
    gates.length ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: palette2.accent, children: "gates" }),
      gates.map((g) => /* @__PURE__ */ jsx(Text, { color: palette2.warn, wrap: "wrap", children: `${g.label}: ${g.value}` }, g.label))
    ] }) : null
  ] });
}

// apps/chat/tui/turn-ui.jsx
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var LABEL_WIDTH = 10;
function Rule({ width, color, palette: palette2, glyphs: glyphs2, heavy = false }) {
  const muted = color || palette2?.muted || "gray";
  const char = heavy && glyphs2?.ruleHeavy ? glyphs2.ruleHeavy : "\u2500";
  return /* @__PURE__ */ jsx2(Text2, { color: muted, children: char.repeat(Math.max(1, width)) });
}
function TurnPhase({ title, width, palette: palette2, glyphs: glyphs2, children, marginTop = 1, marginBottom = 0 }) {
  if (!children) return null;
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginTop, marginBottom, width, children: [
    /* @__PURE__ */ jsx2(Text2, { color: palette2.accent, bold: true, children: title }),
    /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", paddingLeft: 2, borderStyle: "single", borderColor: palette2.border || palette2.muted, borderLeft: true, paddingX: 1, children })
  ] });
}
function ContextRow({ label, value, palette: palette2, valueColor }) {
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "row", marginBottom: 0, children: [
    /* @__PURE__ */ jsx2(Box2, { width: LABEL_WIDTH, children: /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: label }) }),
    /* @__PURE__ */ jsx2(Text2, { color: valueColor || void 0, wrap: "wrap", children: value })
  ] });
}
function RoutePhase({ turn, width, layers, palette: palette2, glyphs: glyphs2 }) {
  const rows = contextRows(turn?.overlay, { layers });
  if (!rows.length) return null;
  return /* @__PURE__ */ jsx2(TurnPhase, { title: "ROUTE", width, palette: palette2, glyphs: glyphs2, children: rows.map((row) => /* @__PURE__ */ jsx2(
    ContextRow,
    {
      label: row.label,
      value: row.value,
      palette: palette2,
      valueColor: row.label === "research" ? palette2.warn : row.label === "route" ? palette2.accentAlt : void 0
    },
    row.label
  )) });
}
function ThinkingPhase({ text, width, layers, palette: palette2, glyphs: glyphs2 }) {
  if (!text || layers?.thinking === false) return null;
  return /* @__PURE__ */ jsx2(TurnPhase, { title: "THINKING", width, palette: palette2, glyphs: glyphs2, children: /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: text }) });
}
function ToolsPhase({ tools, width, layers, palette: palette2, theme, detailDense = false }) {
  if (!tools?.length || layers?.tools === false) return null;
  const groups = summarizeToolCalls(tools);
  return /* @__PURE__ */ jsxs2(TurnPhase, { title: "TOOLS", width, palette: palette2, glyphs: theme.glyphs, children: [
    groups.map((group) => /* @__PURE__ */ jsx2(Text2, { color: toolColor(group.status, theme), wrap: "wrap", children: `${toolGlyph(group.status, theme)} ${toolGroupLabel(group)}` }, group.title)),
    detailDense ? /* @__PURE__ */ jsx2(ToolDetailList, { tools, width: width - 4, theme }) : null
  ] });
}
function SourcesPhase({ turn, width, layers, palette: palette2, glyphs: glyphs2 }) {
  const src = summarizeSources(turn?.sources || []);
  if (!src.total) return null;
  const split = splitSourceLines(src.refs, { limit: 12 });
  return /* @__PURE__ */ jsxs2(TurnPhase, { title: "SOURCES", width, palette: palette2, glyphs: glyphs2, children: [
    split.lines.map((line) => /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: line }, line)),
    split.hidden > 0 ? /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: `+${split.hidden} more` }) : null
  ] });
}
function AnswerPhase({
  assistant,
  working,
  width,
  palette: palette2,
  glyphs: glyphs2,
  theme,
  isError
}) {
  if (!assistant && !working) return null;
  return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", marginTop: 1, marginBottom: 1, width, children: /* @__PURE__ */ jsxs2(TurnPhase, { title: "CONSTRUCT", width, palette: palette2, glyphs: glyphs2, marginTop: 0, children: [
    assistant ? /* @__PURE__ */ jsx2(MarkdownMessage, { text: assistant, width: width - 4, palette: palette2, isError }) : null,
    working && !assistant ? /* @__PURE__ */ jsx2(Text2, { color: palette2.warn, children: `${glyphs2.block} working\u2026` }) : null,
    working && assistant ? /* @__PURE__ */ jsx2(Text2, { color: palette2.warn, children: glyphs2.block }) : null
  ] }) });
}
function TurnMetricsPhase({ usage, width, layers, palette: palette2, glyphs: glyphs2 }) {
  if (!usage || layers?.observability === false) return null;
  const line = stripAnsi(formatTurnUsageLine(usage, {}));
  return /* @__PURE__ */ jsx2(TurnPhase, { title: "USAGE", width, palette: palette2, glyphs: glyphs2, marginBottom: 1, children: /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: line }) });
}
function ToolDetailList({ tools, width, theme }) {
  if (!tools?.length) return null;
  return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", marginTop: 0, children: tools.map((tool) => {
    const ref = tool.input?.path || tool.input?.pattern || tool.input?.glob || tool.input?.name;
    const detail = ref ? `  ${ref}` : "";
    return /* @__PURE__ */ jsx2(Text2, { color: toolColor(tool.status, theme), wrap: "wrap", children: `${toolGlyph(tool.status, theme)} ${tool.title || "tool"}${detail}` }, tool.id);
  }) });
}
function MarkdownMessage({ text, width, palette: palette2, isError = false }) {
  if (!text) return null;
  const parts = parseMarkdownLines(text, { width: Math.max(20, width - 2) });
  return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", marginTop: 0, width, children: parts.map((part, i) => {
    if (part.type === "heading") {
      return /* @__PURE__ */ jsx2(Box2, { marginTop: i > 0 ? 1 : 0, children: /* @__PURE__ */ jsx2(Text2, { bold: true, color: isError ? palette2.danger : palette2.text, wrap: "wrap", children: part.text }) }, i);
    }
    if (part.type === "bullet") {
      const pad = "  ".repeat(part.indent || 0);
      return /* @__PURE__ */ jsx2(Text2, { wrap: "wrap", children: `${pad}${"\u2022"} ${part.text}` }, i);
    }
    if (part.type === "code") {
      return /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: `  ${part.text}` }, i);
    }
    if (part.type === "rule") {
      return /* @__PURE__ */ jsx2(Rule, { width: Math.min(width, 40), palette: palette2 }, i);
    }
    if (part.type === "blank") return /* @__PURE__ */ jsx2(Box2, { height: 1 }, i);
    return /* @__PURE__ */ jsx2(Text2, { color: isError ? palette2.danger : void 0, wrap: "wrap", children: part.text || "" }, i);
  }) });
}
function TurnContextBar({ turn, width, layers, palette: palette2, glyphs: glyphs2 }) {
  return /* @__PURE__ */ jsxs2(Fragment, { children: [
    /* @__PURE__ */ jsx2(RoutePhase, { turn, width, layers, palette: palette2, glyphs: glyphs2 }),
    /* @__PURE__ */ jsx2(SourcesPhase, { turn, width, layers, palette: palette2, glyphs: glyphs2 })
  ] });
}
function SystemNotice({ text, palette: palette2 }) {
  if (!text) return null;
  return /* @__PURE__ */ jsx2(Box2, { marginTop: 1, marginBottom: 1, children: /* @__PURE__ */ jsx2(Text2, { color: palette2.warn, wrap: "wrap", children: text }) });
}
function TurnTranscript({
  turn,
  width,
  layers,
  liveAssistant = "",
  liveThinking = "",
  working = false,
  turnIndex = null,
  detailDense = false,
  theme
}) {
  const { palette: palette2, glyphs: glyphs2 } = theme;
  const assistant = liveAssistant || turn.assistant || "";
  const thinking = liveThinking || turn.thinking || "";
  const isError = typeof assistant === "string" && assistant.startsWith("[error]");
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginBottom: 2, width, children: [
    turnIndex != null ? /* @__PURE__ */ jsx2(Box2, { marginBottom: 0, children: /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, bold: true, children: `TURN ${turnIndex}` }) }) : null,
    /* @__PURE__ */ jsx2(TurnPhase, { title: "YOU", width, palette: palette2, glyphs: glyphs2, marginTop: turnIndex != null ? 0 : 0, children: /* @__PURE__ */ jsx2(Text2, { wrap: "wrap", children: turn.userText }) }),
    /* @__PURE__ */ jsx2(RoutePhase, { turn, width, layers, palette: palette2, glyphs: glyphs2 }),
    /* @__PURE__ */ jsx2(ThinkingPhase, { text: thinking, width, layers, palette: palette2, glyphs: glyphs2 }),
    /* @__PURE__ */ jsx2(ToolsPhase, { tools: turn.tools, width, layers, palette: palette2, theme, detailDense }),
    /* @__PURE__ */ jsx2(SourcesPhase, { turn, width, layers, palette: palette2, glyphs: glyphs2 }),
    /* @__PURE__ */ jsx2(
      AnswerPhase,
      {
        assistant,
        working,
        width,
        palette: palette2,
        glyphs: glyphs2,
        theme,
        isError
      }
    ),
    /* @__PURE__ */ jsx2(TurnMetricsPhase, { usage: turn.usage, width, layers, palette: palette2, glyphs: glyphs2 }),
    (turn.notices || []).map((n, i) => /* @__PURE__ */ jsx2(SystemNotice, { text: n, palette: palette2 }, i))
  ] });
}
var TurnView = TurnTranscript;
function sessionUsageSummary(session) {
  const t = session?.usage?.tokens || {};
  const parts = [];
  if (t.total) parts.push(`${formatTokens(t.total)} tok`);
  if (session?.usage?.cost?.amount > 0) {
    const c = session.usage.cost.amount;
    parts.push(`~$${c.toFixed(c < 1 ? 3 : 2)}`);
  }
  if (session?.usage?.turns) parts.push(`${session.usage.turns} turn${session.usage.turns === 1 ? "" : "s"}`);
  return parts.join(" \xB7 ") || "no tokens yet";
}
function layerPills(layers, palette2, glyphs2) {
  return LAYER_KEYS.map((k) => {
    const on = layers?.[k] !== false;
    return `${k}${on ? "" : "\u2717"}`;
  }).join(`  ${glyphs2.gutter}  `);
}
function SessionHeader({
  cols,
  session,
  layers,
  sandbox,
  permissionMode,
  working,
  spin,
  ctx,
  theme,
  workingBranch
}) {
  const { palette: palette2, glyphs: glyphs2 } = theme;
  const { label, isRouter } = formatModelHeader(session);
  const ctxMeter = ctx?.size ? meter(ctx.used, ctx.size, Math.max(12, Math.floor(cols * 0.18)), theme) : null;
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginBottom: 0, children: [
    /* @__PURE__ */ jsxs2(Box2, { width: cols, justifyContent: "space-between", children: [
      /* @__PURE__ */ jsxs2(Box2, { children: [
        /* @__PURE__ */ jsx2(Text2, { color: palette2.accent, bold: true, children: `${glyphs2.brand} construct` }),
        /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: `  ${glyphs2.gutter}  chat` })
      ] }),
      /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", alignItems: "flex-end", children: [
        /* @__PURE__ */ jsxs2(Box2, { children: [
          /* @__PURE__ */ jsx2(Text2, { bold: true, color: palette2.text, wrap: "wrap", children: label || "(no model)" }),
          /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: `   ${sandbox || "workspace-write"}  ${glyphs2.gutter}  ${permissionMode || "allow_once"}  ` }),
          /* @__PURE__ */ jsx2(Text2, { color: working ? palette2.warn : palette2.ok, children: working ? spin : glyphs2.dot })
        ] }),
        isRouter ? /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: "free-router \\u2014 re-picks on launch and on failure" }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsxs2(Box2, { width: cols, marginTop: 0, flexDirection: "row", justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx2(Box2, { flexDirection: "row", children: ctxMeter ? /* @__PURE__ */ jsxs2(Fragment, { children: [
        /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: "context " }),
        /* @__PURE__ */ jsx2(Text2, { color: ratioColor(ctxMeter.ratio, theme), children: ctxMeter.bar }),
        /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: ` ${percent(ctxMeter.ratio)}` })
      ] }) : /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: "context not reported yet" }) }),
      /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: `session ${sessionUsageSummary(session)}` })
    ] }),
    /* @__PURE__ */ jsx2(Box2, { width: cols, marginTop: 0, children: /* @__PURE__ */ jsxs2(Text2, { color: palette2.muted, wrap: "wrap", children: [
      `layers ${layerPills(layers, palette2, glyphs2)}`,
      workingBranch ? `  ${glyphs2.gutter}  branch ${workingBranch}` : ""
    ] }) }),
    /* @__PURE__ */ jsx2(Rule, { width: cols, palette: palette2, glyphs: glyphs2, heavy: true })
  ] });
}
function PanelSection({ title, children, marginTop = 1, palette: palette2 }) {
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginTop, children: [
    /* @__PURE__ */ jsx2(Text2, { color: palette2.accent, children: title }),
    children
  ] });
}
function SessionRail({
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
  theme,
  cwd,
  modelNotice,
  routeOverlay = null
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
  const oracle = readOracleDockState({ cwd, env: process.env });
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", width, borderStyle: "round", borderColor: palette2.border || palette2.accent, paddingX: 1, children: [
    /* @__PURE__ */ jsx2(Text2, { color: palette2.brandAccent || palette2.accent, bold: true, children: `${glyphs2.brand} session` }),
    /* @__PURE__ */ jsx2(Rule, { width: width - 2, palette: palette2, glyphs: glyphs2, heavy: true }),
    /* @__PURE__ */ jsxs2(PanelSection, { title: "model", marginTop: 1, palette: palette2, children: [
      /* @__PURE__ */ jsx2(Text2, { bold: true, color: palette2.text, wrap: "wrap", children: label || "(none)" }),
      modelNotice ? /* @__PURE__ */ jsx2(Text2, { color: palette2.warn, wrap: "wrap", children: modelNotice }) : null,
      sandbox || permissionMode ? /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: [sandbox, permissionMode].filter(Boolean).join(` ${glyphs2.gutter} `) }) : null
    ] }),
    oracle.visible ? /* @__PURE__ */ jsxs2(PanelSection, { title: "oracle", palette: palette2, children: [
      /* @__PURE__ */ jsx2(Text2, { color: palette2.warn, wrap: "wrap", children: oracle.summary }),
      oracle.topGaps.slice(0, 2).map((g) => /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: `${g.id}: ${g.detail}` }, g.id)),
      /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: "/oracle for detail" })
    ] }) : null,
    /* @__PURE__ */ jsxs2(PanelSection, { title: "layers", palette: palette2, children: [
      /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: LAYER_KEYS.map((k, i) => `${k}=${layers?.[k] !== false ? "on" : "off"}`).join(`  ${glyphs2.gutter}  `) }),
      /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, wrap: "wrap", children: `Ctrl+1\u20135 toggle   /set pickers` })
    ] }),
    routeOverlay ? /* @__PURE__ */ jsx2(RouteRailPanel, { overlay: routeOverlay, width: width - 2, palette: palette2, glyphs: glyphs2 }) : null,
    /* @__PURE__ */ jsx2(PanelSection, { title: "context", palette: palette2, children: ctxMeter ? /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx2(Text2, { color: ratioColor(ctxMeter.ratio, theme), children: ctxMeter.bar }),
      /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: `${formatTokens(ctx.used)}/${formatTokens(ctx.size)}  ${percent(ctxMeter.ratio)}` })
    ] }) : /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: "not reported yet" }) }),
    /* @__PURE__ */ jsx2(PanelSection, { title: `usage ${glyphs2.gutter} ${u.turns} turn${u.turns === 1 ? "" : "s"}`, palette: palette2, children: ledger.length ? ledger.map(([k, v]) => /* @__PURE__ */ jsxs2(Box2, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: k }),
      /* @__PURE__ */ jsx2(Text2, { children: v })
    ] }, k)) : /* @__PURE__ */ jsx2(Text2, { color: palette2.muted, children: "no tokens yet" }) }),
    /* @__PURE__ */ jsx2(Box2, { marginTop: 1, children: /* @__PURE__ */ jsx2(Text2, { color: working ? palette2.warn : palette2.ok, children: working ? `${spin} working\u2026` : `${glyphs2.dot} idle` }) })
  ] });
}
var SessionDock = SessionRail;
var TransparencyPanel = SessionRail;

// apps/chat/tui/picker-ui.jsx
import React3 from "react";
import { Box as Box3, Text as Text3 } from "ink";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function ListPickerOverlay({ picker, width, theme, currentId = null, markerId = null }) {
  const { palette: palette2, glyphs: glyphs2 } = theme;
  if (!picker?.items?.length) return null;
  const visible = getPickerVisibleItems(picker);
  const { items, offset } = pickerViewport(picker, 14);
  const queryLine = picker.query ? `filter: ${picker.query}` : "type to search";
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", marginY: 1, borderStyle: "round", borderColor: palette2.accent, paddingX: 1, width: Math.min(width, 80), children: [
    /* @__PURE__ */ jsx3(Text3, { color: palette2.accent, bold: true, children: picker.title || "select" }),
    /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: `${queryLine}   ${glyphs2.gutter}   \u2191/\u2193 move   enter select   esc cancel` }),
    !visible.length ? /* @__PURE__ */ jsx3(Text3, { color: palette2.warn, children: "no matches \u2014 backspace to edit filter" }) : items.map((item, i) => {
      const absolute = offset + i;
      const selected = absolute === picker.index;
      const marked = markerId && item.id === markerId || currentId && item.id === currentId;
      const muted = item.disabled && !selected;
      return /* @__PURE__ */ jsxs3(Text3, { color: selected ? palette2.accent : muted ? palette2.muted : void 0, bold: selected, wrap: "wrap", children: [
        `${selected ? glyphs2.caret : " "} ${String(absolute + 1).padStart(2)}. ${marked ? `${glyphs2.dot} ` : "  "}${item.label || item.id}`,
        item.tag ? /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: ` [${item.tag}]` }) : null,
        item.detail ? /* @__PURE__ */ jsx3(Text3, { color: item.disabled ? palette2.warn : palette2.muted, children: ` \u2014 ${item.detail}` }) : null
      ] }, `${item.id}-${absolute}`);
    }),
    visible.length > items.length ? /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: `${offset + 1}-${offset + items.length} of ${visible.length} shown (${picker.items.length} total)` }) : visible.length ? /* @__PURE__ */ jsx3(Text3, { color: palette2.muted, children: `${visible.length} item${visible.length === 1 ? "" : "s"}` }) : null
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
  "/oracle",
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
import { Fragment as Fragment2, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var ChatThemeContext = createContext(createTheme());
function useChatTheme() {
  return useContext(ChatThemeContext);
}
function EmptyState({ model, savedModel, demoGuide, demoTitle }) {
  const { palette: palette2, glyphs: glyphs2 } = useChatTheme();
  const { provider, name } = splitModel(model);
  const saved = savedModel && savedModel !== model ? splitModel(savedModel) : null;
  if (demoGuide?.script) {
    return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", paddingY: 1, children: [
      /* @__PURE__ */ jsx4(Text4, { color: palette2.accent, bold: true, children: `${glyphs2.brand} demo: ${demoTitle || demoGuide.script.title}` }),
      /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, wrap: "wrap", children: demoGuide.script.summary }) }),
      /* @__PURE__ */ jsxs4(Box4, { marginTop: 1, flexDirection: "column", children: [
        /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: "Steps \u2014 type /demo next for the next prompt" }),
        demoGuide.script.steps.map((step, i) => /* @__PURE__ */ jsx4(Text4, { color: palette2.text, children: `  ${i + 1}. ${step.title || "step"}` }, i))
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", paddingY: 1, children: [
    /* @__PURE__ */ jsx4(Text4, { color: palette2.accent, bold: true, children: `${glyphs2.brand} welcome to construct chat` }),
    /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, wrap: "wrap", children: "Each turn shows route, thinking, tools, sources, and usage inline before the answer. Session metrics stay in the rail on the right. /set toggles layers; /inspect expands tool detail." }) }),
    /* @__PURE__ */ jsxs4(Box4, { marginTop: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: "To get going" }),
      /* @__PURE__ */ jsx4(Text4, { color: palette2.text, children: `  ${glyphs2.caret} ask a question or describe the change you want` }),
      /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: `  ${glyphs2.caret} shift+enter newline   tab completes /commands   /model /set open searchable pickers` }),
      /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: `  ${glyphs2.caret} construct chat --resume restores the last session` })
    ] }),
    name && name !== "(no model)" ? /* @__PURE__ */ jsxs4(Box4, { marginTop: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsxs4(Box4, { children: [
        /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: `active model ` }),
        /* @__PURE__ */ jsx4(Text4, { color: palette2.text, bold: true, children: provider ? `${provider}/${name}` : name })
      ] }),
      saved ? /* @__PURE__ */ jsx4(Box4, { marginTop: 0, children: /* @__PURE__ */ jsx4(Text4, { color: palette2.warn, wrap: "wrap", children: `saved ${saved.provider ? `${saved.provider}/` : ""}${saved.name} \u2014 OpenRouter unavailable; /model to change` }) }) : null
    ] }) : /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: /* @__PURE__ */ jsx4(Text4, { color: palette2.warn, children: `${glyphs2.caret} no model selected \u2014 set one with /model or a provider key` }) })
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
  detailDense,
  theme,
  demoGuide,
  demoTitle
}) {
  if (!turnBlocks.length && !activeTurn) {
    return /* @__PURE__ */ jsx4(Box4, { flexDirection: "column", width, paddingRight: 2, children: /* @__PURE__ */ jsx4(EmptyState, { model, savedModel, demoGuide, demoTitle }) });
  }
  const completed = activeTurn ? turnBlocks.slice(0, -1) : turnBlocks;
  let turnNum = 0;
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", width, paddingRight: 2, children: [
    completed.map((item) => {
      if (item.kind === "system") {
        return /* @__PURE__ */ jsx4(SystemLogLine, { text: item.text, width, palette: theme.palette }, `sys-${item.text?.slice(0, 24)}-${turnNum}`);
      }
      if (item.kind !== "turn") return null;
      turnNum += 1;
      return /* @__PURE__ */ jsx4(
        CompactTurnLog,
        {
          turn: item.block,
          width,
          layers,
          turnIndex: turnNum,
          detailDense,
          theme
        },
        item.block.id
      );
    }),
    activeTurn ? /* @__PURE__ */ jsx4(
      CompactTurnLog,
      {
        turn: activeTurn,
        width,
        layers,
        liveAssistant,
        liveThinking,
        working,
        turnIndex: turnNum + 1,
        detailDense,
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
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx4(Rule, { width: cols, palette: palette2 }),
    notice ? /* @__PURE__ */ jsx4(Text4, { color: palette2.warn, children: notice }) : null,
    suggestHint && !listPickerActive && !permissionActive ? /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, wrap: "wrap", children: `tab complete   ${suggestHint}` }) : null,
    /* @__PURE__ */ jsxs4(Box4, { children: [
      /* @__PURE__ */ jsx4(Text4, { color: palette2.accent, bold: true, children: permissionActive ? `${glyphs2.caret} permission ` : listPickerActive ? `${glyphs2.caret} pick ` : `you ${glyphs2.caret} ` }),
      listPickerActive ? /* @__PURE__ */ jsx4(Text4, { color: palette2.text, children: pickerQuery || "" }) : /* @__PURE__ */ jsxs4(Fragment2, { children: [
        /* @__PURE__ */ jsx4(Text4, { color: palette2.text, children: input }),
        ghost ? /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: ghost }) : null
      ] }),
      !permissionActive && !listPickerActive && !working ? /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: glyphs2.block }) : null
    ] }),
    /* @__PURE__ */ jsx4(Text4, { color: palette2.muted, children: permissionActive ? "\u2191/\u2193 move   enter select   y/a/n shortcut   esc cancel" : listPickerActive ? "type to filter   \u2191/\u2193 move   enter select   esc cancel" : `enter send   tab complete   shift+enter newline   ${glyphs2.gutter}   /help   Ctrl+1-5 layers   Ctrl-C ${working ? "cancel" : "exit"}` })
  ] });
}
function toggleDetailDense(session) {
  session.detailDense = !session.detailDense;
  return session.detailDense ? "expanded" : "compact";
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
  const [cols, setCols] = useState(stdout?.columns || 100);
  useEffect(() => {
    const onResize = () => setCols(stdout?.columns || 100);
    stdout?.on?.("resize", onResize);
    return () => stdout?.off?.("resize", onResize);
  }, [stdout]);
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
      turnBlocksRef: () => turnBlocksRef.current,
      demoGuide: session.demoGuide || null
    }),
    [driver, cwd, session.demoGuide]
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
  const [routeOverlay, setRouteOverlay] = useState(null);
  const [, forceTick] = useState(0);
  const busy = useRef(false);
  const inputHistory = useRef([]);
  const historyPos = useRef(-1);
  const activeTurnRef = useRef(null);
  const workingBranch = useMemo(() => {
    try {
      return buildPlanContext({ session, cwd, turnBlocks, text: "" }).workingBranch || null;
    } catch {
      return null;
    }
  }, [cwd, session, turnBlocks.length]);
  const railWidth = Math.min(36, Math.max(28, Math.floor(cols * 0.15)));
  const convWidth = Math.max(20, cols - railWidth - 2);
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
      permissionBridge.prompt = (req) => new Promise((resolve4) => {
        setListPicker(createListPickerState({
          kind: "permission",
          title: `Allow "${req.tool || "tool"}"?`,
          items: PERMISSION_PICKER_ITEMS,
          context: { resolve: resolve4, req }
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
  const toggleDetail = useCallback(() => {
    setNotice(`tool detail: ${toggleDetailDense(session)}`);
    setUiEpoch((n) => n + 1);
  }, [session]);
  const toggleLayerShortcut = useCallback((layerKey) => {
    const on = layers[layerKey] !== false;
    const result = applySessionSetting(session, layers, layerKey, on ? "off" : "on", { cwd });
    if (!result.ok) setNotice(result.error || "invalid layer");
    else setNotice(`${layerKey}: ${on ? "off" : "on"}`);
    setUiEpoch((n) => n + 1);
  }, [cwd, layers, session]);
  const handleCommand = useCallback(async (text) => {
    const trimmed = text.trim();
    if (trimmed === "/inspect") {
      toggleDetail();
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
        setRouteOverlay(null);
      }
    });
    const msg = stripAnsi(out.text()).trim();
    if (msg) {
      setTurnBlocks((prev) => [...prev, { kind: "system", text: msg }]);
    }
    setUiEpoch((n) => n + 1);
    if (!keep) exit();
  }, [commands, env, exit, layers, openModelPicker, openSettingKeyPicker, session, toggleDetail]);
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
      if (overlay) {
        applyOverlayToTurn(turn, overlay);
        setRouteOverlay(overlay);
      }
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
    if (key.ctrl && char >= "1" && char <= "5" && !input) {
      toggleLayerShortcut(LAYER_KEYS[Number(char) - 1]);
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
      toggleDetail();
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
  return /* @__PURE__ */ jsx4(ChatThemeContext.Provider, { value: theme, children: /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx4(
      SessionHeader,
      {
        cols,
        session,
        layers,
        sandbox: session.sandbox,
        permissionMode: session.permissionMode,
        working,
        spin,
        ctx,
        theme,
        workingBranch
      }
    ),
    listPicker ? /* @__PURE__ */ jsx4(
      ListPickerOverlay,
      {
        picker: listPicker,
        width: convWidth,
        theme,
        currentId: listPicker.kind === "model" ? pickerSelectedId(session) : null,
        markerId: listPicker.kind === "model" && session.modelMode !== "free-router" ? session.model : null
      }
    ) : null,
    /* @__PURE__ */ jsxs4(Box4, { children: [
      /* @__PURE__ */ jsx4(
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
          detailDense: Boolean(session.detailDense),
          theme,
          demoGuide: session.demoGuide,
          demoTitle: session.demoTitle
        }
      ),
      /* @__PURE__ */ jsx4(
        SessionRail,
        {
          width: railWidth,
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
          theme,
          cwd,
          modelNotice: session.modelNotice || notice || "",
          routeOverlay
        }
      )
    ] }),
    /* @__PURE__ */ jsx4(
      Footer,
      {
        cols,
        input,
        working,
        notice: notice && notice !== session.modelNotice ? notice : "",
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
    /* @__PURE__ */ jsx4(
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
  CompactTurnLog,
  EmptyState,
  RouteRailPanel,
  SessionDock,
  SessionHeader,
  SessionRail,
  SystemLogLine,
  TransparencyPanel,
  TurnContextBar,
  TurnTranscript,
  TurnView,
  createTheme,
  index_default as default,
  runInkChat
};
