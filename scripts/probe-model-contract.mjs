#!/usr/bin/env node
/**
 * probe-model-contract.mjs — record a model's capability floor on the JSON
 * seams before anyone pays a full run to discover it.
 *
 * A namer that cannot hold its output contract on some model is a fact worth
 * one cheap probe, not a per-run surprise: the recorded acceptance runs found
 * it per run, on outcomes a user was actually waiting on. This script runs the
 * namer and densifier contracts (the two host-backed JSON seams) against a
 * named provider/model through the pinned OpenCode adapter, several trials
 * each, and writes a dated per-model artifact.
 *
 *   node scripts/probe-model-contract.mjs --model ollama/qwen3.5:4b
 *   node scripts/probe-model-contract.mjs --model openrouter/z-ai/glm-4.5-air:free --trials 3
 *
 * What a trial records, per seam: whether the first reply parsed, whether the
 * one corrective retry repaired it, or whether the seam fell through to its
 * stated fallback. "Repaired" is a pass with a cost attached, and the artifact
 * keeps the three outcomes distinct because they are three different facts.
 *
 * A hosted model that rate-limits or errors is recorded as `unmeasured`, never
 * as a failure: an answer the model was not allowed to give is not evidence
 * about the model. Exit codes: 0 the probe ran (whatever it measured), 2 it
 * could not run at all.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenCodeAdapter } from '../src/hosts/opencode/adapter.ts';
import { namerPrompt, parseNamings, NAMER_ROLE } from '../src/hosts/namer.ts';
import { densifierPrompt, parseDensified, DENSIFIER_ROLE } from '../src/hosts/densifier.ts';
import { invokeWithRepair } from '../src/hosts/jsonrepair.ts';
import { DOMAINS } from '../src/kernel/implication/domains.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const model = flag('model', null);
const binary = flag('binary', 'opencode');
const trials = Number(flag('trials', '3'));
if (!model) {
  process.stderr.write('usage: probe-model-contract.mjs --model <provider/model> [--binary …] [--trials N]\n');
  process.exit(2);
}

// Two fixed outcomes, chosen from the recorded acceptance cases so the probe
// exercises wording that has already exposed real failures: one that keyword
// routing also catches, one whose vocabulary reaches no keyword at all.
const OUTCOMES = [
  'We want to hire a contractor in Poland to help with support',
  'We want to start recording our customer support calls and use them to train a support assistant',
];

const SEAMS = [
  {
    seam: 'namer',
    role: NAMER_ROLE,
    prompt: (outcome) => namerPrompt(outcome, DOMAINS),
    parse: parseNamings,
  },
  {
    seam: 'densifier',
    role: DENSIFIER_ROLE,
    prompt: (outcome) => densifierPrompt(outcome),
    parse: parseDensified,
  },
];

const host = createOpenCodeAdapter({ binary, model });
try {
  await host.init();
} catch (error) {
  process.stderr.write(`probe: host is not available — ${error.message}\n`);
  process.exit(2);
}

const runs = [];
for (const seam of SEAMS) {
  for (let trial = 0; trial < trials; trial += 1) {
    const outcome = OUTCOMES[trial % OUTCOMES.length];
    let result;
    const startedAt = Date.now();
    try {
      const reply = await invokeWithRepair(host, seam.role, seam.prompt(outcome), seam.parse);
      result = reply.retried
        ? { outcome: 'repaired', firstFailure: reply.firstFailure }
        : { outcome: 'clean' };
    } catch (error) {
      const message = String(error?.message ?? error);
      // A host/transport failure is not evidence about the model's contract.
      result = /status |not available|rate|429|timed out|timeout|exceeded \d+ms/i.test(message)
        ? { outcome: 'unmeasured', reason: message }
        : { outcome: 'fell-through', reason: message };
    }
    const entry = { seam: seam.seam, trial, ms: Date.now() - startedAt, ...result };
    runs.push(entry);
    process.stdout.write(
      `${seam.seam} trial ${trial + 1}/${trials}: ${entry.outcome}` +
        (entry.reason || entry.firstFailure ? ` (${entry.reason ?? entry.firstFailure})` : '') +
        ` [${entry.ms}ms]\n`,
    );
  }
}

const summarize = (seam) => {
  const of = runs.filter((r) => r.seam === seam);
  const count = (o) => of.filter((r) => r.outcome === o).length;
  return {
    trials: of.length,
    clean: count('clean'),
    repaired: count('repaired'),
    fellThrough: count('fell-through'),
    unmeasured: count('unmeasured'),
  };
};

const artifact = {
  model,
  probedAt: new Date().toISOString(),
  trials,
  note:
    'clean = first reply parsed; repaired = one corrective retry parsed; ' +
    'fell-through = both replies malformed (the stated fallback fires); ' +
    'unmeasured = the host or transport failed, which is not evidence about the model. ' +
    'Dated and per-model: free-tier catalogs churn, so this result must not be generalized to a tier or a family.',
  seams: Object.fromEntries(SEAMS.map((s) => [s.seam, summarize(s.seam)])),
  runs,
};

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(repo, 'fixtures', 'model-floors');
mkdirSync(dir, { recursive: true });
const stamp = artifact.probedAt.slice(0, 10);
const slug = model.replace(/[^a-z0-9.]+/gi, '-').replace(/^-|-$/g, '');
const file = path.join(dir, `${stamp}-${slug}.json`);
writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`\nwrote ${path.relative(repo, file)}\n`);
process.exit(0);
