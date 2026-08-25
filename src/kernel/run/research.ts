/**
 * kernel/run/research.ts — what researching means, said to the role that was
 * told to do it.
 *
 * The acquisition ladder has named research as its second rung since the plan
 * schema was written, and until now nothing said what the word meant. A role
 * whose declared source does not answer its slot climbs to "research" and is
 * handed no definition of what it may reach for, what a citation to something
 * outside the declared ground has to look like, how a primary source differs
 * from somebody's summary of one, or when to stop. Every one of those gaps has
 * a default the model fills in on its own, and the defaults are bad ones: reach
 * for whatever is nearest, cite a URL that was never opened, quote an aggregator
 * as if it were the thing it aggregates, and keep going until the context runs
 * out.
 *
 * Four rules, and each is here because its absence produced something specific:
 *
 *   1. LICENSED CAPABILITY, NOT A TOOL. The protocol says the role may read
 *      publicly reachable material if its host gives it a way to, and names no
 *      tool — a brief that picks its own tool is orchestrating itself
 *      (commitment 10), and the same line has to be true on a host with a web
 *      tool and on one without. A role with no such capability is told so
 *      rather than left to hallucinate having used one.
 *   2. A RESEARCH CLAIM CITES SOMETHING REACHABLE, OR IT IS [unverified].
 *      Grounded citations name a document under a declared root; a research
 *      citation names something a reader can go and open. Both marked, and
 *      marked differently, because the reader's trust in them is not the same:
 *      a declared source is the user's own material and the open web is not.
 *   3. PRIMARY OVER AGGREGATOR, AS A POSTURE AND A DISCLOSURE. Not a ban —
 *      an aggregator is often how you find the primary source — but the claim
 *      rests on the primary text, and where only the summary was actually read,
 *      the deliverable says so. Stated as the rule that a summary of a rule is
 *      not the rule.
 *   4. ONE PASS, THEN CLIMB. Research is a rung, not a mode. It gets one pass
 *      at the gap; if the gap survives it, the next rung is the ask ladder,
 *      which is already fail-open. Without a stop rule the cheapest thing a
 *      model can do with an unanswerable question is keep researching it, and
 *      the deliverable never arrives.
 *
 * This lives beside grounding.ts and asks.ts for the reason stated there: the
 * scored fixture runs are graded on exactly this text, and an instrument that
 * measures a prompt the product does not send measures itself.
 */

export const RESEARCH_PROTOCOL = [
  [
    'Researching, if this work needs a fact your material does not hold. Your',
    'declared sources come first and are always the better evidence: they are',
    "the user's own material, and something you found elsewhere never overrides",
    'them. Research is what you do when they are silent on a fact the work',
    'turns on.',
  ].join(' '),
  [
    'What you may reach for. If your host gives you a way to read publicly',
    'reachable material, you may use it for this. If it does not, you have no',
    'research capability on this dispatch — say the fact is unavailable to you',
    'and mark it [unverified]. Never write a citation for something you did not',
    'actually open, and never describe a search you did not run.',
  ].join(' '),
  [
    'How a research claim is cited. Write it as [research: <what it is, and',
    'where a reader finds it>] — a title, publisher, and identifier a reader',
    'can follow, not a bare domain name. A claim you could not source this way',
    'is [unverified] plus one sentence on what would settle it. Those are the',
    'only two shapes; an unmarked research claim reads as something your',
    'declared sources said, and they did not say it.',
  ].join(' '),
  [
    'Primary over aggregator. A summary of a rule is not the rule. Where the',
    'claim depends on what a statute, standard, agreement, specification, filing,',
    'or dataset actually says, the citation is that text — not a news article',
    'about it, not a vendor blog, not an encyclopedia entry, not another',
    "tool's index of it. Aggregators are fine for finding the primary source and",
    'are not evidence for what it says. If the primary text is the only thing',
    'you could reach a summary of, cite the summary and write that you did not',
    'read the primary source, in the same sentence.',
  ].join(' '),
  [
    'When to stop. Research is one pass at the gap, not a mode you stay in.',
    'If the fact is still missing after that pass, stop researching and climb:',
    'ask the user through the ASK line if their answer would change the work,',
    'or state the assumption you proceed on and label it [assumed]. Deliver',
    'either way. A gap is never a reason to withhold the work.',
  ].join(' '),
].join('\n\n');

/** One claim a deliverable sourced from outside the declared ground. */
export interface ResearchCitation {
  /** 1-indexed line the citation sits on, for a reader who has to go and look. */
  readonly line: number;
  /** What the role wrote inside the marker. */
  readonly cited: string;
}

/**
 * The research citations in a deliverable.
 *
 * Deliberately a reader of the shape the protocol asks for, not a URL matcher:
 * a role that writes a bare link has not followed the protocol, and finding the
 * link anyway would let the undisciplined shape pass as the disciplined one.
 */
export function researchCitations(text: string): ResearchCitation[] {
  const found: ResearchCitation[] = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\[research:\s*([^\]]*)\]/gi)) {
      found.push({ line: index + 1, cited: match[1].trim() });
    }
  });
  return found;
}

/**
 * Aggregator vocabulary: the kinds of source that report what a primary text
 * says rather than being it.
 *
 * This list is short and stays short. It exists to catch a research citation
 * whose whole content is "somebody's write-up of the thing", which is the one
 * failure the structural check can see; whether a particular publication is
 * authoritative is a judgment no matcher makes, and pretending otherwise would
 * be the same overreach the citation checker already refuses elsewhere.
 */
const AGGREGATOR_WORDS = [
  'wikipedia',
  'blog',
  'news article',
  'press coverage',
  'summary of',
  'overview of',
  'explainer',
  'according to reporting',
  'secondhand',
  'stack overflow',
];

/**
 * Whether a citation names an aggregator without disclosing that the primary
 * text went unread.
 *
 * The disclosure is what makes it acceptable, so the check is for the
 * disclosure, not for the aggregator. A role that read the summary and says so
 * has followed the rule; one that quotes the summary as if it were the statute
 * has not, and the reader cannot tell the difference from the text alone —
 * which is precisely why it is checked here rather than trusted.
 */
export function undisclosedAggregator(citation: ResearchCitation, context: string): boolean {
  const cited = citation.cited.toLowerCase();
  if (!AGGREGATOR_WORDS.some((word) => cited.includes(word))) return false;
  const disclosed = /did not read the primary|primary source not read|primary text not read|summary only|not the primary/i;
  return !disclosed.test(context);
}
