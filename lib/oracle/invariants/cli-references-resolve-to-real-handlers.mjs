/**
 * lib/oracle/invariants/cli-references-resolve-to-real-handlers.mjs — Layer 1
 * deterministic invariant: every CLI invocation string literal a platform supervisor
 * template emits must name a real top-level `construct` command and, for the daemons
 * that expose one, a flag their own CLI parser actually recognizes.
 *
 * Per the oracle-miss-report's row 4 (supervision `--foreground`): "No detector checks
 * CLI flag existence against what supervision templates emit... Authoring/CI time — a
 * deterministic invariant (`cli-references-resolve-to-real-handlers`) run against every
 * string literal that looks like a CLI invocation." The concrete site the row names is
 * `lib/embed/supervision.mjs`'s `SERVICES` map, whose `args` arrays (`['embed', 'start',
 * '--foreground']`, `['oracle', 'start', '--foreground']`) are baked verbatim into the
 * launchd plist / systemd unit / Task Scheduler entry each daemon's supervisor restarts
 * the daemon with — a typo or a removed flag there fails silently at restart time, not
 * at authoring time, since supervision.mjs's args arrays are never imported or executed
 * as code. Cross-checking those literals against `lib/cli-commands.mjs` (`CLI_COMMANDS`,
 * the CLI's own single source of truth) and each daemon's `lib/<name>/cli.mjs` module
 * turns a one-time manual audit into a mechanical, standing check.
 *
 * The extraction is a targeted line-scan of `SERVICES`'s literal shape (two-space-indent
 * `<name>: {` service keys, `args: [...]` array literals), not a general JS parser — the
 * same deliberately narrow, site-specific approach `closed-bead-sha-reachable.mjs` takes
 * for this repo's own real data shapes. Flag resolution is limited to the two services
 * `SERVICES` currently declares (`embed`, `oracle`), each of which maps by convention to
 * `lib/<name>/cli.mjs`; a service added without that module gets an `unknown` result
 * rather than a false `failed`, since the convention is not a hard requirement.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const id = 'cli-references-resolve-to-real-handlers';
export const layer = 1;
export const description =
  "Every CLI invocation string literal a platform supervisor template emits must resolve to a real construct command, and its flags to ones the target daemon's CLI parser recognizes.";

const SUPERVISED_CLI_MODULES = {
  embed: 'lib/embed/cli.mjs',
  oracle: 'lib/oracle/cli.mjs',
};

/**
 * @param {string} source lib/embed/supervision.mjs's contents
 * @returns {{service: string, tokens: string[]}[]}
 */
export function extractServiceInvocations(source) {
  const invocations = [];
  let currentService = null;
  for (const line of source.split('\n')) {
    const keyMatch = line.match(/^\s{2}(\w+):\s*\{/);
    if (keyMatch) currentService = keyMatch[1];
    const argsMatch = line.match(/args:\s*\[([^\]]+)\]/);
    if (argsMatch && currentService) {
      const tokens = [...argsMatch[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
      invocations.push({ service: currentService, tokens });
    }
  }
  return invocations;
}

async function loadCommandNames(cwd) {
  const mod = await import(path.join(cwd, 'lib', 'cli-commands.mjs'));
  return new Set(mod.CLI_COMMANDS.map((c) => c.name));
}

/**
 * @param {{cwd?: string, supervisionPath?: string}} [opts]
 */
export async function check({
  cwd = process.cwd(),
  supervisionPath = path.join(cwd, 'lib', 'embed', 'supervision.mjs'),
} = {}) {
  let source;
  try {
    source = readFileSync(supervisionPath, 'utf8');
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to read ${supervisionPath}: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  let commandNames;
  try {
    commandNames = await loadCommandNames(cwd);
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to load lib/cli-commands.mjs: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const invocations = extractServiceInvocations(source);
  const results = [];
  const unresolved = [];

  for (const { service, tokens } of invocations) {
    const [command, ...rest] = tokens;
    const commandInvocation = tokens.join(' ');

    if (!commandNames.has(command)) {
      results.push({
        service,
        command: commandInvocation,
        status: 'failed',
        violation: true,
        detail: `supervision.mjs's '${service}' service invokes 'construct ${commandInvocation}', but '${command}' is not a registered command in lib/cli-commands.mjs's CLI_COMMANDS`,
      });
      continue;
    }
    results.push({
      service,
      command: commandInvocation,
      status: 'passed',
      detail: `'${command}' is a registered construct command`,
    });

    const flags = rest.filter((t) => t.startsWith('--'));
    const moduleRelPath = SUPERVISED_CLI_MODULES[service];
    if (!moduleRelPath) {
      for (const flag of flags) {
        const entry = {
          service,
          command: commandInvocation,
          flag,
          status: 'unknown',
          detail: `no known CLI module convention for service '${service}' — cannot verify '${flag}' is a recognized flag`,
        };
        results.push(entry);
        unresolved.push(entry);
      }
      continue;
    }

    let moduleSource;
    try {
      moduleSource = readFileSync(path.join(cwd, moduleRelPath), 'utf8');
    } catch (err) {
      const entry = {
        service,
        command: commandInvocation,
        status: 'unknown',
        detail: `could not read ${moduleRelPath} to verify flags: ${err.message || err}`,
      };
      results.push(entry);
      unresolved.push(entry);
      continue;
    }

    for (const flag of flags) {
      const recognized = moduleSource.includes(`'${flag}'`) || moduleSource.includes(`"${flag}"`);
      results.push({
        service,
        command: commandInvocation,
        flag,
        status: recognized ? 'passed' : 'failed',
        violation: !recognized,
        detail: recognized
          ? `'${flag}' is recognized by ${moduleRelPath}`
          : `supervision.mjs's '${service}' service passes '${flag}', but ${moduleRelPath} contains no literal reference to it`,
      });
    }
  }

  const violations = results.filter((r) => r.status === 'failed');
  let status = 'passed';
  if (violations.length > 0) status = 'failed';
  else if (unresolved.length > 0) status = 'unknown';

  return { status, evaluated: results.length, violations, unresolved, results };
}
