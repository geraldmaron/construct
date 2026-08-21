# Host recipes: the official tracker and docs MCP servers

Recipes for pointing a host — Claude Code, OpenCode, Cursor, or any other
MCP-capable client — at the official, vendor-run MCP servers for Jira and
Confluence (Atlassian Rovo MCP), GitHub, Linear, and Google Workspace. No
connector code lives here or anywhere in this repository: commitment 1 and
`docs/connector-seam-design.md` license host-MCP-first as the read/write
path, and these four servers are exactly that path. What follows is
configuration, not implementation.

**How the claims below are marked.** Every version, endpoint, install
command, date, and tool count was re-checked today against the vendor's own
current material, not recalled from training. A claim reads **(verified:
`<source>`, checked 2026-08-21)** when it was confirmed against a primary
source today, or **(unverified: `<why>`)** when it could not be. No number in
this document is stated bare. Software this new moves fast — re-check before
relying on anything here more than a few weeks old.

## Atlassian Rovo MCP Server — Jira and Confluence

Atlassian's own remote MCP server. It also covers Jira Service Management,
Bitbucket Cloud, and Compass, but this recipe scopes to Jira and Confluence.

**Endpoint.** `https://mcp.atlassian.com/v1/mcp/authv2` — the endpoint
Atlassian's own setup instructions use (verified: [Getting started with the
Atlassian Rovo MCP
Server](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/),
checked 2026-08-21). A second, equivalent form without the `authv2` suffix
(`https://mcp.atlassian.com/v1/mcp`) is also declared as a remote in the
server's own registry manifest (verified: [official MCP Registry entry for
`com.atlassian/atlassian-mcp-server`](https://registry.modelcontextprotocol.io/v0/servers?search=com.atlassian%2Fatlassian-mcp-server),
checked 2026-08-21) — use `authv2` unless a specific client's docs say
otherwise. The legacy `/v1/sse` path still works for clients that predate
Streamable HTTP but is not the one Atlassian's own instructions lead with.

**Auth.** OAuth 2.1 for interactive clients; API token for headless setups
and mandatory for Jira Service Management and Bitbucket Cloud tools
specifically (verified: [Atlassian Rovo MCP
Overview](https://developer.atlassian.com/cloud/rovo-mcp/), checked
2026-08-21).

**Connect Claude Code:**

```bash
claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp/authv2
```

(verified: Atlassian's own Claude Code instructions, same getting-started
page above, checked 2026-08-21.)

**Connect OpenCode.** Atlassian does not publish an OpenCode-specific guide;
this config is constructed here from Atlassian's documented endpoint above
and OpenCode's own documented remote-server schema (verified:
[opencode.ai/docs/mcp-servers/](https://opencode.ai/docs/mcp-servers/),
checked 2026-08-21) — not copied from a vendor example:

```json
{
  "mcp": {
    "atlassian": {
      "type": "remote",
      "url": "https://mcp.atlassian.com/v1/mcp/authv2",
      "enabled": true
    }
  }
}
```

OAuth is OpenCode's default for a remote server, so no further flags should
be needed; if the interactive flow fails, fall back to an Atlassian API token
passed as a header the same way the GitHub recipe below shows.

**Other clients.** Atlassian publishes one-click setup for Cursor, VS Code
(via the `@mcp Atlassian` gallery entry), ChatGPT, and Claude Desktop, plus
generic instructions for "any local MCP-compatible client using the
`mcp-remote` proxy" (verified: [Getting
started](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/),
checked 2026-08-21).

**Version and tools.** The server's registry manifest declares version
`1.1.3`, published 2026-07-08 (verified: [`server.json` in
`atlassian/atlassian-mcp-server`](https://raw.githubusercontent.com/atlassian/atlassian-mcp-server/main/server.json)
and the [official MCP Registry
entry](https://registry.modelcontextprotocol.io/v0/servers?search=com.atlassian%2Fatlassian-mcp-server)
agree on this, checked 2026-08-21). This is a version of Atlassian's hosted
service and its published manifest, not something a client installs — there
is no local binary to pin. Atlassian groups tools by product and by
read/write/search permission on a dedicated [Supported tools
page](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/),
but the page renders its tool table client-side and a reliable total count
could not be extracted today — **(unverified: exact tool count; check the
live page, which is what an admin scoping access should read directly
anyway)**.

**GA date.** Atlassian announced general availability on 2026-02-04
(verified: page metadata (`datePublished`) on [Atlassian Rovo MCP Server is
now
GA](https://www.atlassian.com/blog/announcements/atlassian-rovo-mcp-ga),
checked 2026-08-21).

**The repository is not the server.**
[`atlassian/atlassian-mcp-server`](https://github.com/atlassian/atlassian-mcp-server)
holds client plugin manifests, the registry `server.json`, and docs — not the
server's own source. The server itself is a hosted service Atlassian
operates; there is nothing here to self-host (verified: repository file
listing via the GitHub API, checked 2026-08-21).

## GitHub MCP Server — local and hosted remote

GitHub's own MCP server, in the `github/github-mcp-server` repository.
Unlike Atlassian and Linear below, it ships both a hosted remote endpoint and
a real local binary/image with its own release cadence.

**Remote endpoint.** `https://api.githubcopilot.com/mcp/` — available to all
GitHub users regardless of plan; specific tools still inherit whatever access
requirements the underlying GitHub feature already has (verified: [Setting
up the GitHub MCP
Server](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server),
checked 2026-08-21).

**Connect Claude Code** (2.1.1+; see the repo's install guide for the legacy
`claude mcp add --transport http` form on older versions):

```bash
claude mcp add-json github '{"type":"http","url":"https://api.githubcopilot.com/mcp","headers":{"Authorization":"Bearer YOUR_GITHUB_PAT"}}'
```

(verified: [`docs/installation-guides/install-claude.md`](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md),
checked 2026-08-21.) OAuth is the recommended path for interactive use; the
PAT form above is for non-interactive/headless setups. Local Docker and
Claude Desktop steps are in the same guide.

**Connect OpenCode**, remote (GitHub publishes this one directly, in its own
documented OpenCode config shape):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "github": {
      "type": "remote",
      "url": "https://api.githubcopilot.com/mcp/",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

or local, via Docker:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "github": {
      "type": "local",
      "command": ["docker", "run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "enabled": true,
      "environment": { "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_GITHUB_PAT" }
    }
  }
}
```

(verified: [`docs/installation-guides/install-opencode.md`](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-opencode.md),
checked 2026-08-21 — this file also documents OAuth-based local login with a
published callback port, and a per-agent tool-enable pattern for keeping the
server's large tool surface out of every agent's context by default.)

**Local install.** Docker image `ghcr.io/github/github-mcp-server` (public;
`docker logout ghcr.io` if a pull fails on a stale token), or build from
source with `go build` in `cmd/github-mcp-server`, or download a release
binary (verified: [repository
README](https://github.com/github/github-mcp-server), checked 2026-08-21).
Latest release **v1.10.1**, published 2026-08-20 (verified: [GitHub Releases
API](https://api.github.com/repos/github/github-mcp-server/releases/latest),
checked 2026-08-21 — `published_at: 2026-08-20T09:13:17Z`).

**Auth.** OAuth (browser login, first use, token kept in memory only — no
app registration needed on github.com), a personal access token via
`GITHUB_PERSONAL_ACCESS_TOKEN` (takes precedence over OAuth when both are
present), or a GitHub App for non-interactive deployments (verified:
repository README, checked 2026-08-21).

**Tools.** Not a flat count — tools are grouped into named **toolsets**, and
a host enables only the ones it needs to keep prompt size down. Counted
directly from the repository's own toolset table today: **21 toolsets**
(`context`, `actions`, `code_quality`, `code_security`, `copilot`,
`copilot_issue_intents`, `dependabot`, `discussions`, `gists`, `git`,
`issues`, `labels`, `notifications`, `orgs`, `projects`, `pull_requests`,
`repos`, `secret_protection`, `security_advisories`, `stargazers`, `users`)
(verified: counted from the `<!-- START AUTOMATED TOOLSETS -->` table in
[`README.md`](https://raw.githubusercontent.com/github/github-mcp-server/main/README.md),
checked 2026-08-21). Individual tool count within each toolset was not
counted — **(unverified: the automated table names toolsets, not individual
tools; there are more individual tools than toolsets)**.

**Deprecation note.** The old `@modelcontextprotocol/server-github` npm
package is deprecated as of April 2025 (verified: install-claude.md, checked
2026-08-21) — do not recommend it.

## Linear MCP

Linear's own centrally-hosted remote server, following the authenticated
remote MCP spec. There is no local install path.

**Endpoint.** `https://mcp.linear.app/mcp` for read-write access (default);
`https://mcp.linear.app/mcp/readonly` exposes only read tools; the SSE
endpoint at `/sse` is a deprecated fallback for clients that predate
Streamable HTTP (verified: [Linear Docs — MCP
server](https://linear.app/docs/mcp), checked 2026-08-21).

**Auth.** OAuth 2.1 with dynamic client registration for the interactive
flow; a bearer token or Linear API key can also be passed directly in the
`Authorization` header (verified: same page, checked 2026-08-21). A
read-only API key (only the `Read` permission enabled) is the documented way
to get read-only access without the dedicated read-only endpoint.

**Connect Claude Code:**

```bash
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```

then run `/mcp` inside a session to complete authentication (verified: Linear
Docs — MCP server, checked 2026-08-21).

**Connect OpenCode.** No Linear-published OpenCode example exists; this
config is constructed here from Linear's own documented generic fallback
("Command: `npx`, Arguments: `-y mcp-remote https://mcp.linear.app/mcp`",
verified: same page, "Others" section, checked 2026-08-21) plus OpenCode's
documented local-server schema (verified: opencode.ai/docs/mcp-servers/,
checked 2026-08-21):

```json
{
  "mcp": {
    "linear": {
      "type": "local",
      "command": ["npx", "-y", "mcp-remote", "https://mcp.linear.app/mcp"],
      "enabled": true
    }
  }
}
```

**Other clients.** Linear publishes dedicated setup pages for Claude, Cursor,
VS Code, Windsurf, and Zed, and a Codex CLI recipe (`codex mcp add linear
--url https://mcp.linear.app/mcp`, which needs `experimental_use_rmcp_client
= true` under `[features]` in `~/.codex/config.toml` the first time an MCP is
used in Codex) (verified: Linear Docs — MCP server, checked 2026-08-21).

**Version and tools.** Registry manifest version `1.0.1`, published
2026-08-04, under the `app.linear/linear` namespace (verified: [official MCP
Registry
entry](https://registry.modelcontextprotocol.io/v0/servers?search=app.linear%2Flinear),
checked 2026-08-21). Linear's own docs describe the tool surface
qualitatively — "finding, creating, and updating objects in Linear like
issues, projects, and comments — with more functionality on the way" — and
publish no total count **(unverified: no tool count is published anywhere
Linear controls; treat any specific number quoted elsewhere as unverified
too)**.

**A registry caution.** Searching the official MCP Registry for "linear"
also returns entries with no relationship to Linear the company — one is a
paid, crypto-signature-gated broker, another is a 57-tool third-party
reimplementation, neither under Linear's own `app.linear/*` namespace. The
registry accepts any publisher; only the vendor's own namespace (`app.linear`
for Linear, `com.atlassian` for Atlassian above) is evidence the entry is
official. The same is true searching for "github" or "workspace" — see the
GitHub and Google Workspace sections above and below, where the vendor's real
server is not the top registry hit either (verified: [MCP Registry
search](https://registry.modelcontextprotocol.io/v0/servers), checked
2026-08-21). Verify the namespace before trusting any registry result.

## Google Workspace MCP servers

Not one server: **each Google Workspace product has its own dedicated MCP
server and endpoint** (verified: [Configure the Google Workspace MCP
servers](https://developers.google.com/workspace/guides/configure-mcp-servers),
checked 2026-08-21 — page's own "Last updated 2026-08-20" stamp corroborates
this is current). This is meaningfully less turnkey than the other three
servers in this recipe: there is no single endpoint, and each server needs
its own Google Cloud OAuth client.

**Status.** Developer Preview — "available as part of the Google Workspace
Developer Preview Program, which grants early access to certain features,"
not general availability (verified: same page, checked 2026-08-21). This is
a different Google announcement from the Google *Cloud* MCP support for
BigQuery, Compute Engine, GKE, and Maps — that is a separate product line
with its own docs and does not cover Workspace at all (verified: [Announcing
official MCP support for Google
services](https://cloud.google.com/blog/products/ai-machine-learning/announcing-official-mcp-support-for-google-services),
published 2025-12-10, checked 2026-08-21 — Workspace is not named in this
post). Do not conflate the two when reading Google's own MCP material.

**Endpoints**, one per product (verified: raw HTML of the configuration
guide above, checked 2026-08-21):

| Product | Endpoint |
|---|---|
| Gmail | `https://gmailmcp.googleapis.com/mcp/v1` |
| Drive | `https://drivemcp.googleapis.com/mcp/v1` |
| Docs | `https://docsmcp.googleapis.com/mcp/v1` |
| Sheets | `https://sheetsmcp.googleapis.com/mcp/v1` |
| Slides | `https://slidesmcp.googleapis.com/mcp/v1` |
| Calendar | `https://calendarmcp.googleapis.com/mcp/v1` |
| Chat | `https://chatmcp.googleapis.com/mcp/v1` |
| People (profile) | `https://people.googleapis.com/mcp/v1` |

**Auth.** OAuth 2.0 — but unlike the other three vendors here, there is no
interactive "click connect and authorize" path. Each server needs its own
OAuth 2.0 client ID and secret created in Google Cloud Console first, against
a Google Cloud project you control, with a redirect URI registered for the
specific client (verified: same page, checked 2026-08-21). For Claude, the
documented redirect URI is `https://claude.ai/api/mcp/auth_callback`, and
using the Google Workspace MCP servers with Claude.ai or Claude Desktop
requires a Claude **Enterprise, Pro, Max, or Team** plan (verified: same
page, checked 2026-08-21).

**Connect Claude** (Desktop or claude.ai, Settings → Connectors → Add custom
connector, one connector per product): create the OAuth client as above,
then supply the product's server name, its endpoint from the table, and the
client ID/secret (verified: same page, checked 2026-08-21).

**Connect OpenCode.** Google publishes no OpenCode example, and — unlike
Atlassian and Linear above — this recipe does not construct one. Google's
own docs show only Google Antigravity (Google's own IDE/CLI) and Claude
(via its custom-connector, pre-registered-redirect-URI flow) as working
clients; OpenCode's redirect URI is not one Google's OAuth client screen
recognizes out of the box, and whether OpenCode's own OAuth handling can
supply a caller-provided client ID/secret against an arbitrary redirect was
not confirmed today **(unverified: whether OpenCode can complete Google's
registered-client OAuth flow at all; test the "Others" generic pattern below
against a real Google Cloud OAuth client before relying on it)**. Google's
documented generic pattern for any other client: server name
`googleworkspace`, one of the eight endpoints above per product, transport
HTTP, auth OAuth 2.0 (verified: same page, "Others" section, checked
2026-08-21).

**Tools.** No total count is published. Google's own worked examples name
real tools per product — `gmail.search_threads`, `gmail.get_thread`,
`gmail.create_draft`, `drive.search_files`, `drive.read_file_content`,
`docs.read_doc`, `sheets.get_values`, `slides.read_presentation`,
`calendar.list_events`, `people.get_user_profile` — which is the verified
shape of the tool surface, not a verified count (verified: same page's
"Test the Google Workspace MCP servers" section, checked 2026-08-21).

## Recording a connected source in Construct

None of the above changes what Construct itself does: reads still flow
through whatever the host's MCP tools return, recorded as provenance, never
through a connector this repository builds or calls. Once a host is
attached to one of these servers, the run-time source of record for what
Construct read is still `construct source add`:

```bash
construct source add --kind=jira --locator=<PROJECT-KEY>
construct source add --kind=github --locator=<org>/<repo>
construct source add --kind=docs --locator=confluence:space:<SPACE-KEY>
```

The `docs` kind's locator convention (`<provider>:<container>:<id>` — see
`src/kernel/store/sources.ts`) is what makes a Confluence or Google Docs read
row auditable against the source it was declared for. `jira` and `github`
are their own, separate source kinds already (`jira`'s locator is a bare
project key, e.g. `PROJ`); `github` is declared in `SOURCE_KINDS` but, as of
this writing, has no locator example anywhere in this codebase's tests to
point to — **(unverified: what a `github`-kind locator should look like in
practice; nothing in this repository demonstrates or validates one today)**.
Construct's kernel has no dedicated source kind for Linear at all —
attaching a host to Linear's MCP server per this recipe does not, by itself,
give Construct a way to record Linear provenance; that is a gap for a future
kind, not something this recipe or `sources.ts` closes. This section names
the wiring that already exists in this repository — it adds nothing new and
licenses nothing that `docs/connector-seam-design.md` does not already
license.
