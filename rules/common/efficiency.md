<!--
rules/common/efficiency.md — session context and tool-use efficiency standards.

Applies to all agents operating in a Construct session. Violations compound context
cost and reduce throughput. These rules are enforced by read-tracker.mjs and surfaced
in the session-start efficiency digest.
-->

# Session Efficiency

## Read discipline

Read a file once per task boundary. When a file's content is needed again, use the
in-context version unless there is a concrete reason to believe it changed (e.g., a
tool wrote it since the last read).

Signals that a re-read is warranted:
- A Write/Edit tool call targeted the file after the last read.
- An external process (Bash, a subagent) may have modified it.
- The last read was in a prior session (context was compacted).

Do not re-read to verify — trust the in-context state. If staleness is a concern,
check the file hash via `read-tracker.mjs` state rather than re-reading the full file.

**Threshold:** more than 3 reads of the same file within a session without an intervening
write is a signal to stop and confirm the approach. The session-start digest surfaces
files that crossed this threshold in the prior session.

## Probe before bulk read

Before calling `Read` with `limit` unset or above 200 lines:
1. Check file size with `Glob` or `wc -l`.
2. Use a `limit: 50` probe pass to confirm the region of interest.
3. Then read the targeted range with `offset` + `limit`.

Bulk reading a large file to find a small section is never the right approach.

## Tool call parallelism

Independent tool calls must run in parallel. Sequential execution of parallelizable
calls wastes wall-clock time and burns context on round-trip overhead.

A call is independent when its inputs do not depend on the output of any other call
in the same batch.

## Bash output

Long Bash outputs are automatically persisted to `~/.cx/bash-logs/` by
`bash-output-logger.mjs`. Reference the log path in subsequent turns rather than
re-running the command.

## Agent dispatch cost

Each Task dispatch creates a subagent context. Dispatch a specialist when the task
benefits from a structurally different view (architecture suspicion, security scan,
coverage gap analysis). Do not dispatch for tasks that fit within a single focused
pass — the round-trip cost exceeds the benefit.
