# Source register

| Source | Retrieved | Claim used | Consequence |
|---|---|---|---|
| This repository at `d8171157` | 2026-09-20 | Audit baseline identical to checkout | Work from current tree, not a replay |
| `bd --version` 1.0.3 embedded Dolt | 2026-09-20 | Live tracker is Dolt, not JSONL | Backup must use backend export |
| https://modelcontextprotocol.io/docs/sdk | 2026-09-20 | Official TS SDK exists | Custom JSON-RPC retained until a supported release is locked |
| `@modelcontextprotocol/server` 2.0.0 (MIT, Node >=20, deps: core + zod) | 2026-09-20 | v2 is the stable stdio line; `serializeMessage` is newline JSON-RPC; `registerTool` requires Zod v4 Standard Schema | Locked 2.0.0 for stdio framing only. Domain tool JSON Schema stays in Construct. v1 SDK rejected for express/hono/cors dependency tree. v2 `McpServer.registerTool` rejected because it would duplicate Construct validation in Zod. |
| https://agentskills.io/specification | 2026-09-20 | Portable SKILL.md | Construct manifest stays additive |
| Node engines `>=22.18.0` in package.json | 2026-09-20 | Floor is 22.18 | Session runtime v24.19.0 is supported |

Primary references listed in the mandate were treated as locations, not as
a requirement to re-survey the market.
