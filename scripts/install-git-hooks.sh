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
# --- END CONSTRUCT GATE ---
BLOCK

existing=""
if [ -f "$hook" ]; then
  existing="$(awk -v b="$begin" -v e="$end" '
    $0 == b { skip = 1 }
    skip != 1 { print }
    $0 == e { skip = 0 }
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

echo "installed pre-commit hook -> $hook"
if [ "$hooks_dir" != "$repo_root/.git/hooks" ]; then
  echo "note: core.hooksPath points here, so this file is tracked — the change will show in git status"
fi
