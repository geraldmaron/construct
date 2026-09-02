# Documentation

Everything here is written for someone using Construct. The records of how it
was built live in [`internal/`](internal/), separately, so a reader can tell
which they are holding. A lint holds this list to the directory: a new file
here is added below, which is the moment someone decides it is documentation
rather than a record.

The user documentation set is being rewritten for the current architecture.
Until it lands, `construct help` and `construct <command> --help` are the
reference for the command line, and the operational `construct` skill is what
the agent host reads.

## Reference

- [`exit-codes.md`](exit-codes.md) — the three exit codes every command uses.
