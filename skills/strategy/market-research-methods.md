<!--
skills/strategy/market-research-methods.md (Market Research Methods)
Use when planning customer discovery, validating product direction, or
sizing a market. Covers qualitative and quantitative methods, JTBD
interview technique, survey design traps, and research-to-decision
handoff.
-->

# Market Research Methods

Use when the team needs to validate assumptions before committing resources, or when a decision is being made on vibes rather than signal.

## Qualitative methods

### Jobs-to-be-Done interviews

The only interview format worth running for product direction. The goal is to understand the customer's decision story, not to collect feature requests.

**Recruiting:** target customers who recently switched (to you, away from you, or to a substitute). Recent decisions produce vivid recall. Loyal long-term customers explain their current satisfaction, not their original hire.

**Interview arc (30-45 minutes):**
1. **First thought**: "When did you first realize you needed something for this?" Surfaces the trigger and timeline.
2. **Decision story**: "Walk me through how you actually solved it." Don't ask what they want; ask what they did.
3. **Passive looking**: "Were you looking for a solution before you found one?" Maps latent-to-active journey.
4. **Active looking**: "What did you consider? Why did you reject each one?"
5. **First use**: "What did you do right after you signed up / started using it?"
6. **Anxiety and progress**: "What worried you? What made you feel it was working?"

**Anti-patterns:**
- "What features would you want?", produces a wish list, not a decision signal.
- Leading with your solution, contaminates the demand signal.
- Asking about the future, customers are poor forecasters of their own behavior.

### Contextual inquiry

Observe customers doing the job in their actual environment. Watch for workarounds, handoffs to other tools, and moments of friction that they've normalized and won't mention in an interview.

## Quantitative methods

### Survey design

Surveys measure prevalence of known patterns, not discovery. Run qualitative first.

**Scale rules:**
- Use 5-point Likert for agreement/frequency; 7-point for satisfaction/importance.
- Anchor both ends explicitly: "1 = strongly disagree, 5 = strongly agree."
- Randomize option order for non-ordinal questions to reduce position bias.

**Question traps to avoid:**
- Double-barreled: "Is the product fast and easy to use?", one question, two dimensions.
- Leading: "How much do you enjoy using…?", primes positive response.
- Hypothetical: "Would you use this feature?", intent ≠ behavior; use price or time-tradeoff framing instead.
- Recall over 90 days, reliability drops sharply.

**Sample sizes:**
- Directional signal (±10 pp): n ≥ 100
- Decision-grade (±5 pp): n ≥ 400
- Segment cuts multiply requirements: each additional segment you want to analyze independently needs its own sample size.

### Instrumentation and behavioral data

Behavioral data is the gold standard because it captures revealed preference, not stated preference.

Key instrumentation contracts:
- **Activation event**: the single action that predicts retention at 30 days (find this via cohort analysis).
- **Engagement breadth**: how many distinct features does a retained user touch?
- **Time-to-value**: how long from signup to activation event? Optimize this before optimizing acquisition.

## Market sizing

Use TAM/SAM/SOM only as a forcing function for conversation, not as a precision forecast.

- **TAM** (total addressable market): the revenue available if you had 100% of every relevant customer.
- **SAM** (serviceable addressable market): the segment you can reach with your current GTM.
- **SOM** (serviceable obtainable market): what you can realistically capture in 18-24 months.

**Bottom-up sizing is more credible than top-down:**
- Count the buyers, estimate the contract value, model conversion rate.
- "X% of a $Y billion market" tells investors nothing about why you'll capture it.

## Research-to-decision handoff

Research is only valuable when it changes a decision. Before fielding any study, answer: "What decision will this inform, and what finding would change our plan?"

Document as: "If we find [X], we will [action]. If we find [Y], we will [different action]."

If both answers lead to the same action, skip the research.
