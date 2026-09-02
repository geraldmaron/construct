/**
 * kernel/project/discovery.ts — turn a project's own material into proposals.
 *
 * Pure: it reads nothing. Every proposal names the file and line it came from
 * and how sure it is; nothing here is fact until a person confirms it. The
 * three questions a person is asked first are fixed, because they are the
 * three things the material cannot answer: what the project is to them, what
 * matters most now, and what must not be violated.
 */

import type { ProjectMaterial, MaterialFile } from '../../hosts/repo/material.ts';
import type { ProjectScale } from '../state/profile.ts';
import type { StatementKind } from '../state/profile.ts';

export interface Provenance {
  readonly path: string;
  readonly line: number | null;
  readonly excerpt: string;
}

export interface ProfileProposal {
  readonly field: 'name' | 'purpose' | 'scale';
  readonly value: string;
  readonly confidence: number;
  readonly provenance: Provenance;
}

export interface StatementProposal {
  readonly kind: StatementKind;
  readonly text: string;
  readonly term?: string;
  readonly confidence: number;
  readonly provenance: Provenance;
}

export interface OwnershipProposal {
  readonly pattern: string;
  readonly owners: readonly string[];
  readonly confidence: number;
  readonly provenance: Provenance;
}

export interface OnboardingQuestion {
  readonly id: 'scale' | 'primary_outcome' | 'protected_constraints';
  readonly question: string;
  readonly options?: readonly string[];
}

export interface DiscoveryDraft {
  readonly profile: readonly ProfileProposal[];
  readonly statements: readonly StatementProposal[];
  readonly ownership: readonly OwnershipProposal[];
  readonly canonicalArtifacts: readonly { readonly path: string; readonly role: string; readonly provenance: Provenance }[];
  readonly unknowns: readonly string[];
  /** At most three; asked before any managed work. */
  readonly questions: readonly OnboardingQuestion[];
  /** Asked only when the answer changes scope, authority, permission, or a gate. */
  readonly deferredQuestions: readonly string[];
}

export const SCALE_OPTIONS: readonly ProjectScale[] = ['solo', 'side_project', 'team', 'multi_team', 'organization'];

export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = Object.freeze([
  {
    id: 'scale',
    question: 'What is this to you: a side project, your primary product, a team project, or something broader?',
    options: SCALE_OPTIONS,
  },
  { id: 'primary_outcome', question: 'What result matters most right now?' },
  { id: 'protected_constraints', question: 'What should Construct be especially careful not to change or violate?' },
]);

const MAX_PER_KIND = 10;

function lines(file: MaterialFile): string[] {
  return file.text.split(/\r?\n/);
}

function excerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 160 ? `${t.slice(0, 157)}...` : t;
}

function prov(file: MaterialFile, line: number | null, text: string): Provenance {
  return { path: file.path, line, excerpt: excerpt(text) };
}

function firstHeading(file: MaterialFile): { text: string; line: number } | null {
  const ls = lines(file);
  for (let i = 0; i < ls.length; i += 1) {
    const m = /^#\s+(.+?)\s*$/.exec(ls[i]!);
    if (m) return { text: m[1]!, line: i + 1 };
  }
  return null;
}

function firstParagraph(file: MaterialFile, afterLine: number): { text: string; line: number } | null {
  const ls = lines(file);
  let i = afterLine;
  while (i < ls.length && (ls[i]!.trim() === '' || ls[i]!.trim().startsWith('#') || ls[i]!.trim().startsWith('[![') || ls[i]!.trim().startsWith('<'))) i += 1;
  if (i >= ls.length) return null;
  const start = i;
  const buf: string[] = [];
  while (i < ls.length && ls[i]!.trim() !== '' && !ls[i]!.trim().startsWith('#')) {
    buf.push(ls[i]!.trim());
    i += 1;
  }
  const text = buf.join(' ');
  return text ? { text, line: start + 1 } : null;
}

/** Bullets under a heading whose text matches, until the next heading of equal or higher level. */
function bulletsUnder(file: MaterialFile, heading: RegExp): Array<{ text: string; line: number }> {
  const ls = lines(file);
  const out: Array<{ text: string; line: number }> = [];
  for (let i = 0; i < ls.length; i += 1) {
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(ls[i]!);
    if (!h || !heading.test(h[2]!)) continue;
    const level = h[1]!.length;
    for (let j = i + 1; j < ls.length; j += 1) {
      const next = /^(#{1,6})\s+/.exec(ls[j]!);
      if (next && next[1]!.length <= level) break;
      const bullet = /^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/.exec(ls[j]!);
      if (bullet) out.push({ text: bullet[1]!.replace(/\*\*/g, ''), line: j + 1 });
      if (out.length >= MAX_PER_KIND) return out;
    }
  }
  return out;
}

function prohibitions(file: MaterialFile): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  const ls = lines(file);
  for (let i = 0; i < ls.length && out.length < MAX_PER_KIND; i += 1) {
    const raw = ls[i]!.trim();
    if (raw.startsWith('#') || raw.startsWith('```') || raw.length < 12) continue;
    if (/\b(never|must not|do not|don't|is forbidden|is not allowed)\b/i.test(raw)) {
      out.push({ text: raw.replace(/^(?:[-*+]|\d+\.)\s+/, '').replace(/\*\*/g, ''), line: i + 1 });
    }
  }
  return out;
}

function glossaryRows(file: MaterialFile): Array<{ term: string; meaning: string; line: number }> {
  const out: Array<{ term: string; meaning: string; line: number }> = [];
  const ls = lines(file);
  for (let i = 0; i < ls.length && out.length < 30; i += 1) {
    const cells = ls[i]!.split('|').map((c) => c.trim());
    if (cells.length < 3 || cells[0] !== '' ) continue;
    const term = cells[1]!;
    const meaning = cells[cells.length - 2]!;
    if (!term || !meaning || /^-+$/.test(term) || /^term\b/i.test(term)) continue;
    out.push({ term: term.replace(/`/g, ''), meaning, line: i + 1 });
  }
  return out;
}

function codeownersRows(file: MaterialFile): Array<{ pattern: string; owners: string[]; line: number }> {
  const out: Array<{ pattern: string; owners: string[]; line: number }> = [];
  const ls = lines(file);
  for (let i = 0; i < ls.length; i += 1) {
    const raw = ls[i]!.trim();
    if (raw === '' || raw.startsWith('#')) continue;
    const [pattern, ...owners] = raw.split(/\s+/);
    if (!pattern || owners.length === 0) continue;
    out.push({ pattern, owners, line: i + 1 });
  }
  return out;
}

export function draftFromMaterial(material: ProjectMaterial): DiscoveryDraft {
  const profile: ProfileProposal[] = [];
  const statements: StatementProposal[] = [];
  const ownership: OwnershipProposal[] = [];
  const canonical: Array<{ path: string; role: string; provenance: Provenance }> = [];

  const m = material.manifest;
  if (m?.name) {
    profile.push({ field: 'name', value: m.name.replace(/^@[^/]+\//, ''), confidence: 0.9, provenance: { path: m.path, line: null, excerpt: `"name": "${m.name}"` } });
  }
  if (m?.description) {
    profile.push({ field: 'purpose', value: m.description, confidence: 0.8, provenance: { path: m.path, line: null, excerpt: excerpt(m.description) } });
  }
  const readme = material.readme;
  if (readme) {
    canonical.push({ path: readme.path, role: 'overview', provenance: prov(readme, 1, lines(readme)[0] ?? readme.path) });
    const h1 = firstHeading(readme);
    if (h1 && !profile.some((p) => p.field === 'name')) {
      profile.push({ field: 'name', value: h1.text, confidence: 0.7, provenance: prov(readme, h1.line, h1.text) });
    }
    const para = firstParagraph(readme, h1 ? h1.line : 0);
    if (para && !profile.some((p) => p.field === 'purpose')) {
      profile.push({ field: 'purpose', value: para.text, confidence: 0.6, provenance: prov(readme, para.line, para.text) });
    }
    for (const b of bulletsUnder(readme, /principle|convention|how we work|values/i)) {
      statements.push({ kind: 'principle', text: b.text, confidence: 0.6, provenance: prov(readme, b.line, b.text) });
    }
  }
  for (const doc of material.agentInstructions) {
    canonical.push({ path: doc.path, role: 'agent instructions', provenance: prov(doc, 1, lines(doc)[0] ?? doc.path) });
    for (const b of bulletsUnder(doc, /principle|convention|rule|invariant/i)) {
      if (statements.filter((s) => s.kind === 'principle').length >= MAX_PER_KIND) break;
      statements.push({ kind: 'principle', text: b.text, confidence: 0.6, provenance: prov(doc, b.line, b.text) });
    }
    for (const p of prohibitions(doc)) {
      if (statements.filter((s) => s.kind === 'constraint').length >= MAX_PER_KIND) break;
      if (statements.some((s) => s.text === p.text)) continue;
      statements.push({ kind: 'constraint', text: p.text, confidence: 0.5, provenance: prov(doc, p.line, p.text) });
    }
  }
  if (material.contributing) {
    canonical.push({ path: material.contributing.path, role: 'contribution rules', provenance: prov(material.contributing, 1, material.contributing.path) });
  }
  for (const doc of material.architectureDocs) {
    canonical.push({ path: doc.path, role: 'architecture', provenance: prov(doc, 1, lines(doc)[0] ?? doc.path) });
    for (const b of bulletsUnder(doc, /boundar|invariant|commitment/i)) {
      if (statements.filter((s) => s.kind === 'boundary').length >= MAX_PER_KIND) break;
      statements.push({ kind: 'boundary', text: b.text, confidence: 0.5, provenance: prov(doc, b.line, b.text) });
    }
  }
  if (material.strategy) {
    canonical.push({ path: material.strategy.path, role: 'strategy', provenance: prov(material.strategy, 1, material.strategy.path) });
  }
  if (material.glossary) {
    canonical.push({ path: material.glossary.path, role: 'glossary', provenance: prov(material.glossary, 1, material.glossary.path) });
    for (const row of glossaryRows(material.glossary)) {
      statements.push({ kind: 'glossary_entry', term: row.term, text: row.meaning, confidence: 0.8, provenance: prov(material.glossary, row.line, `${row.term}: ${row.meaning}`) });
    }
  }
  if (material.codeowners) {
    canonical.push({ path: material.codeowners.path, role: 'ownership', provenance: prov(material.codeowners, 1, material.codeowners.path) });
    for (const row of codeownersRows(material.codeowners)) {
      ownership.push({ pattern: row.pattern, owners: row.owners, confidence: 0.6, provenance: prov(material.codeowners, row.line, `${row.pattern} ${row.owners.join(' ')}`) });
    }
  }

  // Scale is only ever a weak guess; the person is asked regardless.
  const distinctOwners = new Set(ownership.flatMap((o) => o.owners));
  if (distinctOwners.size >= 3 || (m?.workspaces && distinctOwners.size >= 2)) {
    profile.push({ field: 'scale', value: 'multi_team', confidence: 0.3, provenance: { path: material.codeowners?.path ?? m?.path ?? '.', line: null, excerpt: `${String(distinctOwners.size)} distinct owners${m?.workspaces ? ', workspaces' : ''}` } });
  } else if (distinctOwners.size >= 1) {
    profile.push({ field: 'scale', value: 'team', confidence: 0.3, provenance: { path: material.codeowners!.path, line: null, excerpt: `${String(distinctOwners.size)} owner(s) declared` } });
  }

  const unknowns: string[] = [];
  if (!profile.some((p) => p.field === 'purpose')) unknowns.push('purpose');
  unknowns.push('primary outcome', 'success measures', 'risk posture', 'review cadence');
  if (ownership.length === 0) unknowns.push('ownership and decision rights');

  const deferred: string[] = [];
  if (ownership.length > 0) deferred.push('Confirm the ownership lines read from CODEOWNERS before Construct treats anyone as an owner.');
  if (material.docFiles.length > 0) deferred.push('Which documents under docs/ are authoritative, and for what?');

  return {
    profile,
    statements,
    ownership,
    canonicalArtifacts: canonical,
    unknowns,
    questions: ONBOARDING_QUESTIONS,
    deferredQuestions: deferred,
  };
}
