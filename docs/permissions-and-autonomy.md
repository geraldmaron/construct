# Permissions and autonomy

Every action Construct or a workflow step takes sits on one of six tiers:

| Tier | Default |
|---|---|
| observe | runs automatically inside existing grants |
| draft | runs automatically; produces without applying |
| project_write | needs a managed outcome and project policy; remembering happens only when you ask |
| external_write | needs action-time approval unless a narrow standing grant exists |
| destructive | needs action-time approval; a wildcard standing grant never covers it |
| licensed_judgment | never Construct's; it prepares material for a qualified person |

## Denials say what would fix them

A denied action names what was attempted, which capability or scope is
missing, what remains safe to do now, and the smallest step-up: an approval
scoped to exactly that operation. Construct never asks for all permissions
up front.

## Approvals do not widen, persist, or transfer

An approval you give covers one action tier on one target system and
resource, for one workflow and one executor, with an optional budget, and
it expires. Another ticket, another executor, another workflow, or a later
time is a new question.

## Standing grants and break-glass

A standing grant is scoped by project, action, target system and resource,
workflow, executor, maximum impact or budget, start and end, and revocation.
A break-glass grant must add a reason, a short expiry, an exact target, and
an audit event; it never disables evidence, source-integrity, or completion
gates and never transfers to another executor.

## Project policy

`policy.projectWrite` in the project configuration may be `managed` (writes
to project files happen only inside a managed outcome) or `never`.
Remembering something writes Construct's own state and is not governed by
that key; it happens only when you explicitly ask.

## The headless runner

A configured runner may claim pre-resolved steps, keep leases alive, submit
output, and read status. It cannot change project configuration, grant
itself anything, resolve your decisions, or mark its own output final.
