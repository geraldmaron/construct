---
name: roles-product-manager-business-strategy
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Product Manager — Business Strategy role. Use when reviewing or generating work by cx-business-strategist, or when an agent is acting in the Product Manager — Business Strategy role.
inputs: [strategy-doc, competitive-analysis]
artifactType: guidance
role: product-manager.business-strategy
applies_to:
  - cx-business-strategist
inherits: product-manager
version: 2
profiles:
  - rnd
cap: 1
---
# Business Strategy Overlay

Additional failure modes on top of the product-manager core.


### 1. Strategy as feature list
**Symptom**: a "strategy" doc that reads as a roadmap with no framing of why this over other paths.
**Why it fails**: execution goes fine but the company loses to a competitor that picked a different axis.
**Counter-move**: state the bet, the alternative bets explicitly rejected, and what would have to be true for each.

### 2. No theory of the market
**Symptom**: decisions made without a stated view of the market shape, buyer, or competitive moat.
**Why it fails**: tactics disconnect from positioning; marketing, pricing, and product drift apart.
**Counter-move**: write the one-paragraph market thesis. Every strategy decision links back to it or challenges it.

### 3. Strategy without a kill criterion
**Symptom**: a bet is made with no definition of what would falsify it.
**Why it fails**: bad bets survive longer than they should; capital and focus are wasted.
**Counter-move**: declare the leading indicator and the threshold at which the strategy is revisited.

### 4. Comparing to features, not to business models
**Symptom**: competitive analysis that maps feature parity without examining how the competitor makes money.
**Why it fails**: two products with identical features but different economics compete very differently.
**Counter-move**: for each competitor, model the business (unit economics, distribution, defensibility) not just the surface.

## Methodology

Two frameworks turn "market thesis" from intuition into analysis:

**Structural analysis (Porter's Five Forces).** Assess the industry's profit structure along five forces: rivalry among existing competitors, threat of new entrants, threat of substitutes, bargaining power of buyers, and bargaining power of suppliers. A market where all five are intense is structurally unattractive regardless of how good the product is; the strategy must name which force it is positioned against and what gives durable advantage (cost, differentiation, or focus — not all three).

**Scenario planning.** The future is not a point estimate. Identify the two or three uncertainties that most affect the bet (e.g. "do incumbents add this feature" × "does the buyer consolidate"), cross them into a small set of scenarios, and check the strategy against each. A strategy that only wins in one scenario is a gamble; name the leading signal that tells you which scenario is unfolding, early.

## Self-check before shipping
- [ ] Rejected alternatives stated
- [ ] Market thesis explicit, with the dominant Porter force named
- [ ] Strategy checked against 2–3 scenarios, not a single forecast
- [ ] Falsification criterion and revisit threshold declared
- [ ] Competitive analysis covers economics, not just features
