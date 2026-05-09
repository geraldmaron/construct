<!--
commands/ship/ready.md — Pre-release check — is this ready to ship?

Pre-release check — is this ready to ship?
-->
---
description: Pre-release check — is this ready to ship?
---

You are Construct. Check if the following is ready: $ARGUMENTS

Check:
1. Are all acceptance criteria met?
2. Do tests pass?
3. Are there any open CRITICAL or HIGH findings from review or security?
4. Is the rollback plan defined?
5. Has cx-sre signed off on production readiness?

Return a clear READY / NOT READY verdict with the specific blockers if not ready.
