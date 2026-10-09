# Held-out handback fixtures, v1

Two independent synthetic cases for a native investigative-research evaluation:

| Case | Held sources | Main pressure |
| --- | --- | --- |
| `held-out-handback-seed-club` | Five files; JSONL count corrections, protocol, communications proofs, planning minute | Corrected arithmetic, causal confounding, copied corroboration, and future trial logistics |
| `held-out-handback-planetarium` | Five files; confirmed/tentative iCalendar records, layout TSV, running order, planning notes | Current capacity, claim-specific authority, demand uncertainty, and later ticket-release conditions |

`suite-cases.json` is a native `cases` array fragment, using the observed format in `native-research-v2/project/suite.json`. Add it to the caller's full suite. All `from` and `rubric` paths are relative to this package root; preserve that relative layout or consistently prefix those paths when integrating. Outer suite metadata, model choice, native adapter, verifier, and invocation belong to the caller. This package deliberately contains no model invocation.

Only the five explicitly mapped `producer-inputs/<case>/` files and exact `native.prompt` belong in each producer sandbox. Each prompt is also frozen as `prompts/<case>.txt` (one trailing LF beyond the prompt string). Do not copy this whole package, `private-grading`, the fragment, or this README into a producer sandbox. `private-grading/<case>/expected.json` records independent expectations; `rubric.txt` is the native judge input. The native fragment references only the rubric, never maps it as a producer file. Do not expose expected answers to producers.

`freeze-manifest.json` freezes every source byte, exact prompt file, case fragment, expected file, rubric, and validation script with SHA-256. Manifest SHA-256: `309b39db21e4be5dce4fc3df1a1b8ec88efdfd03326ff4030b4fc8cb4c4620d2`. The manifest and this README are metadata outside that payload, avoiding a self-referential hash. To verify: `python3 verify-fixtures.py` from this directory. The validation checks integrity, isolation/mapping, prompt equality, format, and key arithmetic; it is not an evaluation of skill performance.

The four native checks are `correctness`, `uncertainty`, `evidence`, and `method_application`. Each rubric assigns concrete requirements to those checks, including necessary versus optional handbacks and action scope. Listing an unresolved issue requested by the user is explicitly permitted. A future booking or ticket-release condition is a legitimate next step, but cannot be used to withhold an answer supported by the held records. All four checks must pass for each case; failures and unevaluable checks remain visible.

Sources, prompts, expectations, and rubrics were authored and frozen before any producer run. No candidate skill text or existing producer outputs were inspected. No model was run and no passing qualification is claimed. This is a compact test of two domains and record shapes, not evidence of general research reliability, external fact checking, live integrations, or host coverage. Everything is synthetic and non-sensitive; permitted producer effects are confined to saving the requested assessment. Any post-run fixture correction requires a new version, preserving the original.
