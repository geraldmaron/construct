---
title: Configure Jira and Confluence
description: "Connect Construct to Atlassian Cloud: tickets, sprints, runbooks, design pages. One credential set covers both."
---

The Atlassian providers (Jira + Confluence) share one credential set and one API token. Configure once; both providers come online.

## Set the credentials

In `~/.config/construct/config.env`:

```
ATLASSIAN_SITE=your-org.atlassian.net
ATLASSIAN_EMAIL=you@example.com
ATLASSIAN_API_TOKEN=ATATT3xFfGF0_your_token
```

Create the API token at <https://id.atlassian.com/manage-profile/security/api-tokens>. The token works for any Atlassian Cloud product on that account (Jira, Confluence, Bitbucket).

## Verify

```bash
construct doctor
```

Look for `Provider: atlassian-jira` and `Provider: atlassian-confluence`. Both should report `healthy` if the credential set is valid.

Inline test for Jira:

```bash
construct mcp call atlassian-jira.search_issues --jql="project = MYPROJ AND status = 'In Progress'"
```

Returns matching issues.

Inline test for Confluence:

```bash
construct mcp call atlassian-confluence.search --query="incident postmortem"
```

Returns matching pages.

## What you can ask Construct once it's connected

**For Jira:**

- Get ticket context (`@construct what's in MYPROJ-123?`).
- Search by JQL (`@construct list bugs assigned to me in sprint 14`).
- Inspect linked PRs and commits (Jira's DevOps panel data).
- Trigger workflow transitions (e.g., move a ticket to "In Review"): gated by the provider's write fence.

**For Confluence:**

- Pull design docs, runbooks, postmortems into the knowledge base (`@construct ingest the SRE runbook for service X`).
- Search pages by content or label.
- Cross-reference with code: `@construct does our architecture in Confluence match what's in lib/storage/?`.

## Capabilities matrix

| Capability | Jira | Confluence |
|---|---|---|
| Read tickets / pages | ✓ | ✓ |
| Search by JQL / CQL | ✓ | ✓ |
| Write (create/transition/comment) | ✓ (fence-gated) | ✓ (fence-gated) |
| Watch (webhooks) | ✓ | ✓ |
| Attachments | ✓ | ✓ |

Write actions only fire when the originating specialist's fence allows them. By default, fences are read-only: opt into write per-specialist.

## Webhooks (optional)

Jira webhooks live at Project Settings → System → Webhooks. Confluence webhooks at Space Settings → Webhooks.

Configure each to POST to:

- Jira: your dashboard's `/api/webhooks/jira` route.
- Confluence: `/api/webhooks/confluence`.

Set `ATLASSIAN_WEBHOOK_SECRET` to a strong random value for signature verification.

Typical event-to-role mappings:

- `jira:issue_created` with label `bug` → `cx-debugger`
- `jira:issue_in_review` → `cx-reviewer`
- `confluence:page_published` with parent "Runbooks" → `cx-sre` (for ingest)

## Common gotchas

- **403 on every request.** The user's Atlassian account doesn't have access to the project/space. Atlassian permissions are per-project: not all projects inherit from the org.
- **Rate limiting.** Atlassian Cloud caps at ~10 req/sec per user. Construct's circuit breaker backs off; if you see "rate-limited" messages, slow your queries.
- **`ATLASSIAN_API_TOKEN` vs `ATLASSIAN_OAUTH_TOKEN`.** Construct uses API tokens (the basic-auth-with-email model). OAuth tokens aren't currently supported.
- **Self-hosted Jira/Confluence.** Set `ATLASSIAN_SITE` to the on-prem host. Auth mechanism may differ: check `docs/providers/atlassian-jira.md`.

## Reference

- [`docs/providers/atlassian-jira.md`](https://github.com/geraldmaron/construct/blob/main/docs/providers/atlassian-jira.md): Jira queries and capabilities.
- [`docs/providers/atlassian-confluence.md`](https://github.com/geraldmaron/construct/blob/main/docs/providers/atlassian-confluence.md): Confluence queries and capabilities.
- [Cookbook → Manage providers](/guides/cookbook/manage-providers): broader provider model.
