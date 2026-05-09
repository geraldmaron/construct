<!--
skills/ai/agent-dev.md — AI Agent Development — Use this skill when building AI agents, tool-use systems, or multi-agent workflo

Use this skill when building AI agents, tool-use systems, or multi-agent workflows. ## Agent Architecture
-->
# AI Agent Development

Use this skill when building AI agents, tool-use systems, or multi-agent workflows.

## Agent Architecture

### Core Loop
1. Receive user input or system event
2. Plan: decide what action to take (tool call, response, delegation)
3. Act: execute the chosen action
4. Observe: process the result
5. Repeat until the task is complete or a stop condition is met

### Planning Strategies
- ReAct: interleave reasoning and acting in a single prompt
- Plan-then-execute: generate a full plan, execute steps sequentially
- Tree of thought: explore multiple approaches, select the best
- Choose based on task complexity; ReAct for simple, plan-first for multi-step

## Tool Design

### Principles
- Each tool does one thing well
- Tool names and descriptions are clear enough for the LLM to select correctly
- Parameters have strict types and validation
- Return structured results the LLM can parse
- Include error states the agent can reason about

### Tool Schema
- Use JSON Schema or equivalent for parameter definitions
- Required vs optional parameters clearly marked
- Enum values for constrained choices
- Description field explains when and why to use the tool
- Examples in the description improve selection accuracy

### Common Tool Categories
- Information retrieval: search, database query, API call
- Computation: calculator, code execution, data transformation
- Communication: email, messaging, notifications
- File operations: read, write, list
- System control: deploy, configure, monitor

## Function Calling

- Validate all tool arguments before execution
- Sanitize user-influenced inputs passed to tools
- Set timeouts on all external tool calls
- Handle tool failures gracefully; allow the agent to retry or choose alternatives
- Log every tool call with inputs, outputs, latency, and success/failure

## Multi-Agent Systems

### Patterns
- **Orchestrator-worker**: one agent delegates subtasks to specialists
- **Pipeline**: agents process sequentially, each adding to the context
- **Debate**: multiple agents propose solutions, a judge selects the best
- **Swarm**: agents claim tasks from a shared queue

### Coordination
- Define clear responsibilities per agent role
- One writer per resource at any time to avoid conflicts
- Shared context via message passing, not shared mutable state
- Supervisor agent monitors progress and handles failures
- Set maximum iterations to prevent infinite loops

## Prompt Engineering for Agents

- System prompt: role, capabilities, constraints, output format
- Include examples of correct tool selection and usage
- Specify when to ask for clarification vs proceed with assumptions
- Define stop conditions: task complete, max iterations, confidence threshold
- Separate instructions from context; keep instructions stable

## Error Handling

- Retry transient failures with backoff
- Escalate persistent failures to the user or supervisor
- Maintain a fallback path when tools are unavailable
- Log enough context to debug failures post-hoc
- Prevent cascading failures in multi-agent systems

## Safety and Guardrails

- Validate agent outputs before executing side effects
- Require human approval for high-impact actions (delete, deploy, send)
- Rate limit tool calls to prevent runaway loops
- Monitor token usage and cost per agent session
- Content filtering on both inputs and outputs

## Evaluation

- Task completion rate on a benchmark set
- Tool selection accuracy: did the agent pick the right tool?
- Step efficiency: how many steps to complete vs optimal?
- Error recovery rate: does the agent recover from tool failures?
- Cost per task: tokens consumed, API calls made, latency
- Run evals on every prompt or tool change
