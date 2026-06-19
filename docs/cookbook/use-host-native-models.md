---
title: Use Host-Native Models
description: Leverage your existing GitHub Copilot or Anthropic subscriptions in OpenCode via Subscription Bridges.
---

Subscription Bridges allow you to use premium models from services you are already subscribed to, without needing direct API keys or paying extra per token. Construct manages local proxy services that bridge your host-native authentication (like the `gh` CLI for Copilot) to a standard OpenAI-compatible API that OpenCode can consume.

## How it Works

1. **Detection:** Construct checks for active authenticated sessions on your machine (e.g., `gh auth status`).
2. **Bridge Service:** When you run `construct dev`, it starts a local "Bridge Service" (e.g., `copilot-bridge` on port 5174).
3. **OpenCode Sync:** Construct automatically registers these bridges as custom providers in your `opencode.json` configuration.
4. **Agentic Use:** You can now select these models in OpenCode's TUI or via the `/models` command.

## Supported Bridges

### GitHub Copilot

If you have a GitHub Copilot subscription, you can use GPT-4o, Claude 3.5 Sonnet, and other models supported by Copilot.

**Prerequisites:**
- [GitHub CLI (`gh`)](https://cli.github.com/) installed.
- Authenticated via `gh auth login`.

**Usage:**
- Models appear as `github-copilot/gpt-4o`, `github-copilot/claude-3.5-sonnet`, etc.
- No `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is required; auth is handled via your local GitHub session.

### Anthropic (Claude Bridge)

*Coming soon.* This bridge will allow you to leverage your Claude Pro subscription or active `claude` CLI sessions.

## Configuration & Management

### Starting Bridges

Bridges are started automatically when you run the standard Construct services:

```bash
construct dev
```

You can check the status of active bridges in the Construct Dashboard or via `construct doctor`.

### Customizing Ports

If the default bridge ports (5174, 5175, etc.) conflict with other services, you can customize them in your `~/.construct/config.env`:

```bash
COPILOT_BRIDGE_PORT=6000
```

## Community Best Practices

Construct follows established community patterns for host-native bridging:
- **Zero-Trust (Local Only):** Bridge services bind only to `127.0.0.1`. Your tokens and code never leave your machine except to reach the official provider's API.
- **Provider Parity:** Bridge models are treated as first-class citizens in OpenCode, supporting tool-calling and system prompts just like direct API models.
- **Cost Optimization:** Use host-native models for high-volume "standard" tasks and save your OpenRouter/Anthropic API credits for high-stakes "reasoning" tasks.

## Troubleshooting

### Bridge Not Starting
- Ensure the respective host CLI (e.g., `gh`) is installed and you are logged in.
- Run `construct doctor` to see detailed error logs for the bridge service.

### OpenCode Cannot See Models
- Run `construct sync` to force-regenerate your `opencode.json` with the latest bridge provider info.
- Check that `BRIDGE_PORT` in `.env` matches the port OpenCode is configured to use.
