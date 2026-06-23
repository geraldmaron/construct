# Distribution PDF fonts

Bundled for offline Typst export via `--font-path`. Family names must match Typst discovery (`Space Grotesk`, `JetBrains Mono`).

**Active `--font-path` faces** (only these belong at this directory root):

| File | Role | License |
| --- | --- | --- |
| SpaceGrotesk-Variable.ttf | Body, masthead, headings, deck/PPTX embed (weight axis 300–700) | [OFL-1.1](https://github.com/floriankarsten/space-grotesk/blob/master/OFL.txt) (Florian Karsten) |
| JetBrainsMono-*.ttf | Code, IDs, monospace (Regular/Medium/SemiBold) | [OFL-1.1](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt) (JetBrains) |

**Not active** — kept for reference or diagram labels only; do not copy back to the root unless re-promoting:

| Location | Contents |
| --- | --- |
| `legacy/` | Inter, Source Serif, older IBM Plex Mono copies |
| `PlusJakartaSans-*.ttf`, `Geist-*.ttf`, `GeistMono-*.ttf`, `IBMPlexMono-Regular.otf` | Pre-Space-Grotesk sans/mono (retired from brand) |
| `handwritten/Caveat.ttf` | Mermaid/D2 hand-drawn diagram labels |

Refresh the brand faces from upstream:

```bash
DIR=templates/distribution/fonts
curl -fsSL -o "$DIR/SpaceGrotesk-Variable.ttf" \
  "https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf"
JB=https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf
for f in JetBrainsMono-Regular.ttf JetBrainsMono-Medium.ttf JetBrainsMono-SemiBold.ttf; do
  curl -fsSL -o "$DIR/$f" "$JB/$f"
done
```

Space Grotesk ships as a single weight-axis variable TTF; Typst interpolates the 400/500/600/700 weights the brand references. Export passes `--font-path`, `--ignore-system-fonts`, and `--ignore-embedded-fonts` so Typst does not fall back to Libertinus Serif or DejaVu Sans Mono.

PPTX export embeds the Space Grotesk and JetBrains Mono TTF files via optional `pptx-embed-fonts` when `pptxgenjs` is installed.

Deck/PPTX **preview artifacts** are not stored here — run `npm run examples:deck` to write gitignored outputs under `.tmp/distribution-examples/`.
