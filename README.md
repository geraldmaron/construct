# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in the rest. Work happens in the background; only genuine decisions surface; deliverables arrive finished and traceable.

This is a ground-up rebirth — see [STRATEGY.md](STRATEGY.md) for the full direction, [GLOSSARY.md](GLOSSARY.md) for the vocabulary every surface uses, and [CHANGELOG.md](CHANGELOG.md) for what shipped. The predecessor lives on, archived and read-only, at `construct-legacy`.

## Status

Phase 0 — bootstrap and guardrails. Not yet usable for real outcomes. If you have a v2 install and want it removed, `construct cleanup` ships in the `3.0.0-alpha` release (Phase 1).

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
