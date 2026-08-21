/**
 * hosts/census.ts — what this machine actually has to work with, in the terms
 * the kernel's selection is allowed to reason about.
 *
 * presence.ts already answers the reachability half: which binaries answered,
 * at what version against their pin, and what a non-interactive auth probe
 * said. This module is the rest of the answer, and it is built on that same
 * survey rather than beside it, so doctor and the selection cannot come to
 * different conclusions about the same machine.
 *
 * Two facts get added here, and both live host-side for the same reason tier
 * membership and tuning membership do: they are read off vendor model strings
 * and vendor auth output, which the kernel never learns.
 *
 * The first is the capability set each adapter declares, taken from the
 * adapter itself rather than restated, so a host that gains or loses
 * `outward-write` changes what gets selected without anything here being
 * edited.
 *
 * The second is cost class, and it is the one that makes this worth having. A
 * locally-served model costs nothing to run twice. A host logged in against a
 * subscription is paid for whether or not it runs. An API key bills per call.
 * A host whose auth was never probed is none of those and must not be treated
 * as the cheap case: it is recorded as unmeasured and ordered last, the same
 * discipline that keeps a host reporting zero cost and zero steps from being
 * counted as free.
 *
 * Three honesty rules carry over from presence.ts unchanged. A cost class is
 * read from what a probe actually printed, never inferred from a host's
 * reputation. A model prefix counts as locally served only on a host this
 * project has actually run local models through. And a host with no facts
 * entry at all is reported as such rather than quietly dropped, because a
 * silent omission from a census is the one failure this file exists to
 * prevent.
 */

import { presenceLines, surveyHosts } from './presence.ts';
import type { HostPresence, ProbeExec } from './presence.ts';
import { CLAUDE_CAPABILITIES } from './claude/adapter.ts';
import { CODEX_CAPABILITIES } from './codex/adapter.ts';
import { CURSOR_CAPABILITIES } from './cursor/adapter.ts';
import { OPENCODE_CAPABILITIES } from './opencode/adapter.ts';
import { tierOfModel as claudeTier } from './claude/pin.ts';
import { tierOfModel as codexTier } from './codex/pin.ts';
import { tierOfModel as cursorTier } from './cursor/pin.ts';
import { tierOfModel as opencodeTier } from './opencode/pin.ts';
import type { HostCapability } from '../kernel/hosts/interface.ts';
import type { ModelTier } from '../kernel/brief/tiers.ts';
import type { CostClass, Resource } from '../kernel/hosts/selection.ts';

/** A cost class and the one sentence it rests on. */
interface CostVerdict {
  readonly costClass: CostClass;
  readonly costReason: string;
}

/**
 * Model strings whose compute runs on this machine. Deliberately short: it
 * lists the provider this project has measured local runs against, not every
 * provider that could in principle be local. An unrecognised prefix is not
 * local, which costs a free resource its place at the front of the queue and
 * never costs a user money.
 */
const LOCALLY_SERVED = /^ollama\//i;

interface HostFacts {
  readonly capabilities: readonly HostCapability[];
  readonly tierOfModel: (model: string | undefined | null) => ModelTier | null;
  /**
   * Whether a locally-served model string means local compute on this host.
   * True only where this project has actually run one: elsewhere the same
   * string is a model the host cannot resolve, not a free run.
   */
  readonly servesLocalModels: boolean;
  /**
   * This host's auth line read as a cost class, or null when the line says
   * nothing about who pays. Only hosts with a non-interactive status command
   * have one; the rest stay unmeasured rather than guessed.
   */
  readonly authCost?: (auth: string) => CostVerdict | null;
}

/**
 * `codex login status` is the one auth probe that states who pays outright.
 * A ChatGPT login spends a subscription; an API key bills per call. Anything
 * else it prints is not a claim about cost and is left unmeasured.
 */
function codexAuthCost(auth: string): CostVerdict | null {
  if (/api key/i.test(auth)) {
    return { costClass: 'metered', costReason: 'codex login status reports an API key, which bills per call' };
  }
  if (/chatgpt/i.test(auth)) {
    return {
      costClass: 'subscription',
      costReason: 'codex login status reports a ChatGPT login, so a run spends subscription capacity',
    };
  }
  return null;
}

/**
 * `cursor-agent status` names the signed-in account or says it is not logged
 * in. A Cursor login is a subscription; the not-logged-in answer says nothing
 * about cost because nothing can run at all.
 */
function cursorAuthCost(auth: string): CostVerdict | null {
  if (/not logged in/i.test(auth)) return null;
  if (/logged in/i.test(auth)) {
    return {
      costClass: 'subscription',
      costReason: 'cursor-agent status reports a signed-in account, so a run spends subscription capacity',
    };
  }
  return null;
}

/**
 * One entry per host presence.ts surveys. Keyed by the same name `--host`
 * takes, so the flag, the survey, and the selection cannot disagree about what
 * a host is called.
 */
const FACTS: Readonly<Record<string, HostFacts>> = {
  opencode: {
    capabilities: OPENCODE_CAPABILITIES,
    tierOfModel: opencodeTier,
    // The provider registry this host reads includes ollama, and every local
    // run this project has measured went through it.
    servesLocalModels: true,
  },
  claude: {
    capabilities: CLAUDE_CAPABILITIES,
    tierOfModel: claudeTier,
    servesLocalModels: false,
  },
  codex: {
    capabilities: CODEX_CAPABILITIES,
    tierOfModel: codexTier,
    servesLocalModels: false,
    authCost: codexAuthCost,
  },
  cursor: {
    capabilities: CURSOR_CAPABILITIES,
    tierOfModel: cursorTier,
    servesLocalModels: false,
    authCost: cursorAuthCost,
  },
};

/** Which hosts this census knows the capabilities and cost shape of. */
export const CENSUS_HOSTS: readonly string[] = Object.freeze(Object.keys(FACTS));

/**
 * What a run on this host would cost, from what was actually observed: a
 * named local model first, then the host's own auth line, then the honest
 * admission that nobody measured it.
 */
export function costOf(
  facts: HostFacts,
  presence: HostPresence,
  model: string | undefined,
): CostVerdict {
  if (facts.servesLocalModels && model && LOCALLY_SERVED.test(model)) {
    return { costClass: 'local', costReason: `${model} is served on this machine, so re-running it costs nothing` };
  }
  const fromAuth = facts.authCost?.(presence.auth);
  if (fromAuth) return fromAuth;
  return {
    costClass: 'unknown',
    costReason: `auth is not probed on ${presence.host}, so what a call there costs is unmeasured`,
  };
}

/**
 * The census, from a presence survey already taken. Split from
 * `surveyResources` so a caller that has surveyed once does not spawn every
 * host binary a second time, and so the mapping can be tested without any
 * binary at all.
 *
 * The model is the one the run will actually be dispatched with, or undefined
 * when none was named. It decides both tier and, on a host that serves them,
 * whether the compute is local. Passing a model one host cannot resolve leaves
 * that host's tier null, which reads as "did not say" and satisfies no floor
 * above `any`.
 */
export function resourcesFrom(
  rows: readonly HostPresence[],
  model?: string,
): Resource[] {
  return rows.map((presence) => {
    const facts = FACTS[presence.host];
    // The presence half is rendered by the module that owns it, so the census
    // line and the doctor line are the same sentence rather than two that have
    // to be kept matching by hand.
    const line = presenceLines([presence])[0];
    if (!facts) {
      // A host presence.ts surveys that this census has no capability
      // declaration for. Reported, never dropped: selecting it would mean
      // claiming a capability set nobody wrote down.
      return {
        host: presence.host,
        found: presence.found,
        dispatchable: false,
        capabilities: [],
        tier: null,
        costClass: 'unknown' as CostClass,
        costReason: `no capability declaration is recorded for ${presence.host}, so nothing can be selected for it`,
        presence: line,
      };
    }
    const cost = costOf(facts, presence, model);
    return {
      host: presence.host,
      found: presence.found,
      dispatchable: presence.dispatchable,
      capabilities: facts.capabilities,
      tier: facts.tierOfModel(model),
      costClass: cost.costClass,
      costReason: cost.costReason,
      presence: line,
    };
  });
}

/**
 * Probe this machine and describe what it has. The probe is the same one
 * doctor runs, so the two surfaces read one survey rather than two.
 */
export function surveyResources(exec?: ProbeExec, model?: string): Resource[] {
  return resourcesFrom(surveyHosts(exec), model);
}

/** One doctor line per resource: how it was found, plus what a run on it costs. */
export function censusLines(resources: readonly Resource[]): string[] {
  return resources.map((r) => `${r.presence}; cost: ${r.costClass} (${r.costReason})`);
}
