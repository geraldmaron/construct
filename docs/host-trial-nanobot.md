# Host trial: the projection inside nanobot

Dated 2026-08-13. What happened when Construct's MCP projection was attached to
a host nobody designed it for, with a real project's outcomes as the subject.

## What was set up

- **Host:** nanobot v0.3.0 (HKUDS/nanobot, Python, MIT), installed with
  `uv tool install nanobot-ai`. This is the personal-assistant nanobot, not the
  Go MCP-host project of the same name published by obot-platform. The two are
  unrelated and the name alone does not identify either.
- **Instance:** its own config and workspace at `~/.nanobot-blackstory/`, so
  nothing touches a default instance. Attached over stdio through the
  documented key, `tools.mcpServers`:

  ```json
  { "tools": { "mcpServers": { "construct": { "command": "construct", "args": ["serve"] } } } }
  ```

- **Model:** a local model through Ollama, pinned in a preset rather than left
  to provider inference. The trial is about whether the surface survives a
  foreign host, so the run costs nothing and needs no key. `apiBase` must carry
  the `/v1` suffix; without it the provider answers `404 page not found` before
  any tool is reached, and the error names neither the provider nor the URL.
- **Subject:** BlackStory, a place-connected historical research platform, whose
  operator work is research triage and therefore the kind of decision the inbox
  exists for.

## What held

The projection loaded unmodified and the host model used it. It read the
catalog, then recorded three real outcomes with its own namings, each with a
stated reason, and every one of them passed the kernel's admission gate. The
runs are readable from the standalone CLI with the inference attributed to the
namer, which is the whole claim of the inversion working through a surface that
knew nothing about it:

```
343  implication-named  (inferred by: namer — a model read the outcome)
344  product-scoping    domain-implicated
```

Presence held its line as designed. Nothing dispatched, nothing advanced
completion, and no capability token was placed in the instance. That last one is
a standing condition of this trial, not an oversight: nanobot can enable chat
channels reachable from outside the machine, and a host holding a role's write
capability must never be one of them.

## What it exposed

**The host reaches whatever Construct is installed, not the repository.** The
machine's `construct` was 3.0.0-alpha.5 and answered with fifteen domains while
the working tree already carried seventeen. Nothing warned about the gap on
either side. A user who reads a catalog through a host is reading a released
catalog, and any claim about coverage made from inside a host is a claim about
the installed version.

**A missing concern is answered by the nearest available one.** Asked to record
"the atlas states its coverage by decade and region, so an empty area reads as a
known gap rather than as an absence of history," the model named `measurement`
and gave a reason that reads perfectly: declaring coverage makes what has been
recorded observable. It is the wrong concern. `measurement` asks whether a claim
about behavior can be observed; whether a collection's silence is a bias is a
different question, and the catalog now carries `coverage-gaps` for it. On the
installed version there was nothing else to name, and nothing in the record said
so — which is the behavior the unmet-concern record was built to end.

This is one run on one model and is written down as an observation, not a
measurement. It is worth stating only because it is the failure the catalog work
predicted, arriving unprompted from a model that had never read the argument.

## What is not settled

- Whether the inbox actually gets used more when it is reachable from a chat
  surface. Three recorded outcomes prove the path, not the habit.
- Whether nanobot is worth an execution adapter. That is a separate question
  from presence and turns on whether its OpenAI-compatible server reports usage;
  an adapter that cannot report cost cannot let the spend ceiling bind, and
  would record as unmeasured rather than free.
- Nothing here is a recommendation to relocate BlackStory's own scheduled
  discovery work, which stays where it is.
