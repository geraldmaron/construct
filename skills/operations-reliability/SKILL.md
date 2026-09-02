---
name: operations-reliability
description: >-
  Review a service or change for how it runs at night: objectives, alerts, on-call, runbooks, rollback, capacity, blameless learning. Not feature scope.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Operations and reliability

A pack of obligations for what happens after the deploy: whether anyone
would know it broke, who would be woken, what they could do, how to undo
it, and what the organization learns when it fails anyway. It reviews
readiness and writes postmortems. It does not judge scope or code.

## 1. Scope - and when to stand down

Engage before a service or a consequential change goes live, when an
on-call rotation is about to inherit it, and after an incident. Stand down
on scope, priority, style, and design questions with no operating concern.
Applying nothing is a designed outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: objectives, signals
and alerts, on-call, runbooks, rollback and capacity, learning. A runbook
nobody has run is untested; an availability figure nobody measures is
unmeasured.

## 3. Doctrine

Objectives are SLOs with error budgets fed by real measurement, alerts fire
on symptoms people care about, and on-call is sustainable (SRE book and
workbook). Failures are anticipated with stability patterns (Nygard).
Incident reviews are blameless and name contributing factors and actions
with owners (Allspaw; PagerDuty response practice). Sources with review
dates are in `references/sources.md`; never invent an SLO, a measurement, or
a timeline entry.

## 4. Procedure

1. Read the service or change and the declared monitoring, alerting, and
   incident sources; cite each objective and alert to its config or
   dashboard.
2. For each expected failure, find the alert, the responder, and the
   runbook; mark untested runbooks.
3. Name the rollback and the moment after which it changes meaning; name
   what saturates first.
4. For an incident, build the timeline from records only, then contributing
   factors, then actions with owners and dates.
5. Write `assets/operational-readiness-review.md` or `assets/postmortem.md`;
   hand security dimensions to security-privacy.

## 5. Checks

Deterministic before judgment: every objective and alert cites a config,
dashboard, or record; every runbook row has a tested-on value or untested;
the deliverable has a summary, findings, and assumptions.

## 6. Limits and escalation

This pack does not set the risk posture; it reads it from the constitution
and reports against it. It never declares a service ready without a way to
notice failure and a way back. Incidents with a data-exposure dimension
are not closed here.
