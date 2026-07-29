---
title: Branding
description: Canonical Construct brand contract — visual identity, naming, voice, tone, and profile terminology for generated artifacts.
---

# Construct branding

Single index for maintainers and agents. Generated surfaces (init scaffolding, platform sync, publish/export, dashboard, supported hosts) must align with these rules.

## Visual identity

| Element | Value | Source |
|---------|-------|--------|
| Sans / display | Plus Jakarta Sans (weights 400–700) | [`lib/brand-tokens.mjs`](../../../lib/brand-tokens.mjs) |
| Monospace | JetBrains Mono | [`lib/brand-fonts.mjs`](../../../lib/brand-fonts.mjs) |
| Color | Field-notebook ink ramp with slate-teal evidence accent (`#1f5c61`) | [`templates/distribution/construct-brand.typ`](../../../templates/distribution/construct-brand.typ) |
| Published artifact tokens | Same ink + typography via templates and CSS vars | [`lib/brand-tokens.mjs`](../../../lib/brand-tokens.mjs), [`packages/construct-ui/styles/theme.css`](../../../packages/construct-ui/styles/theme.css) |
| Diagrams (publish) | D2 `--sketch` for structural hand-drawn figures; Mermaid classic + Plus Jakarta (handDrawn/Caveat retired); proof non-overlap | [`lib/diagram-export.mjs`](../../../lib/diagram-export.mjs), [`lib/figure-layout.mjs`](../../../lib/figure-layout.mjs) |
| Optional whiteboard | Excalidraw / host MCP — agent canvas only, not publish | Leave to the tool; do not bolt into pandoc |

Bundled fonts for offline export: [`templates/distribution/fonts/`](../../../templates/distribution/fonts/). Typst export passes `--font-path`, `--ignore-system-fonts`, and `--ignore-embedded-fonts` so system fallbacks (Libertinus, DejaVu) never replace the brand faces.

### Retired typography (do not ship)

These families are retired from active brand surfaces. References in docs, templates, or app source are drift:

- Space Grotesk (retired Construct 2.0 folio sans)
- Geist / Geist Mono
- IBM Plex (sans or mono as brand body)
- Inter as primary UI font
- Libertinus Serif (Typst fallback only — blocked by export flags)

## Naming

See [prompt surfaces](../concepts/prompt-surfaces.mdx).

| Context | Form |
|---------|------|
| Product / docs name | **Construct** (capital C) |
| CLI, npm package, public Worker Profile | `construct` (lowercase) |
| Internal Worker Profile ids | `architect`, `engineer`, … (never user-facing) |
| Artifact metadata | `construct_doc_id`, release-gate stamps, … |

Users address `@construct` only. Worker Profiles route internally.

## Voice and tone

Prose rules: [STYLE.md](../../STYLE.md). No marketing voice (`robust`, `enterprise-grade`, `best-in-class`, …). Acknowledge limits; refer to Construct as a project, not a product.

Typed artifacts resolve tone from:

1. [`registry/artifact-manifest.json`](../../../registry/artifact-manifest.json) `toneDefault` / `toneAllowed`
2. Workspace Preset tone defaults in `registry/workspace-presets/*.json`
3. Optional project override [`.construct/brand-voice.json`](../../../schemas/brand-voice.schema.json)

Validate before ship: `construct artifact validate <path> --type=<doc-type>`.

## Artifact workflow branding

`registry/artifact-manifest.json` also defines the registered document-class
workflow. A class resolves its author chain, reviewer chain, validation policy,
output formats, and branding policy from that manifest. Any registered class is
eligible; Construct does not silently substitute a PRD for an unknown class.

For workflow settings, precedence is: invocation override, then
`construct.config.json` `artifactWorkflow`, then manifest defaults. Branded is
the default for all styling-capable distribution formats (PDF, HTML, deck,
PPTX, DOCX/DOC, RTF, ODT, EPUB, and TeX). Markdown and text remain plain by
nature; a request or project configuration can explicitly opt out of branding.

## Profile terminology (rebrand)

Each Workspace Preset may define `rebrand.intakeQueueLabel` and `rebrand.signalNoun` in `registry/workspace-presets/*.json`. [`lib/workspace-presets/rebrand.mjs`](../../../lib/workspace-presets/rebrand.mjs) centralizes lookup; defaults are `Intake queue` / `signal`.

User-facing surfaces that must honor rebrand:

- `construct intake` CLI output and `--help`
- Session-start intake prelude
- Dashboard `/api/intake/*` and intake-related pages
- Mission Control insights (`summarizeIntakeQueue`)

Example: `operations` profile → **Request queue** / **request**.

Init templates and guides should use profile-neutral language and point readers to `construct intake --help` for profile-specific labels.

## Enforcement

| Gate | What it checks |
|------|----------------|
| `tests/brand-fonts.test.mjs` | Bundled TTF paths and family names |
| `tests/brand-prose.test.mjs` | Marketing voice, Construct/cli naming, code-fence skipping |
| `tests/functional/publish-template.functional.test.mjs` | Typst/HTML deck brand fonts |
| `scripts/audit/03d-brand.mjs` | Retired fonts, marketing voice, Construct/cli naming, hardcoded dashboard intake titles |
| `lib/hooks/brand-prose-lint.mjs` | PostToolUse block on the same rules for governed paths |
| `construct init:update` | Proposes or applies (`--apply-guide`) stale `.construct/construct_guide.md` refresh |
| `construct artifact validate` | Typed doc structure, visuals, tone |

Run the brand audit: `node scripts/audit/03d-brand.mjs`.

## Related

- [Document I/O](./document-io.md) — export formats and branded PDF/deck/PPTX
- [Templates](../../../templates/docs/README.md) — shipped doc shapes and overrides
