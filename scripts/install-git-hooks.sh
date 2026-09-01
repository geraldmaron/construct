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
# Idempotent: it replaces its own marked section and leaves the rest of the file
# — including the section beads manages — alone.
#
# One section, installed first, and what it leaves behind is an EXIT trap. The
# gate itself runs first so a secret never reaches a commit. The keeper it arms
# undoes something the beads section further down does: beads re-exports the
# whole tracker database and stages it, so a commit that named two files by hand
# ends up carrying every bead any session touched. The export is worth keeping
# and the staging is not, so the keeper takes the file back out of the index
# unless the author put it there. Nothing depends on the staging: beads rewrites
# the file on every tracker write, which is what keeps the reconcile reading
# current state.
#
# The keeper is a trap and not a section at the end of the file, which is the
# part that was learned rather than designed. The beads section exits the hook
# itself whenever its own run fails, and a keeper written as trailing lines is
# simply not reached on that path — so a failed tracker hook left the staged
# export sitting in the index, where the NEXT commit's gate read it as the
# author's own staging and kept it. The failure mode the keeper exists to
# prevent was reachable through the keeper's own absence. A trap runs on every
# exit, including that one.
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
# The keeper used to be its own trailing section. It is a trap inside the gate
# now, and these markers are kept only so that stripping still finds and removes
# the old section from a hook installed before the change.
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
# Whether the author staged the tracker export is only knowable here, before the
# beads section below stages it unconditionally. It is read back by the keeper,
# which runs in this same shell, so the answer never has to survive on disk.
_construct_tracker_staged=no
if git diff --cached --name-only -- .beads/issues.jsonl | grep -q .; then
  _construct_tracker_staged=yes
fi
# The keeper undoes what the beads section stages: that section re-exports the
# whole tracker database and stages it, which would attach every bead any
# session touched to a commit that was about something else. An author who
# staged the export themselves meant it, and keeps it, with the fresher export
# beads just wrote.
#
# It is a trap and not a block at the end of this file because the beads section
# exits the hook on its own failures. Trailing lines are not reached on that
# path, and the staged export then sits in the index until the next commit,
# whose gate reads it as the author's own staging and keeps it — the exact
# misattribution this prevents, arriving through this code not running. A trap
# runs on every exit.
_construct_keep_tracker() {
  _construct_status=$?
  if [ "$_construct_tracker_staged" = no ]; then
    git restore --staged -- .beads/issues.jsonl 2>/dev/null || true
  fi
  exit $_construct_status
}
trap _construct_keep_tracker EXIT
# --- END CONSTRUCT GATE ---
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
} > "$hook"
chmod +x "$hook"

commit_hook="$hooks_dir/commit-msg"
commit_begin="# --- BEGIN CONSTRUCT COMMIT MSG CHECK ---"
commit_end="# --- END CONSTRUCT COMMIT MSG CHECK ---"

read -r -d '' commit_block <<'COMMIT_BLOCK' || true
# --- BEGIN CONSTRUCT COMMIT MSG CHECK ---
# Managed by scripts/install-git-hooks.sh
_construct_root="$(git rev-parse --show-toplevel)"
node "$_construct_root/scripts/hooks/commit-trailers.mjs" check "$1" || exit 1
# --- END CONSTRUCT COMMIT MSG CHECK ---
COMMIT_BLOCK

commit_existing=""
if [ -f "$commit_hook" ]; then
  commit_existing="$(awk -v b="$commit_begin" -v e="$commit_end" '
    $0 == b { skip = 1 }
    skip != 1 { print }
    $0 == e { skip = 0 }
  ' "$commit_hook")"
fi

commit_shebang="#!/usr/bin/env bash"
commit_body="$commit_existing"
case "$(printf '%s\n' "$commit_existing" | head -1)" in
  '#!'*)
    commit_shebang="$(printf '%s\n' "$commit_existing" | head -1)"
    commit_body="$(printf '%s\n' "$commit_existing" | tail -n +2)"
    ;;
esac

{
  printf '%s\n' "$commit_shebang"
  printf '%s\n' "$commit_block"
  printf '%s\n' "$commit_body"
} > "$commit_hook"
chmod +x "$commit_hook"

prepare_hook="$hooks_dir/prepare-commit-msg"
prepare_begin="# --- BEGIN CONSTRUCT COMMIT MSG STRIP ---"
prepare_end="# --- END CONSTRUCT COMMIT MSG STRIP ---"

read -r -d '' prepare_block <<'PREPARE_BLOCK' || true
# --- BEGIN CONSTRUCT COMMIT MSG STRIP ---
# Managed by scripts/install-git-hooks.sh
_construct_root="$(git rev-parse --show-toplevel)"
node "$_construct_root/scripts/hooks/commit-trailers.mjs" strip "$1"
# --- END CONSTRUCT COMMIT MSG STRIP ---
PREPARE_BLOCK

prepare_existing=""
if [ -f "$prepare_hook" ]; then
  prepare_existing="$(awk -v b="$prepare_begin" -v e="$prepare_end" '
    $0 == b { skip = 1 }
    skip != 1 { print }
    $0 == e { skip = 0 }
  ' "$prepare_hook")"
fi

prepare_shebang="#!/usr/bin/env sh"
prepare_body="$prepare_existing"
case "$(printf '%s\n' "$prepare_existing" | head -1)" in
  '#!'*)
    prepare_shebang="$(printf '%s\n' "$prepare_existing" | head -1)"
    prepare_body="$(printf '%s\n' "$prepare_existing" | tail -n +2)"
    ;;
esac

{
  printf '%s\n' "$prepare_shebang"
  printf '%s\n' "$prepare_body"
  printf '%s\n' "$prepare_block"
} > "$prepare_hook"
chmod +x "$prepare_hook"

echo "installed pre-commit hook -> $hook"
echo "installed commit-msg hook -> $commit_hook"
echo "installed prepare-commit-msg strip -> $prepare_hook"
if [ "$hooks_dir" != "$repo_root/.git/hooks" ]; then
  echo "note: core.hooksPath points here, so this file is tracked — the change will show in git status"
fi
