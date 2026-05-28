# Audio and Video Intake

Construct can accept audio and video files in the intake inbox (`.mp3`, `.wav`, `.m4a`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.flac`, `.ogg`, `.webm`, `.m4v`) but cannot extract text from them without an ASR (Automatic Speech Recognition) backend.

When an audio or video file is dropped into `.cx/inbox/`, the embed daemon routes it to `.cx/intake/needs-asr/` instead of the normal pipeline. The original file signal is preserved there until an ASR backend is configured.

## Viewing the backlog

```bash
construct intake needs-asr list
construct intake needs-asr show <id>
```

## Enabling ASR

Set `CONSTRUCT_ASR_BACKEND` in your `.env` file:

| Value | Notes |
|---|---|
| `whisper` | Local OpenAI Whisper via Python. Privacy-safe; runs offline. Install with `pip install openai-whisper`. |
| `assemblyai` | AssemblyAI cloud API. Fast; requires `ASSEMBLYAI_API_KEY`. |

Once configured, re-run `construct embed start` (or `construct init --auto-start`). The daemon will pick up files from the `needs-asr/` queue and route them through the selected backend.

## Privacy considerations

- **whisper**: all transcription happens locally. No audio leaves your machine.
- **assemblyai**: audio is uploaded to AssemblyAI's servers. Review their data processing policy before use with sensitive content.

## Cost

- **whisper**: no API cost. CPU/GPU compute on your machine.
- **assemblyai**: metered by audio-hour. Check current pricing at assemblyai.com.

## Supported formats

All formats listed above are routed to the ASR queue. Unsupported video containers (e.g. `.wmv`) should be converted first with `ffmpeg -i input.wmv output.mp4`.
