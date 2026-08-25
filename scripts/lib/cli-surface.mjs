/**
 * cli-surface.mjs — what the CLI says its own surface is, asked of the CLI.
 *
 * The verb table is exported and can simply be imported. Everything below a
 * verb cannot: subcommands are matched inline by each verb against its own
 * literals, so there is no structure to read. Declaring them a second time in
 * a table beside the code would make a third copy of the truth, and a check
 * that compares two copies passes exactly when both are wrong together.
 *
 * So the surface is measured instead of declared. Every verb already prints
 * its own usage when it is given a subcommand it does not have, and that
 * printed line is the CLI's own answer, produced by the same code that
 * accepts or rejects the argument. Reading it costs one process per verb and
 * cannot drift from behavior, because it *is* behavior.
 *
 * Probing runs against a throwaway HOME so nothing touches a real store.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolved from this file rather than from the caller's directory, because a
 * relative launcher makes the probe silently unable to run and every verb
 * unclassifiable — which reads as a clean pass instead of a broken check.
 */
const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

/**
 * Servers, not commands: they hold stdin open and would hang a probe. Their
 * surface is "no arguments", which is what they are recorded as.
 */
const NEVER_PROBE = new Set(['serve', 'role-serve', 'host-pull-serve']);

/** A token no verb could mistake for one of its own subcommands. */
const SENTINEL = '__construct_surface_probe__';

function sandboxEnv(dir) {
  return {
    ...process.env,
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, '.config'),
    XDG_STATE_HOME: join(dir, '.state'),
    XDG_DATA_HOME: join(dir, '.data'),
    XDG_CACHE_HOME: join(dir, '.cache'),
  };
}

/**
 * Run inside the sandbox, not beside the repository.
 *
 * Redirecting HOME and the XDG variables is not enough on its own: some verbs
 * write relative to the working directory, so a probe left in the checkout
 * rewrites real files as a side effect of a read-only check. The sandbox is
 * the working directory too.
 */
function run(dir, env, args) {
  const result = spawnSync('node', [LAUNCHER, ...args], {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/**
 * What a usage block says may follow the verb, read from the first token of
 * each of its lines.
 *
 * The three cases are different questions, and collapsing them is what makes a
 * check either useless or wrong. A named word (`add`, or an optional `[list]`)
 * is a subcommand, and the set of them is closed. A `<placeholder>` is a value
 * the caller supplies, so no bare word after that verb can be judged. A `--flag`
 * means the verb takes flags and nothing else — which is a *positive* finding
 * that any bare word is wrong, not an absence of information. Reading an empty
 * subcommand set as "unknown" is what let `construct lessons list` pass.
 */
function shapeOf(text, verb) {
  const subcommands = new Set();
  let positional = false;
  let flags = false;

  // Every token of every usage line, not just the first. `construct outcome`
  // puts its flags first and its free-text argument last, so reading only the
  // opening token calls it flag-driven and then rejects the documented form
  // that actually works.
  const lines = new RegExp(`construct ${verb}[ \\t]+(.*)$`, 'gm');
  for (const line of text.matchAll(lines)) {
    let first = true;
    // A placeholder right after a flag that has no `=` is that flag's value,
    // not an argument of the verb: `--run <id>` takes an id, it does not mean
    // the verb accepts a bare positional.
    let awaitingFlagValue = false;

    for (const token of line[1].split(/\s+/).filter(Boolean)) {
      const isPlaceholder = /^\[?</.test(token) || /^"/.test(token);
      const isFlag = /^\[?--/.test(token);

      if (isPlaceholder && awaitingFlagValue) {
        awaitingFlagValue = false;
      } else if (isPlaceholder) {
        positional = true;
      } else if (isFlag) {
        flags = true;
        awaitingFlagValue = !token.includes('=');
      } else if (first) {
        const word = /^\[?([a-z][a-z-]*)\]?$/.exec(token);
        if (word) subcommands.add(word[1]);
        else positional = true;
      } else {
        awaitingFlagValue = false;
      }
      first = false;
    }
  }

  if (subcommands.size > 0) return { shape: 'subcommands', subcommands };
  if (positional) return { shape: 'positional', subcommands };
  if (flags) return { shape: 'flags-only', subcommands };
  return { shape: 'unknown', subcommands };
}

/**
 * Ask one verb what it accepts.
 *
 * Bare invocation is tried first because a verb that takes subcommands
 * generally answers it with the whole usage block. A verb that does real work
 * with no arguments answers with that work instead, so the sentinel is tried
 * next. When neither produces the verb's own usage the shape is `unknown`, and
 * nothing after that verb can be judged — which is the honest result, not a
 * reason to guess.
 */
export function probeVerb(verb, dir, env) {
  if (NEVER_PROBE.has(verb)) return { verb, shape: 'unknown', subcommands: new Set() };

  // `--help` is tried because some verbs swallow an unknown positional and do
  // their work anyway, so neither the bare nor the sentinel form ever reaches
  // their usage. Without it those verbs look like they constrain nothing.
  for (const args of [[verb], [verb, '--help'], [verb, SENTINEL]]) {
    const text = run(dir, env, args);
    // Anywhere in the output, not only the opening line: several verbs print a
    // diagnostic first and their usage under it.
    if (!new RegExp(`^usage: construct ${verb}\\b`, 'm').test(text)) continue;
    return { verb, ...shapeOf(text, verb) };
  }
  return { verb, shape: 'unknown', subcommands: new Set() };
}

/**
 * Probe a set of verbs, sharing one sandbox.
 *
 * The canary runs first. If the launcher cannot be reached the probe answers
 * nothing for every verb, which is indistinguishable from a surface that
 * constrains nothing, and the caller would report a clean pass having checked
 * none of it. A check that cannot run must say so rather than agree.
 */
export function probeSurface(verbs) {
  const dir = mkdtempSync(join(tmpdir(), 'construct-surface-'));
  try {
    const env = sandboxEnv(dir);
    const canary = run(dir, env, ['version']);
    if (!/^\d+\.\d+\.\d+/m.test(canary)) {
      throw new Error(
        `cli-surface: the CLI at ${LAUNCHER} did not answer 'version' with a version, so no ` +
          `surface could be measured. Refusing to report an unchecked pass. Output: ${canary.slice(0, 200)}`,
      );
    }
    return new Map(verbs.map((verb) => [verb, probeVerb(verb, dir, env)]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
