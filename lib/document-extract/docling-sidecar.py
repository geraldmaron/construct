#!/usr/bin/env python3
"""
lib/document-extract/docling-sidecar.py — long-lived JSON-RPC wrapper around docling.

Governed by the ingestion sidecar process contract (ADR-0068): one JSON-RPC
surface, no business logic beyond the extraction call itself — routing,
fallback selection, and degradation-chain decisions all live on the Node
side (lib/document-extract/docling-client.mjs, lib/document-ingest.mjs).

Protocol: newline-delimited JSON over stdin/stdout. Each request is
{"id": <int>, "method": <str>, "params": <obj>}. Each response is
{"id": <int>, "result": <obj>} or {"id": <int>, "error": {"code": <str>, "message": <str>}}.

Methods:
  - ping            → {"ok": true, "doclingVersion": "<x.y.z>"}
  - extract {path}  → {"markdown": "...", "metadata": {...}, "droppedInfo": [...], "structuredDict": {...}?}
  - shutdown        → {"ok": true}; process exits after acknowledgement

No cancel method (construct-4uxq0.9.13): this loop is synchronous and handles
one request at a time — while `extract()` is blocked inside docling's
`convert()`, nothing here reads stdin again until that call returns, so an
incoming cancel message would sit unread until the conversion finished on its
own, which is no cancellation at all. docling 2.45.0's `convert()` also takes
no cancellation/deadline argument. The Node side (docling-client.mjs) kills
this process on a per-request timeout instead of sending a message it could
never act on; that also aborts any other request already queued behind the
one that timed out, since there is exactly one of these processes per client
session and it does not resume where it left off after a kill.

Parent-PID watch (ADR-0068): spawned as a direct child of the Node process
via child_process.spawn, so os.getppid() at start is that Node process's PID.
A background thread polls it every PARENT_POLL_INTERVAL_S; a `kill -9` (or
any other death Node's own `process.on('exit')` handler cannot run for) still
leaves this sidecar exiting on its own rather than orphaned. POSIX reparents
an orphan to init (or the platform's subreaper), so a ppid change is a
reliable signal; on Windows, ppid does not get reparented the same way, so
this is best-effort there rather than a guarantee.

Best-practice notes (2026-06):
  - One sidecar per Node session, kept warm to avoid uv/venv startup (~2s).
  - Stdio JSON-RPC is the leanest Python↔Node IPC for non-LLM use cases;
    MCP rides the same transport but adds protocol overhead unsuitable
    for the parser sidecar.
  - Drops are surfaced explicitly (kind/count/reason/recoverable) so info
    loss is observable to the CLI, not silent.
"""
import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

PARENT_POLL_INTERVAL_S = 2.0


def watch_parent(initial_ppid):
    while True:
        time.sleep(PARENT_POLL_INTERVAL_S)
        if os.getppid() != initial_ppid:
            os._exit(3)


try:
    from docling.document_converter import DocumentConverter
    from importlib.metadata import version as _pkg_version
    DOCLING_VERSION = _pkg_version("docling")
except ImportError as exc:
    sys.stderr.write(json.dumps({"fatal": "docling-import-failed", "detail": str(exc)}) + "\n")
    sys.exit(2)


_converter = None


# By default docling emits a bare `<!-- image -->` marker and discards pixel data,
# so embedded figures are lost. Enable picture-image generation on the PDF
# pipeline and export markdown with images embedded as base64 data URIs; the Node
# side externalizes those into an assets/ directory. The configuration is wrapped
# so a docling API change degrades to the default converter instead of crashing.

def build_converter():
    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import PdfFormatOption

        pdf_options = PdfPipelineOptions()
        pdf_options.generate_picture_images = True
        pdf_options.images_scale = 2.0
        return DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options)}
        )
    except Exception:
        return DocumentConverter()


def export_markdown(doc):
    try:
        from docling_core.types.doc import ImageRefMode
        return doc.export_to_markdown(image_mode=ImageRefMode.EMBEDDED)
    except Exception:
        return doc.export_to_markdown()


def export_structured_dict(doc):
    try:
        return doc.export_to_dict()
    except Exception:
        return None


def get_converter():
    global _converter
    if _converter is None:
        _converter = build_converter()
    return _converter


def extract(params):
    path_raw = params.get("path")
    if not path_raw:
        raise ValueError("missing 'path' parameter")
    path = Path(path_raw)
    if not path.exists():
        raise FileNotFoundError(f"file not found: {path}")

    result = get_converter().convert(str(path))
    doc = result.document
    markdown = export_markdown(doc)

    metadata = {
        "format": result.input.format.value if hasattr(result.input, "format") else None,
        "pageCount": len(doc.pages) if hasattr(doc, "pages") and doc.pages is not None else None,
        "doclingVersion": DOCLING_VERSION,
        "sourcePath": str(path),
    }

    dropped_info = []
    try:
        page_count = metadata.get("pageCount") or 0
        if page_count and len(markdown) / max(page_count, 1) < 50:
            dropped_info.append({
                "kind": "low-text-yield",
                "count": page_count,
                "reason": "Extracted text density below 50 chars/page suggests image-heavy or scanned content; OCR may have partial coverage.",
                "recoverable": True,
            })
    except Exception:
        pass

    payload = {
        "markdown": markdown,
        "metadata": metadata,
        "droppedInfo": dropped_info,
    }

    structured_dict = export_structured_dict(doc)
    if structured_dict is not None:
        payload["structuredDict"] = structured_dict

    return payload


def handle(request):
    method = request.get("method")
    params = request.get("params") or {}
    if method == "ping":
        return {"ok": True, "doclingVersion": DOCLING_VERSION}
    if method == "extract":
        return extract(params)
    if method == "shutdown":
        return {"ok": True}
    raise ValueError(f"unknown method: {method}")


def main():
    watcher = threading.Thread(target=watch_parent, args=(os.getppid(),), daemon=True)
    watcher.start()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = handle(request)
            sys.stdout.write(json.dumps({"id": request_id, "result": result}) + "\n")
            sys.stdout.flush()
            if request.get("method") == "shutdown":
                return
        except Exception as exc:
            error = {
                "code": type(exc).__name__,
                "message": str(exc),
                "trace": traceback.format_exc() if not isinstance(exc, (ValueError, FileNotFoundError)) else None,
            }
            sys.stdout.write(json.dumps({"id": request_id, "error": error}) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
