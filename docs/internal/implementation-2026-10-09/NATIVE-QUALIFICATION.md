# Executed skill qualification

A command that prints passing cases establishes that a grader ran. It does not establish the claimed host/model, fresh production, method application or independent review. Such `skill evaluate` records now carry `executed_evaluator_report` assurance and remain experimental.

A suite can opt into the explicit native Codex adapter with `native: {"adapter":"codex"}` and `host: "codex"`. Every predetermined case also supplies:

```json
{
  "native": {
    "prompt": "Check the claim against the supplied records and save analysis.md.",
    "files": [{"from":"fixtures/record.json","to":"record.json"}],
    "outputs": ["analysis.md"],
    "rubric": "fixtures/held-out-rubric.txt"
  }
}
```

The existing suite identity, version, scope, host/model, six coverage kinds, multiple domains and per-case checks remain required. `verifier.argv` can contain the literal argument `@native-results`; the adapter replaces that argument with its own observed result file. The explicit deterministic verifier still runs and every required check must pass.

The adapter snapshots corpus/rubric/skill bytes before production, uses fresh temporary workspaces, provides only case inputs plus the selected skill bundle to producers, refuses prepopulated outputs and unsafe files, and creates a separate reviewer workspace after production. Reviewers receive the held source bytes, produced artifacts, method and held-out rubric, without the producer conversation. Source and artifact contents remain untrusted data. Each actual native process provides a session identifier, invocation/transcript digest, exit/timeout and elapsed time. The record retains the native requested model identity; it does not invent a server-reported resolved model identity. Method application is judged from the artifact by the separate reviewer and remains a fallible assessment, not introspection into a model's reasoning.

Qualification requires all case witnesses, exact skill/version/digest, matching host/model, new artifact files, distinct observed producer/reviewer sessions, passing substantive judgments and the deterministic verifier. Changed inputs, rubric, evaluator, output or receipts invalidate the record. Failures revoke prior passing evidence for that scope. A missing host, absent subscription, failed process or missing artifact cannot qualify. Native development evaluation uses an existing ChatGPT subscription and only the selected provider's five non-secret configuration fields; no credentials are copied and no global host configuration is changed.

Only Codex has this new qualification adapter. This does not claim cross-host competence, automatic connector traversal, a complete research→specialist→challenge workflow, a provisioned clock or release readiness. Those remain separate acceptance journeys. Protocol tests use explicit fake binaries and are labeled as such; real native corpus attempts and independent judgments are retained separately, including failures.


Independent counterexamples closed in the current slice: native artifacts and invocation receipts are hashed before the external grader starts, and any later mutation fails without replacing the original observation. Qualification parses the receipt bodies and binds role, host/version, requested model, completion/exit, invocation/session identity, exact prompt/input/rubric/skill context, produced artifact hashes and the actual reviewer judgment. One case cannot reuse another case's invocation, session, artifact reference or receipt; case paths must belong to one evaluation directory. Report-only results remain experimental.

The real corpus exposed a separate serialized-JSON redaction crash. Redaction now traverses parsed values before serialization. An input cannot expose a held-out rubric, and a bundled method file cannot count as a newly produced artifact. Twelve focused native adapter tests cover these defects; the complete current candidate passed 968 tests with zero failures and one existing skip, lint, types and packaged smoke. The full test command used `npm test -- --test-concurrency=4` after a concurrent-load run tripped existing startup-latency assertions; those assertions were not changed.

Live evidence is deliberately separate: the first provider attempt failed; a tool-session reset interrupted the second; the third crashed at the redaction boundary. The fourth began before the receipt-binding repairs and cannot establish current qualification, even where its independently reviewed artifact passes. The unchanged six-case corpus must be rerun under the repaired adapter before a qualification claim. Two host-native baseline artifacts passed independent correctness/uncertainty/evidence review, and two intentionally wrong artifacts were rejected on all three criteria. This does not demonstrate incremental benefit or a full specialist workflow. Reviewer workspaces withhold the producer conversation and corpus rubric from the producer context; they are not a claim of operating-system hermeticity.
