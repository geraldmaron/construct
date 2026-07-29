<!--
docs/guides/reference/providers/atlassian-confluence.md: Confluence provider setup and usage guide.

Covers credential configuration (shared with Jira), capabilities (read/search), and CQL examples.
-->

# Atlassian Confluence Provider

Connects Construct to Confluence pages and spaces via page ID reads and CQL search.

**Capabilities:** read, search

## Authentication

Confluence on Atlassian Cloud uses the same credentials as the Jira provider. If you have already configured Jira, no additional setup is needed.

Set these in `~/.config/construct/config.env`:

```
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your_api_token_here
```

If your Confluence instance is at a different URL than Jira, override it:

```
CONFLUENCE_BASE_URL=https://yourorg.atlassian.net
CONFLUENCE_EMAIL=you@example.com
CONFLUENCE_API_TOKEN=your_api_token_here
```

`CONFLUENCE_*` variables take precedence over `JIRA_*` when both are set.

## Verify the connection

```bash
construct provider test atlassian-confluence
```

A healthy response shows the base URL and confirms at least one space is accessible.

## Usage

### Read a page

Fetch a page by its numeric ID (visible in the page URL as `pageId=...` or in the path):

```
config.pageId = "123456789"
```

Returns the page including `body.storage` (Confluence storage format) and version metadata.

### Search with CQL

```
config.cql = "space = ENG AND text ~ \"authentication\" AND type = page"
```

Returns a list of matching pages. Default limit is 25; maximum is 100:

```
config.cql   = "space = DOCS AND ancestor = 98765 ORDER BY lastmodified DESC"
config.limit = 50
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `CONFLUENCE_BASE_URL` | No | Overrides `JIRA_BASE_URL` for Confluence requests |
| `CONFLUENCE_EMAIL` | No | Overrides `JIRA_EMAIL` for Confluence auth |
| `CONFLUENCE_API_TOKEN` | No | Overrides `JIRA_API_TOKEN` for Confluence auth |
| `JIRA_BASE_URL` | Yes (fallback) | Used if `CONFLUENCE_BASE_URL` is not set |
| `JIRA_EMAIL` | Yes (fallback) | Used if `CONFLUENCE_EMAIL` is not set |
| `JIRA_API_TOKEN` | Yes (fallback) | Used if `CONFLUENCE_API_TOKEN` is not set |

## Common CQL examples

| Goal | CQL |
|---|---|
| Pages in a space matching a keyword | `space = ENG AND text ~ "onboarding" AND type = page` |
| Pages under a specific parent | `ancestor = 123456 AND type = page ORDER BY title ASC` |
| Recently modified pages | `space = ENG AND lastmodified >= "2026-04-01"` |
| Blog posts by an author | `type = blogpost AND creator.username = "jsmith"` |
| Pages with a specific label | `label = "runbook" AND space = OPS` |

## Notes

- Page IDs are integers. They appear in the URL as `/wiki/spaces/SPACE/pages/123456789/Page+Title`.
- This provider calls the Confluence REST API v1 (`/wiki/rest/api/`) for read/search. The governed-write Confluence adapter (`lib/providers/contract/adapters/confluence/`, construct-9oi4.10.4) calls the v2 API separately.
- `body.storage` is Confluence's XML-based storage format. If you need plain text, use `construct ingest` to convert the page to markdown after fetching.
