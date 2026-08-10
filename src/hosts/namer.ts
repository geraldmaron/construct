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
import { invokeWithRepair, stripThinkBlocks } from './jsonrepair.ts';

/** The role a namer runs as. Not a catalog domain — it is asking about them. */
export const NAMER_ROLE = 'implication-namer';

/**
 * The namer is asked for a reason per domain, not just a list. escalate.ts
 * discards any naming whose `why` is empty, so a model that will not say why
 * produces silence rather than an implication nobody can argue with — the exact
 * defect the inversion recorded against the keyword path's empty signal lists.
 */
export function namerPrompt(outcome: string, catalog: readonly Domain[]): string {
  const lines = catalog
    .map((d) => {
      const block = [`- ${d.domain}: ${d.concern}`];
      for (const when of d.implicatedWhen) block.push(`    applies when: ${when}`);
      for (const not of d.notImplicatedWhen) block.push(`    does NOT apply when: ${not}`);
      return block.join('\n');
    })
    .join('\n');
  return [
    'You are deciding which of a fixed catalog of concerns an outcome implicates.',
    '',
    'Think about the SITUATION the outcome describes, not the words it uses. A',
    'concern applies because the thing it watches for is actually happening —',
    'not because a matching word appeared, and not because the topic sounds',
    'adjacent. Somebody describing their situation in plain language will name',
    'almost none of these concerns, and will still be in the middle of several',
    'of them. Finding those is the entire job.',
    '',
    'The outcome, in the user\'s own words:',
    outcome,
    '',
    'The catalog. You may name ONLY these concerns, exactly as spelled here.',
    'Each one lists when it applies, and where useful the look-alikes where it',
    'does not:',
    lines,
    '',
    'Rules:',
    '- Name a concern only when one of its "applies when" conditions is actually',
    '  met by the situation. Check its "does NOT apply when" lines before naming',
    '  it: those are mistakes that have genuinely been made here.',
    '- Read past the vocabulary in both directions. An outcome that never says',
    '  "personal data" can still be squarely about it; an outcome that says',
    '  "contracts" may involve no agreement with anyone at all.',
    '- Naming nothing is a valid and useful answer. Do not reach.',
    '- For each concern you name, state why in one sentence: which condition is',
    '  met, and what in the outcome meets it. A reason the user cannot argue',
    '  with is not a reason.',
    '',
    'Reply with JSON only — no prose, no markdown fences, no <think> blocks,',
    'nothing outside the object:',
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
  const bare = stripThinkBlocks(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(bare);
  const body = fenced ? fenced[1] : bare;
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

/**
 * Build a `DomainNamer` backed by a host adapter. The caller owns the
 * adapter's lifecycle: `init()` must have succeeded before the returned namer
 * is used, exactly as with `work`'s dispatch path.
 *
 * A malformed first reply gets one corrective retry (jsonrepair.ts) before
 * the throw that naming.ts turns into the keyword fallback, and a repaired
 * answer reports itself as repaired so the work log can say a second model
 * call was paid.
 */
export function createHostNamer(host: HostAdapter): DomainNamer {
  return async (outcome, catalog) => {
    // No invocationId: nothing cancels a namer call, and inventing one here
    // would mean reading a clock this layer has no reason to read.
    const repaired = await invokeWithRepair(
      host,
      NAMER_ROLE,
      namerPrompt(outcome, catalog),
      parseNamings,
    );
    return repaired.retried
      ? { namings: repaired.value, retried: true, firstFailure: repaired.firstFailure }
      : repaired.value;
  };
}
