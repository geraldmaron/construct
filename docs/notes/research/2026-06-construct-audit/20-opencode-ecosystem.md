---
intake: none
---

# 20 — OpenCode Ecosystem: config, precedence, plugins, local-model handling

Date: 2026-06-09 · Branch: research/capability-registry · Bead: construct-hibq

Audit area: OpenCode (`github.com/sst/opencode`, repo also mirrored as `anomalyco/opencode`) config
semantics, MCP/agent/tool model, plugin API surface, and local-model handling. This doc is
load-bearing for a Construct implementation phase, so every config/source claim is cited to a primary
source: opencode.ai docs, the OpenCode source on the `dev` branch, or named GitHub issues. Source
files were fetched from `dev` and read directly; line numbers refer to that branch and may drift.

---

## Concrete answers (questions 1–6)

### Q1 — Config precedence and merge

**Deep-merge, conflicting keys win by precedence order, arrays replace — except `instructions` and
`plugin`, which concatenate.**

OpenCode loads many config sources and combines them. The docs state configs are "merged together, not
replaced … Later configs override earlier ones only for conflicting keys"
([opencode.ai/docs/config](https://opencode.ai/docs/config)). Source confirms the merge is a true deep
merge via remeda's `mergeDeep`:

```ts
// packages/opencode/src/config/config.ts:7,40-49
import { mergeDeep } from "remeda"
function mergeConfig(target, source) { return mergeDeep(target, source) }
function mergeConfigConcatArrays(target, source) {
  const merged = mergeConfig(target, source)
  if (target.instructions && source.instructions)
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  return merged
}
```

Precedence order (later overrides earlier), per docs and the merge sequence in `config.ts:248-249,
382-395`:

1. Remote config (`.well-known/opencode`)
2. Global config (`~/.config/opencode/{config.json, opencode.json, opencode.jsonc}`)
3. `OPENCODE_CONFIG` (custom path)
4. Project config (`opencode.json` / `opencode.jsonc`, found by walking up to the nearest Git dir)
5. `.opencode/` directories
6. `OPENCODE_CONFIG_CONTENT` (inline env)
7. Managed config files / macOS managed preferences (highest)

(Source: [opencode.ai/docs/config](https://opencode.ai/docs/config); the `merge(...)` calls all use
`mergeConfigConcatArrays`, so the array-concat exception applies to every layer —
`config.ts:340-341`.)

**Mechanics that matter:** because it is `mergeDeep`, nested objects (e.g. `mcp`, `agent`, `provider`,
`permission`) combine key-by-key — a project config can set one field of a globally-defined MCP server
without redefining the whole server. Plain arrays other than `instructions`/`plugin` are *replaced*,
not concatenated (remeda `mergeDeep` replaces arrays). `instructions` and `plugin` are the only
documented array-concat exceptions (`config.ts:46-48`, `config.ts:332-337`).

INFERENCE: A project that lists `permission.bash` as an array would replace, not merge, a global
array; but `permission` in modern configs is keyed objects, which deep-merge. Construct should treat
*objects* as merge-friendly and *arrays* as replace-only when reasoning about what project config can
safely override.

### Q2 — Per-MCP `enabled`

**Boolean. Default is enabled (the check is `=== false`). A project config CAN disable a
globally-enabled server, and vice-versa, via deep-merge.**

```ts
// packages/opencode/src/mcp/index.ts:449-452
const create = Effect.fn("MCP.create")(function* (key, mcp) {
  if (mcp.enabled === false) { return DISABLED_RESULT }
  ...
```

The gate is an explicit `=== false`, so an absent `enabled` (undefined) connects normally — **default
is on**. Docs corroborate the field is boolean and shown as `"enabled": true` in examples
([opencode.ai/docs/mcp-servers](https://opencode.ai/docs/mcp-servers)). Because the `mcp` object
deep-merges (Q1), a project `mcp.<id>.enabled: false` overrides a global `enabled: true` for that one
server (and a project `true` would re-enable a globally-disabled one) — the conflicting key wins by
precedence (project > global). This is exactly the lever Construct uses.

INFERENCE (default value): the docs do not state a default in prose; "default on" is read from the
source gate `mcp.enabled === false`, not from a documentation sentence. Treat "default = enabled" as
**source-derived, doc-silent**.

### Q3 — Per-agent `tools` / `permission`: schema removal vs execution gating

**Confirmed with a critical nuance: a tool's schema is dropped from what the model sees ONLY on a
blanket deny (`pattern === "*"` AND `action === "deny"`). Any narrower deny, or an `ask`, leaves the
schema in and gates only execution.** This corroborates Construct's internal finding (permission denies
do not drop schemas) for *scoped* denies, but refutes it for *blanket* denies.

The definitive code path:

```ts
// packages/opencode/src/session/llm/request.ts:198-203
function resolveTools(input) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

// packages/opencode/src/permission/index.ts:215-224
export function disabled(tools, ruleset) {
  const edits = ["edit", "write", "apply_patch"]
  return new Set(tools.filter((tool) => {
    const permission = edits.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast((r) => Wildcard.match(permission, r.permission))
    return rule?.pattern === "*" && rule.action === "deny"   // ← only blanket deny removes it
  }))
}
```

`resolveTools` runs during LLM request prep; its output is the `tools` map handed to the model
(`request.ts:148, 174`; passed through to `handle.process({ ... tools })` in
`packages/opencode/src/session/prompt.ts:1279-1344`). So a tool with `{"*":"deny"}` is **absent from
the schema set**; a tool with a *pattern-scoped* deny (e.g. `bash: {"git push": "deny"}`) or an `"ask"`
stays present and is gated at execution time via `ctx.ask` (`session/tools.ts:63-71, 134`).

Legacy `tools: {"<id>": false}` is normalized into a blanket deny rule:

```ts
// packages/opencode/src/session/prompt.ts:1114-1115
for (const [t, enabled] of Object.entries(input.tools ?? {}))
  permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
```

so `{"*": false, "webfetch": true}` produces a blanket deny on everything except webfetch → those
schemas are removed. This is exactly what maintainer `rekram1-node` told a user in
[issue #2752](https://github.com/sst/opencode/issues/2752): "all tools are loaded by default, adjust it
to do: `"*": false, "webfetch": true`" to stop the unused tool prompts loading. The reporter confirmed
this fixed the ~7.6k-token tool-prompt overhead on a small local rig. Docs note `tools` is **deprecated
in favor of `permission`** and that `true == {"*":"allow"}`, `false == {"*":"deny"}`
([opencode.ai/docs/agents](https://opencode.ai/docs/agents)).

Special case — the Task tool: subagents denied via `permission.task.<name> = "deny"` are removed from
the Task tool's *description* entirely (`tool/registry.ts:252-264`, `describeTask`), so the model won't
attempt to invoke them. That is description-level pruning, distinct from the tool-map pruning above.

[unverified] for SDK callers: [issue #6396](https://github.com/sst/opencode/issues/6396) reports that
agent `deny` permissions are **ignored when the agent is invoked via the OpenCode SDK** — denied tools
remain usable. Construct's integration runs through the CLI/server path, not the raw SDK, so this is
flagged but not assumed to affect Construct. The behavior was not re-verified in source for this audit.

### Q4 — Model-conditional / per-session tool filtering

**There is NO per-session, model-conditional, plugin-driven tool-pruning mechanism. The only
schema-pruning levers are config-time (`tools`/`permission` blanket-deny per agent, and MCP
`enabled:false`). Config-time disabling is the endorsed pattern; per-session filtering is not on a
visible roadmap.**

The full plugin Hooks interface (`packages/plugin/src/index.ts:222-335`):

- `chat.params(input: {sessionID, agent, model, provider, message}, output: {temperature, topP, topK,
  maxOutputTokens, options})` — **model- and provider-aware**, but its `output` has **no `tools`
  field**, so it cannot add/remove tools. It only mutates sampler params and provider `options`.
- `chat.headers`, `chat.message`, `command.execute.before`, `tool.execute.before/after`, `shell.env`,
  `permission.ask`, and several `experimental.*` hooks (`chat.messages.transform`,
  `chat.system.transform`, `provider.small_model`, `session.compacting`, `compaction.autocontinue`,
  `text.complete`).
- `tool.definition(input: {toolID}, output: {description, parameters})` — can **rewrite** a tool's
  description/schema but **cannot remove** the tool (no enable/disable in the output; it is invoked per
  already-included tool at `tool/registry.ts:289`).

So no hook sees the model *and* can drop tools. Tool resolution (`resolveTools`, Q3) is the only place
the set is pruned, and it reads config-time permission only.

Core does contain *built-in* model-conditional tool selection — but it is not configurable or
plugin-extensible: GPT-family models get `apply_patch` instead of `edit`/`write`, and websearch is
gated by provider capability (`tool/registry.ts:269-279`). This is hard-coded, not a hook.

Related issues confirm the gap and the workaround framing:

- [#2752](https://github.com/sst/opencode/issues/2752): unused tool *prompts* in context; fix is
  config-time `tools` disabling — the maintainer's endorsed answer.
- [#4096](https://github.com/anomalyco/opencode/issues/4096): feature request for *context control for
  subagents* (subagents receive full repo context they don't need) — open feature request, indicating
  no built-in per-subagent context/tool slimming.
- [#18793](https://github.com/anomalyco/opencode/issues/18793): proposal for a `chat.model` hook for
  pre-call model routing — explicitly notes plugins today "can modify params, headers, prompts, and
  tool behavior, but … cannot choose a different model at call time." A design discussion, not
  implemented. (Even this proposed hook is about model *selection*, not tool *pruning*.)

INFERENCE: The endorsed, supported way to shrink the tool surface for a local model in current OpenCode
is config-time disabling (agent `tools`/`permission` + MCP `enabled:false`). Per-request tool filtering
would require either a new hook OpenCode does not yet expose, or a custom provider/fork. Construct's
gateway + machine-wide MCP disabling is working *with* this constraint, not against it.

### Q5 — Local-model handling (Ollama: `/v1` vs `/api/chat`, `num_ctx`)

**Confirmed: OpenCode talks to Ollama over the OpenAI-compatible `/v1` endpoint via
`@ai-sdk/openai-compatible`, and `num_ctx` cannot be set through opencode.json — only a Modelfile
`PARAMETER num_ctx` (or `ollama create`/`/set parameter` + save) changes the actual context window.**

Docs show the Ollama provider as a custom OpenAI-compatible provider:

- `"npm": "@ai-sdk/openai-compatible"`, `"baseURL": "http://localhost:11434/v1"`
  ([opencode.ai/docs/providers](https://opencode.ai/docs/providers)).
- The provider docs' only guidance on context is: "If tool calls aren't working, try increasing
  `num_ctx` in Ollama. Start around 16k–32k" — i.e. set it **in Ollama, not opencode.json**. The
  `limit: {context, output}` field in a model definition informs OpenCode's *own* budgeting/compaction
  thresholds; it does not change what Ollama allocates.

Why `num_ctx` is ignored over `/v1`: the OpenAI-compatible chat-completions body has no `num_ctx`
field, so Ollama's `/v1` route silently drops it; only the native `/api/generate` (`/api/chat`)
`options.num_ctx` honors it. Ollama's own docs state the OpenAI-compat API "does not have a way of
setting the context size for a model … create a Modelfile with the parameter num_ctx and use
`ollama create`" ([docs.ollama.com/api/openai-compatibility](https://docs.ollama.com/api/openai-compatibility)).
[issue #6871](https://github.com/anomalyco/opencode/issues/6871) is the OpenCode feature request asking
to send `num_ctx` for local models — closed as a discussion with no shipped mechanism, confirming
there is no opencode.json path. Community setup guides ([p-lemonish/ollama-x-opencode](https://github.com/p-lemonish/ollama-x-opencode))
independently reach the Modelfile workaround.

Could `chat.params` carry `num_ctx`? Its `options` object flows into provider `options` →
`providerOptions` to the AI SDK (`session/llm/request.ts:114-130, 91`), but since the destination is
the `/v1` chat-completions body, `num_ctx` placed there is still dropped by Ollama's `/v1` route.
INFERENCE: a plugin cannot rescue `num_ctx` over `/v1`; the Modelfile is the real lever. This matches
Construct's `lib/ollama/provision-context.mjs` finding verbatim.

### Q6 — Plugin/agent conventions and community structure

**Plugin API:** the `Hooks` interface enumerated in Q4 (`packages/plugin/src/index.ts:222-335`).
Plugins are a function `(input, options) => Promise<Hooks>`. A plugin may also export custom `tool`
definitions and `auth`/`provider` hooks. Configured via `"plugin": [...]` in opencode.json; loaded from
npm (installed via Bun to `~/.cache/opencode/node_modules`) or local dirs
`.opencode/plugins/` (project) and `~/.config/opencode/plugins/` (global); load order global→project,
dir after config; project plugin name collisions take precedence
([opencode.ai/docs/plugins](https://opencode.ai/docs/plugins)).

**Agents config shape** (`opencode.ai/docs/agents`, `agent/agent.ts:260-278`): per-agent fields
`description` (required), `mode` ("primary" | "subagent" | "all"), `model`, `prompt` (path),
`temperature`, `top_p`, `steps`, `color`, `hidden`, `disable`, `permission` (object; replaces legacy
`tools`), plus pass-through provider `options`. Agents can also be defined as Markdown files in
`.opencode/agent/*.md` (frontmatter + prompt body).

**Community structure** ([awesome-opencode](https://github.com/awesome-opencode/awesome-opencode)):
respected setups separate concerns into `agents/`, `commands/`, `skills/`, `rules/`, and `plugins/`
under `.opencode/`, with MCP servers pre-configured in opencode.json. Notable collections: "Oh My
Opencode" (background agents + LSP/AST/MCP tools + Claude-Code-compatible layer), "Opencode Workspace"
(multi-agent harness), "Micode" (worktree isolation + AST tools), "Opencode Config Starter"
(agents/commands/rules/skills + pre-configured MCP). The convention validates Construct's directory
split; none of the surveyed setups solve per-session tool filtering — they all rely on config-time
agent scoping.

---

## Rubric scores (OpenCode)

Scored 1–5 (5 = strong) against the methodology's six dimensions.

| Dimension | Score | Basis (cited) |
|---|---|---|
| 1. Prompt economy | 3 | All built-in tools + all enabled MCP tools serialize into every agent by default ([#2752](https://github.com/sst/opencode/issues/2752)); the only trim is config-time deny. Compaction/overflow handling exists ([#15298](https://github.com/anomalyco/opencode/issues/15298)). No lazy per-session tool loading. |
| 2. Tool surface design | 3 | Clean built-in set; deny-removes-schema only on blanket deny (`request.ts:198-203`); MCP tools always carry full schemas; no dispatcher/gateway pattern in core; MCP annotations not used to trim. |
| 3. Local-model strategy | 2 | `/v1`-only Ollama path means `num_ctx` is unreachable from config ([#6871](https://github.com/anomalyco/opencode/issues/6871)); guidance is "fix it in Ollama." Built-in GPT/non-GPT tool swap exists but no small-model surface degradation; per-subagent context control is an open request ([#4096](https://github.com/anomalyco/opencode/issues/4096)). |
| 4. Skill/knowledge architecture | 3 | Skills as files + a `skill` tool (`tool/skill.ts`); `instructions`/AGENTS.md concatenated across layers (`config.ts:46-48`); no embedding/retrieval layer in core. |
| 5. Hook/gate philosophy | 4 | Rich, well-typed plugin hook surface (`plugin/src/index.ts:222-335`) covering lifecycle, params, headers, definitions; mostly advisory/transform, permission system is the hard gate. Gap: no tool-set-pruning or model-routing hook (yet — [#18793](https://github.com/anomalyco/opencode/issues/18793)). |
| 6. Test strategy | [unverified] | Not assessed from source in this pass; OpenCode's test layout was not inspected. Flagged for a follow-up if it gates a Construct decision. |

---

## Implications for Construct

Template per methodology §"Per-area document template". File paths are absolute repo paths.

### (a) construct-mcp 7-tool gateway + `construct_call` dispatcher

- **Current.** construct-mcp exposes a lean core tool set in ListTools and routes the long tail behind a
  single `construct_call` meta-tool to keep the serialized schema small
  (`/Users/geralddagher/Developer/Projects/construct/lib/mcp/server.mjs:122, 1220-1268, 1242, 1351-1354`).
  Token sizing for the surface lives in
  `/Users/geralddagher/Developer/Projects/construct/lib/mcp/tool-budget.mjs`.
- **Proposed.** Keep the gateway. It is the correct shape for OpenCode's design.
- **Pros.** OpenCode serializes the full schema of every exposed MCP tool into every agent's window with
  no per-request trim (Q3/Q4); a dispatcher is the only way an MCP server can keep its own footprint
  small. Aligns with the maintainer-endorsed "shrink the surface" posture in [#2752].
- **Cons.** The model cannot see the long-tail tools' individual schemas, so it must learn the
  `construct_call` indirection — a small prompt-comprehension cost, heavier for collapsed small models.
- **Reasoning.** OpenCode has no `chat.params`/`tool.definition` lever to prune tools per session
  (Q4); an MCP server controls its own ListTools, so a gateway is the *only* server-side knob for
  footprint. This is working with OpenCode's grain, not against it.
- **Evidence.** `lib/mcp/server.mjs:122,1220-1268`; OpenCode `packages/plugin/src/index.ts:222-335`
  (no tool-pruning hook); [#2752](https://github.com/sst/opencode/issues/2752).
- **Counter-argument.** For *capable* 14B+/32k models (the decided first-class floor), the gateway's
  indirection may cost more accuracy than the ~few-k tokens it saves; those models could take a flatter
  tool set. The gateway's value concentrates at the collapsed-model end, which is explicitly *not*
  first-class.
- **Falsified-if.** A capable first-class model (qwen3-coder / devstral class) shows materially higher
  task success with a flat tool list than with the gateway at equal context — i.e. the indirection,
  not the token count, is the binding constraint.

### (b) Disabling 5 heavy external MCP servers machine-wide when Ollama models are present

- **Current.** When a local-capable setup is detected, sync writes `enabled:false` into opencode.json
  for `context7, github, memory, sequential-thinking, playwright`
  (`/Users/geralddagher/Developer/Projects/construct/lib/mcp/tool-budget.mjs:8-22`,
  `HEAVY_EXTERNAL_MCP_IDS`), because their schemas (~12k tokens by Construct's estimate) cannot be
  trimmed at runtime and would load into every agent including built-in Build/Plan.
- **Proposed.** Keep disabling-at-sync as the mechanism, but scope the *write* as narrowly as
  OpenCode allows — prefer project-level `.opencode/opencode.json` over the global file where the
  intent is project-scoped, since project config can override global per-server (Q2).
- **Pros.** It is the *only* supported way to drop those schemas in current OpenCode (Q4): no
  per-session filter exists, and `enabled:false` deep-merges cleanly per server (Q2). Directly removes
  the largest fixed cost from the local window.
- **Cons.** "Machine-wide" disabling also strips these servers from any *cloud* session on the same
  machine that might have wanted them — a blunt, host-global side effect. A user running a frontier
  model in another project loses context7/github there too if the write lands in the global config.
- **Reasoning.** OpenCode merges global→project with conflicting keys winning by precedence (Q1), and
  `mcp.<id>.enabled` defaults on and is overridable per server (Q2). Construct can therefore scope the
  disable precisely; a global write is broader than the local-model justification requires.
- **Evidence.** `lib/mcp/tool-budget.mjs:1-22`; OpenCode `mcp/index.ts:449-452` (`enabled===false`);
  `config.ts:40-49,248-249,395`; [opencode.ai/docs/config](https://opencode.ai/docs/config).
- **Counter-argument.** A single global toggle is simpler and matches the common case (one machine,
  mostly-local user); project-scoped writes multiply config files and create drift between projects.
  Simplicity may beat surgical scoping for the actual user base.
- **Falsified-if.** Users routinely mix local and cloud projects on one machine and report losing
  needed external MCP servers in cloud sessions — proving the global blast radius is harmful and the
  project-scoped write is worth the added complexity. (Conversely, falsified the *other* way if no user
  ever runs both modes per machine.)
- **[unverified] flags.** The ~12k-token figure is Construct's internal estimate
  (`tool-budget.mjs` `estimateToolTokens`, `TOKENS_PER_CHAR = 0.25`), reproducible from that helper but
  not corroborated against an actual OpenCode serialized request — mark `[unverified]` until measured
  against a real `tools` payload. The claim "these servers cannot be trimmed at runtime" is **fully
  corroborated** by OpenCode source (Q4).

### (c) Modelfile context variants (`<model>-cx<N>k` via `ollama create`)

- **Current.** For tool-capable Ollama models with no baked `num_ctx`, Construct provisions a context-
  extended variant via `ollama create` with `PARAMETER num_ctx`, because "Ollama's OpenAI-compatible
  `/v1` endpoint has no field for the context window — so `num_ctx` set in opencode.json is silently
  [ignored]" (`/Users/geralddagher/Developer/Projects/construct/lib/ollama/provision-context.mjs:1-14,
  58-70`).
- **Proposed.** Keep it. This is the only correct lever and Construct's stated rationale matches
  OpenCode + Ollama source/docs exactly.
- **Pros.** Directly and fully corroborated: OpenCode uses `@ai-sdk/openai-compatible` against
  `:11434/v1` (Q5), `num_ctx` is undeliverable over `/v1`, and the Modelfile/`ollama create` path is
  Ollama's documented remedy. Construct automates the workaround the community does by hand.
- **Cons.** Creates derived model copies on disk (storage, version drift if base updates); idempotency
  guard mitigates re-creation but not staleness. Variants are invisible to users browsing `ollama list`
  unless they know the `-cx<N>k` convention.
- **Reasoning.** [#6871](https://github.com/anomalyco/opencode/issues/6871) closed without a config
  path; docs say set `num_ctx` "in Ollama"; Ollama docs say use a Modelfile for OpenAI-compat. There is
  no upstream alternative.
- **Evidence.** `lib/ollama/provision-context.mjs:1-14,58-70`;
  [opencode.ai/docs/providers](https://opencode.ai/docs/providers);
  [docs.ollama.com/api/openai-compatibility](https://docs.ollama.com/api/openai-compatibility);
  [#6871](https://github.com/anomalyco/opencode/issues/6871).
- **Counter-argument.** If OpenCode ever ships native-`/api/chat` support or a `num_ctx` pass-through,
  the variant machinery becomes dead weight and a migration cost. Watch the native-LLM runtime
  (`session/llm/native-runtime.ts` exists on `dev`) — if it gains an Ollama-native path, re-evaluate.
- **Falsified-if.** A future OpenCode release honors `options.num_ctx` (or `limit.context`) end-to-end
  against a real Ollama context window over its provider path — at which point the Modelfile variant is
  redundant and should be retired.

---

## Cross-cutting note for synthesis (80-)

Construct's three OpenCode behaviors are each **working with** OpenCode's design, not against it,
*because* OpenCode offers no per-session tool/context lever (Q3/Q4) and no config path to Ollama
`num_ctx` over `/v1` (Q5). The single design tension is *scope*, not *mechanism*: behavior (b) disables
servers more broadly (machine-wide) than the local-model justification strictly needs, and OpenCode's
project>global override semantics (Q1/Q2) would permit a narrower write. Construct's internal
assumptions that could not be corroborated from OpenCode's own docs/source are flagged inline:
the ~12k-token estimate `[unverified]`, and the SDK-permission-bypass caveat `[unverified]` for
Construct's path.

## Sources

- [opencode.ai/docs/config](https://opencode.ai/docs/config)
- [opencode.ai/docs/mcp-servers](https://opencode.ai/docs/mcp-servers)
- [opencode.ai/docs/agents](https://opencode.ai/docs/agents)
- [opencode.ai/docs/providers](https://opencode.ai/docs/providers)
- [opencode.ai/docs/plugins](https://opencode.ai/docs/plugins)
- OpenCode source (`dev`): `packages/opencode/src/config/config.ts`, `.../mcp/index.ts`,
  `.../session/llm/request.ts`, `.../permission/index.ts`, `.../session/tools.ts`,
  `.../session/prompt.ts`, `.../tool/registry.ts`, `.../agent/agent.ts`, `packages/plugin/src/index.ts`
  — via `github.com/sst/opencode`
- Issues: [#2752](https://github.com/sst/opencode/issues/2752),
  [#4096](https://github.com/anomalyco/opencode/issues/4096),
  [#6396](https://github.com/sst/opencode/issues/6396),
  [#6871](https://github.com/anomalyco/opencode/issues/6871),
  [#15298](https://github.com/anomalyco/opencode/issues/15298),
  [#18793](https://github.com/anomalyco/opencode/issues/18793)
- [docs.ollama.com/api/openai-compatibility](https://docs.ollama.com/api/openai-compatibility)
- [github.com/awesome-opencode/awesome-opencode](https://github.com/awesome-opencode/awesome-opencode),
  [github.com/p-lemonish/ollama-x-opencode](https://github.com/p-lemonish/ollama-x-opencode)
