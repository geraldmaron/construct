---
name: strategy-competitive-landscape
description: Use when the team needs a structured read on market positioning before committing direction.
---
# Competitive Landscape Analysis

Use when the team needs a structured read on market positioning before committing direction.

## Porter Five Forces, applied to software products

Run each force as a question, not a score. The goal is to surface which force is the
active constraint on your strategy right now.

### Threat of new entrants
- What stops a better-funded team from replicating your core capability in 18 months?
- Moats that compound: data flywheel, switching cost, workflow embeds, network effects. Pick the one that applies, don't claim all four.
- Regulatory barriers (SOC 2, HIPAA, FedRAMP) are real but temporary, they slow entry, they don't stop it.

### Bargaining power of suppliers
- Model providers, cloud infrastructure, and key open-source dependencies are all suppliers.
- Concentration risk: how many alternatives exist? What's the migration cost if one raises prices or shuts down?
- Lock-in signals: proprietary APIs, undocumented behavior you rely on, single-vendor fine-tuning.

### Bargaining power of buyers
- SMB buyers have low switching costs and high price sensitivity. Enterprise buyers have high switching costs and low price sensitivity, but a long sales cycle to match.
- Who actually approves the purchase? Who blocks it? These are often different people.
- Churn rate is the revealed preference signal. "They say they like it" is not data.

### Threat of substitutes
- The substitute is rarely a direct competitor. It's the customer doing it themselves (spreadsheet, internal tool, hiring a human).
- Ask: what does the customer do today if your product goes offline for a week? That's the substitute.
- Substitutes get more dangerous when your segment moves upmarket and leaves the low end exposed.

### Competitive rivalry
- Crowded markets with undifferentiated offerings compete on price. Avoid this unless unit economics are exceptional.
- Rivalry intensity signals: frequency of feature matching, public pricing wars, customer churn going peer-to-peer.

## Jobs-to-be-Done framing

Forces analysis tells you where power sits. JTBD tells you what customers are actually hiring your product to do.

**The hire/fire framing:**
- What job was the customer trying to get done before they found you?
- What did they fire to hire you? (The fired solution is your real substitute.)
- What circumstances trigger the hire? (The trigger is your acquisition moment, optimize for it.)

**Functional vs. emotional vs. social jobs:**
- Functional: the task they need to complete.
- Emotional: how they want to feel while doing it (confident, in control, not embarrassed).
- Social: how they want to be seen by others because of it.

Enterprise B2B products often win or lose on the social job (does this make the champion look smart to their VP?).

## Competitive response sequencing

When a competitor moves:
1. **Classify the move**: is this feature parity (they're catching up) or capability shift (they're changing the game)?
2. **Test before responding**: does anyone in your current customer base care? Run a 5-customer pulse before committing resources.
3. **Response options** (in order of cost):
   - Ignore (if it doesn't affect the customer jobs you own)
   - Narrate (position why your approach is intentionally different)
   - Match (only if the feature addresses a job you claim to own)
   - Leapfrog (only if you have a structural advantage, don't out-resource a well-funded competitor on a feature race)

## Whitespace identification

Whitespace is where customers have unsatisfied jobs your segment ignores.

- Run a win/loss analysis on the last 20 closed deals. What patterns explain the losses that weren't price-based?
- Look at the jobs customers do in adjacent tools after they close the loop in yours. That adjacency is the whitespace.
- Validate with a demand signal before building: can you pre-sell, get letters of intent, or get named demand from 3+ distinct customers?
