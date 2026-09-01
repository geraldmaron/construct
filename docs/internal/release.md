# Cutting an alpha release

Procedure for a deliberate `@geraldmaron/construct` alpha. Publish stays on
the `alpha` dist-tag; `latest` does not move here.

## Version bump (same commit)

1. Bump `package.json` and refresh the lockfile (`npm install --package-lock-only`).
2. Regenerate the committed Claude skill pack so its stamps match the new version:

   ```bash
   construct skills pack --out=.claude/skills
   ```

3. Update `CHANGELOG.md` for the version.
4. Run the full gate on the bumped tree (not on the tree from before the bump):

   ```bash
   npm run lint && npm run typecheck && npm test && npm run smoke
   ```

   `lint-skill-pack-skew` fails if step 2 was skipped. Pre-commit only warns;
   CI and `release.yml` refuse.

5. Commit with the bead trailer, push `main`, then tag and push the tag:

   ```bash
   git tag -a "v$(node -p "require('./package.json').version")" -m "…"
   git push origin "v$(node -p "require('./package.json').version")"
   ```

`release.yml` runs the gate again and publishes with OIDC provenance
(`npm publish --provenance --tag alpha`).

## Do not

- Gate on version *N*, then bump to *N+1* without regenerating the pack.
- Regenerate the pack only inside CI without committing it — the tagged tree
  must carry the pack the lint checks.
- Move the `latest` dist-tag from an alpha cut.
