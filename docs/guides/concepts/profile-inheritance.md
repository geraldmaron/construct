---
title: Profile inheritance
description: How the extends field in profile.schema.json works, and a worked example showing a research-extended profile that adds an experiment-log intake type.
---

## What inheritance does

A profile can declare `"extends": "<parent-id>"` to inherit the parent's roles, departments, intake types, intake stages, doc templates, hooks, and default skills. The child profile then adds or overrides fields on top.

Inheritance is one level deep. A child cannot extend another child. Circular extension is rejected by the profile loader.

## Resolution order

When Construct loads a profile with `extends`, it merges the two JSON objects with child fields winning over parent fields. For array fields (`roles`, `intake.types`, `intake.stages`, `docTemplates`, `defaultSkills`) the child's array is **appended** to the parent's array, not replaced. There is no `remove` key or other mechanism to drop a parent entry from a child — see [Constraints](#constraints).

The effective resolved profile is what every other subsystem sees. The raw `extends` field is only visible to the loader.

```
parent profile (research)
  └── child profile (research-extended)
        merged at load time → effective profile
```

Field-level resolution:

| Field | Merge strategy |
|---|---|
| `id` | child wins (required, must differ from parent) |
| `displayName` | child wins |
| `tagline` | child wins if present, else parent |
| `custom` | child wins |
| `roles` | parent array + child array, deduped |
| `departments` | child entries appended; same-id entries are replaced |
| `intake.types` | parent array + child array, deduped by value |
| `intake.stages` | child wins if present, else parent |
| `docTemplates` | parent array + child array, deduped |
| `hooks` | child keys win; unset keys fall through to parent |
| `defaultSkills` | parent array + child array, deduped |
| `rebrand` | child keys win; unset keys fall through to parent |

## Worked example

The built-in `research` profile covers academic and applied research workflows. The example below shows a `research-extended` custom profile that adds an `experiment-log` intake type for teams that track experiments as first-class signals.

### Parent: `research` (excerpt)

```json
{
  "id": "research",
  "displayName": "Research",
  "extends": null,
  "roles": ["cx-researcher", "cx-analyst", "cx-product-manager"],
  "intake": {
    "types": ["signal", "finding", "requirement", "question"],
    "stages": ["inbox", "classify", "assign", "analyze", "synthesize", "archive"]
  },
  "docTemplates": ["research-brief", "research-finding", "evidence-brief"]
}
```

### Child: `research-extended`

```json
{
  "$schema": "https://geraldmaron.github.io/construct/schemas/scope.schema.json",
  "id": "research-extended",
  "displayName": "Research (extended)",
  "tagline": "Research workflow with experiment tracking.",
  "extends": "research",
  "custom": true,
  "roles": ["cx-experiment-lead"],
  "intake": {
    "types": ["experiment-log"],
    "stages": []
  },
  "docTemplates": ["runbook"]
}
```

### Effective resolved profile

After the loader merges parent into child:

```json
{
  "id": "research-extended",
  "displayName": "Research (extended)",
  "tagline": "Research workflow with experiment tracking.",
  "extends": "research",
  "custom": true,
  "roles": [
    "cx-researcher",
    "cx-analyst",
    "cx-product-manager",
    "cx-experiment-lead"
  ],
  "intake": {
    "types": ["signal", "finding", "requirement", "question", "experiment-log"],
    "stages": ["inbox", "classify", "assign", "analyze", "synthesize", "archive"]
  },
  "docTemplates": ["research-brief", "research-finding", "evidence-brief", "runbook"]
}
```

The child's `roles` array appended `cx-experiment-lead` to the parent's three roles. The child's `intake.types` appended `experiment-log` to the four parent types. Because the child left `intake.stages` as an empty array, the parent's stage sequence is carried through unchanged. The child's single new `docTemplate` was appended.

## Where extends is defined

The `extends` field is declared in `schemas/scope.schema.json`:

```json
"extends": { "type": ["string", "null"] }
```

The loader lives in `lib/scopes/`. Curated profiles (e.g. `profiles/research.json`) always have `"extends": null`. Custom profiles at `.cx/scope.json` may point at any curated id.

## Constraints

- Maximum inheritance depth: 1. A child profile cannot itself be a parent.
- The parent must be a curated profile (exists in `profiles/<id>.json`). Custom profiles cannot extend other custom profiles.
- Array deduplication is string-equality based. Two entries that are logically the same but spelled differently are kept as two entries.
- Removing a parent entry requires editing the parent directly or creating a new curated profile without that entry. There is no `remove` key or other selective-removal mechanism.
