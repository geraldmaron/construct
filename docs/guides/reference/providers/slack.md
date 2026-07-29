<!--
docs/guides/reference/providers/slack.md: Slack provider setup and usage guide.

Covers token configuration, capabilities (read/search), and example queries.
-->

# Slack Provider

Connects Construct to Slack channel history and message search.

**Capabilities:** read, search

## Authentication

Set a bot token or user token in `~/.config/construct/config.env`:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
```

Or, for user-scoped search (required for `search.messages`):

```
SLACK_USER_TOKEN=xoxp-your-user-token-here
```

Both variables are checked; `SLACK_BOT_TOKEN` takes precedence if both are set.

### Creating a bot token

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under **OAuth & Permissions**, add these bot token scopes:
   - `channels:history`: read messages from public channels
   - `channels:read`: list channels
   - `groups:history`: read messages from private channels the bot is in
   - `search:read`: message search (requires user token scope, not bot)
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (`xoxb-...`)

For `search.messages`, you need a user token (`xoxp-...`) with `search:read` scope. Bot tokens cannot use the search API.

## Verify the connection

```bash
construct provider test slack
```

A healthy response shows the workspace name and the authenticated user.

## Usage

### Read channel history

Fetch recent messages from a channel:

```
config.channel = "#engineering"   // channel name
config.count   = 50               // number of messages (default 20, max 100)
```

Or by channel ID:

```
config.channel = "C0123ABC456"
```

Returns a list of message objects including text, user, timestamp, and thread metadata.

### Search messages

```
config.query = "database migration auth service"
config.count = 20
```

Returns matching messages with channel, author, timestamp, and permalink. Requires a user token with `search:read` scope.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes (or user) | Bot token (`xoxb-...`) for channel history reads |
| `SLACK_USER_TOKEN` | Yes (or bot) | User token (`xoxp-...`) for message search |

## Common query examples

| Goal | Query |
|---|---|
| Find discussion about a service | `"payment-service" in:#engineering` |
| Find an incident post-mortem | `postmortem incident-2026 in:#incidents` |
| Find a decision | `"we decided" OR "final decision" auth refactor` |
| Find a deploy notification | `deployed production in:#deployments` |

## Notes

- Channel IDs are preferred over names: names can change, IDs are stable. Find the ID by right-clicking a channel in Slack and selecting **Copy link**.
- The `search.messages` API is user-scoped. A bot token does not have access to this method: if search is important, configure `SLACK_USER_TOKEN`.
- Message history beyond the free plan retention period (90 days on paid plans) is not accessible via the API.
