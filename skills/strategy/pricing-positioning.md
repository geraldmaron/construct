---
name: strategy-pricing-positioning
description: Use when the team needs to set price, adjust positioning, or defend either to stakeholders.
inputs: [market-signals, competitor-data]
artifactType: positioning
---
# Pricing and Positioning

Use when the team needs to set price, adjust positioning, or defend either to stakeholders.

## Pricing frameworks

### Value-based pricing

Start with what the customer gains, not what it costs to build. The price ceiling is the customer's economic gain from using your product minus their switching cost.

**Steps:**
1. Quantify the value delivered, in the customer's unit (hours saved, revenue unlocked, risk reduced).
2. Identify the next-best alternative and what it costs (incumbent tool + implementation overhead).
3. Set price at a fraction of the value gap: price = (your value - alternative value) × capture rate.
4. Validate with willingness-to-pay research before launch.

**Common errors:**
- Using your cost structure to set price (cost-plus): this leaves value on the table in strong positions and is still wrong in weak ones.
- Anchoring to competitor prices without understanding how your value proposition differs.
- Conflating "what customers say they'll pay" with "what they will actually pay". Stated WTP runs 30-50% high.

### Cost-plus pricing

Only appropriate when:
- You are a commodity supplier and buyers have full price transparency.
- Regulatory pricing constraints apply (government contracts, utilities).
- You are bootstrapping and need a floor to ensure viability before you can run value-based research.

Cost-plus is not a strategy. It's a default that tells the market your cost structure rather than your value.

### Usage-based pricing

Aligns price with value delivery but creates revenue volatility. Use when:
- Customers have highly variable usage patterns.
- The value delivered scales linearly with usage.
- You have the metering infrastructure to make billing transparent.

Hybrid: commitment floor (predictable baseline) + usage above the floor (aligned with value). This is the SaaS standard for developer tools.

## Willingness-to-pay research

### Van Westendorp Price Sensitivity Meter

Ask four questions on a single scale:
1. At what price would this be so cheap you'd question the quality?
2. At what price would this be a bargain?
3. At what price would it start to seem expensive but still worth considering?
4. At what price is it too expensive?

Plot cumulative curves. The "acceptable range" is between the intersection of (1) and (4). The "optimal price point" is near the intersection of (3) and the indifference curve.

**Limitation:** results are hypothetical. Use as a directional range, not a point estimate.

### Conjoint analysis

Present respondents with product configurations at different price points and ask which they prefer. Reveals the marginal value of each attribute, including price. More accurate than Van Westendorp for comparing pricing structures (per-seat vs. per-usage vs. flat).

Requires 200+ responses and statistical analysis. Use when pricing structure is the key decision.

## Positioning

Positioning is a choice of *who you are for and who you are not for*. It is not a tagline.

### Positioning statement structure

> For [target customer] who [has this specific job or problem], [product] is [category] that [delivers this specific outcome]. Unlike [nearest alternative], we [key differentiator].

The differentiator must be:
- Verifiable (testable claim, not aspiration).
- Meaningful to the target customer (not just technically impressive).
- Defensible over 18+ months (not easily replicated).

### Positioning traps

- **Category confusion**: claiming to be in a new category when the customer already has a mental model for what you are. Usually better to reframe the category you're in than to invent a new one.
- **Feature positioning**: describing capabilities instead of outcomes. Features are implementation; outcomes are the job.
- **Everything to everyone**: broad positioning appeals to no one. Pick the beachhead segment where you can win cleanly, then expand.

### Competitive positioning

You have three options against an entrenched competitor:
1. **Flank**: attack a segment they ignore or underserve.
2. **Reframe**: define the category differently so your attributes are the evaluation criteria.
3. **Displace**: only viable with 10x improvement on the customer's most important job dimension.

Never directly attack a category leader's strongest attribute. You will spend more defending their position than building your own.
