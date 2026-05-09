# How to Configure Slack

Construct can post snapshots and roadmap summaries to Slack channels, and receive slash commands from Slack.

## Step 1: Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**.
2. Choose **From scratch**.
3. Name the app (e.g. `Construct`) and pick your workspace.

## Step 2: Add scopes

Under **OAuth & Permissions → Scopes → Bot Token Scopes**, add:

- `channels:history`
- `channels:read`
- `chat:write`
- `commands`

## Step 3: Enable slash commands (optional)

Under **Slash Commands**, add `/construct` pointing at your server:

```
https://your-construct-host/webhooks/slack
```

## Step 4: Install to workspace

Under **OAuth & Permissions**, click **Install to Workspace**. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

## Step 5: Get the signing secret

Under **Basic Information → App Credentials**, copy the **Signing Secret**.

## Step 6: Add to config.env

```sh
# ~/.construct/config.env
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_CHANNELS=#general,#incidents:risk,#decisions:decision
```

## Channel intent format

The `SLACK_CHANNELS` value supports optional intent suffixes. The intent tells Construct how to categorize messages from each channel:

```
#channel-name:intent
```

Valid intents: `risk`, `decision`, `insight`, `external`, `internal`

**Examples:**

```sh
# Single channel, no intent (defaults to insight)
SLACK_CHANNELS=#eng-updates

# Multiple channels with intents
SLACK_CHANNELS=#general,#incidents:risk,#team-decisions:decision,#customer-feedback:external
```

## Step 7: Restart the daemon

```sh
construct embed stop
construct embed start
```

## Authority and approval

Slack posts are classified as `externalPost` actions, which are `approval-queued` in the default operating profile. This means the daemon will queue the post and wait for your approval before sending.

To allow autonomous posting, update the authority in your embed config:

```yaml
# In your embed config (or override in config.env)
operatingProfile:
  authority:
    externalPost: autonomous
```

You can also approve queued posts from the dashboard under the **Approvals** tab.
