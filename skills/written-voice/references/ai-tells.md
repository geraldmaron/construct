# Machine tells: the catalog and the check

Prose can satisfy every rule in SKILL.md and still read as machine-written.
This file lists the markers that make a reader think a model wrote it, the
budget for each, and the script that counts them. It does not claim to beat
AI detectors. Those tools misfire in both directions, on plain technical prose
and on writing by non-native speakers, and no rule here is justified by them.

## Run the check

```bash
python3 scripts/voice-check.py draft.md [more.md ...]
```

It reads .md, .txt, and .html, skips code blocks, and prints candidates for a
person to judge. It never rewrites. Every line that is not `OK` or `none` is a
place to look, not an automatic failure. The spelling pass uses the system
word list when one exists and says so when it does not; add real words to
`scripts/allow-words.txt`.

## A named author comes first

When the document ships under a person's byline, read two or three samples of
their own writing before applying any budget. A construction that is verified
as their habit stays. Stripping a real person's style in the name of not
sounding like a machine produces text that sounds like neither of you.

## Structure (the tells that give the most away)

1. **Negate, then correct.** "It wasn't grit. It was the organization." "This
   isn't a budget. It's a statement of intent." Emphasis manufactured with no
   new information. Budget: two per document, and each must land on something
   concrete.
2. **Grand closing lines.** A section that ends on an aphorism ("You can't fix
   a feeling with a forum") once is voice; every section is a tic. Budget:
   three per document.
3. **Reflexive threes.** "Fast, reliable, and scalable." Real writing lands on
   two or four about as often. Budget: three rhetorical triads per document.
   A list that enumerates what actually exists is not a triad; leave it.
4. **"Not just X, but Y"** and **"serves as" / "stands as"** in place of "is".
   Budget: one each.
5. **Uniform rhythm.** Every paragraph three to five sentences means the shape
   was decided before the content. Want at least one paragraph under 25 words
   and one over 110 in any long document.
6. **Repeated openers.** `It`, `This`, `That's`, `Which` as rhythm devices.
   Want none above 3% of sentences.
7. **Abstraction with no grit.** Fluent about categories, silent about
   specifics. One real detail beats any amount of sentence surgery. In a
   personal document, leave a marked slot for detail only the author has;
   inventing it is fabrication.

## Vocabulary

- **Hype and tic words:** delve, underscore, meticulous, intricate, realm,
  tapestry, testament, crucial, pivotal, vital, foundational, landscape,
  robust, seamless, leverage, utilize, unlock, elevate, foster, myriad,
  vibrant, holistic, transformative, and the others the script lists. Delete
  or replace with the measurable thing. A survivor needs a definition and
  evidence in the same passage.
- **Filler adverbs:** quietly, simply, truly, genuinely, fundamentally,
  deeply, incredibly. "The service quietly runs every job" means "the service
  runs every job".
- **Formulaic transitions:** moreover, furthermore, additionally, it's
  important to note, in conclusion, ultimately, at its core.

## Chat residue

Openers and sign-offs that belong in a chat window, not a document: "Great
question", "Here's the thing", "I wanted to provide a quick update", "After
careful consideration", "Let's dive in", "Let's break it down", "Hope this
helps", "Let me know if you have any questions", "Feel free to". Cut them;
the document starts with its point and stops when it is done.

Over-simplified claims about people ("Most people think...") go too. Name who,
or cut the claim.

## Formatting

- **Dashes.** Em dashes, and spaced hyphens used as dashes, are limited to rare
  deliberate use (house taste; the one dataset-level study ran the other way,
  so this claims no science). Use a period, comma, colon, or parentheses.
- **Bold-label bullets.** A list where every item opens with a bold label is a
  slide, not prose. Fine for a genuine glossary; elsewhere let most items be
  plain sentences.
- **Emoji headings and decorative emoji.** None in a document a reader acts on.
- **Headings that restate the title**, and a closing section that restates what
  the document just said. Stop instead.

## Deliberate imperfection is not the technique

Do not add typos or clumsy phrasing to seem human. It fools nobody and makes
the author look careless. Vary rhythm and add real specifics instead.

## Sources

- Wikipedia: Signs of AI writing (WikiProject AI Cleanup), the most complete
  public catalog of these markers, maintained by editors who remove them daily.
- Kobak et al., "Delving into ChatGPT usage in academic writing through excess
  vocabulary", 2024 (arXiv 2406.07016, 14 million PubMed
  abstracts): the vocabulary frequency spikes behind the tic list.
- The house's own list of phrases that read as machine-made; taste, labeled
  as such.
