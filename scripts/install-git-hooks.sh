#!/usr/bin/env bash
# install-git-hooks.sh — points every checkout of this repository that carries
# the tracked .githooks at its own copy, so the commit gate runs whichever tool
# or agent commits. Run once after clone, and again in the main checkout after a
# merge that brings .githooks to checkouts that lacked it. npm install never
# runs it: a postinstall that rewrites git configuration is the silent host
# mutation this project avoids.
#
# The path is set per checkout (git config --worktree), never repository-wide.
# A shared setting would point checkouts that do not yet have .githooks at a
# directory they lack, and git runs no hooks at all from a missing directory.
# A checkout without .githooks keeps whatever it resolves today and is named,
# so nothing loses its gate silently. Each change is verified by reading back
# the path git actually resolves there.
set -euo pipefail

git config extensions.worktreeConfig true
status=0
while IFS= read -r line; do
  case "$line" in worktree\ *) checkout="${line#worktree }" ;; *) continue ;; esac
  if [ ! -d "$checkout/.githooks" ]; then
    echo "kept:      $checkout has no .githooks yet; it still resolves $(git -C "$checkout" config --get core.hooksPath || echo '.git/hooks')"
    continue
  fi
  chmod +x "$checkout"/.githooks/*
  git -C "$checkout" config --worktree core.hooksPath .githooks
  resolved="$(git -C "$checkout" rev-parse --git-path hooks)"
  case "$resolved" in
    .githooks | "$checkout/.githooks") echo "installed: $checkout -> .githooks" ;;
    *) echo "FAILED:    $checkout still resolves $resolved" >&2; status=1 ;;
  esac
done < <(git worktree list --porcelain)
exit $status
