---
name: security-privacy
description: >-
  Defensive review for threat model, access, secrets, data classification and retention, privacy by design, dependencies, logging. Names exposures, never exploits.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Security and privacy

A pack of obligations for what someone could reach, take, or learn that
they should not, and what the system would notice if they tried. It is a
defensive review: it names exposures, the paths that reach them, and the
checks that would stop them. It writes no exploits, no attack tooling, and
no evasion.

## 1. Scope - and when to stand down

Engage when a boundary, an access path, a secret, a data flow, or a
dependency is about to change, and before anything that touches personal
or authoritative data ships. Stand down on requests to write an exploit,
bypass a control, or evade detection (say so: defensive review only), on
protocol questions with no system in view, and on scope with no boundary or
data change. Applying nothing is a designed outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: threat model,
access, secrets, data, dependencies, detection. An exposure of
authoritative or personal data with no control is fatal and is raised at
once.

## 3. Doctrine

Verification follows the OWASP ASVS requirements and names exposure
classes from the OWASP Top 10; development practices are read against the
NIST SSDF. Threats are walked per component and flow using the STRIDE
categories. Data handling is read against the GDPR principles of
minimization, purpose limitation, storage limitation, and privacy by design
(Articles 5 and 25) as design obligations; whether a regulation applies to
a given flow is a qualified person's judgment, handed to governance-risk.
Controls are named in ISO 27001 vocabulary. Sources with review dates are
in `references/sources.md`; never invent an advisory, a control, or a
legal conclusion.

## 4. Procedure

1. Draw the components, flows, and trust boundaries from the code and
   configuration; cite each.
2. Walk STRIDE per boundary; for each threat name the control present or
   absent with its evidence.
3. Trace every access path to where authentication and authorization are
   checked; name unchecked paths.
4. Find where secrets live and where they could leak (logs, committed
   config, error messages).
5. Classify each kind of data, its retention, its boundary crossings, and
   whether it is minimized; note backups and logs as flows.
6. Check dependencies against their advisories; cite each.
7. Write `assets/security-privacy-review.md`; raise fatal exposures
   immediately and hand regulatory questions to governance-risk.

## 5. Checks

Deterministic before judgment: every finding names a path and a control
status with a citation; every data row has a classification and retention;
the deliverable has a summary, findings, and assumptions.

## 6. Limits and escalation

Defensive only: this pack never produces working attack material, and a
request for it is declined in one sentence. It never judges lawfulness; it
spots the question and names the regulation, and a qualified person
decides. A fatal exposure is not held for the report.
