---
id: reviewer-bad-lgtm-without-verification
surface: internal-role
name: reviewer
category: bad
verdict: fail
summary: Approves based only on reading the diff.
references:
  - skills/roles/reviewer.md
tags:
  - verification-gap
  - false-approval
---

## User

Review this runtime refactor before merge.

## Expected

This is a bad outcome:

```text
LGTM. The diff reads clean and the names make sense.
```

## Why This Fails

It approves on surface reading alone and ignores the review role contract to check build, tests, changed-path behavior, and blast radius.
