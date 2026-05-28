<!--
docs/providers/github.md: GitHub provider setup and usage guide.

Covers token configuration, capabilities (read/search/webhook), and example queries.
-->

# GitHub Provider

Connects Construct to GitHub repositories, issues, pull requests, and code search.

**Capabilities:** read, search, webhook

## Authentication

Set `GITHUB_TOKEN` (or `GH_TOKEN`) in `~/.construct/config.env`:

```
GITHUB_TOKEN=ghp_your_token_here
```

Without a token, the GitHub API allows 60 requests per hour per IP. With a token, the limit is 5,000 requests per hour.

Minimum token scopes:
- `repo`: private repository access (omit for public-only)
- `read:org`: if searching across organization repos
- No write scopes needed unless you add a `write` capability via a plugin

## Verify the connection

```bash
construct provider test github
```

Output includes the rate limit ceiling and remaining requests for the current hour.

## Usage

### Read a repository

Fetch metadata for a specific repository:

```
config.repo = "owner/repo-name"
```

Returns the GitHub repository object (name, description, default branch, topics, visibility, etc.).

### Search issues

```
config.kind  = "issues"
config.query = "label:bug is:open repo:owner/repo-name"
```

### Search pull requests

```
config.kind  = "prs"
config.query = "is:open repo:owner/repo-name review:required"
```

### Search code

```
config.kind  = "code"
config.query = "class PaymentService repo:owner/repo-name"
```

Code search requires `GITHUB_TOKEN`: unauthenticated code search is not supported by the GitHub API.

### Webhook signature verification

Configure a webhook in GitHub with a secret, then set `webhookSecret` in the provider config. When an inbound webhook arrives:

```
config.webhookSecret = "your-secret-here"
request.headers["x-hub-signature-256"] = "sha256=..."
request.body = <raw bytes>
```

The provider verifies the HMAC-SHA256 signature using timing-safe comparison and returns `{ ok: true, event, delivery }` on success.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | No | Personal access token or GitHub App token |
| `GH_TOKEN` | No | Alias for `GITHUB_TOKEN`: checked if `GITHUB_TOKEN` is absent |
| `GITHUB_REPOS` | No | Comma-separated `owner/repo` list surfaced in session-start provider hints |

## Common query examples

| Goal | Query |
|---|---|
| All open bugs in a repo | `is:open is:issue label:bug repo:org/repo` |
| PRs waiting for review | `is:open is:pr review:required repo:org/repo` |
| My assigned issues | `is:open is:issue assignee:@me` |
| Issues updated in the last week | `is:open is:issue repo:org/repo updated:>2026-04-30` |
| Find a class across a repo | `class MyService repo:org/repo` (kind: code) |
