# ADR-0095: Migrate the Jira governed-write adapter off deprecated createmeta and search endpoints; flag token-expiry exposure

- **Date**: 2026-07-16
- **Status**: proposed
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-4uxq0.4.15` (ADR-O: Jira API migration plan)

## Problem

The Jira governed-write adapter calls two Jira Cloud REST v3 endpoints Atlassian has deprecated:

- `GET /rest/api/3/issue/createmeta` — `lib/providers/contract/adapters/jira/transport.mjs:70`
- `POST /rest/api/3/search` — `lib/providers/contract/adapters/jira/transport.mjs:105`

The second of these is not merely deprecated but now returns `410 Gone` for Jira Cloud tenants (see Context — this session's live re-check strengthens the audit's original "many tenants" finding to "effectively all Cloud tenants now"). The adapter also authenticates with a static, long-lived API token and has no logic anywhere that checks or surfaces token expiry, against a backdrop where Atlassian now enforces mandatory 1-year token expiry — including retroactively on tokens that predate the policy.

## Context

**Audit findings carried forward** (bead `construct-4uxq0.4.15`, WP1, 2026-07-16; sources: `community.developer.atlassian.com/t/create-issue-meta-endpoint-deprecation/75413`, `docs.adaptavist.com/sr4jc`, `developer.atlassian.com/cloud/jira/platform/changelog/`):

- `createmeta` deprecated June 2024, no firm sunset date ("borrowed time" per Atlassian staff).
- `search` deprecated Oct 2024, shutdown ramp Aug–Oct 2025, "many tenants now get 410 Gone."
- Jira API tokens: mandatory 1-year expiry for new tokens from 2024-12-15, applied retroactively to pre-existing tokens as of 2025-03-13.

**Independently re-verified live via WebSearch this session (2026-07-16)** — both load-bearing claims hold up, and the search-endpoint and token-expiry claims sharpen into something more urgent than the audit's original phrasing:

- `search` removal: current Atlassian Community threads, an AWS re:Post Jira-connector issue, an AWS Q Business connector issue, a Strategy.com KB article, and an `atlassian/atlassian-mcp-server` GitHub issue (#70, filed against Atlassian's own MCP server) all report the same thing — `POST /rest/api/3/search` (and the `/2` and `/latest` equivalents) now returns `410 Gone` with the message *"The requested API has been removed. Please migrate to the API /rest/api/3/search/jql."* This is no longer a partial, ramping rollout as the audit found it — it now reads as fully removed on Jira Cloud. (One source dates full removal to 2025-05-01; this doesn't reconcile cleanly with the audit's "Aug–Oct 2025" ramp date, but every independently-checked source agrees on the end state: removed, 410, migrate to `search/jql`.)
- `createmeta` deprecation: unchanged from the audit. Atlassian Community and a `go-atlassian` GitHub issue confirm deprecation dated June 6, 2024, migration path `GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes` and `.../issuetypes/{issueTypeId}`, and no announced removal date — still "borrowed time."
- Token expiry: confirmed, and the exact dates matter more than the audit's phrasing suggested. Per Atlassian Community ("API tokens will now have a maximum one-year expiry"): tokens created **after** 2024-12-15 get a max 1-year expiry at creation. Tokens created **before** 2024-12-15 became subject to the same 1-year cap starting 2025-03-13, and Atlassian's own support docs state these pre-existing tokens expire **between 2025-03-14 and 2026-05-12**. Today is 2026-07-16 — that entire retroactive-expiry window has already closed. Any Construct deployment still authenticating with a pre-Dec-2024 Jira token would already be hitting `401`s, indistinguishable in the current adapter from a bad-credentials misconfiguration.

**Codebase state** (grep `createmeta\|rest/api/3/search` across `lib/`, `2026-07-16`) — four independent Jira integrations exist at different migration states, only one of which is the scope of this ADR:

| File | Endpoint(s) | Migrated? | In scope here? |
|---|---|---|---|
| `lib/providers/contract/adapters/jira/transport.mjs:70` (`fetchCreatemeta`) | `GET /rest/api/3/issue/createmeta` | No | **Yes** — governed-write adapter, the 408a split target |
| `lib/providers/contract/adapters/jira/transport.mjs:105` (`searchIssues`) | `POST /rest/api/3/search` | No | **Yes** |
| `lib/providers/contract/adapters/jira/index.mjs:150` (`search`) | `POST /rest/api/3/search` | No | No — separate, older provider implementation living in the same directory; not part of the governed-write path `governed-write.mjs` actually calls |
| `lib/providers/atlassian-jira/index.mjs:91` (`search`) | `POST /rest/api/3/search` | No | No — separate read/search-only data-source provider |
| `lib/embed/providers/jira.mjs:78` (`#listIssues`) | `POST /rest/api/3/search/jql` | **Yes** | N/A — already migrated; useful in-repo precedent that the migration is mechanically straightforward |

All four implementations use the same auth shape — `Basic ${email}:${token}` built from `JIRA_EMAIL`/`JIRA_TOKEN` (or `JIRA_API_TOKEN` in the `atlassian-jira` variant) env vars, set once at adapter construction. `grep -rn "expiry\|expires\|rotat"` across all Jira adapter files returns no hits outside this ADR's own prose — there is no expiry-checking, expiry-warning, or rotation logic anywhere today. A token nearing or past its Atlassian-side expiry fails silently into the adapter's generic `AuthError('Jira authentication failed... Check JIRA_EMAIL / JIRA_TOKEN.')` path (`lib/providers/contract/adapters/jira/governed-write.mjs:169`), which reads identically whether the token is wrong or simply expired.

**ADR-F dependency**: this ADR's parent bead depends on `construct-4uxq0.4.6` (ADR-F: provider certification ladder). As of this writing `docs/decisions/adr/0090-provider-certification-ladder.md` does not yet exist in this repo — it is being drafted in parallel by a sibling agent. This ADR's content does not depend on ADR-F's exact ladder shape: the Jira migration described here is the concrete case study that motivated ADR-F's evidence-ladder question (what does "verified" mean for a provider adapter claim), not a downstream consumer of its output. Proceeding independently; a future edit can add a cross-reference once `0090` lands.

## Decision

1. **Migrate the governed-write adapter's two deprecated calls.**
   - `lib/providers/contract/adapters/jira/transport.mjs:64-71` (`fetchCreatemeta`): replace the single `GET /rest/api/3/issue/createmeta?projectKeys=X&issuetypeNames=Y&expand=projects.issuetypes.fields` call with the two-call sequence `GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes` (resolve issue type ID by name) followed by `GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}` (fetch that type's field metadata). `createmeta.mjs`'s `extractIssueTypeMeta` normalizer will need its input-shape assumptions revisited against the new response shape.
   - `lib/providers/contract/adapters/jira/transport.mjs:103-115` (`searchIssues`): replace `POST /rest/api/3/search` with `POST /rest/api/3/search/jql` (or `GET`), passing an explicit `fields` array (the new endpoint has no default field return) and switching pagination from `startAt`/`total` to the cursor-based `nextPageToken` — `lib/embed/providers/jira.mjs:78` is a working in-repo example of the same call shape.
2. **Flag the token-expiry exposure; do not build a rotation mechanism in this ADR.** Document in the adapter (module header + operator-facing docs) that `JIRA_TOKEN` is subject to Atlassian's mandatory 1-year expiry and that the adapter currently cannot distinguish an expired token from a wrong one. A concrete rotation or expiry-warning mechanism is deferred to the implementation bead's discretion or a future bead — this ADR's decision is limited to *surfacing* the gap, not closing it.
3. **Scope this decision to the governed-write adapter only.** `lib/providers/contract/adapters/jira/index.mjs:150` and `lib/providers/atlassian-jira/index.mjs:91` also call the deprecated `search` endpoint but are not part of the 408a governed-adapter split; they are flagged here as related follow-up work, not folded into this migration.

## Rationale

The `search` endpoint isn't a future risk to plan around — independently-verified live evidence shows it is already returning `410 Gone` on Jira Cloud, meaning the governed-write adapter's `searchIssues` path is already broken for tenants who've had it shut off, not merely "at risk." `createmeta` has no removal date, but "borrowed time" with no commitment from Atlassian is exactly the situation where proactive migration is cheaper than waiting to be broken by surprise, and the same directory (`lib/embed/providers/jira.mjs`) already proves the target shape works. On token expiry: the retroactive-expiry window Atlassian announced (tokens created before 2024-12-15 expire between 2025-03-14 and 2026-05-12) has already fully elapsed as of today, 2026-07-16 — this is not a forward-looking risk either, it is a plausible-today failure mode for any deployment still on a legacy token, and the adapter has zero visibility into it. Flagging costs nothing; building rotation is a separate, larger decision this ADR should not smuggle in.

## Rejected alternatives

- **Wait for a firm `createmeta` sunset date before migrating.** Rejected: no such date exists or is coming ("borrowed time" is the whole characterization), and the sibling `search` endpoint shows what "wait and see" costs once Atlassian actually pulls the trigger — some tenants are already at `410 Gone` today.
- **Build full token-lifecycle/rotation handling in this ADR.** Rejected as scope creep for an endpoint-migration decision; expiry gets a flag and a documentation update here, with rotation left to a separate bead/decision.
- **Migrate all four Jira integrations in one pass.** Rejected: only `lib/providers/contract/adapters/jira/transport.mjs` is the 408a governed-adapter split target this bead and its blocking implementation bead (`construct-4uxq0.13.1`) are scoped to. Migrating the other two `search` call sites is real, correct follow-up work, but bundling it here would make this ADR's Decision no longer map 1:1 to the implementation bead it unblocks.

## Consequences

- **Positive**: closes an already-live breakage path (`search` returning `410 Gone`) rather than a hypothetical one; migrates off a second endpoint before its inevitable removal instead of after; surfaces a previously-invisible auth-failure mode (token expiry) that had no operator-facing signal at all.
- **Negative / cost**: the two-call `createmeta` → `issuetypes` sequence adds a network round-trip and changes `createmeta.mjs`'s response-shape assumptions, requiring test-double updates in `tests/fakes/fake-jira.mjs` (not touched by this ADR). The `search/jql` endpoint's mandatory explicit `fields` array means every current implicit-field caller needs an explicit audit to avoid silently losing fields it used to get by default. The token-expiry flag creates an acknowledged, unresolved gap — operators get documentation, not tooling — until a follow-up bead addresses it.
- **Follow-up**: unblocks `construct-4uxq0.13.1` (the implementation bead: replace deprecated `createmeta` + `search` endpoints). Related but explicitly out-of-scope follow-up: migrate `lib/providers/contract/adapters/jira/index.mjs:150` and `lib/providers/atlassian-jira/index.mjs:91` off `POST /rest/api/3/search`, and decide on a token-expiry check/rotation mechanism.

## Reversibility

High: isolated to the adapter's transport layer (`transport.mjs`, `createmeta.mjs`). No schema, storage, or cross-adapter contract changes. If Atlassian were to reverse a deprecation (historically rare but not unheard of), reverting the transport calls is a small, self-contained diff.

## References

- Bead `construct-4uxq0.4.15` (ADR-O), parent `construct-4uxq0.4` (WP4), blocks `construct-4uxq0.13.1`, depends on `construct-4uxq0.4.6` (ADR-F — not yet drafted as of this writing)
- `lib/providers/contract/adapters/jira/transport.mjs:64-71,103-115` (deprecated calls in scope)
- `lib/providers/contract/adapters/jira/createmeta.mjs`, `lib/providers/contract/adapters/jira/governed-write.mjs:169` (auth-failure path with no expiry distinction)
- `lib/embed/providers/jira.mjs:78` (in-repo precedent already on `search/jql`)
- `lib/providers/contract/adapters/jira/index.mjs:150`, `lib/providers/atlassian-jira/index.mjs:91` (related, out-of-scope `search` call sites)
- Audit-sourced, not independently re-verified beyond what's noted above: exact Oct 2024 announcement date and Aug–Oct 2025 ramp-schedule granularity for the `search` deprecation (`community.developer.atlassian.com/t/create-issue-meta-endpoint-deprecation/75413`, `docs.adaptavist.com/sr4jc`, `developer.atlassian.com/cloud/jira/platform/changelog/`)
- Independently re-verified live this session (2026-07-16): `community.atlassian.com/forums/Jira-questions/why-HTTP-410-Errors-from-rest-api-3-search-error/qaq-p/3109922`; `github.com/atlassian/atlassian-mcp-server/issues/70`; `community.strategy.com/article/KB489535`; `repost.aws/questions/QU72Z7DJTyRtiZsrwIZ7evYw` (search-endpoint removal); `community.atlassian.com/forums/Jira-articles/API-tokens-will-now-have-a-maximum-one-year-expiry/ba-p/2880029`; `support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/` (token expiry policy and dates); `community.developer.atlassian.com/t/create-issue-meta-endpoint-deprecation/75413`; `github.com/ctreminiom/go-atlassian/issues/319` (createmeta deprecation, unchanged from audit)
