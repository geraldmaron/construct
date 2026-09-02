/**
 * kernel/registry/semver.ts — the small part of semantic versioning a local
 * registry needs: parse, compare, and satisfy exact, caret, tilde, and
 * bounded ranges. No dependency, no prerelease ordering beyond "present".
 */

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(raw: string): SemVer | null {
  const m = VERSION.exec(raw.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}

export function isVersion(raw: string): boolean {
  return parseVersion(raw) !== null;
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

export function formatVersion(v: SemVer): string {
  return `${String(v.major)}.${String(v.minor)}.${String(v.patch)}${v.prerelease ? `-${v.prerelease}` : ''}`;
}

type Bound = { readonly op: '>=' | '>' | '<=' | '<' | '='; readonly version: SemVer };

function boundsOf(range: string): Bound[] | null {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') return [];
  const out: Bound[] = [];
  for (const part of trimmed.split(/\s+/)) {
    const caret = /^\^(.+)$/.exec(part);
    const tilde = /^~(.+)$/.exec(part);
    const cmp = /^(>=|<=|>|<|=)(.+)$/.exec(part);
    if (caret) {
      const v = parseVersion(caret[1]!);
      if (!v) return null;
      out.push({ op: '>=', version: v });
      if (v.major > 0) out.push({ op: '<', version: { major: v.major + 1, minor: 0, patch: 0, prerelease: null } });
      else if (v.minor > 0) out.push({ op: '<', version: { major: 0, minor: v.minor + 1, patch: 0, prerelease: null } });
      else out.push({ op: '<', version: { major: 0, minor: 0, patch: v.patch + 1, prerelease: null } });
    } else if (tilde) {
      const v = parseVersion(tilde[1]!);
      if (!v) return null;
      out.push({ op: '>=', version: v });
      out.push({ op: '<', version: { major: v.major, minor: v.minor + 1, patch: 0, prerelease: null } });
    } else if (cmp) {
      const v = parseVersion(cmp[2]!);
      if (!v) return null;
      out.push({ op: cmp[1] as Bound['op'], version: v });
    } else {
      const v = parseVersion(part);
      if (!v) return null;
      out.push({ op: '=', version: v });
    }
  }
  return out;
}

export function isRange(raw: string): boolean {
  return boundsOf(raw) !== null;
}

export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  const bounds = boundsOf(range);
  if (!v || !bounds) return false;
  return bounds.every((b) => {
    const c = compareVersions(v, b.version);
    switch (b.op) {
      case '>=':
        return c >= 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      case '<':
        return c < 0;
      default:
        return c === 0;
    }
  });
}

/** The highest version in `candidates` that satisfies `range`, or null. */
export function highestSatisfying(candidates: readonly string[], range: string): string | null {
  let best: SemVer | null = null;
  for (const c of candidates) {
    const v = parseVersion(c);
    if (!v || !satisfies(c, range)) continue;
    if (!best || compareVersions(v, best) > 0) best = v;
  }
  return best ? formatVersion(best) : null;
}
