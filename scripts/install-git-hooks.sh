#!/usr/bin/env bash
# install-git-hooks.sh — wires the repo's own checks into a real git pre-commit
# hook, so they fire regardless of which tool or agent makes the commit. Run
# once after clone. Not run automatically by npm install — a postinstall that
# mutates git hooks is exactly the kind of silent host-config mutation this
# rebirth is trying not to repeat.
#
# It installs into the ACTIVE hooks directory, which is not always .git/hooks.
# `bd init` sets core.hooksPath to .beads/hooks, and once that is set git stops
# reading .git/hooks entirely — an earlier version of this script wrote there
# unconditionally, so on any machine that had run `bd init` the hook it reported
# installing was never executed. Asking git where hooks live is the fix.
#
# Idempotent: it replaces its own marked sections and leaves the rest of the file
# — including the section beads manages — alone.
#
# Two sections, and the order is the point. The gate runs first so a secret
# never reaches a commit. The keeper runs LAST, after the beads section, because
# what it undoes is something that section does: beads re-exports the whole
# tracker database and stages it, so a commit that named two files by hand ends
# up carrying every bead any session touched. The export is worth keeping and
# the staging is not, so the keeper takes the file back out of the index unless
# the author put it there. Nothing depends on the staging: beads rewrites the
# file on every tracker write, which is what keeps the reconcile reading current
# state.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

hooks_dir="$(git -C "$repo_root" config --get core.hooksPath || true)"
[ -n "$hooks_dir" ] || hooks_dir=".git/hooks"
case "$hooks_dir" in
  /*) ;;
  *) hooks_dir="$repo_root/$hooks_dir" ;;
esac
mkdir -p "$hooks_dir"
hook="$hooks_dir/pre-commit"

begin="# --- BEGIN CONSTRUCT GATE ---"
end="# --- END CONSTRUCT GATE ---"
keeper_begin="# --- BEGIN CONSTRUCT TRACKER KEEPER ---"
keeper_end="# --- END CONSTRUCT TRACKER KEEPER ---"

# secret-scan blocks: leaking a credential is worse than a false positive, and
# it is the one deliberate exception to the fail-open rule. repo-gate only ever
# warns, so `|| true` states an invariant rather than swallowing a failure.
read -r -d '' block <<'BLOCK' || true
# --- BEGIN CONSTRUCT GATE ---
# Managed by scripts/install-git-hooks.sh — re-running the installer replaces
# this section and touches nothing else in the file.
_construct_root="$(git rev-parse --show-toplevel)"
node "$_construct_root/scripts/hooks/secret-scan.mjs" || exit 1
node "$_construct_root/scripts/hooks/repo-gate.mjs" || true
# Whether the author staged the tracker export is only knowable here, before
# the beads section stages it unconditionally. The answer is left where the
# keeper section at the end of this file can read it.
_construct_git_dir="$(git rev-parse --git-dir)"
rm -f "$_construct_git_dir/construct-tracker-staged"
if git diff --cached --name-only -- .beads/issues.jsonl | grep -q .; then
  : > "$_construct_git_dir/construct-tracker-staged"
fi
# --- END CONSTRUCT GATE ---
BLOCK

# The keeper undoes what the beads section stages, so it has to run after it.
# Everything this script manages is stripped out of the existing file first and
# put back in a known order, which is what makes re-running it idempotent no
# matter how many times it has run before.
read -r -d '' keeper_block <<'BLOCK' || true
# --- BEGIN CONSTRUCT TRACKER KEEPER ---
# Managed by scripts/install-git-hooks.sh — re-running the installer replaces
# this section and touches nothing else in the file.
#
# Last on purpose. The section above re-exports the whole tracker database and
# stages it, which attaches every bead any session touched to a commit that was
# about something else. The export is worth having and the staging is not, so
# the file comes back out of the index here. An author who staged it themselves
# meant it, and keeps it, with the fresher export the section above just wrote.
_construct_git_dir="$(git rev-parse --git-dir)"
if [ ! -e "$_construct_git_dir/construct-tracker-staged" ]; then
  git restore --staged -- .beads/issues.jsonl 2>/dev/null || true
fi
rm -f "$_construct_git_dir/construct-tracker-staged"
# --- END CONSTRUCT TRACKER KEEPER ---
BLOCK

existing=""
if [ -f "$hook" ]; then
  existing="$(awk -v b="$begin" -v e="$end" -v kb="$keeper_begin" -v ke="$keeper_end" '
    $0 == b || $0 == kb { skip = 1 }
    skip != 1 { print }
    $0 == e || $0 == ke { skip = 0 }
  ' "$hook")"
  # Drop the bare invocation the first version of this script wrote, so an
  # upgrade does not leave secret-scan running twice.
  existing="$(printf '%s\n' "$existing" | grep -v 'scripts/hooks/secret-scan.mjs' || true)"
fi

shebang="#!/usr/bin/env bash"
body="$existing"
case "$(printf '%s\n' "$existing" | head -1)" in
  '#!'*)
    shebang="$(printf '%s\n' "$existing" | head -1)"
    body="$(printf '%s\n' "$existing" | tail -n +2)"
    ;;
esac

{
  printf '%s\n' "$shebang"
  printf '%s\n' "$block"
  printf '%s\n' "$body"
  printf '%s\n' "$keeper_block"
} > "$hook"
chmod +x "$hook"

echo "installed pre-commit hook -> $hook"
if [ "$hooks_dir" != "$repo_root/.git/hooks" ]; then
  echo "note: core.hooksPath points here, so this file is tracked — the change will show in git status"
fi
