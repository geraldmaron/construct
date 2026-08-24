/**
 * hosts/bob/pin.ts — expectations about the IBM Bob CLI, and which of them
 * scripts/probe-bob-conformance.mjs has actually checked against a live
 * binary.
 *
 * Bob is a probe target, not an execution adapter: this file carries only
 * the claims a probe can check — spawn mechanics, flags, discovery layout —
 * not a HostAdapter. Building the adapter that dispatches real work to this
 * host is separate, later work; what a caller would need to trust first is
 * written down here.
 *
 * Bob reached general availability 2026-04-28 and is metered: a free tier
 * plus paid plans, gated on IBMid SSO for interactive use or a `BOB_API_KEY`
 * for automation. Dispatching this project's own build through Bob is out of
 * scope — development model calls come from Gerald's Claude Code or Cursor
 * subscriptions only. This pin exists to record presence and mechanics for a
 * future adapter decision, never to run this repo's own work.
 *
 * Every `Expectation` below carries a `basis`: 'measured' means a probe ran
 * against a live `bob` binary and observed the behavior directly; 'documented'
 * means the claim is copied from IBM's own published docs and has never been
 * run. The type makes this structural rather than a comment someone can miss:
 * a documented expectation carries the `source` URL and the `checkedOn` date
 * the doc was read, and cannot silently read as measured.
 *
 * No `bob` binary has been available on any machine this pin was written on
 * (`command -v bob` failed 2026-08-24), so every expectation below starts
 * documented. When the probe eventually runs against a real binary, flip the
 * ones it confirms to 'measured' and set PINNED_VERSION from what it reports
 * — do not invent a version string ahead of that.
 *
 * When the probe fails on a version it can reach: re-verify, update
 * PINNED_VERSION, and update whichever expectations moved.
 */

/**
 * The version this pin has verified against a live binary — null until a
 * probe run supplies one. Nothing in this file may set this to a string;
 * only scripts/probe-bob-conformance.mjs, having actually run `bob
 * --version` against a real binary, is in a position to know it.
 */
export const PINNED_VERSION: string | null = null;

export type ExpectationBasis = 'measured' | 'documented';

interface MeasuredExpectation {
  readonly name: string;
  readonly claim: string;
  readonly basis: 'measured';
}

interface DocumentedExpectation {
  readonly name: string;
  readonly claim: string;
  readonly basis: 'documented';
  /** The IBM doc page this claim was copied from. */
  readonly source: string;
  /** The date that page was read (YYYY-MM-DD). */
  readonly checkedOn: string;
}

export type Expectation = MeasuredExpectation | DocumentedExpectation;

const INSTALL_DOCS = 'https://bob.ibm.com/docs/shell/getting-started/install-and-setup';
const NON_INTERACTIVE_DOCS = 'https://bob.ibm.com/docs/shell/getting-started/start-bobshell-non-interactive';
const CUSTOM_MODES_DOCS = 'https://bob.ibm.com/docs/shell/configuration/custom-modes-bobshell';
const SKILLS_DOCS = 'https://bob.ibm.com/docs/ide/features/skills';

/**
 * Every behavior on record for Bob. None of these has been measured: no
 * `bob` binary has been reachable from this repo to probe. Each carries the
 * IBM doc it was copied from and the date that page was read, so the probe
 * script has something concrete to check the day a binary exists, and so a
 * reader can tell at the type level that nothing here has been run yet.
 */
export const EXPECTATIONS: readonly Expectation[] = [
  {
    name: 'version-flag-output-shape',
    claim:
      'The shape of `bob --version` output is not documented anywhere in the install/setup page or elsewhere IBM publishes. ' +
      'This is an open question the probe answers on first contact with a real binary, not a claim recorded ahead of that.',
    basis: 'documented',
    source: INSTALL_DOCS,
    checkedOn: '2026-08-24',
  },
  {
    name: 'prompt-flag-runs-non-interactively',
    claim: '`bob -p "<text>"` runs a prompt non-interactively and exits without opening a REPL.',
    basis: 'documented',
    source: NON_INTERACTIVE_DOCS,
    checkedOn: '2026-08-24',
  },
  {
    name: 'stdin-can-be-piped-alongside-a-prompt',
    claim: '`cat file | bob -p "<text>"` pipes file content over stdin alongside the `-p` prompt text.',
    basis: 'documented',
    source: NON_INTERACTIVE_DOCS,
    checkedOn: '2026-08-24',
  },
  {
    name: 'yolo-is-the-write-gate',
    claim: '`--yolo` is the write gate: without it, Bob does not write or update files.',
    basis: 'documented',
    source: NON_INTERACTIVE_DOCS,
    checkedOn: '2026-08-24',
  },
  {
    name: 'chat-mode-selects-a-custom-mode',
    claim:
      '`--chat-mode=<slug>` selects a custom mode defined in `custom_modes.yaml` (global at `~/.bob/custom_modes.yaml`, ' +
      'project at `.bob/custom_modes.yaml`). Each mode carries `slug`, `name`, `description`, `roleDefinition`, ' +
      '`customInstructions`, `groups` (read, edit, browser, command, mcp), and `whenToUse`.',
    basis: 'documented',
    source: CUSTOM_MODES_DOCS,
    checkedOn: '2026-08-24',
  },
  {
    name: 'skills-discovered-from-a-folder-per-skill',
    claim:
      'Bob discovers a skill from a folder per skill under `.bob/skills/` (project) or `~/.bob/skills/` (global), each ' +
      'containing a `SKILL.md` with YAML frontmatter. `name` and `description` are required; a skill with no `description` ' +
      'is ignored.',
    basis: 'documented',
    source: SKILLS_DOCS,
    checkedOn: '2026-08-24',
  },
  {
    name: 'auth-is-ibmid-sso-or-an-api-key',
    claim:
      'Interactive use authenticates via IBMid SSO; automation authenticates via the `BOB_API_KEY` environment variable. ' +
      'Bob requires Node 24 or later.',
    basis: 'documented',
    source: INSTALL_DOCS,
    checkedOn: '2026-08-24',
  },
];
