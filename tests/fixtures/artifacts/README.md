# Golden artifact fixtures

Per-type golden markdown fixtures for release-gate certification. Each directory mirrors an entry from `registry/artifact-manifest.json`.

| Type | Fixture | Template source |
|------|---------|-----------------|
| See `tests/fixtures/artifacts/<type>/golden.md` | `golden.md` | `cx_fixture_source` frontmatter field |

Regenerate all fixtures:

```bash
node scripts/generate-artifact-fixtures.mjs
```

Tests: `tests/fixtures/artifacts/golden-fixtures.test.mjs`, `tests/artifact-release-gate.test.mjs`.
