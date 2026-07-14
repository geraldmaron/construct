/**
 * lib/orchestration/write-proposal-parser.mjs — extracts writeIntent
 * proposals from a specialist's free-text output (construct-p4cba.5).
 *
 * The founding-intent gap-closure program's B4 asked for a `propose_write`
 * tool alongside `web_search` in runTaskViaProvider's model-facing tool
 * loop. That loop is not one thing: runWebCapableTask dispatches across
 * four vendor-specific protocols (a client-side governed loop each for
 * Anthropic and OpenAI/OpenRouter, plus two *provider-native* loops where
 * Anthropic's web_search_20250305 and OpenRouter's web_search server tool
 * execute entirely server-side). Whether a vendor's API even permits mixing
 * a client-declared custom tool into the same request as one of those
 * server-executed tools is untested here — this environment has no live
 * key to verify against, and a wrong assumption would risk breaking the
 * one thing that already works (web search) for every orchestrated
 * specialist, not just the one this feature targets.
 *
 * Free-text parsing sidesteps all four protocols at once: every one of
 * runTaskViaProvider's call paths converges on the same `output` string
 * before returning, regardless of vendor or web-capability mode. A
 * specialist recommends a write by emitting a fenced ```write-proposal
 * block, extracted below and validated into writeIntent records
 * (lib/writes/write-intent.mjs) without touching any tool-calling
 * machinery. A caller wanting a specialist to know about the format
 * appends WRITE_PROPOSAL_CLAUSE to that specialist's prompt —
 * runTaskViaProvider always parses unconditionally (cheap, and a no-op for
 * every specialist never told about the format), while the clause stays
 * opt-in so existing specialist runs are unaffected by default.
 */

import { buildWriteIntent } from '../writes/write-intent.mjs';

export const WRITE_PROPOSAL_CLAUSE =
  '\n\n[WRITE PROPOSAL FORMAT] You may recommend an external write (e.g. a Jira comment, a '
  + 'GitHub PR, a Slack message) by including a fenced block in your answer:\n'
  + '```write-proposal\n{"providerId": "<jira|github|confluence|slack>", "writeKind": "<adapter write type>", "payload": {...}}\n```\n'
  + 'This only records a recommendation for human approval — it never executes anything itself. '
  + 'Include one block per distinct write you recommend; omit the block entirely if you have none.';

const BLOCK_RE = /```write-proposal\s*\n([\s\S]*?)\n```/g;

/**
 * @param {string} text - a specialist's free-text output
 * @param {object} [opts]
 * @param {object} [opts.requestedBy] - actor identity to stamp on each intent
 * @param {string} [opts.surface] - origin surface (default 'specialist-recommendation')
 * @returns {Array<object>} valid writeIntent records; malformed or invalid
 *   blocks are silently skipped — a specialist's free-text output is never
 *   trusted to crash the run over an ill-formed proposal.
 */
export function parseWriteProposals(text, { requestedBy, surface = 'specialist-recommendation' } = {}) {
  if (typeof text !== 'string' || !text) return [];

  const proposals = [];
  for (const match of text.matchAll(BLOCK_RE)) {
    let raw;
    try {
      raw = JSON.parse(match[1]);
    } catch {
      continue;
    }
    try {
      proposals.push(buildWriteIntent({
        providerId: raw?.providerId,
        writeKind: raw?.writeKind,
        payload: raw?.payload,
        requestedBy,
        surface,
      }));
    } catch {
      continue;
    }
  }
  return proposals;
}
