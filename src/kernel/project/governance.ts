/**
 * kernel/project/governance.ts — what the person has told Construct to treat
 * as settled, in a form the checks can use.
 *
 * Two forms carry that power, both written by Construct when the person
 * confirms them on their own channel: a term ruled out (`Do not state "X" as
 * current`) and a document or item no longer current (`Treat "X" as no
 * longer current`). The parsers read only statements in the person's own
 * voice, so a record an assistant relayed, an answer it gave in the person's
 * place, or a proposal it confirmed never restricts what later work may say,
 * whatever its text. Nothing is read out of prose: "X is outdated" in a
 * decision is the decision's wording, not a supersession.
 *
 * Matching an outdated name is by name: a file name with or without its
 * extension, a leading part of one ("ADR-004" matches
 * adr-004-retry-policy.md), or an item key.
 */

import type { StatementVoice } from '../state/profile.ts';

export interface DeclaredSupersession {
  /** Lower-cased name of what is no longer current, without extension. */
  readonly match: string;
  /** What says so: the statement the person confirmed it for, described for the reader. */
  readonly by: string;
  readonly statementId: string;
}

/** A statement as the parsers read it: its text and whose voice it is in. */
export interface GoverningText {
  readonly id: string;
  readonly text: string;
  readonly voice: StatementVoice;
}

const NAMEISH = /[A-Za-z0-9_][A-Za-z0-9_.\-/]*\.(?:md|markdown|txt|pdf|docx?|json|csv)\b|\b[A-Z][A-Z0-9]+-\d+\b/;
const SETTLED_FORM = /^Do not state "([^"]+)" as current\b/;
const OUTDATED_FORM = /^Treat "([^"]+)" as no longer current\b/;

/** The most specific name in a phrase: a file name or an item key if there is one, else the phrase itself. */
export function nameIn(phrase: string): string {
  const hit = NAMEISH.exec(phrase);
  const raw = (hit ? hit[0] : phrase).trim().replace(/^["'`]|["'`]$/g, '');
  const base = raw.slice(raw.lastIndexOf('/') + 1);
  return base.replace(/\.(?:md|markdown|txt|pdf|docx?|json|csv)$/i, '').toLowerCase().replace(/\s+/g, '-');
}

/** Whether a declared supersession names this document or item. */
export function supersessionFor(names: readonly string[], declared: readonly DeclaredSupersession[]): DeclaredSupersession | undefined {
  const candidates = names.map((n) => n.slice(n.lastIndexOf('/') + 1).replace(/\.(?:md|markdown|txt|pdf|docx?|json|csv)$/i, '').toLowerCase());
  return declared.find((d) => candidates.some((c) => c === d.match || c.startsWith(`${d.match}-`) || c.startsWith(`${d.match}_`)));
}

/** The form a settled-against term is recorded in, so it can be checked: Do not state "X" as current. */
export function settledConstraintText(term: string, statementId: string): string {
  return `Do not state "${term.replace(/"/g, "'")}" as current; it contradicts statement:${statementId}.`;
}

/** The form a document or item the person called no longer current is recorded in: Treat "X" as no longer current. */
export function outdatedConstraintText(name: string, statementId: string): string {
  return `Treat "${name.replace(/"/g, "'")}" as no longer current; statement:${statementId} says so.`;
}

/**
 * Whether text is in one of the two forms that restrict later work. Only the
 * person's own channel may record one; anything relayed is refused with
 * RULE_FORM_REFUSAL.
 */
export function inRuleForm(text: string): boolean {
  const t = text.trim();
  return SETTLED_FORM.test(t) || OUTDATED_FORM.test(t);
}

/** Why a relayed record in a restricting form is refused, and what to do instead. */
export const RULE_FORM_REFUSAL =
  'This text is in the form Construct enforces as a ruled-out term or an outdated document, and only the person can make one: record the decision in plain words and name the terms in contradicts, or the documents in outdates, and Construct asks the person to confirm them.';

/** Terms the person settled against, from their own confirmed constraints of that form. */
export function settledTerms(constraints: readonly GoverningText[]): { term: string; statementId: string }[] {
  return constraints.flatMap((st) => {
    if (st.voice !== 'person') return [];
    const m = SETTLED_FORM.exec(st.text.trim());
    if (!m) return [];
    const by = /statement:(\S+?)[.)]?$/.exec(st.text.trim())?.[1];
    return [{ term: m[1]!, statementId: by ?? st.id }];
  });
}

/**
 * Documents and items the person said are no longer current, from their own
 * confirmed constraints of that form. `describe` names the statement that
 * says so, for the reader; without it, or when it knows nothing, `by` says
 * only that the person confirmed it, and the statement id stays beside it.
 */
export function outdatedTerms(constraints: readonly GoverningText[], describe?: (statementId: string) => string | null): DeclaredSupersession[] {
  return constraints.flatMap((st) => {
    if (st.voice !== 'person') return [];
    const text = st.text.trim();
    const m = OUTDATED_FORM.exec(text);
    if (!m) return [];
    const statementId = /statement:(\S+) says so\.?$/.exec(text)?.[1] ?? st.id;
    const match = nameIn(m[1]!);
    if (match.length < 3) return [];
    return [{ match, by: describe?.(statementId) ?? 'what the person confirmed', statementId }];
  });
}
