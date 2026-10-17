# Codex CLI 0.163.0 held-text reviewer: schema qualification

Recorded 2026-10-17 for work-32615d2f, branch `codex/reviewer-0163`.
Status: local compatibility accepted with controls; live qualification pending the lead's run.

## Verdict and boundary

Move the startup version pin from `codex-cli 0.145.0` to `codex-cli 0.163.0` and name the adapted profile `codex-app-server-held-text-v2`. The request shapes and isolation acknowledgments used by held-text review remain compatible. New async delivery, questions, and partial answers require explicit refusal, rather than being treated as ordinary final text. Unknown methods and item kinds still fail closed.

Strongest failure mode: a newly introduced agent-message delivery or phase could be mistaken for the judgment, or a newly emitted operation could invalidate the bounded protocol assumptions. Best alternative: retain 0.145.0 until a live qualification. Decision: accepted with controls for this local change. Reject the new message forms, preserve all isolation checks, give the adapter a distinct profile, and require the lead's live run before claiming runtime qualification. A schema cannot establish runtime event ordering, isolation enforcement, or model behavior.

The intended user-visible outcome is that the native reviewer accepts 0.163.0 for one isolated held-text review and refuses unsupported protocol activity. Only the startup pin and synthetic transport behavior were observed here; the live outcome is **not proven**.

## Sources and comparison method

The supplied primary sources are the generated JSON Schema trees under:

- `/private/tmp/claude-501/-Users-geralddagher-Developer-Projects-construct/a19e665f-c025-4655-91ac-4bc8a9214412/scratchpad/schema/0.145`
- `/private/tmp/claude-501/-Users-geralddagher-Developer-Projects-construct/a19e665f-c025-4655-91ac-4bc8a9214412/scratchpad/schema/0.163`

Both are supplied outputs of `codex app-server generate-json-schema`. Local version-only execution observed `codex-cli 0.145.0` from the supplied pinned launcher and `codex-cli 0.163.0` from the installed binary. No network, model turn, or live app-server review was run.

Comparison parsed JSON, ignored object ordering and presentation-only schema titles, compared alternatives and required/enum sets independent of order, and traversed referenced definitions from every used request, response, and accepted notification. Descriptions were separately compared with variants matched by discriminator, so inserting `partial_answer` cannot make a shifted array index look like a changed `final_answer`. Defaults, required properties, unions, discriminators, and semantic description changes were retained. The method inventories were compared across `ClientRequest`, `ClientNotification`, `ServerRequest`, and `ServerNotification`; RPC envelopes and error definitions were also checked. This is a semantic comparison, not a textual diff.

The implementation boundary is `src/hosts/semantic-review.ts` (pin, isolation arguments, dispatch), `src/hosts/semantic-review-app-server.ts` (finite transport), and the release scripts consuming the identity and public transcript. No kernel schema or stored record format changes are needed; the profile is an existing string field. Existing tests and transport were extended; no new dependency or reusable utility was introduced. Repository searches found the original transport and fixtures, so no replacement implementation was built.

## Sent requests and their responses

| Operation / schema | Change in 0.163.0 | Reviewer effect |
| --- | --- | --- |
| `initialize`: `v1/InitializeParams` | Capabilities add optional `explicitGatewayOauth` and nullable `extensions` map. `mcpServerOpenaiFormElicitation` is now described as a legacy opt-in, with `extensions` preferred. | Compatible. Continue sending only client identity and `experimentalApi: true`; neither new capability is enabled. Every server request, including authentication and elicitation, remains refused. |
| `v1/InitializeResponse` | No structural change, including its referenced types. | Compatible. Existing object acknowledgment check stays. |
| `initialized`: `ClientNotification` | The sole client notification and its shape are unchanged. | Compatible; still sent without params after initialization. |
| `thread/start`: `v2/ThreadStartParams` | No structural or description change in the request or its referenced definitions. | Exact existing request remains: model, cwd, `approvalPolicy: 'never'`, `sandbox: 'read-only'`, `ephemeral: true`. |
| `v2/ThreadStartResponse` | Adds `disabledPluginIds`, default `[]`. Its `Thread` adds nullable `model`, `originator`, `projectId`, `reasoningEffort`, `section`, `sectionEnteredAt`, plus `historyMode` default `legacy`. `projectId` is newly required (but nullable); the other additions are not required. | Compatible additive metadata. The reviewer uses the existing returned identity and policy fields and ignores these additions. `section` references new section/appearance records. Nested turn/item changes are covered below. |
| Isolation definitions | `AskForApproval`, `SandboxPolicy`, and their referenced types are structurally unchanged. `readOnly.networkAccess` remains a boolean defaulting to false. | The reviewer still requires an **explicit** returned `networkAccess === false`, `sandbox.type === 'readOnly'`, `thread.ephemeral === true`, matching model/cwd/thread, and `approvalPolicy === 'never'`. A schema default does not replace an acknowledgment. |
| `thread/inject_items`: `v2/ThreadInjectItemsParams` | Unchanged: required thread ID and array of arbitrary raw Responses API JSON items. | Exact single user `message` with one `input_text` is unchanged. The raw item's internal semantics are not described by this schema; exact staging at runtime remains a live-check obligation. |
| `v2/ThreadInjectItemsResponse` | Unchanged empty-object response. | Existing non-null, non-array, empty-object acknowledgment remains required before any turn. |
| `turn/start`: `v2/TurnStartParams` | Adds optional nullable `disabledPluginIds`, `parentTurnId`, `rootTurnId`, `serviceTierForTurn`, `toolOutput`, `turnTrigger`. `toolOutput` references new `TurnToolOutput` and function-output types. Image input now permits `fileId` or URL instead of requiring URL. Personality is described as deprecated and no longer selecting a style. | None is sent. The existing single text directive, model, `approvalPolicy: 'never'`, and `sandboxPolicy: { type: 'readOnly', networkAccess: false }` remain unchanged, as does optional `outputSchema`. Text input is unchanged; no image or tool-output branch is admitted. |
| `v2/TurnStartResponse` | Wrapper unchanged; referenced `Turn` adds nullable `rootTurnId`. Error and nested item changes below. | Existing nonempty ID, `inProgress`, items array, explicit null error, and agreement with observed turn ID remain required. No turn chaining is requested. |
| RPC success / error envelopes | `JSONRPCResponse`, `JSONRPCError`, `JSONRPCErrorError`, and request IDs unchanged. | Exactly one result/error and a pending request ID remain required. Integer error code and string message are required; RPC error always stops the run. Message contents stay withheld, except the existing bounded capacity category. |

The complete `thread/start` request/acknowledgment-validation block and the complete `turn/start` request/acknowledgment-validation block were compared with `HEAD` and are byte-identical. Feature disabling, MCP inventory/disable checks, provider/authentication controls, exact evidence staging, byte limits, timeouts, identity fencing, and transcript admission are unchanged.

## Accepted notifications and shared payload types

| Notification / shared type | Change | Reviewer effect |
| --- | --- | --- |
| `thread/started` | Envelope unchanged; referenced `Thread` additions described above. Thread description removes `thread/rollback` from the operations populating turns. | Still accepted only once during startup with a nonempty matching thread ID. No rollback/history operation is used. |
| `turn/started`, `turn/completed` | Envelopes unchanged; `Turn.rootTurnId` added. `Turn.error` description now covers failed **or interrupted** turns. ID, items, status and status enum are unchanged. | Existing phase and identity fencing remain. Completion requires the final message, matching turn, `completed` status, and no error. Failed/interrupted turns cannot qualify. |
| `item/started`, `item/completed`: `userMessage` | Envelope and text input unchanged; image input adds file-ID support as above. | Only one text content entry exactly equal to the bounded review directive is admitted. Other content fails. |
| Same notifications: `agentMessage` | Adds nullable/default-null `delivery` (`async` is the sole non-null value), nullable/default-null `questions` array, and the `partial_answer` phase. Questions reference `AsyncUserInputQuestion`, with required title and nullable string options. `final_answer` is now described as the assistant's *declared* terminal answer; absent/null phase still means unknown. | **Adapted in v2:** reject any non-null delivery, any non-null questions (including an empty array), and every non-null phase except the previously known `commentary` / `final_answer`. Missing/null fields retain compatibility. No questions are answered. Even declared final text still needs the existing ordered `turn/completed`; tools, additional final items and unsupported activity fail. |
| Same notifications: `reasoning` | No structural change. | Discarded unread for the current turn and valid phase; not retained as evidence or judgment. |
| `item/agentMessage/delta` | Unchanged. | Still accepted only during the turn, for the current thread/turn and already-started final item, with string delta. Text is taken from the completed item, not concatenated deltas. |
| `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`, `item/reasoning/summaryPartAdded` | All three schemas unchanged. | Existing current-thread/current-turn and turn/final phase checks stay. Contents are discarded unread and unrecorded; raw bytes still count. |
| `turn/moderationMetadata` | Unchanged: required `threadId`, `turnId`, and `metadata: true` (arbitrary JSON). | No inference about metadata contents is justified. Existing identity/order checks and unread discard remain byte-identical. Oversized metadata consumes the raw byte bound. |
| `remoteControl/status/changed` | Unchanged, including referenced types. | Existing passive metadata handling; no control request is sent. |
| `thread/status/changed` | Unchanged, including referenced types. | Existing passive handling and cross-thread refusal remain. |
| `thread/tokenUsage/updated` | Unchanged, including referenced types. | Ignored passive metadata under the existing thread check. |
| `account/rateLimits/updated` | `RateLimitSnapshot` adds nullable `normalModelSlug`; `PlanType` adds `edu_plus`, `edu_pro`, `ent26`, `enterprise_cbp_automation`, `promax`, `self_serve_business_prolite`. | Compatible ignored metadata; no scheduling, retry, or permissions derive from it. |
| `skills/changed` | Unchanged empty-object schema. | Existing exception accepts only a non-null, non-array empty object. Nonempty/null/array payloads still fail. |
| `warning` | Unchanged. | Only the existing model-metadata fallback warning pattern is recorded, with existing redaction/bound; every other warning is refused. Schema compatibility does not prove which warnings 0.163.0 actually emits. |
| `error` and `TurnError` | Error notification wrapper unchanged. `TurnError` adds nullable/default-null `misalignment`, including optional detailed explanation, error type, review target and steer message. `CodexErrorInfo` changes from a closed `oneOf` to `anyOf` with a catch-all string/object branch, adding named values `flexUnavailable`, `misalignmentPolicyViolation`, `rateLimitExceeded`, `tooManyDenials`. | Error notifications remain refused; no expanded error/steer content is acted on or retained. Turn-start acknowledgment still requires null error; completion still requires no error. Unknown error kinds cannot grant assurance. |

The nested item additions also occur inside `Thread` and `Turn` response/event snapshots. The adapter does not execute or derive permission from those snapshots; its existing item-event and terminal checks remain authoritative. This change does not introduce whole-schema validation or broaden snapshot trust.

## Refused item branches

`ThreadItem` adds `functionCallOutput`, with ID, name, optional namespace and output. Function output can be a string or a list of input-text, input-image, input-audio or encrypted-content parts. It is refused at item dispatch, without reading the output. Its finite name is added only to refusal diagnostics.

Existing refused branches gain these fields/values:

- `commandExecution`: nullable/default-null `pluginId`, `scriptPath`. Referenced read `CommandAction.path` changes from `AbsolutePathBuf` to `LegacyAppPathString` (both schema strings; the latter lacks the absolute-path guarantee).
- `mcpToolCall`: nullable `mcpAppUi` (resource URI and inline/fullscreen display mode) and `readOnlyHint`. `mcpAppResourceUri` documentation now points to the new UI resource field.
- `subAgentActivity`: nullable model and reasoning effort; activity kind adds `completed`.
- Collaboration tool kinds add `followupTask`, `interruptAgent`, `listAgents`, `sendMessage`; collaboration status adds `interrupted`.
- `imageGeneration`: nullable/default-null `failure` (usage-limit details) and `transparentBackground`.

All remain refused regardless of payload or a read-only hint. The unchanged refused item branches are `hookPrompt`, `plan`, `dynamicToolCall`, `webSearch`, `imageView`, `sleep`, `enteredReviewMode`, `exitedReviewMode`, and `contextCompaction`. Every future/unrecognized item type is refused and its arbitrary name is withheld from diagnostics.

## Unknown and unsupported operation inventory

The notification union grows from 70 to 85 methods; none is removed. All 15 additions remain **refused**, not passive or private exceptions. Their finite names are added only to diagnostic labeling:

- `account/gatewayOAuth/changed`
- `autoApprovalReview/strictReviewRequired`
- `mcpServer/event/stream/notification`
- `modelProvider/authRecoveryCompleted`
- `modelProvider/authRecoveryStarted`
- `project/changed`
- `thread/attachment/updated`
- `thread/prediction/updated`
- `thread/project/updated`
- `thread/queue/changed`
- `thread/readState/changed`
- `thread/realtime/item/completed`
- `thread/realtime/item/started`
- `thread/realtime/item/transcript/delta`
- `thread/reverted`

The existing notifications outside the accepted conditional branches above also remain refused, regardless of any payload-schema changes:

- `account/login/completed`
- `account/updated`
- `app/list/updated`
- `command/exec/outputDelta`
- `configWarning`
- `deprecationNotice`
- `error`
- `externalAgentConfig/import/completed`
- `externalAgentConfig/import/progress`
- `fs/changed`
- `fuzzyFileSearch/sessionCompleted`
- `fuzzyFileSearch/sessionUpdated`
- `guardianWarning`
- `hook/completed`
- `hook/started`
- `item/autoApprovalReview/completed`
- `item/autoApprovalReview/started`
- `item/commandExecution/outputDelta`
- `item/commandExecution/terminalInteraction`
- `item/fileChange/outputDelta`
- `item/fileChange/patchUpdated`
- `item/mcpToolCall/progress`
- `item/plan/delta`
- `mcpServer/oauthLogin/completed`
- `mcpServer/startupStatus/updated`
- `model/rerouted`
- `model/safetyBuffering/updated`
- `model/verification`
- `process/exited`
- `process/outputDelta`
- `serverRequest/resolved`
- `thread/archived`
- `thread/closed`
- `thread/compacted`
- `thread/deleted`
- `thread/environment/connected`
- `thread/environment/disconnected`
- `thread/goal/cleared`
- `thread/goal/updated`
- `thread/name/updated`
- `thread/realtime/closed`
- `thread/realtime/error`
- `thread/realtime/itemAdded`
- `thread/realtime/outputAudio/delta`
- `thread/realtime/sdp`
- `thread/realtime/started`
- `thread/realtime/transcript/delta`
- `thread/realtime/transcript/done`
- `thread/settings/updated`
- `thread/unarchived`
- `turn/diff/updated`
- `turn/plan/updated`
- `windows/worldWritableWarning`
- `windowsSandbox/setupCompleted`

All 10 server-request methods remain refused before payload handling, and their method inventory is unchanged:

- `account/chatgptAuthTokens/refresh`
- `applyPatchApproval`
- `attestation/generate`
- `execCommandApproval`
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/call`
- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`

The client request union changes from 89 to 105 methods: `thread/rollback` is removed and the following 17 methods are added. None is sent by the reviewer. Any unsolicited incoming request carrying an ID is refused, even if its method is otherwise familiar. Any unsupported notification, including a client method incorrectly sent as a notification, is refused. Changes inside refused payloads therefore cannot widen authority.

- `account/gatewayOAuth/cancel`
- `account/gatewayOAuth/login`
- `account/gatewayOAuth/read`
- `externalAgentConfig/import/recordHistory`
- `plugin/reconcile`
- `thread/attachment/add`
- `thread/attachment/list`
- `thread/attachment/remove`
- `thread/attachmentOwner/list`
- `thread/items/list`
- `thread/revert`
- `thread/section/move`
- `thread/turns/list`
- `threadSection/create`
- `threadSection/delete`
- `threadSection/list`
- `threadSection/update`

The notification envelope's optional `emittedAtMs` timestamp is unchanged and is not used as an authority or ordering source. Unknown operation names remain replaced with `unrecognized` in diagnostics. Existing diagnostic names do not constitute an acceptance list.

## Files changed

- `src/hosts/semantic-review.ts`: version pin, v2 profile identity and dispatch.
- `src/hosts/semantic-review-app-server.ts`: v2 message refusal and finite diagnostic names; isolation validation unchanged.
- `scripts/release-gate.mjs`: 0.163.0 and v2 release-evidence admission/staging checks.
- `scripts/experimental-live.mjs`: version/profile limitation disclosure.
- `tests/hosts/semantic-review.test.ts`: current-version fake executable fixtures.
- `tests/hosts/semantic-review-app-server.test.ts`: synchronous compatibility and refusal of new message forms, all added notifications, function output, failed/interrupted turns and error-bearing completion; private contents stay withheld.
- `tests/scripts/release-gate.test.ts`: current version/profile fixtures and explicit old-version/profile rejection.
- `tests/kernel/workflow/semantic-progress.test.ts`: current-version identity fixture.
- `tests/kernel/workflow/semantic-lifecycle.test.ts`: current-version fake executable fixture.
- This schema-diff record.

Historical release evidence and dated observations remain historical. No changes were made to `src/kernel/broker/tools.ts`, `workflows/`, or git metadata. Construct MCP was not used; the lead retains the claim.

## Local validation

```text
Check:    Repository lint and policy checks
Command:  npm run lint
Result:   pass
Observed: Biome checked 388 files with no fixes; all chained policy/generated-file checks passed.

Check:    Type checking
Command:  npm run typecheck
Result:   pass
Observed: tsc --noEmit exited 0 with no diagnostics.
```

These were run together as requested: `npm run lint && npm run typecheck`.

```text
Check:    Semantic reviewer host tests and affected release/lifecycle fixtures
Command:  node --test tests/hosts/semantic-review.test.ts tests/hosts/semantic-review-app-server.test.ts tests/scripts/release-gate.test.ts tests/kernel/workflow/semantic-progress.test.ts tests/kernel/workflow/semantic-lifecycle.test.ts
Result:   pass
Observed: 44 tests, 44 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo (0 suites).
```

The host subset is exactly **16 tests** (7 stream/pin tests and 9 app-server tests). The additional affected fixtures contribute **28 tests**. Scenarios looped within a test are not counted as separate tests. The host-only command `node --test tests/hosts/semantic-review.test.ts tests/hosts/semantic-review-app-server.test.ts` also passed 16/16 before the final additional error scenarios; the final combined run covers those scenarios too.

```text
Check:    Whitespace and patch review
Command:  git diff --check
Result:   pass
Observed: No whitespace errors. Read-only git diff review confirmed the scoped changes.

Check:    Full suite, packaged smoke and live review
Command:  npm test; npm run smoke; npm run release:live
Result:   not run
Observed: Outside the requested local check scope; live review expressly reserved for the lead, with no network allowed here.
```

Local version-only pin probes also observed the installed 0.163.0 binary admitted as `codex-app-server-held-text-v2`, and the supplied 0.145.0 binary rejected. A read-only comparison with `git show HEAD:src/hosts/semantic-review-app-server.ts` proved both complete thread-start and turn-start request/validation blocks byte-identical to the originals.

```text
Outcome:  The native reviewer accepts 0.163.0 for one isolated held-text review and refuses unsupported protocol activity.
Surface:  Startup pin plus synthetic app-server peer; live surface not exercised.
Data:     Installed/pinned binaries for version-only probes; exact held-text and adversarial protocol fixtures for transport tests.
Observed: 0.163.0 pins v2, 0.145.0 is unavailable, synchronous transport succeeds and unsupported forms fail without retaining private payloads.
Verdict:  not proven: native live event ordering, effective runtime isolation and review judgment require the lead's live run.
```

Verification record
- Project inspected: answered: see Sources and comparison method ("pin, isolation arguments, dispatch").
- Reuse checked: answered: see Sources and comparison method ("Existing tests and transport were extended").
- Validation path run: answered: see Local validation ("44 tests, 44 passed, 0 failed"). The explicitly requested scoped checks were run; full suite and smoke were not.
- Outcome observed: not proven: see the outcome block; the live review is reserved for the lead.
- Surface inspected: not applicable: no visible interface; native protocol surface remains unproven live.
- Diff reviewed: answered: see Local validation ("both complete thread-start and turn-start request/validation blocks byte-identical").
- Residual risk: actual 0.163.0 may emit new/refused events or warnings, order events differently, fail native staging, or differ in effective isolation; the lead's live controls must settle those runtime questions. No live qualification is claimed by this record.
