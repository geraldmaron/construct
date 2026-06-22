/**
 * apps/chat/engine/turn-controls.mjs — resolve one turn's execution controls from
 * the compiled execution policy (construct-rv2x).
 *
 * The owned-loop engine (ai-sdk-agent.mjs) calls this once per turn to turn a
 * capability profile plus the turn overlay into the concrete knobs streamText
 * needs: the step cap, the output-token cap, caching eligibility, and the tool-
 * group / schema budget, plus the continuation/compaction budget the session uses
 * to decide when to compact context (construct-6zga.1.9). The capability profile
 * is resolved from the active model id, so a mid-session model switch re-derives
 * the envelope.
 *
 * Behavior preservation is the contract: this never throws and never returns a
 * tighter envelope than today for a hosted-direct model. hosted-direct keeps the
 * legacy step cap, the full tool set, and unbounded output; every other class
 * enforces its compiled budget. An explicit CX_CHAT_MAX_STEPS operator override
 * wins over the policy's step cap. Any failure in policy resolution falls back to
 * the legacy envelope (16 steps, full tool set, no cap, no caching) so a policy
 * bug can never break a chat turn.
 */

import { resolveExecutionCapabilityProfile } from '../../../lib/models/execution-capability-profile.mjs';
import { compilePolicyFromOverlay } from '../../../lib/models/execution-policy.mjs';
import { continuationBudgetFromPolicy } from '../../../lib/chat/context-continuation.mjs';

const LEGACY_STEP_CAP = 16;

const LEGACY_CONTROLS = Object.freeze({
  policy: null,
  iterations: LEGACY_STEP_CAP,
  outputCap: null,
  cacheEligible: false,
  allowedToolGroups: null,
  maxToolSchemas: Infinity,
  degraded: false,
  continuation: Object.freeze({ triggerTokens: null, triggerRatio: null }),
});

function legacyControls() {
  return { ...LEGACY_CONTROLS };
}

export function resolveTurnControls({ model = null, turnOverlay = null, env = {} } = {}) {
  try {
    const profile = resolveExecutionCapabilityProfile({ model });
    const toolFailure = turnOverlay?.toolFailure === true;
    const policy = compilePolicyFromOverlay({ profile, overlay: turnOverlay, toolFailure });

    const envSteps = Number(env?.CX_CHAT_MAX_STEPS);
    const iterations = envSteps > 0 ? Math.floor(envSteps) : policy.tools.maxToolIterations;

    // hosted-direct is the mandated default path: keep today's unbounded output
    // until live-probe evidence supersedes the compatibility_fallback tier. Every
    // other class enforces its compiled output budget.
    const outputCap = policy.source.capabilityClass === 'hosted-direct' ? null : policy.output.outputTokenBudget;

    return {
      policy,
      iterations,
      outputCap,
      cacheEligible: policy.caching.eligible === true,
      allowedToolGroups: policy.tools.allowedToolGroups,
      maxToolSchemas: policy.tools.maxToolSchemas,
      degraded: policy.degradedMode === true,
      continuation: continuationBudgetFromPolicy(policy),
    };
  } catch {
    return legacyControls();
  }
}
