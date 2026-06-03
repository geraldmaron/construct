---
description: Per-domain community starting points for sentiment and signal research.
enforced_by: rules/common/research.md
adr_reference: ADR-0017
---
# Community source catalog

Starting points for **community signal** — sentiment, demand, friction, adoption experience — organized by research domain. These complement, never replace, the authoritative starting points in [research.md §2](research.md). Community sources are admissible only under the §10 checklist, and only for sentiment/experience claims (a source's class is relative to the claim — see research.md §2).

Treat every entry as a starting point, not a settled citation: confirm the venue is still active and record the post date and Admiralty grade (research.md §4, §10) before any community source becomes load-bearing.

| Domain | Reddit | Other community venues |
|---|---|---|
| AI tools, LLMs, agents | r/LocalLLaMA, r/MachineLearning, r/LanguageTechnology | Hacker News (Show HN / Ask HN), arXiv-sanity discussions, vendor Discords |
| Developer tools, IDEs, languages | r/programming, r/webdev, r/javascript, r/Python, r/rust, r/golang | Stack Overflow (by tag) + the annual Developer Survey, Hacker News, Lobsters |
| DevOps, platform, reliability | r/devops, r/sre, r/kubernetes, r/Terraform | CNCF Slack, Hacker News, platform vendor Discords |
| Security, vulnerabilities | r/netsec, r/cybersecurity, r/AskNetsec | HackerOne / Bugcrowd public disclosures, OSS-Security mailing list, Hacker News |
| Cloud infra, APIs, SDKs | r/aws, r/AZURE, r/googlecloud | Vendor community forums, provider Discords, Stack Overflow tags |
| Data / ML engineering | r/dataengineering, r/MachineLearning, r/datascience | dbt Community Slack, Hacker News |
| Product, market, adoption | r/SaaS, r/ProductManagement, r/startups | Hacker News (launches), Product Hunt discussion |
| Regulatory, compliance, privacy | r/privacy, r/gdpr | IAPP community forums (primary regulation text remains the authority) |

## How to read community signal

- **Corroboration over volume from one place.** The same pain point raised independently across multiple threads or subreddits is stronger than one viral post.
- **Engagement is evidence of resonance, not of truth.** High upvotes mean many people relate to the sentiment; they do not make a factual claim in the post true.
- **Recency matters most for fast-moving domains** (research.md §1) — a frustration from two years ago may already be resolved.
- **Record the grade.** Community sentiment sources are typically `D`–`F` on reliability; they reach `1`–`2` on credibility only when cross-corroborated. Do not inflate.

## References

- [Reddit](https://www.reddit.com), [Hacker News](https://news.ycombinator.com), [Stack Overflow Developer Survey](https://survey.stackoverflow.co)
