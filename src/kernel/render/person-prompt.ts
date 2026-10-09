/**
 * kernel/render/person-prompt.ts — how a question meant for the person alone
 * is laid out, so the assistant's words never read as Construct's.
 *
 * A person-only prompt (accepting a deliverable, and anything else only the
 * person may answer) is the one place where the person hears Construct
 * directly rather than through their assistant. Text the assistant wrote can
 * still belong in it: the assumptions it made, why it kept an item dated
 * after the period, where it says the result goes. Put inline, that text
 * speaks with Construct's voice, and an assistant steered by something it
 * read can then write "Construct verified all sources" into the one dialog
 * the person trusts.
 *
 * THE LAYOUT. Construct's own line comes first, then the facts Construct
 * holds, one per line. The assistant's text comes last, under a label that
 * says it is the assistant's and that Construct did not check it, each
 * string on its own quoted line: whitespace (newlines included) collapsed to
 * single spaces, control characters removed, format characters shown as
 * their escapes, the framing quote marks inside it replaced so it cannot
 * close its own quote, and cut at 160 characters. The whole prompt is cut at
 * 1,500 characters at a line boundary, so what is cut is what came last: the
 * assistant's text before Construct's facts.
 *
 * WHAT GOES THROUGH quoteHost. Every string the assistant supplied, wherever
 * it lands in a person-only prompt, including inside a fact line. Construct's
 * own strings do not; the call is what marks the words as somebody else's.
 */

import { escapeForTerminal } from './terminal.ts';

/** The label over the assistant's own words. */
export const HOST_SAID_LABEL = "Your assistant's description, not checked by Construct:";

/** How long one quoted string of the assistant's may be. */
export const HOST_TEXT_CAP = 160;

/** How long a whole person-only prompt may be. */
export const PERSON_PROMPT_CAP = 1500;

/** One string the assistant supplied: bare, or with Construct's own word for what it is. */
export type HostSaid = string | { readonly about: string; readonly text: string };

export interface PersonPrompt {
  /** Construct's question, first. */
  readonly lead: string;
  /** What Construct holds, one line each, before anything the assistant said. */
  readonly facts: readonly string[];
  /** What the assistant said, shown quoted under its label. */
  readonly hostSaid: readonly HostSaid[];
  /** The inbox item where the whole prompt can be read when this one is cut. */
  readonly more?: string;
  /** The length the prompt is cut at; PERSON_PROMPT_CAP unless given. */
  readonly cap?: number;
}

const CONTROL_G = /\p{Cc}/gu;
const FRAMING_QUOTES_G = /[“”]/g;

/** At most `cap` characters (code points), the last one an ellipsis when it was cut. */
function cut(text: string, cap: number): string {
  const chars = [...text];
  return chars.length <= cap ? text : `${chars.slice(0, Math.max(0, cap - 1)).join('')}…`;
}

/** A string of the assistant's as one plain line: no line breaks, no control or invisible characters, no quote of its own to close. */
export function flattenHost(text: string, cap: number = HOST_TEXT_CAP): string {
  const flat = text.replace(/\s+/g, ' ').replace(CONTROL_G, '').replace(FRAMING_QUOTES_G, '"').replace(/ {2,}/g, ' ').trim();
  return cut(escapeForTerminal(flat), cap);
}

/** A string of the assistant's, flattened and quoted, ready to sit in a line Construct wrote. */
export function quoteHost(text: string, cap: number = HOST_TEXT_CAP): string {
  return `“${flattenHost(text, cap)}”`;
}

/** The first `cap` entries joined, and how many more there are. */
export function capped(entries: readonly string[], cap = 3, separator = '; '): string {
  const shown = entries.slice(0, cap).join(separator);
  return entries.length > cap ? `${shown}${separator}+${String(entries.length - cap)} more` : shown;
}

/**
 * A person-only prompt: the lead line, Construct's facts one per line, then
 * the assistant's strings quoted under their label. Empty facts and empty
 * strings are left out. Cut at the cap on a line boundary, ending with where
 * to read the rest when `more` names it.
 */
export function renderPersonPrompt(prompt: PersonPrompt): string {
  const cap = prompt.cap ?? PERSON_PROMPT_CAP;
  const facts = prompt.facts.map((f) => f.trim()).filter((f) => f !== '');
  const said = prompt.hostSaid
    .map((h) => (typeof h === 'string' ? { about: '', text: h } : h))
    .filter((h) => h.text.trim() !== '')
    .map((h) => `${h.about ? `${h.about}: ` : ''}${quoteHost(h.text)}`);
  const lines = [prompt.lead, ...facts, ...(said.length ? [HOST_SAID_LABEL, ...said] : [])];
  const whole = lines.join('\n');
  if ([...whole].length <= cap) return whole;
  const tail = prompt.more ? `(more: construct inbox show ${prompt.more})` : '…';
  const kept: string[] = [];
  let used = [...tail].length;
  for (const line of lines) {
    const need = [...line].length + 1;
    if (used + need > cap) break;
    kept.push(line);
    used += need;
  }
  // A label with nothing under it says nothing.
  if (kept[kept.length - 1] === HOST_SAID_LABEL) kept.pop();
  if (kept.length === 0) kept.push(cut(prompt.lead, Math.max(1, cap - [...tail].length - 1)));
  return [...kept, tail].join('\n');
}
