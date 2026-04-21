<!--
rules/common/agents.md — platform-agnostic agent orchestration guidance.

Defines when to route to specialist agents, parallel execution rules,
and multi-perspective analysis patterns. Does not reference specific
platform agent types or config paths.
-->
# Agent Orchestration

## Immediate Agent Usage

No user prompt needed — match the task to the right specialist:
1. Complex feature requests - planning specialist
2. Code just written/modified - code review specialist
3. Bug fix or new feature - TDD specialist
4. Architectural decision - architecture specialist

## Parallel Task Execution

ALWAYS use parallel execution for independent operations. Launch multiple specialists concurrently when their work is independent.

## Multi-Perspective Analysis

For complex problems, use multiple specialist perspectives:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
