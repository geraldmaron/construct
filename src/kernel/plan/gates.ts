/**
 * kernel/plan/gates.ts — the obligation a lens states over work filed against
 * a repository the user declared as ground.
 *
 * Construct states obligations and checks them; the host writes the code that
 * satisfies them. Two things can carry an obligation and they are not equal. A
 * repository that declares its own check — a script anybody can run — has
 * already said what passing means for it, and naming that script is worth more
 * to a role than any standard, because it is what the work will actually be
 * measured by. A repository that declares none leaves the standard itself as
 * the obligation, and the standard is named rather than the line going quiet:
 * an obligation that disappears whenever nobody automated it is not an
 * obligation, it is a preference.
 *
 * The judgement here is pure and the reading is not. What sits at a declared
 * root is gathered in hosts/repo/gates.ts and arrives as a `RepoManifest`,
 * which is what makes every match below testable without a filesystem — the
 * same seam grounding uses for surveys.
 *
 * Only declared ground is ever read. A manifest that happens to sit beside the
 * running process is not evidence about the user's work, and nothing here can
 * learn of one: a root reaches this module because the workspace declared it as
 * a source, never because the process is standing in it.
 *
 * This adds no lens depth. Each concern below belongs to a lens that already
 * asks its questions and already names the standard its method descends from;
 * all this does is let the repository's own check speak where it exists.
 */

import { escapeForPrompt } from '../run/sourcereads.ts';
import { standardsFor } from './standards.ts';

/** One entry of a manifest's script table, as the manifest writes it. */
export interface ManifestScript {
  /** The name a reader runs, e.g. `test:a11y`. */
  readonly name: string;
  /** What that name runs, kept because a gate is often only visible in it. */
  readonly command: string;
}

/**
 * What one declared root says it checks about itself. An unreadable or
 * absent manifest is not one of these; the caller supplies the roots
 * separately so "no manifest" and "no root at all" stay distinguishable.
 */
export interface RepoManifest {
  /** The declared ground root this was read from. */
  readonly root: string;
  /** Empty means the manifest declares no scripts, which is a real answer. */
  readonly scripts: readonly ManifestScript[];
}

/**
 * A concern a repository can declare its own check for, and the lens that
 * states the obligation when it does not.
 *
 * The tokens are matched against a script's name first and its command second.
 * They are deliberately few and specific: a token that fires on an ordinary
 * script name would put a gate in the obligation line that nobody wrote, which
 * is worse than falling back to the standard.
 */
export interface GateConcern {
  /** The word the obligation line uses: "a gate for accessibility". */
  readonly concern: string;
  /** The lens that owns the obligation, matching `RoleLens.lens`. */
  readonly lens: string;
  /** The deliverable slot the answer belongs in, matching that lens's slot. */
  readonly slot: string;
  /** Lowercase tokens that name this concern in a script name or command. */
  readonly tokens: readonly string[];
}

export const GATE_CONCERNS: readonly GateConcern[] = Object.freeze([
  {
    concern: 'accessibility',
    lens: 'design',
    slot: 'accessibility-obligation',
    tokens: ['a11y', 'accessibility', 'axe', 'pa11y'],
  },
  {
    concern: 'security',
    lens: 'security',
    slot: 'security-obligation',
    tokens: ['security', 'audit', 'snyk', 'semgrep', 'sast'],
  },
  // Performance sits with operations rather than with design because the
  // questions a missed performance budget raises are the operations lens's
  // own: how anyone finds out it degraded, and what the degradation costs to
  // keep alive. Its standards entry — latency and saturation as signals a
  // failure path owes — is the fallback that reads correctly here.
  {
    concern: 'performance',
    lens: 'operations',
    slot: 'performance-obligation',
    tokens: ['perf', 'performance', 'lighthouse', 'bench', 'benchmark'],
  },
]);

/** The gate concern a lens states, if it states one. */
export function gateConcernFor(lens: string): GateConcern | undefined {
  return GATE_CONCERNS.find((c) => c.lens === lens);
}

/** One check a declared repository already runs, named the way a reader runs it. */
export interface DeclaredGate {
  readonly concern: string;
  readonly lens: string;
  /** The script name, which is what a reader passes to their package runner. */
  readonly script: string;
  /** The declared ground root whose manifest names it. */
  readonly root: string;
  /**
   * Whether the script's own name named the concern, or only the command it
   * runs did. Carried because the two are different strengths of evidence and
   * a reader deciding whether the match is real needs to know which it was.
   */
  readonly matchedOn: 'name' | 'command';
}

/** Lowercase alphanumeric runs, which is how a script name spells its parts. */
function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== '');
}

function namesConcern(tokens: readonly string[], concern: GateConcern): boolean {
  return tokens.some((t) => concern.tokens.includes(t));
}

/**
 * The gates the declared manifests already run, at most one per concern per
 * root.
 *
 * A name match beats a command match everywhere, because a repository that
 * called its script `test:a11y` said what it was for, while a command that
 * merely mentions a tool may be doing something else with it. Within each
 * class the manifest's own order decides, so the same repository always
 * produces the same obligation line.
 */
export function gatesDeclared(manifests: readonly RepoManifest[]): DeclaredGate[] {
  const found: DeclaredGate[] = [];
  for (const manifest of manifests) {
    for (const concern of GATE_CONCERNS) {
      const byName = manifest.scripts.find((s) => namesConcern(tokensOf(s.name), concern));
      const match =
        byName ??
        manifest.scripts.find((s) => namesConcern(tokensOf(s.command), concern));
      if (!match) continue;
      found.push({
        concern: concern.concern,
        lens: concern.lens,
        script: match.name,
        root: manifest.root,
        matchedOn: byName ? 'name' : 'command',
      });
    }
  }
  return found;
}

/** What the run was given as ground, and what those roots declare about themselves. */
export interface GroundGates {
  /** Local roots the run may read, as the store recorded them. */
  readonly roots: readonly string[];
  /** The manifests read from those roots. A root with none is simply absent. */
  readonly manifests: readonly RepoManifest[];
}

/** The standard a lens falls back to, named the way its publisher names it. */
function standardClause(lens: string): string {
  const record = standardsFor(lens);
  const first = record?.refs[0];
  if (first) return `${first.name} (${first.publisher})`;
  return record?.ungrounded ?? 'the practice this lens descends from';
}

/**
 * The obligation block a dispatched role reads, or the empty string for a lens
 * that states no gate concern.
 *
 * Always one of two sentences, never none. A repository that declares a check
 * gets that check named, by the script a reader runs, so the role is working
 * against the bar the repository already set. A repository that declares none —
 * or a run given no repository at all — gets the standard named instead, which
 * is the same obligation with nobody automating it yet.
 *
 * Script names and roots come from a manifest somebody else wrote, so both
 * render through `escapeForPrompt`: a raw control character in either could
 * otherwise forge a line of its own in a block built one entry per line.
 */
export function gateObligation(lens: string, ground: GroundGates): string {
  const concern = gateConcernFor(lens);
  if (!concern) return '';
  const declared = gatesDeclared(ground.manifests).filter((g) => g.concern === concern.concern);
  const standard = standardClause(lens);
  const lines: string[] = [];
  if (declared.length > 0) {
    for (const gate of declared) {
      lines.push(
        `- this repo has a gate for ${concern.concern} — ` +
          `${escapeForPrompt(gate.script)} — and the work must pass it. It is a ` +
          `script in ${escapeForPrompt(gate.root)}, run through that repository's ` +
          'own package runner' +
          (gate.matchedOn === 'command'
            ? ', and the manifest names it by what it runs rather than by what it is called'
            : '') +
          `. ${standard} is the standard behind it; the gate is what this work is ` +
          'measured by.',
      );
    }
  } else if (ground.roots.length > 0) {
    lines.push(
      `- the repository you were given as ground declares no ${concern.concern} gate, ` +
        `so the obligation is the standard itself: ${standard}. Name the requirements ` +
        'this work has to meet and how a reader would check it against them.',
    );
  } else {
    lines.push(
      '- no repository was declared as ground for this run, so the obligation is ' +
        `the standard itself: ${standard}. Name the ${concern.concern} requirements ` +
        'this work has to meet and how a reader would check it against them.',
    );
  }
  return (
    `Your ${concern.concern} obligation, which is checkable rather than ` +
    'aspirational. Construct states the obligation; the code that satisfies it is ' +
    `written by whoever does the work. Answer this under the ${concern.slot} ` +
    'section of your deliverable:\n' +
    `${lines.join('\n')}\n`
  );
}
