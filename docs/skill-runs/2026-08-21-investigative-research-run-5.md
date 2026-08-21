# investigative-research — recorded run 5 (2026-08-21, Sonnet tier)

Run conditions: Sonnet-tier producing agent, skill file outside the
repository as its only method reference, repository forbidden, web access
on. The task was real and immediately consumed: the evidence base for the
presentation layer added to written-voice — which formatting rules are
science, which are convention, and which are folklore. The deliverable
below is verbatim as produced; nothing was edited.

The one-line verdict for the use ledger: the disconfirmation pass reversed
two of the requester's own priors before they could be encoded as science.
The em-dash-as-machine-tell claim found zero peer-reviewed support and one
dataset-level contradiction (machine text shows LESS punctuation variety,
including fewer dashes), so the em-dash limit ships as labeled house
taste. The 7-plus-or-minus-2 chunking rule was exposed as folklore for
documents (Cowan's correction, wrong domain), so no literal item-count
ceiling ships as evidence. What survived at evidence strength: Mayer's
segmenting and signaling, the fact-box RCT for tables-over-prose on
comparison data, headings-as-retrieval-cues (two independent
methodologies), the documented lexical tics, and conditional support for
sketch-style rendering (drafts yes, authoritative or quantitative
artifacts no). The run's own pre-mortem became a design control: every
encoded rule carries its confidence tier, so folklore can never be read
as record.

Producing model: Sonnet (same family as the skill's author; the
correlated-error caveat travels with any same-family judged reading).

---

# Research record: document presentation and readability evidence — DRAFT

**Frame:** This covers English-language reader comprehension/perception research reachable via web search and fetch in one session, spanning cognitive psychology (1950s–2020s), Mayer's multimedia-learning program, HCI/visualization studies, LLM-detection literature (2023–2026), and NN/g practitioner research. It excludes non-English-language studies, paywalled full texts I could not open, and any study earlier than what search surfaced. Absences below are classified, not silently assumed benign.

---

## 1. Cognitive load and chunking

**Well-evidenced.** Sweller's cognitive load theory (1988 origin) is a mature, replicated experimental program distinguishing intrinsic, extraneous, and germane load; instructional material that reduces extraneous load (i.e., unnecessary parsing effort) improves learning outcomes across many worked-example and split-attention studies [research: cognitive load theory literature summarized across multiple sources including structural-learning.com and Pearson Schools, secondary aggregator write-ups of Sweller's program, not the primary 1988/2011 texts themselves — primary Sweller papers were not opened this session]. Miller's "magical number seven" (1956, *Psychological Review*) is the famous original claim about immediate-memory chunk capacity [research: Miller 1956, as indexed on PhilPapers/Wikipedia — abstract-level, primary text not opened]. It has been materially revised, not merely footnoted: Cowan (2001) argues true capacity, once rehearsal and chunking strategies are controlled out, is closer to **4±1** items, and this correction is now the standard citation in working-memory research [research: Cowan 2001 as characterized in ScienceDirect "What's magic about magic numbers?" (Mathy & Feldman) and secondary summaries — primary Cowan text not opened]. Mayer's multimedia-learning program is the strongest evidence base in this whole set: reportedly built on 200+ controlled experiments, with the **signaling principle** (cueing organization) and **segmenting principle** (breaking continuous material into learner-paced parts) both showing measurable transfer-test gains, including specifically for worked math examples and for breaking complex charts into steps [research: Mayer's principles as summarized by ScienceDirect "Evidence-Based Principles for How to Design Effective Instructional Videos" and educationaltechnology.net, secondary summaries of Mayer 2021 *Multimedia Learning* 3rd ed. — the book itself not opened].

**Weakly evidenced or folklore.** "7±2" as a rule for *document* chunk counts (e.g., "no more than 7 bullet points," "sections should have ≤7 subsections") is folklore: Miller's number described immediate verbal-memory span in a lab task, not reading comprehension of structured prose, and the number itself was later revised downward by Cowan. Any formatting rule citing "7±2" for headings-per-document or items-per-list is importing a contested memory-span statistic into a domain (extended reading with re-scannable text) where working-memory span is not the bottleneck — a reader can re-look at item 9. This is an inference, marked as such.

**Rule the evidence supports:** Segment long continuous explanation into headed, learner-paced chunks (Mayer's segmenting principle, direct hit); use headings/lead sentences that signal structure rather than just decorate (signaling principle, direct hit). Do **not** encode a literal item-count ceiling as science — cap list/section length for scanability as a design choice, not a cited memory limit.

---

## 2. Format choice: prose vs. tables vs. lists

**Well-evidenced — tables for comparison and risk data.** The strongest single study found this session: a pre-registered randomized trial (YouGov panel, N=2,305, UK, two medical topics) directly compared tabular "fact boxes" against equivalent-content text for health-risk information. Fact boxes produced higher immediate comprehension (79.6% vs 69.7% correct, Cohen's d=0.39) and modestly better six-week recall (d=0.12), with benefits holding across education/numeracy levels [research: registered report RCT on fact boxes vs. text, PMC7137953, opened directly — primary record, not summary]. This is a **record**, randomized, pre-registered, and directly on point for "when do tables beat prose": comparison/enumerable numeric data. Caveat stated by the authors themselves: decisions were hypothetical, and effects may shift for consequential real choices.

**Directionally supportive but off-target.** Note-taking research (comparison-structured material favors tables/concept maps over linear notes) and an LLM-comprehension paper ("Better Think with Tables," 26% relative gain) both point the same direction, but the second is about machine reading, not human readers, and is cited here only as directional corroboration, not as human-readability evidence [research: arXiv 2412.17189, "Better Think with Tables" — read via search snippet only, not full paper; explicitly an LLM study, weight discounted accordingly].

**Lists — genuinely mixed, not a clean win.** A controlled study (Geiger & Downen, 2021, *Psychological Reports*) directly comparing narrative-style vs. list-style procedural text found narrative text produced **better** comprehension in the "read to perform" condition, with the list format's advantage only emerging under *rereading* [research: Geiger & Downen 2021, "The Effect of Structure on the Memory for Procedural Text," DOI 10.1177/0033294120942915, PubMed-indexed peer-reviewed journal — summary from search results and abstract, full text not opened]. This is a genuine disconfirmation of the folk claim "lists always beat prose for procedures": the advantage is conditional on task (rereading/reference use) rather than universal.

**Weakly evidenced / folklore.** Numbered vs. unnumbered list choice: no controlled comparison surfaced this session. What is documented is practitioner consensus (technical-writing style guides) that numbered lists are used when sequence or reference-by-step-number matters, and bulleted lists otherwise — this is **house convention, not measured evidence** [unverified — no experimental comparison of numbered vs. bulleted list comprehension found; would be settled by a controlled study manipulating list-marker type against a task requiring/not-requiring step reference].

**Rule the evidence supports:** Use tables for discrete, comparable, numeric/categorical facts a reader will scan for a specific value (strong evidence). Use lists for material the reader will use as a reference to re-find a step later; for material meant to be read straight through once for gist or causal understanding, prose can equal or beat list form — don't reflexively listify narrative or causal explanation. Numbered-vs-bulleted is a taste/convention call, not a science-backed one.

---

## 3. Visuals and the hand-drawn question

**Solid.** Dual coding theory (Paivio, 1960s–70s) and the picture-superiority effect are long-standing, replicated findings: concrete pictures are recalled better than words under normal presentation rates, attributed to encoding along both a visual and verbal channel [research: Paivio & Csapo 1971/1973 as characterized by Gorilla/Wikipedia summaries — primary papers not opened]. **Important disconfirmation:** a 2025 paper (Higdon, Neath, Surprenant & Ensor, *QJEP*) argues the effect is better explained by **distinctiveness**, not dual coding — pictures are more perceptually distinct from each other than words are, and that alone may account for the memory advantage [research: Higdon et al. 2025, journals.sagepub.com/doi/10.1177/17470218241235520, peer-reviewed — abstract/title-level, full text not opened]. This matters for rule-writing: "use a picture because two encoding channels beat one" is a live theoretical dispute, not settled mechanism, even though the *effect itself* (pictures recalled better) is solid.

**Sketch-style rendering — genuinely mixed, actively studied.** There is a real peer-reviewed line of work here (Wood & Isenberg et al., "Sketchy Rendering for Information Visualization," IEEE TVCG 2012, and a 2025 follow-up ACM paper, "'It looks like someone just threw random dots on a dot plot': User Response to Sketchy Rendering Styles") [research: both papers found via search with title/venue confirmed — IEEE TVCG and ACM digital library entries, abstracts read via search summary, full text not opened]. Findings are contextual, not a clean "sketchy = more approachable" result: sketchy rendering can increase engagement and willingness to annotate/critique when the sketchiness is unambiguous, but participants in the 2025 study still judged sketchy visualizations as "unfit for publication" even when explicitly told they were prototypes — and sketchy rendering measurably degrades precise judgments like relative-area estimation. The "unfinished = editable, invites honest feedback" intuition has real experimental support in some conditions and a real documented failure mode in others (perceived unprofessionalism, degraded quantitative reading).

**Rule the evidence supports:** Use a genuine image/diagram over a text description when the content is concrete and comparison-friendly (picture-superiority effect, solid). Sketch-style rendering for early-draft diagrams meant to invite critique has real but conditional support — appropriate for explicitly-marked drafts, not for anything meant to be read as authoritative or requiring precise quantitative reading (area/length comparisons). This is evidence-supported nuance, not a blanket "always sketch drafts" rule.

---

## 4. Reading human — machine-writing tells

**Well-evidenced, and dated 2024–2025 as requested.** A large-scale study (Kobak et al., *Science Advances* 2024/2025) analyzed >14 million PubMed abstracts (2010–2024) and found a step-change post-2022 in specific word frequencies — "delve," "underscore," and related terms — attributable to LLM-assisted writing, with an estimated ≥10% of 2024 abstracts showing LLM involvement by this marker [research: Kobak et al., "Delving into LLM-assisted writing in biomedical publications through excess vocabulary," *Science Advances*, DOI 10.1126/sciadv.adt3813 — peer-reviewed record; full text returned HTTP 403 on fetch, so this citation rests on the arXiv preprint version and search-summary characterization, not the published version itself]. A companion mechanistic paper (arXiv 2412.11385) traces the "delve" overuse specifically to RLHF training data skew rather than to base-model behavior [research: arXiv preprint, not peer-reviewed at time of this search — class as preprint, one tier below the Science Advances record]. Separately, multiple 2024–2025 detection-method papers converge on: AI text uses a narrower punctuation range (fewer dashes, semicolons, question marks relative to commas/periods — note this is the **opposite** of the popular "AI overuses em-dashes" claim and should not be encoded without flagging the conflict), more uniform sentence length/syntax, deeper/longer dependency structures, and lower "burstiness" (variance in sentence length) [research: multiple arXiv 2024-2025 detection papers (2406.15583, thesai.org Volume16No3) — abstracts/search-summaries, full texts not opened; burstiness-as-signal claims mostly sourced through AI-detection-tool marketing content (Turnitin-adjacent blogs, QuillBot, proofreaderpro.ai), which is aggregator/vendor content, not peer-reviewed — flagged accordingly].

**Disconfirmation on em-dash claim specifically:** the popular narrative (heavily present in the requester's own framing) is that AI text *overuses* em-dashes. The one dataset-level finding this session surfaced (thesai.org paper) says the opposite — AI text shows **less** punctuation variety including fewer dashes. I could not find a peer-reviewed study directly confirming em-dash overuse as an AI tell; it is widespread anecdotal/practitioner observation (visible in vendor "humanizer" tool marketing) rather than a measured finding. This claim should be encoded as **[unverified — plausible, anecdotally near-universal among practitioners, but the one dataset-level punctuation study found runs the opposite direction; needs a study measuring em-dash frequency specifically, which none of the sources opened this session did]**, not as settled science.

**Rule the evidence supports:** Vary sentence length deliberately (burstiness has real, if detection-tool-mediated, evidentiary support and a plausible mechanism); avoid the specific lexical tics with documented frequency spikes ("delve," "underscore," "commendable," "meticulous," "intricate," "realm" — strong evidence, Science Advances-class); do not encode "cut em-dashes" as evidence-backed — treat it as a taste rule pending better data. Formulaic transition words ("moreover," "it's important to note") and rule-of-three overuse were named in the request but no dedicated peer-reviewed frequency study surfaced this session — **[unverified]**, folklore-class pending a study.

---

## 5. Scanning behavior

**Well-evidenced, with an important caveat the request didn't ask for but the source volunteers.** The NN/g F-pattern finding rests on eye-tracking of 232 users across many pages (2006), and the source page itself states the pattern is "a rough, general shape rather than a uniform, pixel-perfect behavior," not a prescriptive law — it is a **derived record** (the organization's own primary write-up of its proprietary study, not independently replicated peer-reviewed research) [research: nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/, opened directly this session]. The page reports a later (2017-era) eye-tracking study as confirming the pattern, but I did not open that follow-up separately — it is reported via the same source, so it is **not independent corroboration**, only NN/g's own restatement; single-source until an outside eye-tracking replication is checked. The design implication NN/g draws — front-load key information, put scannable/informative words at the start of lines and headings — is stated as their own recommendation built on the finding, which is a step from data to design advice.

**Headings as retrieval cues — genuinely well-evidenced, separately from NN/g.** Independent cognitive-psychology literature (multiple studies on topic headings, eye fixations, and recall, indexed via ScienceDirect/ResearchGate) consistently finds headings/titles act as retrieval cues that improve organization and recall of subsequent text, and that this effect is mediated by readers building a structural representation of the text, not just decoration [research: "Effects of topic headings on text processing: Evidence from adult readers' eye fixation patterns," ScienceDirect, and "Effects of Headings on Text Summarization" — search-summary level, primary texts not opened]. This is independent of NN/g (different method — eye fixation during reading vs. web-page scanning), so headings-as-retrieval-cues is corroborated by two genuinely different methodologies, unlike the F-pattern claim.

**Plain language.** Evidence is real but heterogeneous: a plain-language IRB-consent template dropped average reading grade level from 10th to 5th [unverified precise citation — sourced via search summary of a retrospective analysis, not opened directly], while Cochrane's own "plain language summaries" were separately found to still require ~15 years of education to read comfortably — i.e., plain-language *policy* does not guarantee plain-language *outcome*, and self-labeled "plain language" documents should not be assumed readable without a Flesch-Kincaid or similar check [research: Cochrane PLS readability cross-sectional study, PMC9464378 — search-summary level].

**Rule the evidence supports:** Front-load the point of a section in its first line/heading (two independent methodologies support this — NN/g scanning behavior and cognitive-psychology heading-as-cue research). Do not treat NN/g's F-pattern as independently replicated science; treat it as a single, credible, non-independently-corroborated organizational finding whose own authors call it descriptive, not a law to design pixel-precisely around. Measure actual readability (grade level) rather than trusting a "plain language" label.

---

## Single-source list

- F-pattern eye-tracking finding: NN/g's own page only; the "later study confirmed it" claim is NN/g restating itself, not an independent source. An outside replication (academic eye-tracking lab, not a UX consultancy) would settle this.
- Miller 7±2 as originally stated: effectively single-source (Miller 1956) until Cowan's correction, which is itself the field's accepted counter-source — so the *current* consensus (≈4) is reasonably corroborated, but "7±2" alone is not.
- Em-dash-as-AI-tell: zero peer-reviewed sources found this session; entirely vendor/practitioner-blog sourced, single-class (aggregator) throughout.
- IRB plain-language grade-level drop: one retrospective analysis, not independently checked against a second study this session.

## Strongest objection

Most of the citations above rest on search-engine summaries of papers, not the papers themselves — only three URLs were actually opened and read directly (NN/g's F-pattern page, the fact-boxes RCT, and an attempted-but-blocked Science Advances fetch). A skeptical reader is right to note that a search snippet can mischaracterize a study's actual finding, effect size, or caveats, and that this record cannot rule that out for the majority of its claims. The discipline applied here (marking [research: …, not opened] versus fully-read records) is the mitigation, not a cure.

## Pre-mortem

If these rules are encoded as-is and treated as uniformly "proven," the most likely failure: someone downstream reads the [research] tags as equivalent-strength evidence, applies the Miller 7±2 folklore rule as a hard list-length cap, and applies the em-dash-removal rule as settled science — both of which this record explicitly flags as weak or contradicted. The fix is encoding the confidence tier (record / peer-reviewed-summary / preprint / aggregator / folklore) alongside each rule, not just the rule.

## Handbacks

None. Every sub-question in the original five areas was either answered, marked [unverified] with what would settle it, or flagged as a live theoretical dispute (dual coding vs. distinctiveness) — none required the requester's authority or access I lack.

---

Verification record
- Claims cited:        answered — inline `[research: …]` / `[unverified]` markers throughout §1–§5
- Source classes:      answered — record / derived record / aggregator / preprint / secondary-summary distinguished per claim, inline
- Independence:        answered — "Single-source list" section above
- Disconfirmation:     answered — §2 (Geiger & Downen vs. "lists always win"), §3 (distinctiveness vs. dual coding; sketchy-rendering mixed findings), §4 (em-dash direction contradicted by the one dataset found) | reversed the draft conclusion: yes — the em-dash and numbered-list claims flipped from "assume folklore is roughly right" to "actively contradicted or unsupported"
- Coverage frame:      answered — frame sentence at top; absences (non-English studies, unopened full texts, no controlled numbered-vs-bulleted study) classified as not-yet-collected
- Ground exhausted:    answered — most sources reached only via search-result summary rather than full-text open, and each such claim is labeled "not opened" inline; three URLs were opened directly (NN/g page, fact-boxes RCT, attempted Science Advances fetch which 403'd)
- Strongest objection: answered — own section above
- Pre-mortem:          answered — own section above
- Handbacks:           none
