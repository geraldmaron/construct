/**
 * lib/role-preload.mjs — inline role anti-pattern files into specialist prompts at sync time.
 *
 * Specialist prompts carry a marker: **Role guidance**: call `get_skill("roles/NAME")` before drafting.
 *
 * Default: on-demand. The directive stays in the prompt verbatim and the agent calls
 * `get_skill("roles/NAME")` at runtime. All hosts Construct supports (Claude Code, OpenCode, Codex,
 * Copilot) have the construct-mcp server exposing get_skill, so the runtime call is reliable.
 * This saves ~1000+ words of prompt budget per agent by not inlining skills that may not be needed.
 *
 * Opt-in preload: when a registry entry sets `preloadRoleGuidance: true`, the role body is inlined
 * at sync time. Use this only for agents deployed to hosts without reliable MCP access, or where the
 * role content is load-bearing on every single invocation. See `rules/common/skill-composition.md`.
 */
import fs from "node:fs";
import path from "node:path";

export const ROLE_DIRECTIVE_RE = /^[ \t]*\*\*Role guidance\*\*:\s*call\s+`get_skill\("roles\/([^"]+)"\)`\s*before\s*drafting\.[ \t]*$/m;

export const PROMPT_WORD_CAP = 3600;

function stripFrontmatter(body) {
  if (!body.startsWith("---\n")) return body;
  const end = body.indexOf("\n---\n", 4);
  return end === -1 ? body : body.slice(end + 5);
}

function stripTopHeading(body) {
  return body.replace(/^#\s+[^\n]*\n+/, "").replace(/^Load this[^\n]*\n+/, "");
}

export function readRoleFile(root, name) {
  const p = path.join(root, "skills", "roles", `${name}.md`);
  if (!fs.existsSync(p)) return null;
  return stripTopHeading(stripFrontmatter(fs.readFileSync(p, "utf8"))).trim();
}

export function inlineRoleAntiPatterns(prompt, root, agentName = "(unknown)", warn = console.warn, opts = {}) {
  if (!opts.preload) return prompt;
  const match = prompt.match(ROLE_DIRECTIVE_RE);
  if (!match) return prompt;
  const ref = match[1];
  const [core, flavor] = ref.split(".");
  const coreBody = readRoleFile(root, core);
  if (!coreBody) {
    warn(`[sync] ${agentName}: role file skills/roles/${core}.md missing; leaving directive in place`);
    return prompt;
  }
  let block = `## Role guidance\n\n${coreBody}`;
  if (flavor) {
    const flavorBody = readRoleFile(root, `${core}.${flavor}`);
    if (flavorBody) {
      block += `\n\n### ${flavor} overlay\n\n${flavorBody}`;
    } else {
      warn(`[sync] ${agentName}: flavor file skills/roles/${core}.${flavor}.md missing`);
    }
  }
  return prompt.replace(ROLE_DIRECTIVE_RE, block);
}
