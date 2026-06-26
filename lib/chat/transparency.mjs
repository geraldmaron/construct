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
 * Route, tools, and observability are on by default; model reasoning (thinking)
 * stays off unless opted in — full chain-of-thought is persisted either way.
 */

const LAYER_KEYS = ['thinking', 'path', 'specialists', 'tools', 'observability'];

export const LAYER_GUIDANCE = Object.freeze({
  thinking: 'model reasoning summary (/set thinking on) — off by default',
  path: 'contract handoffs and escalation in the route panel',
  specialists: 'specialist routing detail in the route panel',
  tools: 'tool call list with pass/fail status',
  observability: 'per-turn token and cost footer',
});

export function resolveLayers({ flags = {}, env = process.env } = {}) {
  const layers = Object.fromEntries(LAYER_KEYS.map((k) => [k, k !== 'thinking']));

  if (flags.thinking === true || env.CX_CHAT_THINKING === '1') layers.thinking = true;
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
    const route = routeRequest({
      request,
      context: context || {},
      cwd: context?.cwd ?? null,
    });
    const projectQuestion = context?.projectQuestion
      || /\b(what is this project|what('s| is) this (repo|project|codebase)|describe this project)\b/i.test(String(request));
    const assumptionsBlocked = projectQuestion
      || (context?.vagueFollowUp && !context?.priorIntent);

    return {
      intent: route.intent,
      workCategory: route.workCategory,
      specialists: route.specialists,
      policySpecialists: route.policySpecialists,
      displaySpecialists: route.displaySpecialists,
      externalResearch: route.externalResearch,
      riskFlags: route.riskFlags,
      track: route.track,
      contractChain: route.contractChain,
      framingChallenge: route.framingChallenge,
      dispatchSummary: route.dispatchSummary,
      dispatchReasons: route.dispatchReasons,
      triggers: route.triggers,
      docAuthoring: route.docAuthoring,
      artifactReview: route.artifactReview,
      teamRouting: route.teamRouting,
      sessionTurnIndex: context?.turnIndex ?? 0,
      priorIntent: context?.priorIntent ?? null,
      workingBranch: context?.workingBranch ?? null,
      assumptionsBlocked,
    };
  } catch {
    return null;
  }
}

// Per-turn policy is carried in the system prompt via lib/chat/system-prompt.mjs
// `turnPolicyLines`/`buildSystemPrompt`, not prepended to the user message, so a
// model cannot echo it back as user-visible reasoning.
