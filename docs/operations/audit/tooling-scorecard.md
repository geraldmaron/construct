# Tooling & Pattern Scorecard

Audit Phase 7 deliverable (epic `construct-ij31`). Grades every external tool, runtime, and pattern Construct depends on against the field of established options, and records a verdict: **keep**, **make-optional**, or **replace**.

## Sourcing contract

Two claim classes, kept distinct per `rules/common/no-fabrication.md`:

- **Current state** — verified against the source tree this session (file paths / ADRs cited). Re-verifiable.
- **Field & verdict** — assessment of the established options in each category and the fit against Construct's documented constraints (ADR-0001 zero-npm-core; ADR-0014 optional embeddings; ADR-0024 optional document I/O; offline-first; Node-first). Where a verdict would *replace* a tool, the adoption/maintenance ranking that justifies it must be source-verified before acting — flagged inline as `[verify-before-replace]`. No adoption metrics are invented here.

## Corrections to the initial exploration

The first-pass exploration mis-stated three subsystems; verified facts:

| Claim (initial) | Verified reality | Source |
|---|---|---|
| Embeddings = Python `sentence-transformers` | **Node-native** transformers.js, `Xenova/all-MiniLM-L6-v2`, 384-dim ONNX, in-process — no Python | `lib/embed/semantic.mjs`, `lib/storage/embeddings-local.mjs`, `@huggingface/transformers` (optional dep) |
| Export pipeline = `lib/export.mjs` | File does not exist; export lives in `lib/document-export.mjs` | `bin/construct:1528` |
| Docling = mandatory ~10-min local uv venv | One of three strategies: `adapter` (local docling/whisper/pdftotext), `provider` (LLM), `docling-remote` (`DOCLING_SERVE_URL`); fallback policy; env>config>default | `lib/ingest/strategy.mjs` |

## Scorecard

### Embeddings runtime — `transformers.js` (Xenova) · **KEEP**
Current: Node-native ONNX via `@huggingface/transformers`, MiniLM-L6 384-dim, optional dep, degrades when absent (ADR-0014). Field: transformers.js, `fastembed-js`, ONNXRuntime-node, or an external embedding API. Fit: a Node-native, offline, in-process embedder with no Python is precisely the zero-runtime ideal; the daily path already needs no Python. **Verdict: keep.** Follow-up: the model id is pinned to MiniLM — worth a periodic check that it's still the right accuracy/size tradeoff vs `bge-small`/`gte-small` `[verify-before-replace]`.

### Vector store — **LanceDB** · **KEEP**
Current: `@lancedb/lancedb` + `apache-arrow`, embedded, one of only four core npm deps. Field: LanceDB, sqlite-vec, hnswlib-node, Chroma/Qdrant (server). Fit: embedded (no server), Node-first, columnar — aligns with offline-first and a thin core. **Verdict: keep.** sqlite-vec is the one alternative worth a sizing comparison if dependency weight ever bites `[verify-before-replace]`.

### Document extraction — **docling (+ remote + provider)** · **KEEP, but default to no-Python**
Current: strategy-selected (`lib/ingest/strategy.mjs`); local docling needs a uv/Python venv, but `docling-remote` and `provider` avoid it entirely. Field: docling, unstructured, marker, LlamaParse; Node-native `unpdf`/`pdfjs`, `mupdf`-wasm, `mammoth` (DOCX); OCR `tesseract.js`; transcription `whisper.cpp`. Fit: docling is strong on high-fidelity/scanned/A-V, but the local venv is the heaviest thing Construct can pull in. The architecture *already* makes it optional — the gap is the **default common-case path**: there is no Node-native fast path (only `pdftotext`, a system binary). **Verdict: keep docling for high-fidelity; add a Node-native fast path (`unpdf`/`mammoth`) as the default `adapter` for plain PDF/DOCX so the everyday path is zero-Python.** Tracked: capability bead + Phase 7 follow-up.

### Document export — **Pandoc + Typst** · **KEEP**
Current: system binaries, spawned, optional, licence-isolated at the process boundary (Pandoc GPLv2 kept out of core; Typst Apache-2.0 as `--pdf-engine`), actionable install guidance when absent (`lib/document-export.mjs`, ADR-0024). Field: Pandoc(+Typst/LaTeX/wkhtmltopdf), `md-to-pdf`/Puppeteer, WeasyPrint. Fit: Pandoc+Typst is the most capable and correctly licence-isolated markdown→PDF/DOCX/HTML path; spawning (not bundling) respects zero-npm-core. **Verdict: keep.**

### CLI framework & UI — **fully custom ANSI** · **KEEP CORE, re-grade prompts in Phase 5**
Current: zero `chalk`/`picocolors`/`inquirer`/`ora`/`commander`/`yargs`; hand-rolled `lib/term-format.mjs` (NO_COLOR/non-TTY aware) + `lib/tty-prompts.mjs` (menus/multiselect) + the registry dispatcher (ADR-0001). Field — argument parsing: bespoke vs commander/yargs/citty. Field — prompts: bespoke vs `@clack/prompts`, Ink, enquirer. Fit: zero-npm-core is a deliberate, defensible constraint, and a registry-driven dispatcher is a sound pattern; the risk is the **prompt/visual layer** carrying accessibility + maintenance burden that a maintained library (`@clack/prompts`) handles for free. **Verdict: keep the zero-dep core; Phase 5 visual audit decides whether `tty-prompts` meets the bar or whether a single vetted prompt dep is justified** `[verify-before-replace]`.

### Task tracking — **beads (bd)** · **KEEP** (project standard)
Current: external `bd` binary, Dolt-backed, mandated for all task tracking (CLAUDE.md, `rules/common/beads-hygiene.md`). Field: beads, GitHub Issues, Linear/Jira, plain markdown. Fit: local-first, git-synced, agent-oriented — fits an offline, multi-agent tool. **Verdict: keep** (it is the project's chosen standard, in active use this session).

### Telemetry — **OpenTelemetry + local JSONL** · **KEEP**
Current: OTel optional deps + local `.construct/traces` JSONL, remote export optional. Field: OTel (the de-facto open standard), vendor SDKs. Fit: standards-based, offline default, optional remote. **Verdict: keep.**

### Diagramming — **none today** · **ADD** (capability gap)
No diagram-as-code generation exists; `lib/wireframe.mjs` is text-only. Field: D2 (sketch + themes), Excalidraw / mermaid-to-excalidraw, Mermaid+ELK, Graphviz, PlantUML, nomnoml, Rough.js. **Verdict: add `construct diagram`** — primary candidate D2 (Go binary, headless SVG/PNG, distinctive sketch themes), fallback Excalidraw hand-drawn; pick finalised in capability bead `construct-ij31.16` `[verify-before-replace]`.

### Demos / recordings — **none today** · **ADD** (capability gap)
No demo-production capability. Field: VHS (charm, `.tape`→GIF/MP4/WebM), asciinema(+agg), terminalizer; Playwright for the dashboard. **Verdict: add `construct demo`** — primary VHS for terminal, Playwright for dashboard; capability bead `construct-ij31.17`.

## Roll-up

| Category | Current | Verdict |
|---|---|---|
| Embeddings | transformers.js (Node) | keep |
| Vector store | LanceDB | keep |
| Doc extraction | docling + remote + provider | keep; add Node-native default fast path |
| Doc export | Pandoc + Typst | keep |
| CLI core | custom registry dispatcher | keep |
| CLI prompts/visual | custom ANSI | re-grade in Phase 5 |
| Task tracking | beads | keep |
| Telemetry | OpenTelemetry + JSONL | keep |
| Diagramming | — | add (`construct diagram`) |
| Demos | — | add (`construct demo`) |

**Headline:** the heavy stack is already well-chosen and mostly zero-runtime — the real work is two **additions** (diagram, demo) and one **softening** (a Node-native extraction default so the everyday ingest path needs no Python), not replacements. The one open design question is the prompt/visual layer, deferred to the Phase 5 visual-maturity audit.
