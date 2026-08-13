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
 * scored runs over the fixture organizations are graded on exactly this text. An
 * instrument that measures a prompt the product does not send reports a number
 * nobody feels; rendering both the dispatch and the scored run from one export
 * is what keeps that instrument a measurement of what ships rather than of
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
 * The rung between "my documents are silent" and "somebody else's problem".
 *
 * A role that can name the file which would settle its own question, inside a
 * root it was just licensed to read, and writes the question down as open
 * instead of opening the file, has done the reader no service: the reader now
 * holds a question, a path, and the same license. The work was available and
 * was not done.
 *
 * This is not a licence to read forever, which is why it carries the same stop
 * rule as the research rung: a named path is one read, and what survives the
 * read is genuinely open and says so. The three honest endings are that the
 * document settled it, that the document was read and did not settle it, or
 * that it could not be opened and why — and an open question that ends none of
 * those ways is a question nobody tried to answer.
 *
 * Spoken only where the license is granted, because it is meaningless without
 * it: a role with no reachable root cannot be asked to go and look.
 */
export const GROUND_EXHAUSTION_RULE = [
  'Before you write anything down as unknown. If you can name the document',
  'that would settle a question — a file under a root above, by its path —',
  'then that question is work you can do, not an open question, and the',
  'reader cannot do it for you any faster than you can. Go and read it, then',
  'report what it said.',
  '',
  'One read per question, the same stop rule research has. A question that',
  'survives the document you named is genuinely open: write it down, say which',
  'document you read and what it failed to settle, and move on. If you could',
  'not open the file at all, write that and why — an unread path is a fact',
  'about your access, and it belongs in the deliverable rather than in the',
  "reader's inbox as though nobody had noticed.",
  '',
  'What is not acceptable is naming the path and stopping. "The auth code was',
  'not read to confirm this" tells the reader you knew where the answer was',
  'and left it there.',
].join('\n');

/**
 * What a role may report, as an instruction rather than a suggestion.
 *
 * A dispatched role can see findings that belong to other concerns, and saying
 * so mildly does not stop it reporting them. Two things go wrong when it does.
 * The reader gets a survey of the material instead of the concern they asked
 * for, and attribution stops meaning anything — a work log in which every role
 * reports everything cannot say in whose name a finding was written, which is
 * the one thing it exists to say.
 *
 * The bound does NOT rest on a role reaching findings the others could not.
 * That premise was tested over two fixture organizations and retired; a role's
 * output is scoped here because its deliverable owes specific slots and its
 * name goes on the answer, not because its question set grants it sight.
 *
 * Measured before it shipped, across a sweep of every lens over one fixture
 * organization: making ownership binding cut what a role produced by roughly
 * two fifths and cut findings belonging to other roles by about half, while
 * every role that reached its own planted finding still reached it. That effect
 * came from making the scope binding, which the wording below keeps; what it
 * drops is a justifying clause since shown to be false.
 */
export const ROLE_OWNERSHIP_BOUND = [
  'What belongs to you. A finding another role owns is not yours to report,',
  'however real it is. Before you write each one, name which of your slots it',
  'fills; if it fills none of them, drop it rather than reporting it as an',
  'aside. Reporting everything you noticed is not thoroughness, it is declining',
  'to exercise the judgment you were dispatched for, and it leaves the reader',
  'unable to tell which concern actually answered. Fewer findings that are all',
  'yours beat a survey of the material.',
].join(' ');

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
        `actually read is not a citation.\n\n${GROUND_EXHAUSTION_RULE}`
      : '';
  return (
    'Your material for this task is these documents, and nothing else around ' +
    'you. Files that happen to sit near you are not evidence for it.\n' +
    `${lines.join('\n')}${gap}${license}\n\n` +
    GROUNDED_SYNTHESIS_PROTOCOL
  );
}
