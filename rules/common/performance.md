<!--
rules/common/performance.md — model-agnostic performance and context management rules.

Defines model selection tiers, context window management heuristics,
and build troubleshooting steps. No platform-specific tool names or config paths.
-->
# Performance Optimization

## Model Selection Strategy

**Fast tier** (small/cheap models):
- Lightweight agents with frequent invocation
- Pair programming and code generation
- Worker agents in multi-agent systems

**Standard tier** (mid-range models):
- Main development work
- Orchestrating multi-agent workflows
- Complex coding tasks

**Reasoning tier** (large/frontier models):
- Complex architectural decisions
- Maximum reasoning requirements
- Research and analysis tasks

## Context Window Management

Avoid last 20% of context window for:
- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

Prefer this retrieval ladder before loading more context:
1. Targeted search to narrow candidate files
2. Targeted reads (aim for <400 lines)
3. Parallel reads for the minimum necessary file set
4. Summarize to a context artifact before broad re-exploration

Heuristics:
- Re-reading the same file multiple times without a state change is a retrieval smell.
- Large reads should be reserved for files where local structure matters more than symbol search.
- Use workflow/context artifacts as cached state instead of rediscovering background repeatedly.

Lower context sensitivity tasks:
- Single-file edits
- Independent utility creation
- Documentation updates
- Simple bug fixes

## Build Troubleshooting

If build fails:
1. Analyze error messages
2. Fix incrementally
3. Verify after each fix
