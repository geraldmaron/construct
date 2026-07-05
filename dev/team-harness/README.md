# Team Harness

Local verification entry point for the team-mode control plane.

The harness expects a reachable Postgres database through `DATABASE_URL` or
`CONSTRUCT_DATABASE_URL`. It does not start Docker implicitly; operators can
point it at a local container, managed database, or CI service.

```bash
CONSTRUCT_DEPLOYMENT_MODE=team DATABASE_URL=postgres://... dev/team-harness/verify.sh
```

The script applies migrations, registers a synthetic worker, reads queue/worker
health, and runs the focused team-mode tests that do not require external model
providers.
