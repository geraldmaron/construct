/**
 * hosts/namer.ts — the host-layer implementation of kernel's `DomainNamer`
 * seam.
 *
 * naming.ts defines the seam and constructs nothing, on purpose: the kernel
 * stays host-ignorant. This module is the adapter side. It is deliberately
 * written against `HostAdapter` rather than against OpenCode or Claude, because
 * both adapters already take `{ role, task }` and return a deliverable carrying
 * `text` — so one namer serves every conforming host, and a future host gets
 * naming for free rather than a third copy of this file.
 *
 * What this module is careful NOT to do:
 *
 *   - It does not decide whether a model is consulted. That is the CLI's
 *     decision (--host); with a host named, the kernel consults the namer on
 *     every outcome (adopted 2026-08-05).
 *   - It does not validate domains. `admissible()` in naming.ts is the only
 *     gate on what the catalog contains, and duplicating it here would create
 *     two places for a hallucinated role to slip through differently.
 *   - It does not degrade to a guess. Every failure path — a host error, a
 *     non-ok result, unparseable output — THROWS, because naming.ts turns a
 *     throw into the keyword fallback, stated as such. Returning an empty
 *     array here would be indistinguishable from "the model considered the
 *     catalog and named nothing", and those two are not the same fact.
 *
 * The prompt asks for JSON and nothing else, and the parser tolerates the
 * fenced-code wrapper models add anyway. That tolerance is not politeness: the
 * measured alternative is a namer that fails on formatting and reports silence
 * the user then reads as "no domain applies".
 */

import type { Domain } from '../kernel/implication/domains.ts';
import type { DomainNamer, DomainNaming } from '../kernel/implication/naming.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';

/** The role a namer runs as. Not a catalog domain — it is asking about them. */
export const NAMER_ROLE = 'implication-namer';

/**
 * The namer is asked for a reason per domain, not just a list. escalate.ts
 * discards any naming whose `why` is empty, so a model that will not say why
 * produces silence rather than an implication nobody can argue with — the exact
 * defect the inversion recorded against the keyword path's empty signal lists.
 */
export function namerPrompt(outcome: string, catalog: readonly Domain[]): string {
  const lines = catalog.map((d) => `- ${d.domain}: ${d.concern}`).join('\n');
  return [
    'You are deciding which of a fixed catalog of domains an outcome implicates.',
    '',
    'The outcome, in the user\'s own words:',
    outcome,
    '',
    'The catalog. You may name ONLY these domains, exactly as spelled here:',
    lines,
    '',
    'Rules:',
    '- Name a domain only if the outcome genuinely implicates its concern.',
    '- Naming nothing is a valid and useful answer. Do not reach.',
    '- For each domain you name, state why in one sentence, grounded in the',
    '  outcome\'s own words. A reason the user cannot argue with is not a reason.',
    '',
    'Reply with JSON only, no prose and no explanation outside it:',
    '{"domains":[{"domain":"<exact catalog name>","why":"<one sentence>"}]}',
    'If nothing is implicated, reply exactly: {"domains":[]}',
  ].join('\n');
}

/**
 * Pull the JSON object out of a model's reply. Models wrap JSON in ``` fences
 * and prefix it with a sentence often enough that refusing those replies would
 * turn a formatting habit into a reported non-implication.
 */
export function parseNamings(text: string): readonly DomainNaming[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('the host replied with no JSON object');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('the host replied with malformed JSON');
  }

  const domains = (parsed as { domains?: unknown } | null)?.domains;
  if (!Array.isArray(domains)) {
    throw new Error('the host\'s JSON has no "domains" array');
  }

  const namings: DomainNaming[] = [];
  for (const entry of domains) {
    const record = entry as { domain?: unknown; why?: unknown } | null;
    if (typeof record?.domain !== 'string') continue;
    namings.push({
      domain: record.domain,
      why: typeof record.why === 'string' ? record.why : '',
    });
  }
  return namings;
}

/** The text a conforming adapter puts in its deliverable. */
function deliverableText(output: unknown): string {
  const text = (output as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('the host returned no text');
  }
  return text;
}

/**
 * Build a `DomainNamer` backed by a host adapter. The caller owns the
 * adapter's lifecycle: `init()` must have succeeded before the returned namer
 * is used, exactly as with `work`'s dispatch path.
 */
export function createHostNamer(host: HostAdapter): DomainNamer {
  return async (outcome, catalog) => {
    // No invocationId: nothing cancels a namer call, and inventing one here
    // would mean reading a clock this layer has no reason to read.
    const result = await host.invoke({ role: NAMER_ROLE, task: namerPrompt(outcome, catalog) });
    if (result.status !== 'ok') {
      // Thrown, not returned empty: escalate.ts turns a throw into silence,
      // and a host that errored has not considered the catalog at all.
      throw new Error(`host "${host.name}" returned status ${result.status}`);
    }
    return parseNamings(deliverableText(result.output));
  };
}
