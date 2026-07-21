/**
 * Inline perspective anti-pattern guidance into Worker Profile prompts.
 *
 * Worker Profile prompts carry a marker: **Perspective guidance**: call
 * `get_skill("perspectives/NAME")` before drafting.
 *
 * Default: on-demand. The directive stays in the prompt verbatim and the agent calls
 * `get_skill("perspectives/NAME")` at runtime. All hosts Construct supports (Claude Code, OpenCode, Codex,
 * Copilot) have the construct-mcp server exposing get_skill, so the runtime call is reliable.
 * Saves ~1000+ words of prompt budget per agent by not inlining skills that may not be needed.
 *
 * Opt-in preload is reserved for hosts without reliable MCP access.
 */
import fs from "node:fs";
import path from "node:path";

import { logSkillCall } from "./telemetry/skill-calls.mjs";

export const PERSPECTIVE_DIRECTIVE_RE = /^[ \t]*\*\*Perspective guidance\*\*:\s*call\s+`get_skill\("perspectives\/([^"]+)"\)`\s*before\s*drafting\.[ \t]*$/m;

export const PROMPT_WORD_CAP = 3600;

function stripFrontmatter(body) {
  if (!body.startsWith("---\n")) return body;
  const end = body.indexOf("\n---\n", 4);
  return end === -1 ? body : body.slice(end + 5);
}

function stripTopHeading(body) {
  return body.replace(/^#\s+[^\n]*\n+/, "").replace(/^Load this[^\n]*\n+/, "");
}

export function readPerspectiveFile(root, name, opts = {}) {
  const p = path.join(root, "skills", "perspectives", `${name}.md`);
  if (!fs.existsSync(p)) return null;
  const t0 = Date.now();
  const body = stripTopHeading(stripFrontmatter(fs.readFileSync(p, "utf8"))).trim();
  logSkillCall({
    skillId: `perspectives/${name}`,
    source: opts.source || 'perspective-preload',
    callerContext: opts.callerContext,
    latencyMs: Date.now() - t0,
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    tokensReturned: Math.ceil(body.length / 4),
  });
  return body;
}

export function inlinePerspectiveAntiPatterns(prompt, root, workerProfileId = "(unknown)", warn = console.warn, opts = {}) {
  if (!opts.preload) return prompt;
  const match = prompt.match(PERSPECTIVE_DIRECTIVE_RE);
  if (!match) return prompt;
  const ref = match[1];
  const [core, flavor] = ref.split(".");
  const coreBody = readPerspectiveFile(root, core);
  if (!coreBody) {
    warn(`[sync] ${workerProfileId}: perspective skills/perspectives/${core}.md missing; leaving directive in place`);
    return prompt;
  }
  let block = `## Perspective guidance\n\n${coreBody}`;
  if (flavor) {
    const flavorBody = readPerspectiveFile(root, `${core}.${flavor}`);
    if (flavorBody) {
      block += `\n\n### ${flavor} perspective\n\n${flavorBody}`;
    } else {
      warn(`[sync] ${workerProfileId}: perspective skills/perspectives/${core}.${flavor}.md missing`);
    }
  }
  return prompt.replace(PERSPECTIVE_DIRECTIVE_RE, block);
}
