/**
 * hosts/opencode/pin.ts — the pinned host version and the behaviors the
 * adapter depends on.
 *
 * Commitment 1 makes the host a dependency Construct rides rather than
 * rebuilds, which means a host upgrade is a supply-chain event: the adapter
 * keeps working only for as long as the behaviors below keep holding. v2's
 * failure mode was discovering that after users hit it. So the version is
 * pinned to the one actually verified end to end, and every assumption the
 * parser makes is written down here as a named, probe-checkable expectation
 * rather than living implicitly in parser branches.
 *
 * When the probe fails: re-verify against the new version, update PINNED_VERSION,
 * and fix whatever moved — do not widen the pin to silence it. The pin is not a
 * minimum, it is a statement about what was tested.
 */

/**
 * The version this adapter was verified against end to end. `opencode --version`
 * prints exactly this string.
 */
export const PINNED_VERSION = '1.15.4';

export interface ConformanceExpectation {
  readonly id: string;
  readonly claim: string;
  readonly whyItMatters: string;
}

/**
 * Behaviors the adapter relies on. Each is checked by
 * scripts/probe-opencode-conformance.mjs against a live binary. Wording is the
 * probe's failure message, so it has to say what broke and what depends on it.
 */
export const CONFORMANCE_EXPECTATIONS: readonly ConformanceExpectation[] = [
  {
    id: 'version-pinned',
    claim: `\`opencode --version\` reports ${PINNED_VERSION}`,
    whyItMatters:
      'Every other expectation here was verified against that build. A different version has not been verified, whatever it happens to do today.',
  },
  {
    id: 'json-format-ndjson',
    claim: '`run --format json` writes one JSON object per line to stdout',
    whyItMatters: 'The whole transcript parser assumes line-delimited JSON.',
  },
  {
    id: 'text-part-carries-output',
    claim: 'a text event carries the model output at part.text',
    whyItMatters:
      'This is the deliverable. If it moves, every run returns an empty deliverable and reports success.',
  },
  {
    id: 'step-finish-carries-usage',
    claim: 'a step_finish event carries part.tokens {input,output,total} and part.cost',
    whyItMatters:
      "The coordinator's spend ceiling (construct-r67.5) is enforced on these numbers. If they move, the ceiling silently stops counting.",
  },
  {
    id: 'usage-is-per-step',
    claim: 'a multi-step run emits more than one step_finish',
    whyItMatters:
      'Usage is summed across steps. If the host switched to one cumulative event, summing would double-count and the ceiling would trip early.',
  },
  {
    id: 'notices-go-to-stderr',
    claim: 'human-facing notices go to stderr; stdout under --format json is clean NDJSON',
    whyItMatters:
      'The parser tolerates non-JSON lines anyway, because a caller merging the streams would otherwise crash on a healthy run. If notices ever move INTO stdout that tolerance stops being belt-and-braces and starts being load-bearing.',
  },
  {
    id: 'run-failure-sets-exit-code',
    claim: 'a failed run emits type:"error" events AND exits non-zero',
    whyItMatters:
      'Both signals agree today, so either alone would do. The adapter reads the error events for the message (they name the actual cause; the exit code does not) and treats a non-zero exit as a failure regardless. If the two ever diverge, this is where it shows up.',
  },
  {
    id: 'tool-failure-is-not-run-failure',
    claim: 'a rejected tool call reports part.state.status "error" while the run still exits 0',
    whyItMatters:
      'Lets a caller tell "the role could not read the file" from "the host fell over". Collapsing them would make every permission denial look like an outage.',
  },
];
