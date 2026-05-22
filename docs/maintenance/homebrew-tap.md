# Homebrew tap

Construct ships a Homebrew formula via a personal tap so users without Node can install the SEA binary with `brew install`. The active formula lives in a separate repository (`geraldmaron/homebrew-construct`). The release workflow auto-bumps it on every `v*` tag push.

## End-user install

```bash
brew install geraldmaron/construct/construct   # one-time
brew upgrade construct                          # whenever a new release ships
construct init                                 # first time on the machine
```

The formula drops one binary into `/opt/homebrew/bin/construct` (Apple Silicon) or `/usr/local/bin/construct` (Intel macOS / Linuxbrew). No Node, no Docker required at install time. Construct's optional resources (Postgres via Docker, embedding model) are probed and bootstrapped on demand at first use.
If Homebrew reports that `bin/construct` is already occupied by an npm global
install or another shim, choose the owner explicitly with `brew link --overwrite
construct` or remove the older binary before linking.

## One-time tap setup (do this once before the first release)

1. **Create the tap repository.** Homebrew requires the repo name to start with `homebrew-`:

   ```bash
   gh repo create geraldmaron/homebrew-construct --public --description "Homebrew tap for Construct"
   git clone https://github.com/geraldmaron/homebrew-construct
   cd homebrew-construct
   mkdir -p Formula
   ```

2. **Seed the initial formula.** Copy the template from this repo and replace the placeholder SHAs with the actual SHA-256 values from the first GitHub Release:

   ```bash
   cp /path/to/construct/templates/homebrew/construct.rb Formula/construct.rb
   # Edit Formula/construct.rb — replace each REPLACE_ON_FIRST_RELEASE_* placeholder
   # with the matching sha from https://github.com/geraldmaron/construct/releases/tag/v0.1.0
   # (each binary has a sibling .sha256 file with the digest)
   git add Formula/construct.rb
   git commit -m "construct 0.1.0"
   git push
   ```

3. **Create a personal access token** with `repo` scope on the tap repository. GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new → Repository access = only `geraldmaron/homebrew-construct`, Repository permissions = Contents (read+write) and Pull requests (read+write).

4. **Wire the token into the construct repo.**
   - Repo Settings → Secrets and variables → Actions → Secrets → New repository secret → name `HOMEBREW_TAP_TOKEN`, paste the PAT.
   - Same page → Variables → New repository variable → name `HOMEBREW_TAP_ENABLED`, value `true`. The release workflow's `homebrew` job is gated on this variable so it stays inert until you opt in.

5. **Test the end-to-end install** on a clean machine:

   ```bash
   brew install geraldmaron/construct/construct
   construct --help
   ```

## How auto-bump works after that

On every `v*` tag push to the construct repo, `.github/workflows/release.yml` runs (in order):

1. `gate` — full test suite, lint, npm audit.
2. `build-binary` — SEA binary per platform with SHA-256 sidecar.
3. `docker` — image to ghcr.io with Trivy scan.
4. `publish` — `npm publish --provenance --access public` (OIDC Trusted Publishers, no static token) + GitHub Release with all binaries + sha256 files.
5. `homebrew` — an inline script downloads the sha256 sidecars from the release, regenerates `Formula/construct.rb` from scratch with the new version and per-platform URLs/SHAs, clones `geraldmaron/homebrew-construct`, commits the updated formula, and pushes directly to the tap's default branch.

The inline script reads each platform's SHA from the matching GitHub Release asset sidecar, so the formula always references a verified artifact. If the job fails (token missing, tap repo rate-limited, formula syntax invalid), the release itself is unaffected — the `homebrew` job is downstream of `publish` and its failure does not retroactively undo npm publish or the GH Release.

## Disabling the bump

Two ways:

- **Quick disable for a single release**: set `HOMEBREW_TAP_ENABLED` repository variable to `false` (or delete it) before tagging. The job's `if:` skips it.
- **Permanent removal**: delete the `homebrew` job from `.github/workflows/release.yml`.

## Why a personal tap and not homebrew-core

Homebrew-core has strict criteria — stable project (typically 1.0+), prefers source builds over downloading prebuilt binaries from random GitHub repos, no telemetry by default, no self-update mechanism in the binary. While Construct is in the 0.x pre-stable phase, a personal tap is appropriate; the formula format is identical, so migration to homebrew-core later (when there is real adoption signal and a 1.0 release) is straightforward.
