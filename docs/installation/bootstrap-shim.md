<!--
docs/installation/bootstrap-shim.md — Bootstrap shim for non-Node projects.

Explains the .construct/ layout staged by construct init, how hook commands
resolve through it, and Docker/curl fallbacks for teammates without Node.
-->

# Bootstrap Shim (Non-Node Projects)

When you run `construct init` in a project that does not have Node.js as a dependency, Construct stages a lightweight shim under `.construct/`. This lets the Claude Code hooks work without requiring a global `construct` install on every developer's machine.

## What gets staged

```
.construct/
├── version          # pinned Construct version (e.g. "0.9.4")
├── run.mjs          # launcher — resolves the correct construct binary
├── bootstrap.sh     # Unix entry point (sources run.mjs)
└── bootstrap.ps1    # Windows entry point (sources run.mjs)
```

Commit all four files. Teammates clone the repo and get working hooks automatically.

## How hooks resolve

Claude Code hook commands in `.claude/settings.json` reference the shim instead of the global binary:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node .construct/run.mjs hook guard-bash" }
        ]
      }
    ]
  }
}
```

`run.mjs` follows this resolution order:

1. `node_modules/.bin/construct` (if the project has `@geraldmaron/construct` as a dev dep)
2. The pinned version fetched from npm cache or registry, matching `.construct/version`
3. Global `construct` binary

This means Node projects that add Construct as a dev dependency get the exact pinned version without shim overhead.

## Teammates without Node

Two fallbacks are available for team members whose machines do not have Node installed:

### Docker fallback

`bootstrap.sh` detects when Node is absent and falls back to Docker:

```bash
docker run --rm -v "$(pwd):/project" -w /project \
  geraldmaron/construct:<version> hook <name>
```

The image is available on Docker Hub. Pin the version in `.construct/version` so all team members use the same build.

### Curl binary fallback

For environments without Docker, `bootstrap.sh` can download a pre-built binary:

```bash
curl -fsSL https://releases.construct.dev/v<version>/construct-linux-x64 \
  -o /tmp/construct && chmod +x /tmp/construct
```

Set `CONSTRUCT_BIN=/tmp/construct` in your shell before starting Claude Code and `run.mjs` picks it up.

## Updating the pinned version

```bash
construct init:update
```

This rewrites `.construct/version` to the currently installed version and regenerates `run.mjs`. Commit the updated files so teammates get the new version on next pull.

## Opting out

If all team members have Construct installed globally and you do not want the shim, omit the `.construct/` directory and configure hook commands to use `construct hook <name>` directly.
