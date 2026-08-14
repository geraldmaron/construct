# How to talk to Construct (host surface)

Dated 2026-08-14. Answers the question: do we need a Construct-only UI, or
do we harness hosts we already have?

## The short answer

**Do not stand up a Construct-only product UI.** Commitment 1 forbids building
an agent runtime, memory engine, or tool broker in competition with the
platforms. Presence is already one MCP projection (`construct serve`).
Execution is already host adapters (OpenCode first-class; Claude, Codex, Cursor
pinned). A bespoke chat shell would duplicate what nanobot, Claude Code, Codex,
Cursor, and OpenCode already ship, and would own none of their distribution.

What Construct uniquely owns is coverage, obligation, and provenance — the
organizational distillation layer. That layer rides hosts; it is not a host.

## Surfaces that already work

| Surface | Job | How |
|---|---|---|
| CLI spine | Outcome → work → log → inbox → decide → compose → show | `construct …` |
| MCP projection | Presence inside any MCP host; no completion writes | `construct serve` |
| OpenCode | First-party execution adapter | `--host=opencode` |
| Claude / Codex / Cursor | Additional execution adapters | `--host=claude\|codex\|cursor` |
| nanobot (HKUDS) | Chat / WebUI presence for BlackStory dogfood | MCP attached; see below |

## nanobot — wired for presence, not yet the default PATH install

Trial record: `docs/host-trial-nanobot.md`. Instance lives at
`~/.nanobot-blackstory/` so it does not collide with a personal default.

**Interact:**

```bash
# Chat workbench (browser)
nanobot webui -c ~/.nanobot-blackstory/config.json -y

# One-shot CLI
nanobot agent -c ~/.nanobot-blackstory/config.json -m "Record an outcome: …"
```

**Version trap (verified 2026-08-14).** Homebrew `construct` on PATH was
`3.0.0-alpha.10` while this checkout is `3.0.0-alpha.11` (voice + form fixes).
The trial instance at `~/.nanobot-blackstory/` is pointed at this checkout's
launcher, not PATH. If a later session finds PATH lag again, restore:

```json
{
  "tools": {
    "mcpServers": {
      "construct": {
        "command": "node",
        "args": [
          "/Users/geralddagher/Developer/Projects/construct/bin/construct.mjs",
          "serve"
        ]
      }
    }
  }
}
```

Applied 2026-08-14 (this session, with explicit approval). Restart webui/agent
to pick it up. Sessions must not rewrite host configs without that approval.

**What nanobot must not hold.** Capability tokens and erasure stay off this
host: it can enable channels reachable from outside the machine. Presence only.
Execution adapters are a separate decision and require a usage/cost report so
the spend ceiling can bind.

## OpenCode is first-party for execution — not the only interface

OpenCode remains the conformance-pinned execution host. Interfaces for *talking
to* Construct are broader:

1. **Wherever you already work** — attach MCP (`claude mcp add construct
   construct serve`, Cursor MCP, Codex MCP, OpenCode tools). Cursor in
   particular: the predecessor registered `lib/mcp/server.mjs` from a global
   install. That path is not the rewrite and does not exist on this machine.
   Point Cursor at `node <checkout>/bin/construct.mjs serve` (same launcher
   nanobot uses). Applied 2026-08-14 to `~/.cursor/mcp.json`.
2. **nanobot WebUI** — lightweight chat shell for outcome/inbox dogfood without
   opening an IDE.
3. **CLI** — still the spine; hosts never replace `decide`, `compose`, or
   erasure.

## Xirp and peers — projection targets, not substitutes

Spotify's Xirp (public beta 2026-08-10) is a vendor-neutral *session manager*
over Claude Code, Codex, and Gemini CLI — worktrees, multi-session
orchestration, optional Portal/Backstage ownership catalog. Its own docs put
domain routing, legal/compliance review, and deliverable obligations out of
scope. That is Construct's remaining claim after role-depth retirement
(`RESEARCH-DECISIONS.md` §16–17).

**Read:** Xirp is a future MCP/host projection target under commitment 1, gated
by the same Phase 4/5 host-breadth rules as any other host. It does not replace
Construct. Portal ownership (component → team) is a different relation from
Construct's outcome → concern routing; importing a catalog does not raise
coverage accuracy (`RESEARCH-DECISIONS.md` §17).

Other industry shells (OpenCode Desktop, Claude Code, Cursor agent mode, Codex
app) fill the same slot: places a person already is. Prefer attaching the
projection over inventing a fifth shell.

## When a Construct-owned UI *would* be justified

Only if every of these is true at once:

1. No MCP-capable host reaches the operator (not true today).
2. The missing surface is something hosts cannot project (inbox batching UX,
   packet review) *and* cannot be a thin local viewer over the existing store.
3. Gerald accepts the commitment-1 exception in STRATEGY with a dated amendment.

Until then: **suck it up means harness hosts, not build a chat product.** If a
thin local *viewer* for composed PDFs / packets is needed later, that is a
document browser, not an agent UI — file it separately and keep it read-only.

## Recommendation (this session)

1. Keep OpenCode as execution pin.
2. Use nanobot WebUI + MCP for BlackStory / chat dogfood; point MCP at the
   checkout when verifying voice/form work.
3. Treat Xirp as a Phase 4/5 host candidate, not a roadmap pivot.
4. Do not fund a Construct-only chat UI.
5. Held run-derived lessons are listed and admitted on the spine
   (`construct lessons list|approve`), never inside a host.
