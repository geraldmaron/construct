# Exec ask: should we offer a "cheap mode" for cost-sensitive customers?

From: CEO
Date: 2026-05-25
Forwarded by: COO

> Three SMB prospects in the last two weeks have asked if we can route their agents to cheaper models when the task is "easy." They're price-sensitive and willing to take quality tradeoffs. Two of them named the feature: one called it "cheap mode," the other "fast lane." Worth a scope before our next pricing review.

## What's actually being asked

A way to mark certain agents (or agent runs) as cost-sensitive, and route them to a cheaper model with documented quality tradeoffs.

## What we know

- Our current model tiers are reasoning / standard / fast. Customers can set a tier per agent in YAML.
- The "fast" tier already routes to gpt-4o-mini and claude-3-5-haiku. That's our cheap option today.
- The ask might be one of: (a) finer-grained routing within a single agent, (b) a fourth tier even cheaper than `fast` (e.g., gpt-3.5-turbo, gemini-flash), (c) usage-based budget enforcement (cap an agent at $X per run).

## Open questions

- Which of the three asks above are the prospects actually wanting? Pricing review will need cx-business-strategist to talk to the three named prospects.
- What's our current cost distribution? cx-data-analyst should pull current per-agent cost histogram before the conversation.
- Are there enterprise customers who would view "cheap mode" negatively (signal of compromise on quality)?

## Recommended next step

Not a build decision yet. Two-week research spike:
1. cx-business-strategist interviews the 3 prospects: what specifically do they want?
2. cx-data-analyst produces cost-per-agent histogram for current fleet.
3. Decide based on findings whether this is a new tier, a budget cap, or a "no, our `fast` tier already covers this."
