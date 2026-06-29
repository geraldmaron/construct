# ADR-0036: Document Ingestion — Keep the Offline Sidecar, Offer docling-mcp Remote as Opt-In

- **Date**: 2026-06-10
- **Status**: accepted
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none
- **last_verified_at**: 2026-06-20
- **verified_by**: construct · 2026 re-evaluation confirms offline sidecar default; node-native fast tier; legacy regex fallback removed

## Problem

Construct extracts documents (PDF/DOCX/PPTX → searchable Markdown) by spawning a long-lived Python
**docling sidecar** it provisions itself via `uv` (`lib/document-extract/docling-sidecar.py`,
`lib/runtime/uv-bootstrap.mjs`), pinning `docling==2.45.0` and downloading ML models on first use.
The docling maintainers now ship an official **docling-mcp v2.0** server that does the same job —
long-lived process, warm models, conversion cache, image extraction — and adds a *remote* mode that
calls a Docling Serve API with no local model download. The decision-forcing question: should
Construct retire its bespoke sidecar and consume docling-mcp instead, as bead construct-n1f8 proposed?
The bespoke sidecar is real maintenance surface (provisioning, version pinning, JSON-RPC framing,
image externalization), so "use the upstream server" is attractive on its face.

## Context

Two facts bound the decision, both from `docs/notes/research/2026-06-construct-audit/60-third-party-strategic-eval.md`:

- docling-mcp v2.0 is **hybrid**: a default *remote* mode (Docling Serve API, ~50 MB base, no model
  download) and an opt-in *local* mode that still installs models via the `[local]` extra.
- The current sidecar is **working and bounded**: a 600 s timeout with a legacy-extractor fallback
  recorded in `droppedInfo`, plus `generate_picture_images` → `assets/` externalization, all shipped
  and covered by `tests/functional/mcp-ingest-resilience.functional.test.mjs`. It deliberately uses
  raw JSON-RPC over MCP framing because the parser IPC is not an LLM tool call.

Construct's product posture is **local-first and offline-capable** — local Ollama models, offline ONNX
embeddings, no required network for core flows. Documents ingested are frequently the most sensitive
inputs a user has (contracts, internal decks, customer data).

## Decision

Do not retire the sidecar. Keep the offline Python sidecar as the **default** ingestion path, and add
docling-mcp **remote** mode as an explicit **opt-in** ingestion strategy behind the existing
`ingest.strategy` config seam (`extractViaAdapter`), for users who want zero local footprint and
accept remote conversion. Do **not** adopt docling-mcp *local* mode — it keeps the model-download cost
while adding MCP framing overhead the sidecar avoids.

## Rationale

The bead's premise — that docling-mcp removes the provisioning liability — only holds for *remote*
mode, and remote mode sends every ingested document to a Docling Serve API. For a tool whose core
promise is local-first/offline operation over often-sensitive documents, making remote conversion the
default is a privacy and offline-capability regression, not an upgrade. docling-mcp *local* mode, the
privacy-preserving option, still downloads the same models — so it does not remove the liability the
bead cited; it only relocates it behind another process plus MCP overhead, for a net loss against the
in-process sidecar. The sidecar, meanwhile, is already bounded, tested, and aligned with the docling
*library's* intended use. The asymmetry is decisive: keep the working offline default, and expose the
genuinely-useful remote option as opt-in for the users it actually serves (ephemeral/CI runners,
zero-footprint installs) — which the `ingest.strategy` seam already supports without a rewrite.

## Rejected alternatives

- **Retire the sidecar; adopt docling-mcp remote as the default** (the bead as written). Rejected:
  defaulting to remote conversion ships sensitive documents off-box for a local-first tool, and makes
  ingestion network-dependent — a regression in posture, not a simplification.
- **Adopt docling-mcp local mode to drop the bespoke sidecar.** Rejected: it does not remove the
  model-download/provisioning cost (the stated motivation) and adds MCP protocol framing the sidecar
  intentionally avoided for non-LLM IPC; net maintenance and latency loss.
- **Swap docling for markitdown to drop the Python/uv footprint entirely.** Rejected here (tracked
  separately): markitdown removes ML deps but loses docling's complex-table/figure fidelity, which is
  the reason docling was chosen; it is a different capability tier, not a drop-in.

## Consequences

- The default ingestion path is unchanged — no regression risk to the tested offline flow.
- A new opt-in `ingest.strategy` value wires docling-mcp remote for zero-footprint installs; that work
  is additive and gated behind explicit configuration.
- Construct continues to own sidecar provisioning/versioning, accepted as the cost of an offline
  default. If docling-mcp ships a self-hostable local-network mode that needs no model download, this
  decision is revisited.

## Reversibility

Two-way door. The decision keeps the status quo as default and adds an opt-in; adopting docling-mcp
more broadly later is unblocked by the same `ingest.strategy` seam. Falsified-if docling-mcp adds a
no-model-download mode that runs fully on-box (e.g. a bundled lightweight Serve), which would remove
the privacy objection to making it the default.

## References

- `docs/notes/research/2026-06-construct-audit/60-third-party-strategic-eval.md` (docling section)
- docling-mcp: https://github.com/docling-project/docling-mcp
- ADR-0024 (document-io optional capability)
- `lib/document-extract/docling-sidecar.py`, `lib/runtime/uv-bootstrap.mjs`, `lib/document-ingest.mjs`

## Re-evaluation (2026-06-20)

Community benchmarks (2025–2026) rank docling highest on complex table extraction; MarkItDown and Unstructured trade fidelity for footprint or format breadth. Hybrid orchestrators (pdfmux-style) route per page but add another Python layer Construct would own.

**Confirmed for Construct:**

| Criterion | Docling sidecar | Node-native (unpdf/mammoth) | docling-remote |
|-----------|-----------------|----------------------------|----------------|
| Local-first default | Yes | Yes (fast tier) | No (opt-in) |
| Cross-platform | Yes (uv) | Yes | Yes |
| Office beyond DOCX | Yes | No — fail loud | Yes |
| Table/layout fidelity | Best | Low | Best |
| Footprint | ~1.5 GB | Optional npm deps | None local |

**Changes shipped with this re-evaluation:**

- Default high-fidelity ingest unchanged (docling sidecar).
- Fast tier (`--fidelity=fast`) uses unpdf/mammoth; office zip formats require docling.
- Docling failure fallback is **node-native**, not regex/CLI legacy extractors.
- Legacy zip-xml / pdftotext paths removed; PDF/Office require docling or node-native unpdf/mammoth.

**Still rejected as default:** docling-mcp remote (privacy), MarkItDown (fidelity), Unstructured (PDF table accuracy vs docling).

Canonical intake/export matrix: [`docs/guides/reference/document-io.md`](../../guides/reference/document-io.md).
