/**
 * kernel/run/grounding.ts — what a role is told when the dispatch carries
 * documents.
 *
 * A role with no material reasons from its domain knowledge, and the assignment
 * tells it so: whatever files happen to sit around it are not evidence, because
 * it may be running inside this tool's own package or inside the user's
 * codebase. A role that was handed documents is in the opposite position. Those
 * documents are the evidence, they are the only thing it may cite, and the
 * findings worth the dispatch are the ones that need two of them at once.
 *
 * Both rules cannot be spoken at the same time without contradicting each
 * other, so the assignment picks one according to whether material reached this
 * dispatch. This module owns the grounded half.
 *
 * The protocol lives here rather than inside the assignment builder because the
 * scored runs over the fixture organization are graded on exactly this text. An
 * instrument that measures a prompt the product does not send reports a number
 * nobody feels; rendering both the dispatch and the scored run from one export
 * is what keeps that instrument a measurement of shipped depth rather than of
 * itself.
 */

/** One document set a run read, in the words the store recorded. */
export interface Material {
  /** The declared source it came from. */
  readonly source: string;
  /** What was read, in words a person can audit. */
  readonly descriptor: string;
  readonly coverage: 'complete' | 'partial' | 'unreachable';
  /** The honest quantity: "14 of 14 tickets", "connector returned 401". */
  readonly detail: string;
}

/**
 * How to work material into findings.
 *
 * Every sentence here is a discipline a shallow run fails: reading each
 * document alone, restating what a document already concludes instead of
 * deriving it, paraphrasing a named mechanism into looser words, and citing one
 * document for a finding that needs two.
 */
export const GROUNDED_SYNTHESIS_PROTOCOL = [
  [
    'How to work it. The findings worth your dispatch combine two documents',
    'that never cite each other. For each one, ask which other document changes',
    'what this one means: a ticket that looks routine beside a design document,',
    'a strategy sentence beside a spec, an incident note beside a roadmap item.',
    'Prefer findings that would collapse if either document were removed. A',
    'document you have connected once is not finished. Ask what else it',
    'collides with, because the second, less obvious connection is usually the',
    'one nobody has made yet.',
  ].join(' '),
  [
    'Three kinds are worth naming when you find them:',
    '- a cross-reference: two documents describe the same underlying thing without saying so. Tie them and name the connection.',
    '- a conflict: two commitments cannot both hold. Cite both sides.',
    '- a risk: a forward-looking exposure visible only by combining sources. Name the mechanism, not a vague worry.',
  ].join('\n'),
  [
    'Use the material; do not list it back. Each finding states what follows',
    'from the documents it cites, specific enough that a reader can check it',
    "against them. Name mechanisms in the material's own vocabulary, meaning",
    'the field, setting, mode, or rule the documents themselves use, never a',
    'looser paraphrase of it. Where a document already states a conclusion, the',
    'finding is what produced it: cite the documents whose combination creates',
    'the mechanism, not the one that reports the result.',
  ].join(' '),
  [
    'When a finding rests on two documents, cite both. Naming a second document',
    'in your sentence without citing it leaves the finding uncited.',
  ].join(' '),
  [
    'Cite each document by its path exactly as the list above writes it. Never',
    'cite a document that is not in that list, and never invent content for',
    'one.',
  ].join(' '),
  [
    'Depth over breadth: three findings with both documents cited and the',
    'mechanism named beat ten observations.',
  ].join(' '),
].join('\n\n');

/**
 * The material block: what this dispatch was given, and what it was not.
 *
 * A source that could not be read is listed saying so rather than omitted. Its
 * silence would otherwise read as coverage, and a role that believes it saw
 * everything writes with a confidence the run did not earn.
 */
export function groundedMaterialProtocol(
  material: readonly Material[],
  groundRoots: readonly string[] = [],
): string {
  const lines = material.map(
    (m) => `- ${m.descriptor} (${m.source}) [${m.coverage}]: ${m.detail}`,
  );
  const short = material.filter((m) => m.coverage !== 'complete');
  const gap =
    short.length > 0
      ? '\n\nNot all of it was read. Treat what the ' +
        (short.length === 1 ? 'incomplete source' : 'incomplete sources') +
        ' above would have held as unknown, say so where a finding depends on ' +
        'it, and never let the gap pass as coverage.'
      : '';
  // The listed documents are a survey, not a fence: the ground itself is the
  // evidence, and a role whose host can open any file in it may go past the
  // list — inside the named roots and nowhere else, citing only what it read.
  const license =
    groundRoots.length > 0
      ? '\n\nThe list above is the survey, not the boundary. You may read and ' +
        'cite any document under these declared roots, by its full path:\n' +
        groundRoots.map((root) => `- ${root}`).join('\n') +
        '\nNothing outside these roots is evidence, and a path you did not ' +
        'actually read is not a citation.'
      : '';
  return (
    'Your material for this task is these documents, and nothing else around ' +
    'you. Files that happen to sit near you are not evidence for it.\n' +
    `${lines.join('\n')}${gap}${license}\n\n` +
    GROUNDED_SYNTHESIS_PROTOCOL
  );
}
