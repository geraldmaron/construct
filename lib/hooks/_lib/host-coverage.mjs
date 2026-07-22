/**
 * lib/hooks/_lib/host-coverage.mjs — honest map of where Construct quality
 * gates fire, and which compensating controls apply when Layer-1 agent hooks
 * are unavailable.
 *
 * Construct wires lifecycle hooks only through
 * `platforms/claude/settings.template.json` into Claude Code. Other hosts may
 * expose their own hook APIs; Construct deliberately does not claim parity or
 * ship a mirrored `.cursor/hooks.json`. See docs/guides/concepts/hooks.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { HOST_KEYS, getCapability } from '../../platforms/capabilities.mjs';

/** Hosts Construct currently installs agent lifecycle hooks for. */
export const CONSTRUCT_WIRED_HOOK_HOSTS = Object.freeze(['claude']);

/**
 * Research citations for host-native hook capability (2025–2026).
 * These describe the *host* product, not Construct wiring.
 */
export const HOST_HOOK_RESEARCH = Object.freeze([
  {
    host: 'cursor',
    claim: 'Cursor documents native Agent hooks (preToolUse, postToolUse, sessionStart, stop, …) via `.cursor/hooks.json`, plus optional Claude Code third-party hook loading.',
    urls: [
      'https://cursor.com/docs/hooks',
      'https://cursor.com/docs/reference/third-party-hooks',
    ],
    constructWires: false,
    whyNotFullParity: [
      'Tool-name mapping is incomplete (Claude Bash→Cursor Shell, Edit→Write; Glob/WebFetch/WebSearch have no Claude→Cursor matcher map per third-party docs).',
      'Non-exit-2 hook failures fail open (action proceeds) — unsafe to treat as Claude-equivalent hard gates.',
      'Third-party Claude settings loading requires an explicit Cursor Settings opt-in ("Include third-party Plugins, Skills, and other configs").',
      'Known coverage gaps: AskQuestion skips pre/postToolUse; WebSearch/WebFetch hooks unreliable under Auto model routing (Cursor forum reports, 2026).',
      'Shipping a mirrored Construct hook suite would create false confidence without Claude Code semantics.',
    ],
  },
  {
    host: 'codex',
    claim: 'Construct capability registry marks Codex hooks.supported=false; no Construct lifecycle-hook install path.',
    urls: [],
    constructWires: false,
    whyNotFullParity: ['No Construct adapter writes Codex agent hooks.'],
  },
  {
    host: 'opencode',
    claim: 'OpenCode exposes its own session/tool events; Construct does not wire lib/hooks into them.',
    urls: [],
    constructWires: false,
    whyNotFullParity: ['platforms/capabilities.json hooks.supported=false for opencode.'],
  },
  {
    host: 'vscode',
    claim: 'VS Code / Copilot Chat has no Construct-equivalent PreToolUse hard-block surface for the Claude hook suite.',
    urls: [],
    constructWires: false,
    whyNotFullParity: ['platforms/capabilities.json hooks.supported=false for vscode.'],
  },
  {
    host: 'copilot',
    claim: 'Copilot is instructions-only in the Construct registry; no hook install path.',
    urls: [],
    constructWires: false,
    whyNotFullParity: ['instructionsOnly=true; hooks.supported=false.'],
  },
]);

/**
 * Fail-closed compensating controls when Layer-1 agent hooks do not fire.
 * Order matches docs/guides/concepts/gates-and-enforcement.mdx layers 2–4.
 */
export const COMPENSATING_CONTROLS = Object.freeze([
  {
    id: 'git-pre-commit',
    layer: 2,
    failClosed: true,
    summary: '`.beads/hooks` via `core.hooksPath` — secret scan, `construct lint:comments`, `construct docs:verify`.',
  },
  {
    id: 'git-pre-push',
    layer: 2,
    failClosed: true,
    summary: 'Beads/git pre-push plus Claude PreToolUse `pre-push-gate` when on Claude Code; CI remains merge authority.',
  },
  {
    id: 'cli-release-gates',
    layer: 2,
    failClosed: true,
    summary: '`construct doctor`, `construct lint:comments`, `construct docs:verify`, `npm run release:check`.',
  },
  {
    id: 'ci-required-checks',
    layer: 3,
    failClosed: true,
    summary: 'GitHub required status checks (test matrix, docs drift, comment policy, gates audit, …).',
  },
  {
    id: 'mcp-broker',
    layer: 4,
    failClosed: true,
    summary: 'Team/enterprise MCP broker (`CONSTRUCT_MCP_BROKER=on`) denies/approves tools independent of host hooks.',
  },
  {
    id: 'cursor-rules-pointer',
    layer: 1,
    failClosed: false,
    summary: '`.cursor/rules/construct.mdc` points agents at Construct CLI gates (notice-only; not a hard block).',
  },
]);

/**
 * @returns {{ host: string, constructWiresHooks: boolean, hostNativeHooksDocumented: boolean }[]}
 */
export function hostHookCoverageMatrix() {
  return HOST_KEYS.map((host) => {
    const cap = getCapability(host);
    const research = HOST_HOOK_RESEARCH.find((r) => r.host === host);
    return {
      host,
      displayName: cap.displayName,
      constructWiresHooks: Boolean(cap.hooks.supported),
      hostNativeHooksDocumented: Boolean(research?.urls?.length),
      research: research || null,
    };
  });
}

/**
 * Detect which host adapter footprints exist under a project directory.
 * @param {string} projectDir
 * @returns {string[]} host keys with on-disk adapter evidence
 */
export function detectProjectHostAdapters(projectDir) {
  const found = [];
  if (fs.existsSync(path.join(projectDir, '.claude', 'settings.json'))
    || fs.existsSync(path.join(projectDir, '.claude', 'agents'))) {
    found.push('claude');
  }
  if (fs.existsSync(path.join(projectDir, '.cursor', 'mcp.json'))
    || fs.existsSync(path.join(projectDir, '.cursor', 'rules'))) {
    found.push('cursor');
  }
  if (fs.existsSync(path.join(projectDir, '.vscode', 'mcp.json'))) {
    found.push('vscode');
  }
  if (fs.existsSync(path.join(projectDir, '.codex', 'config.toml'))) {
    found.push('codex');
  }
  if (fs.existsSync(path.join(projectDir, '.opencode', 'opencode.json'))) {
    found.push('opencode');
  }
  if (fs.existsSync(path.join(projectDir, '.github', 'prompts'))) {
    found.push('copilot');
  }
  return found;
}

/**
 * True when Construct would be claiming Cursor hook parity by shipping hooks.json.
 * Used as a negative invariant in sync/init tests.
 * @param {string} projectDir
 */
export function constructShippedCursorHooksJson(projectDir) {
  return fs.existsSync(path.join(projectDir, '.cursor', 'hooks.json'));
}

/**
 * Only Claude may have hooks.supported=true in the capability registry.
 * @returns {string[]} hosts incorrectly marked as Construct-wired
 */
export function hostsIncorrectlyMarkedHookSupported() {
  return HOST_KEYS.filter((h) => getCapability(h).hooks.supported && !CONSTRUCT_WIRED_HOOK_HOSTS.includes(h));
}
