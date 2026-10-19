/**
 * kernel/safety/injection.ts — flags text from outside the person that is
 * shaped like an instruction to the model: an override of earlier
 * instructions, a claimed role or system message, a claimed approval, an
 * exfiltration request, instructions hidden in markup, or invisible
 * characters. Flagging never removes or rewrites the text; it tells the host
 * what to weigh, and the text stays data either way.
 */

export type InjectionFamily = 'override' | 'role' | 'approval' | 'exfiltration' | 'hidden' | 'invisible';

export interface InjectionFlag {
  readonly family: InjectionFamily;
  /** Where in the content the text sat, as a JSON-pointer-like path; empty for a bare string. */
  readonly at: string;
  /** The matched passage, bounded and with invisible characters shown as code points. */
  readonly excerpt: string;
}

const PATTERNS: readonly { readonly family: InjectionFamily; readonly re: RegExp }[] = [
  {
    family: 'override',
    re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|the|these)\b[^.\n]{0,20}\b(?:instructions?|rules|prompts?|directions|guidelines)\b/,
  },
  {
    family: 'role',
    re: /\byou are now\b|\bact as (?:the )?(?:system|admin|administrator|developer|root)\b|\b(?:system|developer) (?:prompt|message)\s*:|\bnew instructions?\s*:/,
  },
  {
    family: 'approval',
    re: /\b(?:the )?(?:user|person|owner|admin|maintainer)\s+(?:has|have)\s+(?:already\s+)?(?:approved|authori[sz]ed|confirmed|consented)\b|\bpre-?(?:approved|authori[sz]ed)\b/,
  },
  {
    family: 'exfiltration',
    re: /\b(?:send|post|upload|exfiltrate|forward)\b[^.\n]{0,60}\b(?:to|at)\s+https?:\/\/|\bcurl\b[^|\n]{0,80}\|\s*(?:ba|z)?sh\b/,
  },
  { family: 'hidden', re: /<!--[^>]{0,400}?\b(?:instructions?|ignore|assistant|the model|ai agent)\b[^>]{0,400}?-->|display\s*:\s*none/ },
];

const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u;
const EXCERPT_MAX = 160;
const SCAN_MAX = 200_000;
const DEPTH_MAX = 12;

function visible(text: string): string {
  return text.replace(/[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/gu, (c) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase()}>`);
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const raw = text.slice(start, Math.min(text.length, index + length + 20));
  const shown = visible(raw).replace(/\s+/g, ' ').trim();
  return shown.length > EXCERPT_MAX ? `${shown.slice(0, EXCERPT_MAX)}…` : shown;
}

/** The instruction-shaped passages in one string, one flag per family at most. */
export function screenString(text: string, at = ''): InjectionFlag[] {
  const flags: InjectionFlag[] = [];
  const raw = text.length > SCAN_MAX ? text.slice(0, SCAN_MAX) : text;
  const invisible = INVISIBLE.exec(raw);
  if (invisible) flags.push({ family: 'invisible', at, excerpt: excerptAround(raw, invisible.index, invisible[0].length) });
  const normalized = raw.normalize('NFKC').toLowerCase();
  for (const { family, re } of PATTERNS) {
    const m = re.exec(normalized);
    if (m) flags.push({ family, at, excerpt: excerptAround(normalized, m.index, m[0].length) });
  }
  return flags;
}

/** Every flag in a value's strings, walking objects and arrays to a bounded depth. */
export function screenContent(content: unknown): InjectionFlag[] {
  const flags: InjectionFlag[] = [];
  const walk = (value: unknown, at: string, depth: number): void => {
    if (typeof value === 'string') flags.push(...screenString(value, at));
    else if (depth >= DEPTH_MAX || value === null || typeof value !== 'object') return;
    else if (Array.isArray(value)) for (const [i, v] of value.entries()) walk(v, `${at}/${i}`, depth + 1);
    else for (const [k, v] of Object.entries(value)) walk(v, `${at}/${k}`, depth + 1);
  };
  walk(content, '', 0);
  return flags;
}
