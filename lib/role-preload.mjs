/**
 * lib/role-preload.mjs — inline role anti-pattern files into specialist prompts at sync time.
 *
 * Specialist prompts carry a marker: **Role guidance**: call `get_skill("roles/NAME")` before drafting.
 * buildPrompt() in sync-agents.mjs replaces that marker with the role body so the content is always
 * present — no runtime get_skill dependency. Flavor overlays (e.g. engineer.ai) are concatenated
 * under the core role content.
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

export function inlineRoleAntiPatterns(prompt, root, agentName = "(unknown)", warn = console.warn) {
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
