/**
 * lib/chat/transparency.mjs — the transparency layer for `construct chat`.
 *
 * The terminal's differentiator is visibility into the loop, so this module
 * decides what the user sees and enriches the host stream with Construct's own
 * orchestration knowledge. It resolves which transparency layers are active
 * (thinking, planned path, specialist routing, tool calls, observability),
 * classifies each normalized driver event into a channel, and — before a turn
 * runs — derives the specialist path Construct's policy would route the request
 * through (orchestration-policy.mjs) so the planned route is shown alongside the
 * host's actual execution.
 *
 * Transparency-first by default: every layer is on unless explicitly disabled,
 * matching the surface's promise of maximum visibility with opt-out, not opt-in.
 */

const LAYER_KEYS = ['thinking', 'path', 'specialists', 'tools', 'observability'];

export function resolveLayers({ flags = {}, env = process.env } = {}) {
  const layers = Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));

  if (flags.thinking === false || env.CX_CHAT_THINKING === '0') layers.thinking = false;
  if (flags.path === false) layers.path = false;
  if (flags.specialists === false) layers.specialists = false;
  if (flags.tools === false) layers.tools = false;
  if (flags.observability === false || flags.quiet === true) layers.observability = false;

  return layers;
}

const CHANNEL_BY_TYPE = {
  thinking: 'thinking',
  text: 'message',
  plan: 'path',
  tool_call: 'tools',
  tool_update: 'tools',
  usage: 'observability',
  specialist: 'specialists',
  permission: 'permission',
  error: 'error',
  done: 'system',
};

export function channelFor(event) {
  return CHANNEL_BY_TYPE[event?.type] || 'system';
}

// message, permission, error and system are structural and always shown; the
// optional layers gate everything else so toggles change visibility without
// changing the underlying event stream (which still flows to persistence).

export function isVisible(event, layers) {
  const channel = channelFor(event);
  if (channel === 'message' || channel === 'permission' || channel === 'error' || channel === 'system') return true;
  return Boolean(layers[channel]);
}

export async function planTurn(request, { env = process.env, context = null } = {}) {
  try {
    const { routeRequest } = await import('../orchestration-policy.mjs');
    const route = routeRequest({ request, context: context || {} });
    const projectQuestion = context?.projectQuestion
      || /\b(what is this project|what('s| is) this (repo|project|codebase)|describe this project)\b/i.test(String(request));
    const assumptionsBlocked = projectQuestion
      || (context?.vagueFollowUp && !context?.priorIntent);

    return {
      intent: route.intent,
      workCategory: route.workCategory,
      specialists: route.specialists,
      externalResearch: route.externalResearch,
      riskFlags: route.riskFlags,
      track: route.track,
      contractChain: route.contractChain,
      framingChallenge: route.framingChallenge,
      dispatchSummary: route.dispatchSummary,
      docAuthoring: route.docAuthoring,
      sessionTurnIndex: context?.turnIndex ?? 0,
      priorIntent: context?.priorIntent ?? null,
      workingBranch: context?.workingBranch ?? null,
      assumptionsBlocked,
    };
  } catch {
    return null;
  }
}

export function buildTurnPolicyMessage(overlay) {
  if (!overlay) return '';
  const lines = [
    '[construct policy overlay — follow before answering]',
    `intent: ${overlay.intent || 'unknown'}`,
    `workCategory: ${overlay.workCategory || 'unknown'}`,
    `specialists: ${(overlay.specialists || []).join(' -> ') || 'none'}`,
  ];
  if (overlay.sessionTurnIndex > 0 && overlay.priorIntent) {
    lines.push(`session: turn ${overlay.sessionTurnIndex + 1}; prior intent was ${overlay.priorIntent}`);
  }
  if (overlay.workingBranch) {
    lines.push(`workingBranch: ${overlay.workingBranch}`);
  }
  if (overlay.externalResearch?.required) {
    lines.push(`externalResearch: required (${overlay.externalResearch.shape || overlay.externalResearch.reason || 'yes'})`);
    lines.push('You MUST grep/read repo sources and cite paths. Mark unsourced claims [unverified].');
  }
  if (overlay.assumptionsBlocked) {
    lines.push('Do not infer project purpose, architecture, or behavior without grep/read evidence from this repo.');
  }
  return lines.join('\n');
}
