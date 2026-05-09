<!--
docs/providers/atlassian-jira.md — Jira provider setup and usage guide.

Covers credential configuration, capabilities (read/search), and JQL examples.
-->

# Atlassian Jira Provider

Connects Construct to Jira issues, sprints, and project search via JQL.

**Capabilities:** read, search

## Authentication

Add these three variables to `~/.construct/config.env`:

```
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your_api_token_here
```

Generate an API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

## Verify the connection

```bash
construct provider test atlassian-jira
```

A healthy response shows the base URL you are connected to. Failure messages identify which of the three required variables is missing or invalid.

## Usage

### Read a specific issue

Fetch a single issue by key:

```
config.issueKey = "PROJ-123"
```

Returns the full issue object including summary, status, assignee, priority, and last-updated timestamp.

### Search with JQL

```
config.jql = "project = PROJ AND status = \"In Progress\" AND assignee = currentUser()"
```

Returns a list of matching issues. By default returns 50 results; set `maxResults` (max 100) to adjust:

```
config.jql        = "project = PROJ AND sprint in openSprints()"
config.maxResults = 100
```

Fields returned per issue: `summary`, `status`, `assignee`, `priority`, `updated`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | Yes | Your Atlassian Cloud base URL (no trailing slash) |
| `JIRA_EMAIL` | Yes | Atlassian account email |
| `JIRA_API_TOKEN` | Yes | API token from Atlassian account settings |

## Common JQL examples

| Goal | JQL |
|---|---|
| Open issues assigned to me | `assignee = currentUser() AND resolution = Unresolved` |
| Issues in current sprint | `sprint in openSprints() AND project = PROJ` |
| High-priority bugs | `issuetype = Bug AND priority in (High, Highest) AND resolution = Unresolved` |
| Recently updated | `project = PROJ AND updated >= -7d ORDER BY updated DESC` |
| Blockers | `issuelinkstype = "is blocked by" AND resolution = Unresolved` |
| Issues without assignee | `project = PROJ AND assignee is EMPTY AND resolution = Unresolved` |

## Notes

- Jira Cloud uses API v3 (`/rest/api/3/`). Jira Server and Jira Data Center may require `JIRA_BASE_URL` adjusted to the server's domain and may use a different auth scheme.
- `search` uses a `POST` request to `/rest/api/3/search` to support long JQL strings.
- The Confluence provider shares the same credentials — no separate setup needed if both are used.
