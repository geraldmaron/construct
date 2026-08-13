/**
 * kernel/run/rolekey.ts — matching a role name a model wrote against the role
 * a run actually dispatched.
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
 * The fix is the same shape as rolesNamed() in position.ts: lenient about
 * how a role's name is spelled, strict about which role it resolves to. A
 * written name that normalizes to no dispatched role is still refused in
 * full — "author", "construct-position", "AGENTS.md", "Product team" none of
 * these are a role this run ran under any spelling, and normalizing case and
 * whitespace does nothing to manufacture a match for them.
 */

function normalizeRoleKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * A lookup from any way a model might spell a dispatched role's name back to
 * that role's real identifier. Built once per screen, O(1) per claim.
 * Returns undefined for anything that does not resolve to a role this run
 * actually dispatched — never a guess, never a partial match.
 */
export function roleLookup(roles: readonly string[]): (written: string) => string | undefined {
  const byKey = new Map(roles.map((role) => [normalizeRoleKey(role), role]));
  return (written: string) => byKey.get(normalizeRoleKey(written));
}
