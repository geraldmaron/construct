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

/**
 * Servers, not commands: they hold stdin open and would hang a probe. Their
 * surface is "no arguments", which is what they are recorded as.
 */
const NEVER_PROBE = new Set(['serve', 'role-serve']);

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

function run(env, args) {
  const result = spawnSync('node', ['bin/construct.mjs', ...args], {
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
  const pattern = new RegExp(`construct ${verb}[ \\t]+(\\S+)`, 'g');
  for (const match of text.matchAll(pattern)) {
    const token = match[1];
    if (/^\[?</.test(token) || /^"/.test(token)) positional = true;
    else if (/^\[?--/.test(token)) flags = true;
    else {
      const word = /^\[?([a-z][a-z-]*)\]?$/.exec(token);
      if (word) subcommands.add(word[1]);
      else positional = true;
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
export function probeVerb(verb, env) {
  if (NEVER_PROBE.has(verb)) return { verb, shape: 'unknown', subcommands: new Set() };

  for (const args of [[verb], [verb, SENTINEL]]) {
    const text = run(env, args);
    const first = text.split('\n')[0] ?? '';
    if (!new RegExp(`^usage: construct ${verb}\\b`).test(first)) continue;
    return { verb, ...shapeOf(text, verb) };
  }
  return { verb, shape: 'unknown', subcommands: new Set() };
}

/** Probe a set of verbs, sharing one sandbox. */
export function probeSurface(verbs) {
  const dir = mkdtempSync(join(tmpdir(), 'construct-surface-'));
  try {
    const env = sandboxEnv(dir);
    return new Map(verbs.map((verb) => [verb, probeVerb(verb, env)]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
