# Distribution PDF fonts

Bundled for offline Typst export via `--font-path`. Family names must match Typst discovery (`Plus Jakarta Sans`, `IBM Plex Mono`).

**Active `--font-path` faces** (only these belong at this directory root):

| File | Role | License |
| --- | --- | --- |
| PlusJakartaSans-*.ttf | Body, masthead, headings, deck/PPTX embed | [OFL-1.1](https://github.com/tokotype/PlusJakartaSans/blob/master/OFL.txt) (Tokotype) |
| IBMPlexMono-Regular.otf | Code, IDs, monospace | [OFL-1.1](https://scripts.sil.org/OFL) (IBM) |

**Not active** — kept for reference or diagram labels only; do not copy back to the root unless re-promoting:

| Location | Contents |
| --- | --- |
| `legacy/` | Inter, Source Serif, older IBM Plex Mono copies |
| `Geist-*.ttf`, `GeistMono-*.ttf` | Pre-Jakarta sans/mono (retired from brand) |
| `handwritten/Caveat.ttf` | Mermaid/D2 hand-drawn diagram labels |

Refresh Plus Jakarta Sans from the upstream repo:

```bash
BASE=https://raw.githubusercontent.com/tokotype/PlusJakartaSans/master/fonts/ttf
for f in PlusJakartaSans-Regular.ttf PlusJakartaSans-Medium.ttf PlusJakartaSans-SemiBold.ttf PlusJakartaSans-Bold.ttf; do
  curl -fsSL -o "templates/distribution/fonts/$f" "$BASE/$f"
done
```

Export passes `--font-path`, `--ignore-system-fonts`, and `--ignore-embedded-fonts` so Typst does not fall back to Libertinus Serif or DejaVu Sans Mono.

PPTX export embeds the Jakarta TTF files via optional `pptx-embed-fonts` when `pptxgenjs` is installed.

Deck/PPTX **preview artifacts** are not stored here — run `npm run examples:deck` to write gitignored outputs under `.tmp/distribution-examples/`.
