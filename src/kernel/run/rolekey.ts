/**
 * kernel/run/rolekey.ts — matching a label a model wrote against the label
 * this run actually knows, whether that label is a dispatched role or a
 * shape's section name.
 *
 * Every screen in this system that checks "did a real role produce this" is
 * built to refuse anything that isn't a role the run dispatched — that is
 * the whole fabrication guard. Measured on three live compositions in one
 * session, a small free model kept clearing that bar for the wrong reason:
 * not because it named a role that never ran, but because it wrote the real
 * role's name in a form the composer's own prompt never showed it —
 * "Product Scoping" for "product-scoping", spaces for hyphens, and so on.
 * Two whole documents came back with zero claims kept because every single
 * one was refused this way; the guard was working exactly as designed and
 * the reader still got nothing.
 *
 * A second instance of the identical failure showed up one call downstream,
 * in how a kept claim gets placed under its section heading: `claim.section
 * === section.name`, the same exact-string comparison, with a worse
 * symptom — a section mismatch is not even reported as refused, the claim
 * is simply never rendered under any heading and the reader has no way to
 * know it existed. One live PRD composed nine claims that all survived
 * attribution and still produced a document with every section reporting
 * "no claim was placed there," because none of the nine section labels the
 * model wrote matched a shape section's name exactly.
 *
 * Both are the same problem: a written label compared against a known set
 * with no tolerance for how a small model actually writes labels it was
 * only ever shown, not asked to spell consistently. Lenient about the
 * spelling, strict about the identity — a written label that normalizes to
 * nothing in the known set is still refused (roleLookup) or left unplaced
 * (sectionLookup) in full. "author", "construct-position", "AGENTS.md",
 * "Product team" are not a role this run ran under any spelling, and
 * normalizing case and whitespace does nothing to manufacture a match for
 * them.
 */

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * A lookup from any way a model might spell a known label back to that
 * label's real identifier. Built once per screen, O(1) per lookup. Returns
 * undefined for anything that does not resolve to a label in the known set
 * — never a guess, never a partial match.
 */
function keyLookup(known: readonly string[]): (written: string) => string | undefined {
  const byKey = new Map(known.map((label) => [normalizeKey(label), label]));
  return (written: string) => byKey.get(normalizeKey(written));
}

/** A written role name resolved against the roles this run dispatched. */
export const roleLookup = keyLookup;

/** A written section name resolved against a shape's declared sections. */
export const sectionLookup = keyLookup;
