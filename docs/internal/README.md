# Internal records

Records that current tooling and documentation read. Nothing here describes
how to use Construct; current documentation is one level up, in `docs/`.

- `releases/`: the experimental-alpha release records. Each
  `releases/<version>.json` manifest names its evidence by path and SHA-256:
  the run folder `releases/<version>-<timestamp>/` that
  `npm run release:live` writes, and the fresh-user observations in
  `releases/observations/`. `npm run release:check` reads the manifest for
  the package version and verifies every file it cites.
- `skill-runs/`: dated records of method skills run on real work, cited by
  `skills/AUTHORING.md` and `skills/README.md`.
