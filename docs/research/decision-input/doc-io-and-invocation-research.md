---
intake: none
intake_rationale: Durable ADR decision-input research; moved from .cx/research/ for vanilla package tree.
---

# Research Brief: Document I/O (Docling + export tooling) and Construct Invocation Model

- **Date**: 2026-06-04
- **Bead**: construct-i1mt
- **Status**: complete
- **Recency baseline**: All sources fetched 2026-06-04; MCP spec rev 2025-11-25.
- **No-fabrication note**: Unverifiable footprints/versions are marked `[unverified]`. Per rules/common/no-fabrication.md.

## Executive summary

- **Docling is an ingestion engine, not an exporter.** It converts PDF/DOCX/PPTX/XLSX/HTML/images/audio INTO Markdown, HTML, JSON, Text, DocTags, and WebVTT. It accepts Markdown as an *input* but cannot render Markdown back out to PDF or DOCX. Document *generation* is out of scope. License MIT.
- For **Markdown → PDF/DOCX export**, the cleanest fit for a light Node.js CLI is to **spawn external standalone binaries**: **Pandoc** (markdown→DOCX, and markdown→PDF via an engine) plus **Typst** (fast, single-binary PDF engine). Both add **zero npm/native weight** to the core install.
- The **MCP-aligned invocation model** is explicit, **on-demand `tools`** (`tools/call`), optionally a user-controlled `prompt` (slash command) — not ambient/always-on behavior.

---

## Topic 1 — Docling: ingestion vs. export, footprint, sidecar, license

### Claims (cited)
- **Input formats**: "PDF", "DOCX, XLSX, PPTX", "Markdown", "AsciiDoc", "LaTeX", "HTML, XHTML", "CSV", images (PNG/JPEG/TIFF/BMP/WEBP), audio/video (WAV/MP3/M4A…, MP4/AVI/MOV), WebVTT, USPTO/JATS/XBRL XML, and Docling JSON. [source: https://docling-project.github.io/docling/usage/supported_formats/ — fetched 2026-06-04]
- **Export/output formats**: only **HTML, Markdown, JSON, Text, DocTags, WebVTT**. [source: same supported-formats page — fetched 2026-06-04]
- **Export is out of scope (explicit)**: markdown-to-PDF or markdown-to-DOCX export is not supported. Docling accepts Markdown as an *input* format but does not export to those proprietary formats. [source: same supported-formats page — fetched 2026-06-04]
- **License**: "The Docling codebase is under MIT license." [source: https://github.com/docling-project/docling — fetched 2026-06-04]
- **Python**: `requires-python = '>=3.10,<4.0'`; Python 3.9 support was dropped in docling version 2.70.0. [source: https://raw.githubusercontent.com/docling-project/docling/main/pyproject.toml and https://github.com/docling-project/docling — fetched 2026-06-04]
- **Heavy ML deps**: declares `torch>=2.2.2,<3.0.0` and `torchvision>=0,<1`. [source: pyproject.toml — fetched 2026-06-04] The exact install size of a default `pip install docling` is `[unverified]` (the fetched pyproject reflected a `docling-slim` variant whose 8-package base was quoted ~50MB; the standard install adds torch + models and is substantially larger, but no primary number was confirmed).
- **Models pulled at runtime**: "By default, models are downloaded automatically upon first usage." Prefetch via `docling-tools models download` into `$HOME/.cache/docling/models`; offline use via `artifacts_path`. [source: https://docling-project.github.io/docling/usage/advanced_options/ — fetched 2026-06-04]
- **Sidecar (docling-serve)**: a **FastAPI** HTTP service, "Running Docling as an API service," `POST /v1/convert/source`, default **port 5001**, with `/docs` and `/ui`. Container images: CPU-only **~4.4 GB**, CUDA 12.8 **~11.4 GB** (base 4.4–8.7 GB). License MIT. [source: https://github.com/docling-project/docling-serve and https://raw.githubusercontent.com/docling-project/docling-serve/main/README.md — fetched 2026-06-04]

### Implications for Construct
- A "Docling-backed document-I/O capability" can use Docling **only for the INGESTION half** (incoming docs → markdown/JSON for the agent). The **EXPORT half (markdown → PDF/DOCX) must use a different tool** (Topic 2).
- Docling's torch + model-download footprint means it should **never be a core npm/runtime dependency**. Run it as the **docling-serve sidecar** (HTTP, port 5001) or an opt-in Python install — invoked on demand, with models prefetched for offline/air-gapped parity.

---

## Topic 2 — Markdown → document export tooling

| Tool | MD→PDF | MD→DOCX | Fidelity | Runtime / footprint | License | Fit as optional, on-demand dep for a Node CLI |
|---|---|---|---|---|---|---|
| **Pandoc** | Yes (needs a `--pdf-engine`) | **Yes (native)** | High for structured docs; PDF look depends on engine | **Standalone statically-linked binary, no runtime/data-file deps** | **GPLv2+** (process-isolation exempts your code per COPYRIGHT) | **Excellent** — spawn the binary; zero npm weight |
| **Typst** | Yes (own markup; via Pandoc for MD) | No | LaTeX-quality, very fast | **Single Rust binary, ~40 MB `[size unverified beyond secondary]`, no external runtime** | **Apache-2.0** | **Excellent** as the PDF engine behind Pandoc; zero npm weight |
| **WeasyPrint** | Via HTML (not MD directly) | No | High for CSS paged-media | **Python ≥3.10 + system libs (Cairo, Pango, GDK-PixBuf)** | BSD | Poor — heavy non-Node toolchain |
| **Headless Chromium (Puppeteer/Playwright)** | Via HTML | No | **Best visual/CSS fidelity** | **Bundled/downloaded browser, 100s of MB** | Apache-2.0 | Heavy; viable only if browser is downloaded on demand (Topic 3) |

### Claims (cited)
- Pandoc converts "various flavors of Markdown, HTML, LaTeX and **Word docx**"; PDF "By default… will use LaTeX… With the option `--pdf-engine`… you can specify other programs" (valid engines include `weasyprint`, `typst`, `wkhtmltopdf`, `prince`, `xelatex`, etc.). LaTeX is needed **only for PDF**, not for DOCX. [source: https://pandoc.org/MANUAL.html — fetched 2026-06-04]
- Pandoc binary: "The executable is statically linked and has no dynamic dependencies or dependencies on external data files." [source: https://pandoc.org/installing.html — fetched 2026-06-04]
- Pandoc license: "GPL, version 2 or greater"; running it "in a separate process" does not force your code to be GPL. [source: https://github.com/jgm/pandoc/blob/main/COPYRIGHT — fetched 2026-06-04]
- Typst: license **Apache-2.0**; self-contained Rust binary; `typst compile file.typ` → PDF; uses **its own markup**, not Markdown. [source: https://github.com/typst/typst — fetched 2026-06-04] "~40MB" single binary is `[secondary, unverified primary]` [source: https://crates.io/crates/md-typ-pdf result — fetched 2026-06-04].
- WeasyPrint: HTML/CSS → PDF (no direct Markdown), needs Cairo/Pango/GDK-PixBuf and Python ≥3.10; BSD. [source: https://weasyprint.org/ — fetched 2026-06-04]
- Puppeteer license Apache-2.0; bundles a Chromium build; for headless work the lighter `chrome-headless-shell` is preferred. [source: https://github.com/puppeteer/puppeteer/blob/main/LICENSE and https://blog.risingstack.com/pdf-from-html-node-js-puppeteer/ — fetched 2026-06-04]

### Implications for Construct
- **Recommended: Pandoc (DOCX + orchestration) + Typst (PDF engine), both spawned as external binaries.** This keeps the npm core at **zero added install weight** and avoids Python.
- **GPL handling**: invoking Pandoc as a separate process (never linking/vendoring its source) keeps Construct's own license unaffected — matches Construct's "spawn external binary" sidecar style.
- Reserve **headless-Chromium** for cases needing pixel-perfect CSS fidelity; gate it behind on-demand browser download.

---

## Topic 3 — Optional heavy-dependency packaging in a Node.js CLI

### Patterns (cited examples)
- **Per-platform `optionalDependencies`** (npm picks by `os`/`cpu`): **esbuild** moved to this model so only the matching platform binary installs. [source: https://github.com/evanw/esbuild/issues/789 — fetched 2026-06-04]
- **Separate CLI-triggered download of heavy binaries** (package stays light): **Playwright** — "the npm package itself does not contain browser binaries… `npx playwright install`", with `--only-shell` to fetch just the headless shell; binaries cached under `~/.cache/ms-playwright`. [source: https://playwright.dev/docs/browsers — fetched 2026-06-04]
- **Prebuilt-binary download with build fallback**: `prebuild-install || node-gyp rebuild` and `node-pre-gyp install --fallback-to-build`. [source: https://www.npmjs.com/package/prebuild-install and https://www.npmjs.com/package/node-pre-gyp — fetched 2026-06-04]
- **Lazy / dynamic `import()`** so `--help` and light subcommands never load heavy deps (the `lazy-imports` package was built for exactly this CLI use case, e.g. deferring `aws-sdk`). [source: https://www.npmjs.com/package/lazy-imports — fetched 2026-06-04]
- **Spawning external system binaries / sidecars** (Pandoc, Typst, docling-serve) — the heaviest deps live outside npm entirely (Topics 1–2).

### Implications for Construct
- Keep the **npm core install zero-heavy-dependency**. Treat Pandoc, Typst, and Docling as **external binaries / a sidecar**, discovered on `PATH` (or installed on demand), never bundled. This matches ADR-0001 (zero-npm-core) and ADR-0014 (local-embeddings-optional).
- Use **lazy `import()`** for the document-I/O command module so it loads only when a doc command runs.
- If a native helper is ever needed, prefer **per-platform `optionalDependencies`** (esbuild model) or **CLI-triggered prefetch** (Playwright model) over `postinstall` network calls — both fail gracefully and respect `--omit=optional`.

---

## Topic 4 — MCP explicit-invocation vs. ambient activation

### Claims (cited, MCP spec rev 2025-11-25)
- **Tools are model-controlled, invoked on demand** via `tools/list` (discover) and `tools/call` (invoke): "Tools in MCP are designed to be **model-controlled**… the protocol itself does not mandate any specific user interaction model." Human-in-the-loop: "there **SHOULD** always be a human in the loop with the ability to deny tool invocations." [source: https://modelcontextprotocol.io/specification/2025-11-25/server/tools — fetched 2026-06-04]
- **Prompts are user-controlled** (explicit selection), via `prompts/list` + `prompts/get`: "Prompts are designed to be **user-controlled**… the intention of the user being able to explicitly select them," "triggered through user-initiated commands… For example, as slash commands." [source: https://modelcontextprotocol.io/specification/2025-11-25/server/prompts — fetched 2026-06-04]
- MCP has **no ambient/always-on primitive** — every action is an explicit message (`tools/call`, `prompts/get`) negotiated via declared capabilities. "Enact on demand" maps directly onto a single `tools/call`. [source: both spec pages — fetched 2026-06-04]

### Implications for Construct
- Expose the **Construct invocation/activation entrypoint as an explicit MCP `tool`** (e.g. one `tools/call` that "enacts on demand"), not as ambient behavior. This is the spec-sanctioned "enact on demand" pattern a tool-on-top can call.
- Offer a **user-controlled `prompt` / slash-command** as the human-facing entrypoint (discoverable, explicit), keeping the model-controlled `tool` for agent-driven invocation.
- Both document-I/O export and ingestion should be **discrete `tools`** so a host always shows the user what is being invoked (matches MCP's "clear visual indicators when tools are invoked" guidance and Construct's no-ambient-side-effects posture).

---

## Counter-evidence / caveats
- **Pandoc GPL**: GPLv2+ is more restrictive than MIT/Apache. Mitigation is the explicit process-separation exception in Pandoc's own COPYRIGHT; if Construct ever vendored Pandoc source (not spawning), this conclusion flips. [source: pandoc COPYRIGHT — fetched 2026-06-04]
- **Typst input is not Markdown** — markdown→PDF via Typst goes *through Pandoc* (Pandoc emits Typst, Typst compiles). A standalone Typst path requires a markdown→Typst shim. [source: typst README + pandoc MANUAL — fetched 2026-06-04]
- **Docling default install size** is `[unverified]` — the only primary number fetched described a `docling-slim` base (~50 MB, 8 pkgs); the torch-bearing standard install is materially larger but no confirmed figure was found.

## Gaps
- Exact disk footprint of a default `pip install docling` (standard extra) — `[unverified]`.
- Typst single-binary size confirmed only via a secondary crates.io page (~40 MB) — needs a primary release-asset confirmation.
- docling-serve async job/task API surface — not confirmed from the fetched README excerpt.

## Recommendation
1. **Ingestion**: Docling via the **docling-serve sidecar** (HTTP, port 5001), models prefetched for offline parity. Never a core npm dep.
2. **Export**: **Pandoc (DOCX + driver) + Typst (PDF engine)**, spawned as external binaries — zero npm-core weight. This is the best fit for a zero-heavy-dependency Node core. Flip condition: if pixel-perfect CSS fidelity becomes a hard requirement, add on-demand headless-Chromium (Playwright `--only-shell`) as a second engine.
3. **Invocation**: expose document I/O and the activation entrypoint as **explicit MCP `tools`** (`tools/call`, "enact on demand"), plus a user-controlled **`prompt`/slash command**. No ambient activation.

## Sources (URL + access date 2026-06-04)
- Docling repo (MIT, formats): https://github.com/docling-project/docling
- Docling supported formats (ingestion-only, no MD→PDF/DOCX): https://docling-project.github.io/docling/usage/supported_formats/
- Docling pyproject (Python ≥3.10, torch): https://raw.githubusercontent.com/docling-project/docling/main/pyproject.toml
- Docling advanced options (model prefetch / offline): https://docling-project.github.io/docling/usage/advanced_options/
- docling-serve repo (FastAPI sidecar, MIT, port 5001): https://github.com/docling-project/docling-serve
- docling-serve README (image sizes, /v1/convert/source): https://raw.githubusercontent.com/docling-project/docling-serve/main/README.md
- Pandoc MANUAL (DOCX/PDF, --pdf-engine): https://pandoc.org/MANUAL.html
- Pandoc installing (static binary): https://pandoc.org/installing.html
- Pandoc COPYRIGHT (GPLv2+, process exception): https://github.com/jgm/pandoc/blob/main/COPYRIGHT
- Typst repo (Apache-2.0, Rust binary, own markup): https://github.com/typst/typst
- Typst size (secondary, ~40MB) [unverified primary]: https://crates.io/crates/md-typ-pdf
- WeasyPrint (HTML→PDF, BSD, Cairo/Pango): https://weasyprint.org/
- Puppeteer LICENSE (Apache-2.0): https://github.com/puppeteer/puppeteer/blob/main/LICENSE
- Headless-shell vs Chromium (footprint): https://blog.risingstack.com/pdf-from-html-node-js-puppeteer/
- esbuild per-platform optionalDependencies: https://github.com/evanw/esbuild/issues/789
- Playwright browsers (CLI-triggered download, --only-shell): https://playwright.dev/docs/browsers
- prebuild-install: https://www.npmjs.com/package/prebuild-install
- node-pre-gyp: https://www.npmjs.com/package/node-pre-gyp
- lazy-imports (lazy CLI loading): https://www.npmjs.com/package/lazy-imports
- MCP spec — Tools (model-controlled, tools/call): https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP spec — Prompts (user-controlled, slash commands): https://modelcontextprotocol.io/specification/2025-11-25/server/prompts
