<!--
docs/getting-started.md — Construct onboarding guide.

Covers installation, first-session setup, the memory layer payoff timeline,
and the bootstrap command to accelerate cold-start recall.
-->

# Getting Started with Construct

## Installation

```bash
git clone https://github.com/your-org/construct ~/.construct
~/.construct/install.sh
```

After install, `construct doctor` confirms the system is healthy.

## First Session

Open a project and start your AI coding session. Construct injects context at session start automatically via hooks. The session-start output includes:

- **Working branch** — confirmed before any mutating operation
- **Workflow status** — active task key and acceptance criteria
- **Prior observations** — relevant patterns and decisions from previous sessions

## Memory Layer

Construct's memory layer records observations, patterns, and decisions across sessions. Retrieval uses a BM25 + cosine hybrid search.

### Payoff Timeline

| Sessions | What to expect |
|---|---|
| 0 | Retrieval is cold. Seed corpus provides baseline recall if bootstrapped. |
| 5 | Personal patterns start surfacing alongside seed corpus entries. |
| 20 | Personal patterns dominate. Retrieval is meaningfully better than cold. |
| 50+ | Retrieval is fully personalized. Seed corpus rarely surfaces. |

### Cold-Start Acceleration

Run once after install to import the seed corpus of common patterns, anti-patterns, and architectural decisions:

```bash
construct bootstrap
```

This gives the retrieval layer a meaningful signal immediately, without waiting for 20 sessions of real data.

### Measuring Value

```bash
construct memory stats
```

Reports:
- Sessions tracked
- Average observations injected per session
- Hit rate (sessions where at least one observation was injected)
- p95 retrieval latency

If hit rate is below 30% after 20+ sessions, check that observations are being recorded. Run `construct search "any keyword"` to verify the store has content.

### Disabling Memory Injection

Set `CONSTRUCT_MEMORY=off` to disable memory injection for a session. Useful for A/B comparison or debugging. Stats are still recorded with `memoryEnabled: false` so you can compare outcome quality.

```bash
CONSTRUCT_MEMORY=off claude  # or opencode, etc.
```

## Key Commands

| Command | Description |
|---|---|
| `construct bootstrap` | Import seed observation corpus |
| `construct memory stats` | Show memory layer usage stats |
| `construct search <query>` | Search observations and documents |
| `construct sync` | Regenerate all platform agent files from registry |
| `construct doctor` | Verify system health |
| `construct lint:comments` | Check comment policy violations |
| `construct lint:comments --fix` | Insert stub headers for files missing one |
| `construct workflow status` | Show active workflow state |

## Comment Policy

All files under `lib/`, `bin/`, and test files follow the comment policy in `rules/common/comments.md`. The key rule: comments explain **why** non-obvious decisions were made. They don't narrate execution or restate what the code says. The PostToolUse `comment-lint.mjs` hook flags violations at authoring time.

## Workflow

Construct tracks work through `.cx/workflow.json`. Use `construct workflow` to manage tasks, mark completions, and record verification evidence. The session-start hook surfaces the active task key so every session starts with clear context about what's in progress.
