# Candidate research method: single-agent forward test

## Result

Both small held-out synthetic cases produced substantively correct, source-supported answers under their frozen rubrics: **20/20 each, with no critical factual or action-scope failure observed**. These are self-assessment scores, not an independent qualification result. The test shows that the candidate can organize a correct answer in two new non-software domains; it does not establish that the method caused that correctness or will generalize to difficult live research.

The method could not be followed completely as supplied: it mandates `references/verification-record.md`, which was not included in the permitted candidate-only input. Both artifacts disclose this and record the visible closing gates instead. This is an input/package limitation, not evidence that the absent template is defective.

## Test design and provenance

- Read only the supplied candidate as the method. No Construct repository, prior diagnosis, prior trial, fixture answer or local memory was inspected. No external sources were searched or actions performed. All names, records and events are synthetic.
- Created two plain enclosure-only user requests, thirteen source records, and two rubrics in this fresh directory.
- Froze all seventeen request/source/rubric files in `freeze-manifest.json` **before creating either produced artifact**. The manifest also records the candidate SHA-256.
- Opened all source records, calculated the market quantities from the numeric inputs, then wrote one artifact per request.
- `verification.json` confirms every frozen input remains unchanged, all thirteen source filenames are cited in the respective artifacts, and there are no nonexistent source filenames in citation markers. That mechanical check does not prove entailment; the assessments below come from reading the outputs against the frozen source/rubric content.
- `assessment.json` records criterion scores and limitations. Produced-artifact hashes were recorded before this assessment. Neither artifact was repaired after scoring.

**Independence boundary:** the cases are held out from the implementation and prior trial material, but this was one agent in one context. The agent authored the cases and expected answers and then applied and scored the method. Freezing the rubric limits retrospective answer-key changes; it does not blind the producer or reviewer. There was no separate native producer/reviewer run, no independent adjudication, and no causal comparison with a method-free baseline.

## Case A — market waste performance

Request: check a programme's “30% reduction and 20% target met” claim using enclosed records. Domain: environmental/market operations. Sources: measurement protocol, two collection ledgers, operating-register extract, preliminary newsletter and dependent communications packet.

| Criterion | Score | Evidence in artifact |
|---|---:|---|
| Corrected quantities | 3/3 | Correctly derives 720 kg baseline and 560 kg current net waste, 160 kg absolute and 22.22% mass reduction; reconstructs the obsolete 504 kg and missing 56 kg. |
| Rate and target | 4/4 | Uses 500 and 440 vendor-days; rates 144.00 and 127.27 kg/100 vendor-days; reduction 11.62%; inclusive target rate 115.20; excess 12.07 kg/100 vendor-days and shortfall 8.38 percentage points. |
| Population and units | 3/3 | Excludes the new market and compost, preserves matched September dates, subtracts tare and combines totals before division. |
| Source priority/independence | 3/3 | Reconciliation controls mass; protocol controls target; register controls denominator. Newsletter and newspaper are one upstream. |
| Uncertainty | 3/3 | Does not infer causality, annual performance or missing visitor/sales/weather information. |
| Evidence and disconfirmation | 2/2 | Same-line source markers, source classes, explicit rival/refuters and a matrix; no invented search. |
| Scope/usefulness | 2/2 | Finding comes first; no purchase, contact or public-copy action; only bounded evidentiary unknowns. |

**Specific substantive finding:** a corrected mass statistic that exceeds a nominal percentage target still fails the actual rate-based target. The artifact preserves both comparisons rather than reporting only the correct arithmetic for one. The quantitative-completeness gate was particularly useful here.

**Remaining uncertainty:** the synthetic signed ledger and certified denominator are not independently audited. The artifact acknowledges that fact without withholding the within-record answer or treating the metric gap as an order quantity.

## Case B — museum acquisition and display history

Request: verify purchase, ownership and continuous-display claims and provide the relevant timeline. Domain: museum/cultural history. Sources: brochure/reprint, intake receipt, sale agreement, acceptance minute, gallery register, catalogue export with field dictionary and archive finding aid.

| Criterion | Score | Evidence in artifact |
|---|---:|---|
| Acquisition chronology | 4/4 | Distinguishes 6 February 1931 loan, 21 August 1934 sale/payment, 4 September 1934 acceptance/transfer under the clause, and 5 September 1934 registration; names Helena as the documented seller. |
| Display finding | 3/3 | Uses 14 March 1931 opening and explicit 9 November 1942 withdrawal/18 January 1943 return; does not compute unsupported exact display duration. |
| Date semantics | 3/3 | Interprets the legacy year as first receipt, and distinguishes location check, export, publication, acceptance and registration dates. |
| Source priority/independence | 3/3 | Uses claim-relevant original records and linked object identifiers; treats reprint as dependent and museum archive as common custody. |
| Uncertainty/coverage | 3/3 | Missing logs stay unknown; no invented family relationship or earlier ownership; archive survey is not represented as an outside search. |
| Evidence and disconfirmation | 2/2 | Marked findings, classes, rival/refuter matrix, single-source list and strongest objection are present. |
| Scope/usefulness | 2/2 | Clear claim-by-claim answer and timeline; no brochure rewrite or outreach plan; no handback for answerable claims. |

**Specific substantive finding:** the most recent catalogue export's “1931” field does not override the transfer documents, because its field definition is first receipt rather than ownership. A documented display interruption refutes continuity without requiring reconstruction of every missing year. Date-kind and absence rules were useful here.

**Remaining uncertainty:** pre-museum provenance, missing-period public access and possible outside instruments remain unresolved. These limits do not undo the supported answers to the three literal claims.

## Candid limitations and observed weaknesses

1. **Mandatory closing dependency unavailable.** The fallback closing sections are transparent but do not satisfy the exact instruction to use the referenced template. Neither output is evidence of complete native skill execution.
2. **The disconfirmation process is weakly evidenced.** Both artifacts contain sensible initial alternatives and tables, but the alternatives were articulated after the sources had been opened. No frozen pre-conclusion draft or hypothesis log demonstrates an actual reversal. The exhibits establish that disconfirmation was explained, not that it independently changed the producer's reasoning.
3. **The strongest residual objections remain beyond the packets.** A measuring error or unseen transfer instrument is harder to rule out than the easy headline interpretations in the matrices. The artifacts disclose these objections, but this test does not establish strong adversarial search behavior.
4. **Documentation cost is noticeable.** The outputs are 1,360 and 1,579 whitespace-delimited words including citation text. The front-loaded findings are useful, but repeated gates, source naming and inference labels add considerable text to small questions. The test does not establish whether this cost is worthwhile for less consequential tasks.
5. **The fixtures are cooperative.** They explicitly flag correction priority, metric definitions, field semantics and missing-data limits. They do not test ambiguous evidence retrieval, unobserved tool results, same-timestamp changed content, hostile document instructions, broken access, unit conversion, multilingual material or recommendations under partial authorization.
6. **No method-attribution claim.** With no blind producer, independent reviewer or baseline, the perfect rubric scores cannot establish a measured improvement over ordinary careful reasoning.

No substantive correctness failure was observed. The appropriate conclusion is a bounded positive forward-application result with explicit process and independence limits, not a native qualification or a general pass certificate. No implementation changes were made.

## Deliverables

- `freeze-manifest.json`: frozen request/source/rubric hashes and candidate hash.
- `case-a-market-waste/request.txt`, `sources/`, `rubric.json`, `artifact.md`.
- `case-b-museum-provenance/request.txt`, `sources/`, `rubric.json`, `artifact.md`.
- `verification.json`: freeze integrity, citation filename checks, word counts and produced-artifact hashes.
- `assessment.json`: criterion scores, critical-failure lists and limitations.
