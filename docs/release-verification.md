# Release verification

An alpha is cut deliberately and published only under the `alpha` dist-tag;
`latest` stays on the predecessor until a `3.0.0` is promoted on purpose.

## The gate

```bash
npm run lint && npm run typecheck && npm test && npm run smoke
```

`lint` chains: no absolute paths, glossary parity, no tracker ids in code,
skill-spec and skill-policy conformance, terminal-escape safety, the docs
index, documentation commands against the command registry, documentation
bead references, lockfile version parity, the registry index check, and the
generated-reference check. `test` runs the sterile suite, including the
documentation examples, the scenario tests, the drift fixtures, and the
broker protocol. `smoke` packs the package, installs it into a scratch
project, and runs init, status, doctor, config, source add and refresh,
workflow run, run show, inbox, run cancel, serve over stdio, skill install
and verify, reset, and a refused retired command from packaged bytes under
an isolated home, and proves no per-user database appears.

## Cutting an alpha

1. Bump `package.json` and refresh the lockfile
   (`npm install --package-lock-only`).
2. Regenerate derived material: `npm run registry:index` and
   `npm run docs:generate`.
3. Update `CHANGELOG.md`.
4. Run the full gate on the bumped tree.
5. Commit with the bead id. Tagging, pushing, and publishing happen only when
   the person directs them; `npm publish --provenance --tag alpha` never
   moves `latest`.

## Live host conformance

Automated CI is deterministic and credential-free. `npm run conformance`
checks every supported host without a credential: whether it is installed
here, whether `construct init` wires it and plants the operational skill
where it reads, the MCP handshake, ordinary-language classification, skill
loading on request, a managed workflow run to a final deliverable, decision
relay, and the limits of the headless surface. It prints a table and writes
`.tmp-conformance/report.json`.

Live calls into an installed host run only with `--live`, outside any host
session, with that host's credential present. A host that is not installed,
has no credential, or would be nested is an explicit untested result with
the reason, never a pass. What was and was not exercised for a given version
is recorded in the changelog entry for that version.
