---
name: first-run
description: >-
  When someone talks in a host they already have, in ordinary language,
  first-run is talk, a run, and a seat they did not name from ground that
  is actually visible. The shipped binary does not meet that bar. Do not
  tell them staff showed up. Do not treat talk as a created run. Stand
  down when they are already inside a run, or when they asked for a
  terminal verb walkthrough.
license: Apache-2.0
metadata:
  version: 0.1.0
  source: geraldmaron/construct
---

# First run

This file is for the host, not a verb the person types.

First-run is 1+3: they talk in the host they already have, in ordinary
language; a run exists; a seat they did not name can show up from ground
Construct can see (repos, directories, and sources in reach, plus the
words they said). They never type a catalog word, a CLI verb, or
`record_outcome`. Keyword `construct outcome` is not first-run.

That is the contract. It is not what the shipped binary does. Ordinary
talk still leaves an empty work log. The host must still call
`record_outcome`, and omitting namings is still an error. Do not say
staff showed up. Do not say talk already created a run. Do not say
namings are optional, or that Construct already adds unnamed seats.

`construct serve` is how this session is pointed at Construct. It is not
beat two and not a verb lesson.

## 1. Scope - and when to stand down

Engage when they just spoke in this host and no run is on the board yet.
Stand down when they are already inside a run, when the call is a
terminal walkthrough, or when they asked for a verb. Applying nothing is
a designed outcome.

## 2. What you do

Stay in this conversation. Do not ask them to type a command.

If `record_outcome` is on your tool list, call it this turn with namings
for the words they said. An empty namings list means this implicates
nothing; say that. Do not invent a seat. Do not print the catalog.

If `record_outcome` is not on your tool list, recording did not attach.
Stay here. Do not restart. Do not ask them to type a verb. A file for
later is a miss.

If they are on a box with no host session, first-run is still talk in a
host they already have (Cursor, Claude Code, Codex, OpenCode, or IBM
Bob). This box has no host session. Do not send them to
`construct outcome`.

Empty staff after a host read is a miss, not a success. Do not cover
that miss by saying staff showed up.

## 3. When the call is theirs

The only Construct-shaped surface is an inbox card, and only when the
decision is actually theirs: what happened, what they decide, one
action. The host relays the call. They stay in the conversation. Do not
print a decide verb or an id they must type. Do not make catalog
concern names the thing they must read to act.

## 4. Record

Before you close the turn, the reply carries this block, each line
answered or marked undone:

```
FIRST-RUN RECORD
Talk heard: <their words, or undone>
record_outcome called this turn: yes / no / not on the tool list
Namings sent: <domains, or empty, or omitted>
Run on the log: yes / no
Unnamed seat from visible ground: no — the shipped binary does not
  add one
Staff-showed-up claimed: no
```

A missing line is the miss. Do not fill a no by narrating success.

## 5. What is enforced, and by what

Nothing in this file is machine-enforced by this file. The record is
visible so a reader can see whether talk became a run. An environment
that separately checks the record adds a deterministic tier on top;
this file works identically with or without one.
