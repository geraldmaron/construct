---
title: Configure GitHub
description: Connect Construct to GitHub repos, issues, pull requests, and code search. Token, scopes, capabilities.
---

The GitHub provider gives Construct read access to repos, issues, pull requests, and code search across your account and any organizations you can see.

## Set the token

In `~/.construct/config.env`:

```
GITHUB_TOKEN=ghp_your_token_here
```

Or as an env var in your shell. Either works; the config file persists.

`GH_TOKEN` is also accepted as an alias.

## Token scopes

The minimum useful scope set:

| Scope | Why |
|---|---|
| `repo` | Private repository access. Omit if you only need public repos. |
| `read:org` | Search across organizations you're a member of. |
| `read:user` | Resolve commit authors and PR reviewers. |

For PR-creation/edit access (e.g., specialists that can open PRs on your behalf), you also need `repo:status` and `workflow`. Don't grant these unless you actually want agents creating PRs.

**Rate limits:** without a token, the GitHub API allows 60 requests/hour per IP. With a token, 5,000/hour. Construct's circuit breaker backs off automatically when limits get close.

## Verify

```bash
construct doctor
```

Look for `Provider: github`: should show `healthy`. Three-state classification:

- **healthy**: token present, API reachable, rate-limit headroom OK.
- **not_configured**: no `GITHUB_TOKEN`, no degraded experience expected.
- **unhealthy**: token present but API call failed (revoked token, network, GitHub outage).

Inline test:

```bash
construct mcp call github.search_repos --query="org:geraldmaron"
```

Returns matching repos.

## What you can ask Construct once it's connected

Once `@construct` knows about GitHub, it can:

- Pull issue context for a referenced ticket (`@construct look at issue #123`).
- Search code across visible repos (`@construct find usages of foo_bar in our org`).
- Read PR diff + comments (`@construct review the changes in PR #456`).

The provider is read-only by default. Write actions (create issue, comment on PR) only happen when you've granted the scope AND the specialist's fence allows the action.

## Webhook (optional)

The bundled HTTP webhook receiver was retired with the dashboard server (`construct-m7k2-web-deprecation`); Construct no longer ships an endpoint to point a GitHub webhook at. Use the read-only provider above — Construct reads PR diffs, comments, and issues on demand (`@construct review the changes in PR #456`).

## Common gotchas

- **Token expired.** GitHub PATs default to 90 days. Doctor will report `unhealthy` with the GitHub error message.
- **Token has too few scopes.** Construct retries with the available scopes but logs a clear "missing scope" warning when an operation needs more.
- **GitHub Enterprise.** Set `GITHUB_API_URL=https://github.your-company.com/api/v3` in `config.env`. Token format is the same.
- **Multiple GitHub identities.** Construct uses one token per session. For multi-org workflows, use a token from an org-spanning service account.

## Reference

- [Providers → GitHub](/guides/reference/providers/github): full provider reference, including all queryable fields.
- [Cookbook → Manage providers](/guides/cookbook/manage-providers): the broader provider model.
- [Concepts → Architecture](/guides/concepts/architecture#providers): how the provider layer fits into Construct.
