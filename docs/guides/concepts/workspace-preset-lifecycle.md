---
title: Workspace Preset lifecycle
description: How workspace-wide operating presets are researched, validated, promoted, monitored, and retired.
---

# Workspace Preset lifecycle

A Workspace Preset configures workspace-wide behavior: intake types and stages, document
defaults, tone, baseline Skills, research defaults, and Procedure preferences. Construct ships
four curated Presets: `rnd`, `operations`, `creative`, and `research`.

A Workspace Preset is not a Worker Profile. It does not identify an assignable worker or select
a worker runtime and model tier. Worker Profiles own that execution configuration. A Preset can
influence which Skills, Procedures, and Worker Profiles a Plan selects without becoming one of
those Profiles.

The canonical owner is `registry/workspace-presets/<id>.json`, selected by the
`workspacePreset` configuration field. Workspace Presets contain intake tables, artifact
classes, tone defaults, and workspace-wide Skill and Procedure selections, but no assignable
runtime or model tier.

## Lifecycle

```text
draft → validated → promoted → monitored → retired
```

A curated Preset is a research artifact, not an unreviewed configuration file. It earns
promotion by classifying representative signals correctly and producing the intended artifacts.

## 1. Discover

Characterize the workspace, its incoming signals, recurring work, and expected outputs.

Required evidence:

- dominant work loop in five to eight stages;
- recurring signal classes;
- canonical output artifacts;
- required Skill and Procedure emphasis;
- at least two primary sources, such as interviews, internal documentation, or observed work.

Record this evidence in the Preset draft's requirements brief. Without evidence, the draft is
an opinion rather than a researched operating configuration.

## 2. Frame

Convert discovery into an intake taxonomy and stage sequence.

- Each intake type must be distinct, observable, and routable to an Assignment responsibility.
- Each stage must answer “what changed?” and name its dominant Artifact.
- Recommended execution is expressed as Plan and Assignment constraints, not a permanent cast of
  workers.

Acceptance: representative signals classify to one intake type with confidence above `0.6`.

## 3. Emphasize Skills and Procedures

Select the reusable knowledge and sequences the workspace uses most often.

- Every default Skill resolves to a checked-in Skill.
- Every Procedure preference resolves to a checked-in Procedure.
- Every document class has an accountable Assignment responsibility and acceptance gate.
- Worker selection remains a Plan decision constrained by required Capabilities and Policy.

The Preset must not embed copies of Worker Profiles, Skills, Procedures, or Policies. It
references their identifiers so each concept keeps one owner.

## 4. Validate

Run the classifier against at least five representative signals. Record precision, recall, and
median routing confidence, then inspect the resulting Plan and Artifact selection.

Acceptance:

- precision and recall are both at least `0.7`;
- canonical signals do not resolve to `unknown`;
- all referenced Skills, Procedures, document classes, and Capabilities exist;
- the Preset does not grant authority beyond the active Workspace Policy.

## 5. Promote

Promotion moves a validated draft into the canonical Preset catalog. The change includes its
requirements evidence and validation results.

Promotion does not create aliases or duplicate the Preset into multiple catalogs. One resolved
record is authoritative for a Workspace.

## 6. Monitor

Measure classification quality, Assignment outcomes, Artifact acceptance, and Skill/Procedure
use for the active Preset. A material quality drop starts a new draft revision; monitoring data
does not silently mutate the promoted record.

## 7. Retire

Retirement removes the Preset from selection while preserving its requirements, validation, and
outcome evidence. Existing Runs and Artifacts keep the Preset id needed for provenance. New
Workspaces cannot select a retired Preset, and generated host adapters must not retain it.

## Canonical ownership

| Concern | Owner |
|---|---|
| Preset record | `registry/workspace-presets/<id>.json` |
| Runtime loading and resolution | `lib/workspace-presets/` |
| Project selection | `construct.config.json` field `workspacePreset` |
| Drafts and validation evidence | `.construct/workspace-presets/draft-<id>/` |
| Intake classification implementation | `lib/intake/` |
| Skills | `skills/` and `lib/skills/` |
| Procedures | `registry/procedures/` and `lib/procedures/` |
| Worker Profiles | `registry/worker-profiles/` and `lib/worker-profiles/` |

The machine-readable ownership and naming contract is
`config/canonical-terminology.json`; the architecture guide is the human-readable source of
truth.
