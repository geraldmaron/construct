/**
 * kernel/context/subjects.ts — which of a workspace's records one note is
 * actually about.
 *
 * The context loop showed the producer every record the workspace kept. In a
 * workspace holding several clients that puts one client's fields into the
 * prompt reasoning over another client's call notes — a leak between subjects
 * that no gate downstream would catch, because nothing about it is a citation.
 * It is also unbounded: documents are capped, records were not, so a workspace
 * that grew would eventually spend most of its prompt on subjects the note
 * never mentioned.
 *
 * The scope is the note's own words. A record whose name the note does not say
 * is not shown, which costs nothing real: a record update must name the record
 * it changes, so a subject the note never mentions is a subject the note
 * cannot determine anything about. "They moved the renewal" with nobody named
 * yields no update, and that is the correct answer rather than a missed one.
 *
 * Deterministic on purpose. Asking a model which records are relevant would
 * mean showing it every record to decide — the thing being avoided.
 */

/** The least a record's name may be and still be matched; shorter is noise. */
const MIN_NAME_LENGTH = 2;

/** Anything with a name this workspace keeps. Kept structural so any record shape fits. */
export interface NamedSubject {
  readonly name: string;
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a note says this name. Bounded by non-word characters at both ends
 * so "Acme" does not match "Acmex" — and matched case-insensitively, because
 * a person typing after a call does not capitalize reliably and a fact lost to
 * a lowercase client name is a fact lost for no reason.
 *
 * A name whose every character is punctuation, or that is a single character,
 * matches nothing: the pattern would fire on half the note.
 */
export function noteNames(body: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH) return false;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(trimmed)}(?![\\p{L}\\p{N}])`, 'iu').test(body);
}

export interface ScopedSubjects<T> {
  readonly shown: readonly T[];
  /** How many the note named but the cap withheld; stated, never absorbed. */
  readonly withheld: number;
}

/**
 * The records a note is about, in the order the workspace lists them, bounded.
 *
 * The cap is the same discipline the document cap follows: what it drops is
 * reported so a caller can say so, rather than the prompt quietly ending.
 */
export function subjectsOf<T extends NamedSubject>(
  body: string,
  records: readonly T[],
  cap: number,
): ScopedSubjects<T> {
  const named = records.filter((record) => noteNames(body, record.name));
  return { shown: named.slice(0, cap), withheld: Math.max(0, named.length - cap) };
}
