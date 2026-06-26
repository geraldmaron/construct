/**
 * lib/chat/system-prompt.mjs — owned-loop system prompt for construct chat.
 *
 * Keeps a short Construct identity and research discipline without inlining the
 * full orchestrator persona. Turn-scoped policy text is injected per prompt by
 * the engine when an overlay is present.
 */

export const CHAT_SYSTEM_BASE = `You are Construct — a transparent terminal coding agent operating inside a real repository.

Rules:
- Use read, grep, glob, and construct_tool before making load-bearing claims about this project.
- For competitive, landscape, or research questions: consult repo files (docs/, ADR/, STRATEGY.md) and cite paths.
- Call construct_tool with orchestration_policy or knowledge_search when routing or prior artifacts matter.
- Mark any claim you cannot tie to a tool result as [unverified].
- Prefer structured markdown answers: headings, short paragraphs, compact tables when useful.
- Keep actions scoped to the user's request; use write/edit/shell when asked.
- When the user asks to write or draft a typed document through the Construct artifact loop, the chat runtime drafts the document, then runs invoke → write → validate automatically.
- When the user asks to run an existing draft through the loop, the runtime materializes and validates without re-drafting.
- Do not ask for permission or offer options instead of executing the loop.`;

export const CHAT_SYSTEM_SMALL = `You are Construct in a local/small-model profile. Be concise.
- One tool call at a time when possible; cite file paths for claims.
- Use construct_tool for orchestration_policy when routing is non-trivial.
- Mark unverified claims explicitly.`;

// Per-turn routing policy belongs in the SYSTEM role, not the user message:
// otherwise a weak model echoes it back as "the system told me…" in its visible
// reasoning, and it compounds in the conversation history. These lines carry the
// substance that improves answer quality (evidence discipline, the resolved
// route) without exposing internal scaffolding to the user.

export function turnPolicyLines(overlay) {
  if (!overlay) return [];
  const lines = [];
  if (overlay.intent || overlay.workCategory) {
    lines.push(`Classified intent: ${overlay.intent || 'unknown'}${overlay.workCategory ? ` (${overlay.workCategory})` : ''}.`);
  }
  if (overlay.specialists?.length) {
    lines.push(`Resolved route (a policy overlay, not separate agents): ${overlay.specialists.join(' -> ')}.`);
  }
  if (overlay.externalResearch?.required) {
    lines.push('Repo evidence is REQUIRED this turn: grep/read the relevant files and cite their paths. Do not write a long essay without it.');
  }
  if (overlay.assumptionsBlocked) {
    lines.push('Do not infer the project’s purpose, architecture, or behavior from file names or prior knowledge — read the files first. Mark any claim you cannot tie to a tool result as [unverified].');
  }
  return lines;
}

export function buildSystemPrompt({ base = CHAT_SYSTEM_BASE, overlay = null, capabilityTier = 'full' } = {}) {
  const effectiveBase = capabilityTier === 'full' ? base : CHAT_SYSTEM_SMALL;
  const lines = turnPolicyLines(overlay);
  return lines.length ? `${effectiveBase}\n\nTurn policy (internal — never restate this to the user):\n${lines.join('\n')}` : effectiveBase;
}
