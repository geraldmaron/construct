#!/usr/bin/env python3
"""
lib/document-extract/docling-sidecar.py — long-lived JSON-RPC wrapper around docling.

Protocol: newline-delimited JSON over stdin/stdout. Each request is
{"id": <int>, "method": <str>, "params": <obj>}. Each response is
{"id": <int>, "result": <obj>} or {"id": <int>, "error": {"code": <str>, "message": <str>}}.

Methods:
  - ping            → {"ok": true, "doclingVersion": "<x.y.z>"}
  - extract {path}  → {"markdown": "...", "metadata": {...}, "droppedInfo": [...]}
  - shutdown        → {"ok": true}; process exits after acknowledgement

Best-practice notes (2026-06):
  - One sidecar per Node session, kept warm to avoid uv/venv startup (~2s).
  - Stdio JSON-RPC is the leanest Python↔Node IPC for non-LLM use cases;
    MCP rides the same transport but adds protocol overhead unsuitable
    for the parser sidecar.
  - Drops are surfaced explicitly (kind/count/reason/recoverable) so info
    loss is observable to the CLI, not silent.
"""
import json
import sys
import traceback
from pathlib import Path

try:
    from docling.document_converter import DocumentConverter
    from docling import __version__ as DOCLING_VERSION
except ImportError as exc:
    sys.stderr.write(json.dumps({"fatal": "docling-import-failed", "detail": str(exc)}) + "\n")
    sys.exit(2)


_converter = None


def get_converter():
    global _converter
    if _converter is None:
        _converter = DocumentConverter()
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
    markdown = doc.export_to_markdown()

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

    return {
        "markdown": markdown,
        "metadata": metadata,
        "droppedInfo": dropped_info,
    }


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
