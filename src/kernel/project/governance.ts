/**
 * kernel/project/governance.ts — what the person has told Construct to treat
 * as settled, in a form the checks can use.
 *
 * Documents rarely say they are out of date. People do: "INT-203 supersedes
 * ADR-004", "the 2025 platform strategy is outdated". A remembered decision
 * in one of those shapes marks the named document or item as superseded, so
 * citing it without saying so is caught the same way a "Supersedes:" header
 * is. Matching is by name: a file name with or without its extension, a
 * leading part of one ("ADR-004" matches adr-004-retry-policy.md), or an
 * item key.
 */

export interface DeclaredSupersession {
  /** Lower-cased name of what was replaced, without extension. */
  readonly match: string;
  /** What replaced it, in the person's words. */
  readonly by: string;
  readonly statementId: string;
}

const REPLACES = /^\s*(.+?)\s+(?:supersedes|replaces|overrides)\s+(?:the\s+)?(.+?)\s*\.?\s*$/i;
const REPLACED_BY = /^\s*(?:the\s+)?(.+?)\s+(?:is|are|was|were)\s+(?:now\s+)?(?:superseded|replaced|overridden)\s+by\s+(?:the\s+)?(.+?)\s*\.?\s*$/i;
const OUTDATED = /^\s*(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:now\s+)?(?:outdated|obsolete|out of date|retired|no longer (?:valid|current|applies|in force))\b/i;
const NAMEISH = /[A-Za-z0-9_][A-Za-z0-9_.\-/]*\.(?:md|markdown|txt|pdf|docx?|json|csv)\b|\b[A-Z][A-Z0-9]+-\d+\b/;

/** The most specific name in a phrase: a file name or an item key if there is one, else the phrase itself. */
export function nameIn(phrase: string): string {
  const hit = NAMEISH.exec(phrase);
  const raw = (hit ? hit[0] : phrase).trim().replace(/^["'`]|["'`]$/g, '');
  const base = raw.slice(raw.lastIndexOf('/') + 1);
  return base.replace(/\.(?:md|markdown|txt|pdf|docx?|json|csv)$/i, '').toLowerCase().replace(/\s+/g, '-');
}

export function declaredSupersessions(statements: readonly { readonly id: string; readonly text: string }[]): DeclaredSupersession[] {
  const out: DeclaredSupersession[] = [];
  for (const s of statements) {
    for (const sentence of s.text.split(/(?<=[.;])\s+|\n/)) {
      let m = REPLACED_BY.exec(sentence);
      if (m) { out.push({ match: nameIn(m[1]!), by: m[2]!.trim(), statementId: s.id }); continue; }
      m = REPLACES.exec(sentence);
      if (m) { out.push({ match: nameIn(m[2]!), by: m[1]!.trim(), statementId: s.id }); continue; }
      m = OUTDATED.exec(sentence);
      if (m) out.push({ match: nameIn(m[1]!), by: `(remembered: "${s.text.trim()}")`, statementId: s.id });
    }
  }
  return out.filter((d) => d.match.length >= 4);
}

/** Whether a declared supersession names this document or item. */
export function supersessionFor(names: readonly string[], declared: readonly DeclaredSupersession[]): DeclaredSupersession | undefined {
  const candidates = names.map((n) => n.slice(n.lastIndexOf('/') + 1).replace(/\.(?:md|markdown|txt|pdf|docx?|json|csv)$/i, '').toLowerCase());
  return declared.find((d) => candidates.some((c) => c === d.match || c.startsWith(`${d.match}-`) || c.startsWith(`${d.match}_`)));
}
