#!/usr/bin/env node
/**
 * lib/host-capabilities.mjs — <one-line purpose>
 *
 * <2–6 line summary.>
 */
import { execFileSync, execSync } from "node:child_process";
import { readOpenCodeConfig } from "./opencode-config.mjs";
import net from "node:net";

export async function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

function commandVersion(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
      .toString()
      .trim();
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

export function detectHostCapabilities() {
  const claudeRaw = commandVersion("claude");
  const claudeVersion = parseClaudeVersion(claudeRaw);
  const claudeTeamsSupported = versionAtLeast(claudeVersion, { major: 2, minor: 1, patch: 32 });
  const tmuxRaw = commandVersion("tmux", ["-V"]);
  const opencodeRaw = commandVersion("opencode");
  const codexRaw = commandVersion("codex");

  return [
    {
      host: "Claude Code",
      availability: claudeRaw ? "installed" : "missing",
      version: claudeRaw,
      orchestration: claudeTeamsSupported ? "full-multi-agent" : "primary-plus-subagents",
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
      promptableWorkers: false,
      sharedTaskRuntime: "construct-workflow",
      lifecycleHooks: ["session.error", "session.idle", "tool.execute.before", "tool.execute.after"],
      notes: [
        "Primary agents are promptable; subagents are bounded worker sessions.",
        "Construct uses .cx/workflow.json plus task permissions and plugins to coordinate parallel worker execution.",
        "Use NEEDS_MAIN_INPUT to route user questions back to the primary persona.",
      ],
    },
    {
      host: "Codex",
      availability: codexRaw ? "installed" : "missing",
      version: codexRaw,
      orchestration: "profile-and-mcp",
      promptableWorkers: false,
      sharedTaskRuntime: "construct-workflow",
      lifecycleHooks: [],
      notes: [
        "Use Construct profiles, MCP workflow tools, and the active session.",
        "Native profile switching is not automatic; continue in-session when dispatch is unavailable.",
      ],
    },
  ];
}

export function printHostCapabilities(hosts = detectHostCapabilities()) {
  console.log("Construct orchestration host capabilities:");
  for (const host of hosts) {
    console.log("");
    console.log(`${host.host}: ${host.availability}${host.version ? ` (${host.version})` : ""}`);
    console.log(`  orchestration: ${host.orchestration}`);
    console.log(`  promptable workers: ${host.promptableWorkers === true ? "yes" : "no"}`);
    console.log(`  shared task runtime: ${host.sharedTaskRuntime === true ? "native" : host.sharedTaskRuntime || "none"}`);
    if (host.lifecycleHooks.length) console.log(`  lifecycle hooks: ${host.lifecycleHooks.join(", ")}`);
    for (const note of host.notes) console.log(`  - ${note}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHostCapabilities();
}
