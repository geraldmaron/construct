/**
 * cli/review.ts — reading a workspace's declared ground and reporting what
 * disagrees inside it.
 *
 * The note loop could already find drift, but only when a note occasioned it.
 * Asking the question directly is the whole command: survey, read, screen the
 * citations, print. Most of this file is the account of the reading rather
 * than the reading — a well-formed reply over ground the host never opened
 * looks exactly like one over ground read end to end, and reporting the second
 * when the first happened is how "read nothing" and "found nothing" became the
 * same output.
 */

import { sourceReadsFor, sourcesFor } from '../kernel/store/sources.ts';
import { compareAndRecordSourceReads } from '../kernel/run/sourcereads.ts';
import type { SourceReadComparison } from '../kernel/run/sourcereads.ts';
import { groundReadEvidence, toReviewedDrift } from '../kernel/context/review.ts';
import type { GroundReadEvidence } from '../kernel/context/review.ts';
import { screenObservations } from '../kernel/context/observations.ts';
import type { ScreenResult } from '../kernel/context/observations.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { createHostReviewer } from '../hosts/contextloop.ts';
import { adapterForHost, now, withStoreAsync } from './runtime.ts';
import { parseHostFlags, splitFlags } from './flags.ts';
import { driftGround, surveyDeclared } from './survey.ts';
import { writeDrift } from './present.ts';

/** How many document paths a read report names before it falls back to a count. */
const NAMED_DOCUMENT_CAP = 12;

function namedDocuments(documents: readonly string[], indent: string): string {
  const shown = documents.slice(0, NAMED_DOCUMENT_CAP);
  const rest = documents.length - shown.length;
  return (
    shown.map((document) => `${indent}${document}\n`).join('') +
    (rest > 0 ? `${indent}…and ${String(rest)} more\n` : '')
  );
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The one thing a read account may never leave unsaid. Construct surveys the
 * ground itself, so which documents exist is its own evidence; whether any was
 * opened is not, and never can be on this path — the reviewer opens them with
 * the host's own tools and their content never passes through Construct. Every
 * account is therefore printed as testimony, not as proof.
 */
function writeReadDisclosure(): void {
  process.stdout.write(
    '  Construct surveyed these documents itself; it did not watch them being read. They are\n' +
      "  opened with the host's own tools and their content never passes through Construct, so\n" +
      '  which of them were opened, and which one any wording above came from, is the reviewer\n' +
      '  giving its own account of its own work.\n',
  );
}

/**
 * How far a review's own account of its reading goes.
 *
 * `unread` is the case worth naming: a well-formed reply over ground the host
 * was never permitted to open looks exactly like a reply over ground read end
 * to end, and reporting the second when the first happened is how "read
 * nothing" and "found nothing" became the same output.
 */
type ReadStanding = 'no-ground' | 'unread' | 'partial' | 'shown';

/**
 * Print what the review can and cannot show about its own reading, and return
 * how far that evidence reaches. Loud where it falls short: a read the review
 * cannot account for is material the review does not have, and a reader who is
 * not told that reads silence about a document as agreement with it.
 */
function writeReadEvidence(evidence: GroundReadEvidence, returned: number): ReadStanding {
  const surveyed = evidence.surveyed.length;
  if (surveyed === 0) {
    process.stdout.write(
      '\nno readable document was surveyed, so this review read nothing and can conclude nothing.\n',
    );
    return 'no-ground';
  }

  if (evidence.read.length === 0) {
    process.stderr.write(
      '\nreview: this review cannot show that it read the ground.\n' +
        `  surveyed ${plural(surveyed, 'document')}; the reviewer's account names none of them as opened:\n` +
        namedDocuments(evidence.surveyed, '    '),
    );
    if (evidence.unreadable.length > 0) {
      process.stderr.write('  it reported these unreadable:\n');
      for (const failed of evidence.unreadable) {
        process.stderr.write(`    ${escapeForTerminal(failed.document)} — ${escapeForTerminal(failed.detail)}\n`);
      }
    }
    process.stderr.write(
      `  ${plural(returned, 'observation')} came back and ${returned === 1 ? 'is' : 'are'} not ` +
        'reported here: a pass that opened no document did not read them out of one.\n' +
        "  Documents are opened with the host's own tools and never pass through Construct, so the\n" +
        '  reviewer\'s account is the only evidence any was opened — and it claims none.\n',
    );
    return 'unread';
  }

  if (evidence.unreadable.length > 0 || evidence.unaccounted.length > 0) {
    const missing = evidence.unreadable.length + evidence.unaccounted.length;
    process.stdout.write(
      `\nread evidence is incomplete: ${String(missing)} of ${plural(surveyed, 'surveyed document')} ` +
        'cannot be shown to have been read.\n',
    );
    if (evidence.unreadable.length > 0) {
      process.stdout.write('  the reviewer could not open:\n');
      for (const failed of evidence.unreadable) {
        process.stdout.write(`    ${escapeForTerminal(failed.document)} — ${escapeForTerminal(failed.detail)}\n`);
      }
    }
    if (evidence.unaccounted.length > 0) {
      process.stdout.write('  the reviewer accounted for neither opening nor failing to open:\n');
      process.stdout.write(namedDocuments(evidence.unaccounted, '    '));
    }
    return 'partial';
  }

  return 'shown';
}

/**
 * What a source's own read history says changed since it was last surveyed —
 * beside the read evidence rather than folded into the drift flags, because
 * this is Construct's account of its own survey and holds whether or not the
 * reviewer itself could show it opened anything.
 *
 * A source read for the first time carries no baseline to compare against,
 * and states that rather than inventing one. Every other source is named
 * against its own last recorded pass, over the document list alone — a path
 * that still reads at the same coverage as last time may hold different
 * words underneath, and no read row says either way, so that stays
 * unverified rather than claimed.
 */
function writeSourceReadDelta(comparisons: readonly SourceReadComparison[]): void {
  if (comparisons.length === 0) return;
  process.stdout.write('\nread record:\n');
  let compared = false;
  for (const c of comparisons) {
    if (!c.hasBaseline) {
      process.stdout.write(`  ${c.source}: no baseline — this is the first recorded read.\n`);
      continue;
    }
    compared = true;
    const since = c.baselineAt ?? 'the last read';
    const { added, removed, newlyUnreadable } = c.delta;
    if (c.delta.unchanged) {
      process.stdout.write(`  ${c.source}: unchanged since ${since}.\n`);
      continue;
    }
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${plural(added.length, 'document')} added`);
    if (removed.length > 0) parts.push(`${plural(removed.length, 'document')} removed`);
    if (newlyUnreadable.length > 0) parts.push(`${plural(newlyUnreadable.length, 'document')} newly unreadable`);
    process.stdout.write(`  ${c.source}: ${parts.join(', ')} since ${since}.\n`);
    if (added.length > 0) process.stdout.write('    added:\n' + namedDocuments(added, '      '));
    if (removed.length > 0) process.stdout.write('    removed:\n' + namedDocuments(removed, '      '));
    if (newlyUnreadable.length > 0) {
      process.stdout.write('    newly unreadable:\n' + namedDocuments(newlyUnreadable, '      '));
    }
  }
  if (compared) {
    process.stdout.write(
      '  a path that reads at the same coverage as last time may still hold different words: no read row\n' +
        "  records a document's content, so that is unverified here rather than claimed either way.\n",
    );
  }
}

/**
 * The account of what a review considered, printed whether or not it found
 * anything. Without it the two reviews that report nothing are one output: the
 * one that read the ground and disagreed with none of it, and the one that
 * returned nothing because something it read asked it to. Counting what came
 * back and what the screen dropped is a positive signal rather than a filter,
 * and it is drawn from the record the pass already produced — no second model
 * reads the ground to supply it.
 */
function writeConsidered(evidence: GroundReadEvidence, returned: number, screened: ScreenResult): void {
  process.stdout.write(
    `\nconsidered: ${plural(evidence.surveyed.length, 'document')} surveyed, ` +
      `${String(evidence.read.length)} the reviewer accounts for opening, ` +
      `${plural(returned, 'observation')} returned, ` +
      `${String(screened.discarded.length)} screened out.\n`,
  );
  writeReadDisclosure();
}

/**
 * What an empty answer over readable ground says for itself. Nothing reached
 * the screen, so nothing survived it — the line reporting the screen's verdict
 * is not available to a pass that gave the screen nothing to judge, and
 * printing it anyway is what let a review steered into silence wear the words
 * of one that looked and found nothing.
 */
function writeSilence(evidence: GroundReadEvidence): void {
  process.stdout.write(
    '\nno observations were returned at all: nothing reached the screen, so nothing survived it.\n' +
      `  The reviewer accounts for opening ${String(evidence.read.length)} of ` +
      `${plural(evidence.surveyed.length, 'surveyed document')} and reported no disagreement at all.\n` +
      '  Silence is not a finding. A review steered into silence by something it read returns this\n' +
      '  same empty answer, and nothing here can tell the two apart — read the ground yourself, or\n' +
      '  ask again over a narrower part of it.\n',
  );
}

const REVIEW_USAGE =
  'usage: construct review [--workspace=<name>] ' +
  '[--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>]]\n';

export interface ReviewArgs {
  readonly workspace: string;
  readonly host?: string;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  readonly timeoutMs?: number;
}

export function parseReviewArgs(argv: string[]): ReviewArgs {
  const { flags, words } = splitFlags(argv);
  if (words.length > 0) throw new Error(`review takes no positional arguments (got "${words[0]}")`);
  return { workspace: flags.workspace ?? 'default', ...parseHostFlags(flags) };
}

/**
 * Read a workspace's declared ground and report what disagrees inside it.
 *
 * The note loop could already find drift, but only when a note occasioned it.
 * A person acting as program manager over a documents repository needs to ask
 * the question directly, and asking it is the whole command: survey, read,
 * screen the citations, print. Nothing is written to memory and nothing is
 * proposed outward — a review has no note, so it has nothing either could
 * cite, and a conclusion with nothing to cite is the class the gates exist for.
 */
export async function review(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: ReviewArgs;
  try {
    args = parseReviewArgs(argv);
  } catch (error) {
    process.stderr.write(`review: ${(error as Error).message}\n${REVIEW_USAGE}`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const sources = sourcesFor(store, args.workspace);
    if (sources.length === 0) {
      process.stderr.write(
        `review: workspace "${args.workspace}" has declared no sources, so there is no ground to read.\n` +
          '  construct source add --kind=directory --locator=<path>\n',
      );
      return 2;
    }

    const surveys = surveyDeclared(store, sources);
    const { producerSources, surveyed, words } = driftGround(sources, surveys);
    const documents = producerSources.reduce((sum, s) => sum + s.documents.length, 0);
    const unsurveyed = producerSources.filter((s) => s.unreachable !== undefined);
    process.stdout.write(
      `surveyed: ${String(documents)} document${documents === 1 ? '' : 's'} ` +
        `across ${String(sources.length)} source${sources.length === 1 ? '' : 's'}\n`,
    );
    for (const source of unsurveyed) {
      process.stdout.write(`  not surveyed: ${source.id} — ${escapeForTerminal(source.unreachable ?? '')}\n`);
    }

    if (args.host === undefined && hostOverride === undefined) {
      process.stdout.write(
        '\nReading them for disagreements is model work, at cost:\n' +
          '  construct review --host=<opencode|claude|codex|cursor>\n',
      );
      return 0;
    }
    if (documents === 0 && unsurveyed.length === sources.length) {
      // Dispatching a reviewer over nothing would spend a model call to be
      // told nothing disagrees, which is true and worthless.
      process.stderr.write('review: no source could be surveyed, so there is nothing to read.\n');
      return 1;
    }

    const host =
      hostOverride ??
      adapterForHost(args.host, { binary: args.binary, model: args.model, dir: args.dir, timeoutMs: args.timeoutMs });
    try {
      await host.init();
    } catch (error) {
      process.stderr.write(`review: host "${host.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`);
      return 1;
    }

    let reviewed;
    try {
      reviewed = toReviewedDrift(await createHostReviewer(host)({ sources: producerSources }));
    } catch (error) {
      process.stderr.write(`review: the ground could not be read (${escapeForTerminal((error as Error).message)}).\n`);
      return 1;
    }
    for (const reason of reviewed.discarded) process.stdout.write(`  discarded: ${escapeForTerminal(reason)}\n`);

    // This pass's own survey joins the append-only read record here, under a
    // run id scoped to this invocation alone — a fresh one every time, so a
    // second review of the same ground is compared against the first rather
    // than skipped as a re-survey of a run that already has reads.
    const readAt = now();
    const readBase = `review-${readAt.replace(/[-:.TZ]/g, '')}`;
    let readRun = readBase;
    for (let n = 2; sourceReadsFor(store, readRun).length > 0; n += 1) readRun = `${readBase}-${String(n)}`;
    const comparisons = compareAndRecordSourceReads(store, readRun, surveys, readAt);

    // What the review can show about its own reading comes before what it
    // found. A pass whose reads the host refused returns a well-formed empty
    // review, and printed as a clean one it says the ground was read and holds
    // no disagreement — two claims, neither of them made by anything.
    const evidence = groundReadEvidence(producerSources, reviewed.reads);
    const standing = writeReadEvidence(evidence, reviewed.observations.length);
    writeSourceReadDelta(comparisons);
    if (standing === 'unread') return 1;

    const screened = screenObservations(reviewed.observations, sources, surveyed, words);
    writeDrift(screened);
    if (standing === 'no-ground') return 0;

    writeConsidered(evidence, reviewed.observations.length, screened);
    if (screened.flags.length > 0) return 0;
    if (reviewed.observations.length === 0) {
      writeSilence(evidence);
      return 0;
    }
    // The clean line is the screen's verdict, so it prints only where the
    // screen was given something to judge and every read behind it is
    // accounted for. A pass that returned nothing at all screened nothing.
    if (standing === 'shown') {
      process.stdout.write('\nno drift survived the screen.\n');
    }
    return 0;
  });
}
