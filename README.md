# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in the rest. Work happens in the background; only genuine decisions surface; deliverables arrive finished and traceable.

This is a ground-up rebirth — see [STRATEGY.md](STRATEGY.md) for the full direction, [GLOSSARY.md](GLOSSARY.md) for the vocabulary every surface uses, and [CHANGELOG.md](CHANGELOG.md) for what shipped. The predecessor (`@geraldmaron/construct` 1.x/2.x) lives on, archived and read-only, at `construct-legacy` — this repo and its npm package, `@geraldmaron/construct-engine`, start a new version lineage at `0.0.0` rather than continuing the old one. The `construct` CLI command name is unchanged; only the package identity is new.

## Status

Phase 0 — bootstrap and guardrails. Not yet usable for real outcomes. Versioning: `0.x` until the Phase 5 second-user gate (STRATEGY.md) passes, no stability promised before then. If you have a predecessor install and want it removed, `construct cleanup` ships in the first alpha (Phase 1) — install `@geraldmaron/construct-engine` to reach it, since the old package under `@geraldmaron/construct` won't auto-update to it.

## Development

```bash
npm install
npm test          # sterile suite via node --test, native TS type-stripping
npm run lint       # no-absolute-paths + glossary parity
npm run typecheck
npm run smoke      # packaged-install smoke: build, pack, install, run
```

Requires Node ≥ 22.18. Source is TypeScript using erasable syntax only, so it runs natively via Node's type-stripping in development — no build step for `npm test`. `npm run build` produces the published `dist/` for packaging.

## License

Apache-2.0
