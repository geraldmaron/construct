/**
 * hosts/presence.ts — whether each host this machine could dispatch through is
 * actually reachable: found, at what version against the pinned one, and what
 * is known about its authentication without ever triggering an interactive
 * login.
 *
 * Doctor checked only the parts Construct owns, so a user whose first run
 * failed on a missing host met that failure as a mid-run stack of host errors
 * instead of one line at doctor time. Presence is a report, never a gate: a
 * missing host is information, because serve-only use is legitimate and a
 * host can be installed five minutes after doctor runs.
 *
 * Three honesty rules. A version is what the binary printed, never what the
 * pin hoped. Auth is probed only where the host offers a non-interactive
 * status command; everywhere else the column says "not probed" rather than
 * guessing from environment variables whose meaning the host may change.
 * And a host with no adapter yet says so, so its row reads as reachability,
 * not as a dispatch promise.
 */

import { spawnSync } from 'node:child_process';
import { hostEnvironment } from './environment.ts';
import { PINNED_VERSION as OPENCODE_PINNED } from './opencode/pin.ts';
import { PINNED_VERSION as CLAUDE_PINNED } from './claude/pin.ts';
import { PINNED_VERSION as CODEX_PINNED } from './codex/pin.ts';
import { PINNED_VERSION as CURSOR_PINNED } from './cursor/pin.ts';
import { PINNED_VERSION as BOB_PINNED } from './bob/pin.ts';

export interface HostPresence {
  /** The host, by the name its adapter (or future adapter) uses. */
  readonly host: string;
  /** Whether the binary answered at all. */
  readonly found: boolean;
  /** The version line the binary printed, when it printed one. */
  readonly version?: string;
  /** The version the adapter was verified against, when an adapter exists. */
  readonly pinned?: string;
  /** What is known about authentication, stated conservatively. */
  readonly auth: string;
  /**
   * Whether `construct work` can spawn this host's CLI. Distinct from
   * in-session dispatch: a host you are already inside of is used through
   * `construct serve`, and is not spawnable just because an adapter exists.
   */
  readonly spawnable: boolean;
  /** Whether an adapter can dispatch work through this host today. */
  readonly dispatchable: boolean;
}

/** Runs a binary and returns its first stdout line, or null when it cannot. */
export type ProbeExec = (file: string, args: readonly string[]) => string | null;

// Stderr is read alongside stdout because status commands report there
// (codex prints its login state on stderr). Only a zero exit counts as an
// answer: a failing binary's error text is not a version or an auth state.
const defaultExec: ProbeExec = (file, args) => {
  // The probe hands hosts the same deliberately-chosen environment dispatch
  // does: an XDG-respecting host handed construct's XDG overrides will create
  // directories, and a doctor probe must observe, never create.
  const run = spawnSync(file, [...args], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: hostEnvironment() as NodeJS.ProcessEnv,
  });
  if (run.error || run.status !== 0) return null;
  const first = `${run.stdout}\n${run.stderr}`
    .split('\n')
    .find((l) => l.trim().length > 0);
  return first?.trim() ?? null;
};

/**
 * Every host worth a doctor line, probed. The list is the union of hosts with
 * adapters and hosts a user plausibly has installed for subscription-priced
 * capacity; each row states which kind it is.
 */
export function surveyHosts(exec: ProbeExec = defaultExec): HostPresence[] {
  const rows: HostPresence[] = [];

  const opencode = exec('opencode', ['--version']);
  rows.push({
    host: 'opencode',
    found: opencode !== null,
    ...(opencode !== null ? { version: opencode } : {}),
    pinned: OPENCODE_PINNED,
    auth: 'not probed — auth lives in the host\'s own config',
    spawnable: opencode !== null,
    dispatchable: opencode !== null,
  });

  const claude = exec('claude', ['--version']);
  rows.push({
    host: 'claude',
    found: claude !== null,
    ...(claude !== null ? { version: claude } : {}),
    pinned: CLAUDE_PINNED,
    auth: 'not probed — auth lives in the host\'s own config',
    spawnable: claude !== null,
    dispatchable: claude !== null,
  });

  // `codex login status` is non-interactive and prints the auth method — the
  // one auth probe here that costs nothing to trust, and the interesting one:
  // "Logged in using ChatGPT" means dispatch spends a subscription, not a key.
  const codex = exec('codex', ['--version']);
  const codexAuth = codex !== null ? exec('codex', ['login', 'status']) : null;
  rows.push({
    host: 'codex',
    found: codex !== null,
    ...(codex !== null ? { version: codex } : {}),
    pinned: CODEX_PINNED,
    auth: codexAuth ?? (codex !== null ? 'login status unavailable' : 'not probed'),
    spawnable: codex !== null,
    dispatchable: codex !== null,
  });

  // `cursor-agent status` is the same costs-nothing auth probe: it names the
  // signed-in account, or exits nonzero saying "Not logged in".
  const cursor = exec('cursor-agent', ['--version']);
  const cursorAuth = cursor !== null ? exec('cursor-agent', ['status']) : null;
  rows.push({
    host: 'cursor',
    found: cursor !== null,
    ...(cursor !== null ? { version: cursor } : {}),
    pinned: CURSOR_PINNED,
    auth: cursorAuth ?? (cursor !== null ? 'not logged in' : 'not probed'),
    spawnable: cursor !== null,
    dispatchable: cursor !== null,
  });

  // Bob is a probe target with no spawn adapter. Doctor must still name it,
  // so an in-session Bob user is not told a host they have cannot be seen.
  // In-session dispatch goes through `construct serve`, not a spawned CLI.
  const bob = exec('bob', ['--version']);
  rows.push({
    host: 'bob',
    found: bob !== null,
    ...(bob !== null ? { version: bob } : {}),
    ...(BOB_PINNED !== null ? { pinned: BOB_PINNED } : {}),
    auth: 'not probed — IBMid SSO or BOB_API_KEY',
    spawnable: false,
    dispatchable: false,
  });

  return rows;
}

/** One doctor line per host, report-shaped. */
export function presenceLines(rows: readonly HostPresence[]): string[] {
  return rows.map((r) => {
    const found = r.found ? (r.version ?? 'found') : 'not found';
    const pin = r.pinned ? ` (pinned: ${r.pinned})` : '';
    const spawn = r.spawnable ? 'yes' : 'no';
    const adapter = r.dispatchable || !r.found ? '' : ' — no spawn adapter';
    return `${r.host}: ${found}${pin}; spawnable: ${spawn}${adapter}; auth: ${r.auth}`;
  });
}
