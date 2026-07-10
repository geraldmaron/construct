# Audio and Video Intake

Construct accepts audio and video files (`.mp3`, `.wav`, `.m4a`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.flac`, `.ogg`, `.webm`, `.m4v`) and transcribes them on demand via [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — local, offline, Metal-accelerated on macOS.

## Requirements

`whisper-cli` must be on `PATH`. On macOS, install via Homebrew:

```bash
brew install whisper-cpp
```

On Linux, build from source per the [whisper.cpp quick-start](https://github.com/ggml-org/whisper.cpp#quick-start) or install via your distro package manager.

If the binary is missing, audio extraction throws `WHISPER_BINARY_MISSING` with an actionable install hint instead of silently failing.

## Model

The `base.en` GGML model (~150 MB) auto-downloads on first use to `<project>/.construct/runtime/whisper/models/ggml-base.en.bin`. Subsequent runs reuse the cached model.

Override the default model via environment:

```bash
export CONSTRUCT_WHISPER_MODEL=small.en   # better accuracy, ~466MB
export CONSTRUCT_WHISPER_MODEL=large-v3   # multilingual, ~3GB
```

Supported model names: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v3`, `large-v3-turbo`.

## Ingestion

```bash
construct ingest <audio-or-video-file>
```

The pipeline produces a `## Transcript` markdown section, stores the result at `.construct/ingest/<sha256>/markdown.md`, and indexes it into `knowledge_search`. The same idempotent re-ingest behavior applies — re-running on the same content is a no-op.

## Performance

On Apple Silicon with Metal, whisper.cpp hits roughly 10× real-time on the `base.en` model. A 1-minute clip transcribes in ~6 s after the model is loaded.

## Privacy

All transcription happens locally. No audio leaves the machine. The model files are downloaded once from Hugging Face (`huggingface.co/ggerganov/whisper.cpp`) and cached locally.

## Supported formats

All formats listed above route through whisper.cpp. Unsupported containers (e.g. `.wmv`) should be converted first:

```bash
ffmpeg -i input.wmv output.mp4
```
