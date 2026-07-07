#!/usr/bin/env node
/**
 * lib/host-capabilities.mjs — Detect the active AI harness and its tool surface.
 *
 * Inspects the runtime environment (process title, env vars, OpenCode config)
 * to classify whether Construct is running inside Claude Code, OpenCode,
 * a plain terminal, or a multi-agent subagent context. The MCP server and
 * CLI consult the classification to gate harness-specific features.
 */
import { execFileSync, execSync } from "node:child_process";
import { readOpenCodeConfig } from "./opencode-config.mjs";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { isMainModule } from './roots.mjs';

const LOWEST_PORT = 0;
const HIGHEST_PORT = 65535;
const RETRYABLE_PORT_ERRORS = new Set(["EADDRINUSE", "EACCES"]);

export async function findAvailablePort(startPort, { maxPort = HIGHEST_PORT } = {}) {
  if (!Number.isInteger(startPort) || startPort < LOWEST_PORT || startPort > HIGHEST_PORT) {
    throw new RangeError(`startPort must be an integer between ${LOWEST_PORT} and ${HIGHEST_PORT}. Received ${startPort}.`);
  }
  if (!Number.isInteger(maxPort) || maxPort < LOWEST_PORT || maxPort > HIGHEST_PORT) {
    throw new RangeError(`maxPort must be an integer between ${LOWEST_PORT} and ${HIGHEST_PORT}. Received ${maxPort}.`);
  }
  if (startPort > maxPort) {
    throw new RangeError(`startPort ${startPort} must be less than or equal to maxPort ${maxPort}.`);
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", (error) => {
      if (!RETRYABLE_PORT_ERRORS.has(error?.code) || startPort >= maxPort) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(findAvailablePort(startPort + 1, { maxPort }));
    });
  });
}

function commandVersion(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
      .toString()
      .trim()
      .split(/\r?\n/, 1)[0];
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
    patch: Number(match[3]),
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

function detectVsCodeAvailability(homeDir = os.homedir()) {
  const settingsCandidates = (() => {
    const platform = os.platform();
    if (platform === "darwin") {
      return [
        path.join(homeDir, "Library", "Application Support", "Code", "User", "settings.json"),
        path.join(homeDir, "Library", "Application Support", "Code - Insiders", "User", "settings.json"),
      ];
    }
    if (platform === "linux") {
      return [
        path.join(homeDir, ".config", "Code", "User", "settings.json"),
        path.join(homeDir, ".config", "Code - Insiders", "User", "settings.json"),
      ];
    }
    if (platform === "win32") {
      const appData = process.env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");
      return [
        path.join(appData, "Code", "User", "settings.json"),
        path.join(appData, "Code - Insiders", "User", "settings.json"),
      ];
    }
    return [];
  })();

  const version = commandVersion("code") || commandVersion("code-insiders");
  const hasSettings = settingsCandidates.some((candidate) => fs.existsSync(candidate));
  return { version, hasSettings };
}

function detectCursorAvailability(homeDir = os.homedir()) {
  const version = commandVersion("cursor") || commandVersion("cursor-agent");
  const hasConfig = fs.existsSync(path.join(homeDir, ".cursor", "mcp.json"));
  return { version, hasConfig };
}

function detectCopilotAvailability(homeDir = os.homedir()) {
  const promptsDir = path.join(homeDir, ".github", "prompts");
  const instructionsPath = path.join(homeDir, ".github", "copilot-instructions.md");
  const hasFiles = fs.existsSync(promptsDir) || fs.existsSync(instructionsPath);
  return { hasFiles };
}

/**
 * Detects active host-native sessions (GitHub, Anthropic, etc.).
 * Returns a list of authenticated provider families.
 */
export function detectActiveSessions() {
  const active = [];
  
  // GitHub Copilot check
  try {
    const ghStatus = execSync("gh auth status", { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    if (ghStatus.includes("Logged in to github.com")) {
      active.push("github-copilot");
    }
  } catch { /* not logged in or gh cli missing */ }
  
  // Anthropic / Claude Code check. MCP server definitions live in
  // ~/.claude.json's top-level `mcpServers`, not settings.json (construct-ranh);
  // settings.json is still checked for `primaryModel` and any legacy `mcpServers`
  // a user configured by hand before that was confirmed inert.
  const home = os.homedir();
  const claudeSettings = path.join(home, ".claude", "settings.json");
  const claudeUserConfig = path.join(home, ".claude.json");
  try {
    if (fs.existsSync(claudeSettings)) {
      const settings = JSON.parse(fs.readFileSync(claudeSettings, "utf8"));
      if (settings?.primaryModel || settings?.mcpServers) {
        active.push("anthropic");
      }
    }
    if (!active.includes("anthropic") && fs.existsSync(claudeUserConfig)) {
      const userConfig = JSON.parse(fs.readFileSync(claudeUserConfig, "utf8"));
      if (userConfig?.mcpServers) {
        active.push("anthropic");
      }
    }
  } catch { /* invalid or missing config */ }
  
  return active;
}

// `capability` is the honest, normalized functional classification per host:
//   full-native      — the host runs a multi-specialist chain itself (native
//                       dispatch or config-driven agents): Claude Code, OpenCode.
//   mcp-orchestrated  — no native subagent primitive, but the host calls the
//                       `orchestration_run` MCP tool to reach the same orchestrated
//                       outcome in-process: Codex, VS Code, Cursor, Copilot.
//   prompt-only       — neither native dispatch nor MCP; instruction files only.
//                       No supported 2026 host is prompt-only.

export function detectHostCapabilities() {
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
      notes: claudeTeamsSupported
        ? [
            "Best host for full multi-agent orchestration.",
            "Enable CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1.",
            tmuxRaw ? "tmux split-pane display is available." : "tmux is not installed; use in-process teammate mode or install tmux/iTerm2 integration.",
          ]
        : ["Upgrade Claude Code to 2.1.32 or newer for Agent Teams."],
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
        "Use NEEDS_MAIN_INPUT to route user questions back to the primary persona.",
      ],
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
        "Run a full multi-specialist chain via the `orchestration_run` MCP tool (in-process; no daemon needed).",
        "Use Construct profiles, MCP project/memory tools, and the active session for single-pass work.",
      ],
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
        "Run a full multi-specialist chain via the `orchestration_run` MCP tool in Copilot agent mode (in-process; no daemon needed).",
        "Construct's MCP servers load from `.vscode/mcp.json` (project) and the user-profile `mcp.json` (global, only when it already exists).",
      ],
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
        "Run a full multi-specialist chain via the `orchestration_run` MCP tool (in-process; no daemon needed).",
        "Construct manages Cursor MCP registrations in `.cursor/mcp.json` (project) and `~/.cursor/mcp.json` (global, when it already exists).",
      ],
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
        "Copilot agent mode runs Construct's MCP tools — use `orchestration_run` for a real multi-specialist chain (in-process; no daemon needed).",
        "Construct also writes reusable prompt profiles under `.github/prompts/` for single-pass role work.",
      ],
    },
  ];
}

export function formatHostCapabilitiesJson(hosts = detectHostCapabilities()) {
  return JSON.stringify(hosts, null, 2) + '\n';
}

export function printHostCapabilities(hosts = detectHostCapabilities()) {
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

if (isMainModule(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--json')) {
    process.stdout.write(formatHostCapabilitiesJson());
  } else {
    printHostCapabilities();
  }
}
