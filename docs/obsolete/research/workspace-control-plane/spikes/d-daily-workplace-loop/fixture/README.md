Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

/**
 * Fixture manifest for Spike D (construct-b0nny.5.4, directive §11).
 *
 * Everything in this directory is a FIXTURE: a local, disposable stand-in for
 * a real workplace's tools. None of it talks to a real GitHub, Jira, Slack,
 * or Confluence instance, and none of it corresponds to a real company,
 * product, or person. "Nimbus" is a fictional internal-tools product invented
 * only to give the signals a coherent narrative.
 *
 * This fixture is deliberately seeded with a small set of realistic
 * inconsistencies (a stale objective, an unaddressed high-severity issue, a
 * leadership decision that never propagated to the backlog, and several
 * low-signal "noise" items) so the loop in ../loop/run-loop.mjs has
 * something real to find, filter, and reason about.
 */

# Spike D fixture — "Nimbus" (fictional)

| File | Stand-in for | Notes |
|---|---|---|
| `strategy.md` | Company strategy doc | Three pillars, used for alignment checks |
| `objectives.json` | Internal OKR tracker | Contains one stale/overdue objective (OBJ-2) |
| `directive.md` | Standing directive for the daily loop | Mission, cadence, scope |
| `authority-policy.md` | Authority policy for the daily loop | What it can/can't do without human approval |
| `github-issues.json` | GitHub Issues | One stale high-severity bug (GH-101), two noise issues |
| `jira-backlog.json` | Jira-style backlog | PROJ-88 not reconciled with a newer Slack decision |
| `slack-messages.json` | Slack + Confluence-style notes | Contains the contradicting leadership message and social noise |

All fixture JSON files carry `"_fixture": true` and a `"_note"` field stating
they are local stand-ins, not real integrations.
