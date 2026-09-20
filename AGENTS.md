# Agent Instructions

Construct is the operating layer for this project. Work happens in this
host. Construct owns context admission, bounded work, evidence, and trust
transitions.

Call `bootstrap` once. Answer ordinary questions without recording anything.
Use `project_context` for one topic at a time. Use `work` for the native
ledger. Use `claim_work` / `submit_work` for a resolved outcome. Do not
spawn another agent or another host CLI. Do not run `construct` to do the
work; the command line is for setup, inspection, and recovery.

```bash
construct work ready
construct work show <id>
construct doctor
```

The full gate: `npm run lint && npm run typecheck && npm test && npm run smoke`.

File operations must be non-interactive (`cp -f`, `mv -f`, `rm -f`,
`rm -rf`). Never hang on a confirmation prompt.

Standing constraints that still apply: no secrets in source; fixtures never
touch the real HOME; AI-authored code never cites tracker ids; commit
messages state an invariant in plain language; documentation states what is
true now.
