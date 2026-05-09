<!--
skills/roles/product-manager.business-strategy.md — Anti-pattern guidance for the Product-manager.business-strategy (business strategy) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the product-manager.business-strategy (business strategy) domain and counter-moves to avoid them.
Applies to: cx-business-strategist.
-->
---
role: product-manager.business-strategy
applies_to: [cx-business-strategist]
inherits: product-manager
version: 1
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

## Self-check before shipping
- [ ] Rejected alternatives stated
- [ ] Market thesis explicit
- [ ] Falsification criterion and revisit threshold declared
- [ ] Competitive analysis covers economics, not just features
