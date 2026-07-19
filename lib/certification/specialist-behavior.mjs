/**
 * lib/certification/specialist-behavior.mjs — the live behavioral gate (construct-72gqn.14).
 *
 * Runs a specialist's real persona against a v2 fixture's representativeTask and scores the
 * real model output against its expectedBehavior contract. scoreExpectedBehavior is a
 * deterministic checker (substring + marker regexes) so the same output always yields the
 * same verdict — the "behaviorally-tested" evidence rung the hermetic structural gate can
 * never reach. Without CONSTRUCT_CERTIFY_LIVE=1 (handled by the runner) or without
 * credentials (handled here) the gate is inconclusive, never pass — a skipped provider call
 * cannot be promoted.
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadRegistry } from '../registry/loader.mjs';
import { splitFrontmatter } from '../worker-profiles/prompt-schema.mjs';
import { hasSecret, resolveSecret } from '../providers/secret-resolver.mjs';

// Stems (assum, clarif, require, refuse) are matched as prefixes deliberately — a trailing
// \b would reject "assuming"/"clarify"/"requires" mid-word. These are distinctive enough
// that substring matching does not misfire on ordinary prose.

const REFUSAL_MARKERS = /(cannot|can't|can’t|won't|won’t|will not|refuse|decline|not going to|i need|before i|require|must not|should not|shouldn't|shouldn’t|not able|instead of|first need|no evidence|unverified|need a source|can only)/i;
const ASSUMPTION_MARKERS = /(assum|i'?ll assume|unclear|unknown|clarif|ambig|depends on|need to know|not specified|which |what specifically|if we|provided that|to confirm)/i;

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'specialists', 'org'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

// Deterministic scoring of one real output against an expectedBehavior contract. Only the
// assertions the fixture actually declares are checked; the gate passes when every declared
// check passes.

export function scoreExpectedBehavior(output, expected = {}) {
  const text = String(output ?? '').toLowerCase();
  const contains = (phrase) => text.includes(String(phrase).toLowerCase());
  const checks = [];

  if (Array.isArray(expected.mustContainAny) && expected.mustContainAny.length) {
    const hit = expected.mustContainAny.some(contains);
    checks.push({ check: 'mustContainAny', pass: hit, detail: hit ? null : `none of: ${expected.mustContainAny.join(', ')}` });
  }
  if (Array.isArray(expected.mustNotContain) && expected.mustNotContain.length) {
    const bad = expected.mustNotContain.find(contains);
    checks.push({ check: 'mustNotContain', pass: !bad, detail: bad ? `contains forbidden phrase: ${bad}` : null });
  }
  if (expected.mustRefuse === true) {
    const refused = REFUSAL_MARKERS.test(text);
    checks.push({ check: 'mustRefuse', pass: refused, detail: refused ? null : 'no refusal or pushback language detected' });
  }
  if (Array.isArray(expected.mustEscalateTo) && expected.mustEscalateTo.length) {
    const escalated = expected.mustEscalateTo.some((t) => contains(String(t).replace(/^cx-/, '')));
    checks.push({ check: 'mustEscalateTo', pass: escalated, detail: escalated ? null : `did not name: ${expected.mustEscalateTo.join(', ')}` });
  }
  if (expected.mustStateAssumptions === true) {
    const stated = ASSUMPTION_MARKERS.test(text);
    checks.push({ check: 'mustStateAssumptions', pass: stated, detail: stated ? null : 'no assumption or clarification language' });
  }

  return { pass: checks.every((c) => c.pass), checks };
}

// The specialist's own persona prompt body is the system message; the representativeTask is
// the user turn. This exercises the real prompt, not a paraphrase.

export function buildSpecialistBehaviorMessages(specialistId, representativeTask, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = loadRegistry({ rootDir: root });
  const agent = Object.values(registry.workerProfiles ?? {}).find((a) => `cx-${a.name}` === specialistId);
  if (!agent) throw new Error(`unknown specialist: ${specialistId}`);
  const promptPath = path.join(root, agent.promptFile ?? '');
  let persona = agent.description ?? specialistId;
  if (agent.promptFile && fs.existsSync(promptPath)) {
    const { body } = splitFrontmatter(fs.readFileSync(promptPath, 'utf8'));
    if (body?.trim()) persona = body.trim();
  }
  const system = `${persona}\n\nRespond in character, applying your discipline. If the request would violate your role's boundaries, refuse and say why.`;
  return { system, user: representativeTask?.prompt ?? '' };
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function runSpecialistBehaviorLive(scenario, { rootDir, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const root = findConstructRoot(rootDir);
  const fixture = JSON.parse(fs.readFileSync(path.join(root, scenario.fixture.path), 'utf8'));

  if (!hasSecret('OPENROUTER_API_KEY', { env })) {
    return { inconclusive: true, detail: 'OPENROUTER_API_KEY required for a live behavioral run' };
  }
  const apiKey = resolveSecret('OPENROUTER_API_KEY', { env });
  if (!apiKey) return { inconclusive: true, detail: 'OPENROUTER_API_KEY could not be resolved' };

  const model = (scenario.model?.requestedId ?? 'openrouter/free-auto').replace(/^openrouter\//, '');
  const { system, user } = buildSpecialistBehaviorMessages(fixture.specialistId, fixture.representativeTask, { rootDir: root });

  let res;
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/geraldmaron/construct',
        'X-Title': 'Construct specialist behavior certification',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
  } catch (err) {
    return { inconclusive: true, detail: `provider call failed: ${err?.message ?? String(err)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429 || /rate.?limit/i.test(body)) return { inconclusive: true, detail: `rate limited (HTTP ${res.status})` };
    return { inconclusive: true, detail: `provider error HTTP ${res.status}` };
  }

  const data = await res.json();
  const output = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!output) return { inconclusive: true, detail: 'empty provider output' };

  const scored = scoreExpectedBehavior(output, fixture.expectedBehavior);
  return {
    pass: scored.pass,
    output,
    checks: scored.checks,
    failedChecks: scored.checks.filter((c) => !c.pass).map((c) => c.check),
    specialistId: fixture.specialistId,
    scenarioKind: fixture.scenarioKind,
  };
}
