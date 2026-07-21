---
name: docs-codebase-research-workflow
description: "Use when: cx-researcher maps the repo — entry points, dependencies, hot paths, or unfamiliar subsystems."
inputs: [repository-path]
artifactType: research-brief
toneDefault: pedagogical
toneAllowed: [pedagogical, direct]
verificationBar: "Question→Method→Sources→Findings(Observation≠Inference)→Counter-evidence→Recommendation; every load-bearing claim cites a verifiable primary source or [unverified]."
---
# Codebase Research Workflow

Use when: cx-researcher investigates **this repository** — structure, dependencies, behavior. Not for external vendor research or user interviews.

Call `get_skill("perspectives/researcher")` and `get_skill("exploration/repo-map")` before deep dives.

## Steps

1. **Clarify the map question**: what subsystem, entry point, or data flow must be understood?
2. **Read before concluding**: grep, glob, read implicated files. No claims from memory.
3. **Produce artifacts**:
   - `.construct/codebase-map.md` for broad orientation (repo-map skill)
   - `.construct/research/{slug}.md` for focused investigations using `get_template("research-brief")`
4. **Source classes** (codebase-primary):

   | Source | Class |
   |---|---|
   | Source file at commit | primary |
   | Test asserting behavior | primary |
   | Config / schema in repo | primary |
   | Comment or doc in repo | secondary |
   | External blog about the repo | tertiary — locate code, do not cite alone |

5. **Cite as** `[source: path#Lnn]` or `[source: commit-sha]`.
6. **Tone**: default `pedagogical` — teach the next reader the shape of the system.

## Verification bar

- Every architectural claim traceable to file:line.
- Unknown paths marked `[unverified]` until read.
- cx-researcher must **not** answer product prioritization or user preference questions.
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
