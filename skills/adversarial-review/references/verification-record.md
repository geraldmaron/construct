# Verification record and composition

Closing template for an adversarial review. Read this when the review is
ready to finalize, or when several skills share one deliverable.

## Verification record

The review ends with a short block, exactly this shape:

```
Verification record
- Steelman stated:    answered - see <where>
- All six run:        answered - <clean: <which> | findings from: <which>>
- Findings concrete:  answered - <n> findings: <n> fatal, <n> serious, <n> minor | none
- VERDICT:            <accepted | accepted with controls | needs validation | rejected>
- Self-review:        answered - <independent | shared-context, disclosed>
- No improvement drift: answered - breakage only
```

A gate that was not done says `not done - <reason>` in its slot. It is
never deleted, never skipped silently.

The record is presence, not quality: whether the strongest failure mode is
genuinely the strongest is judgment, and the record never claims to have
automated it.

## Composition

When several skills govern one deliverable, the skill that owns the
deliverable's shape produces its full record, and every other skill
contributes exactly one line to that same block - its name, then its
verdict or a one-clause gate summary - never a second full block.
Every "see <where>" carries a short quoted fragment of what it points to,
not a bare location.

## Enforcement

Nothing in the skill file is machine-enforced by that file. The posture,
the challenge set, and the record are obligations on you, made checkable
for the reader. An environment that separately checks the record's presence
adds a deterministic tier on top; the skill works identically with or
without one.
