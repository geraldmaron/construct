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
resource, for one workflow, one executor and the one run it was asked in,
with an optional budget, and it expires. Another ticket, another executor,
another workflow, another run, or a later time is a new question, even when
the work goes to the same place.

For a write that leaves the project, the resource is the destination the
step is handed, so the question names where the work goes. It also says
whether that is a source you or your assistant declared (with its address
and sensitivity), the most sensitive material the work rests on, how many
of its citations have no known sensitivity, which checks were waived
earlier in the run, and that Construct cannot see where your assistant's
connector writes. Who the work is for appears last, quoted as your
assistant's description, which Construct did not check.

## Answers only you can give

Approving a write outside the project or a destructive action, accepting a
deliverable or making it final, making the project a side project, and
confirming a replacement, a ruled-out term, or an outdated document that
remembering asked about need you on a channel of your own: a prompt the
host shows you, or `construct inbox resolve <id> <answer>` from a terminal
of your own. An answer your assistant relays to one of these questions is
refused, not recorded, and the question stays open for your own answer;
when the host can show you a prompt, Construct puts the question to you
there and quotes what your assistant relayed. A relay may still answer
other questions, decline an action, or approve other work that stays
inside the project, and those answers are recorded as relayed through the
host they came from.

## Standing grants and break-glass

A standing grant is scoped by project, action, target system and resource,
workflow, executor, maximum impact or budget, start and end, and revocation.
A break-glass grant must add a reason, a short expiry, an exact target, and
an audit event; it never disables evidence, source-integrity, or completion
gates and never transfers to another executor.

The policy engine honors both kinds of grant when it finds one, but no
command or tool creates, lists, or revokes them. The only grants in use are
the approvals you give in a run.

## How a question reaches you

When an answer only you can give is needed and the host can show you a
question from Construct itself (MCP elicitation), Construct asks you there
and waits a minute for your choice. Otherwise, or if you decline or close
the prompt, the question waits in `construct inbox`
(`construct inbox list`, `construct inbox show <id>`) for you to answer
with `construct inbox resolve <id> <answer>` from a terminal of your own.
A host hook that could answer the prompt for you turns it off. The inbox
holds decisions, approvals, clarifications, and blocks, plus proposed
statements waiting to be confirmed or retired.

Your assistant relays your answers with `decide`, and Construct records
them as relayed. `construct inbox resolve` run without a terminal, or in a
terminal an editor or agent host controls, counts as relayed too.

When a deliverable has changed since an open question about it was asked,
asking again withdraws that question and asks a current one as the
deliverable stands. Approving the older question moves nothing: a relayed approval puts the current
question to you, and your own answer is refused with the id of the current
question.

## Project policy

`policy.projectWrite` in the project configuration may be `managed` (writes
to project files happen only inside a managed outcome) or `never`.
Remembering something writes Construct's own state and is not governed by
that key; it happens only when you explicitly ask.

## The headless runner

A configured runner may claim pre-resolved steps, keep leases alive, submit
output, and read status. It cannot change project configuration, grant
itself anything, resolve your decisions, or mark its own output final.

A runner is served with `construct serve --headless --executor=<id>`, under
an id of its own such as `runner:nightly`; an id that names an interactive
session is refused. It reaches `project_write` at most, so a step above that
tier is refused with the reason, and a step that needs a decision waits for
your answer; the runner cannot give it. It cannot delegate, use the work
ledger, or remember anything.
