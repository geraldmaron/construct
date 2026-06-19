# Distribution PDF fonts

Bundled for offline Typst export via `--font-path`. Family names must match Typst discovery (`Geist`, `Geist Mono`).

| File | Role | License |
| --- | --- | --- |
| Geist-*.ttf | Body, masthead, headings (same face as dashboard/docs) | [OFL-1.1](https://github.com/vercel/geist-font/blob/main/LICENSE) (Vercel) |
| GeistMono-*.ttf | Code, IDs, monospace | [OFL-1.1](https://github.com/vercel/geist-font/blob/main/LICENSE) (Vercel) |

Legacy faces live under `legacy/` (outside `--font-path` so Typst cannot fall back to them):

| File | Role | License |
| --- | --- | --- |
| Inter-*.otf, InterDisplay-*.otf | Retained for reference only | [OFL-1.1](https://scripts.sil.org/OFL) (rsms/inter) |
| IBMPlexMono-Regular.otf | Retained for reference only | [OFL-1.1](https://scripts.sil.org/OFL) (IBM) |
| SourceSerif4-*.otf | Retained for reference only | [OFL-1.1](https://github.com/adobe-fonts/source-serif) |

Refresh Geist cuts from the pinned `geist` npm package:

```bash
cp node_modules/geist/dist/fonts/geist-sans/Geist-{Regular,Medium,SemiBold,Bold}.ttf templates/distribution/fonts/
cp node_modules/geist/dist/fonts/geist-mono/GeistMono-{Regular,Medium,SemiBold}.ttf templates/distribution/fonts/
```

Export passes `--font-path`, `--ignore-system-fonts`, and `--ignore-embedded-fonts` so Typst does not fall back to Libertinus Serif or DejaVu Sans Mono.
