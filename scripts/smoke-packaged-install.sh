#!/usr/bin/env bash
# smoke-packaged-install.sh — the consumer's experience, tested before any
# consumer exists. v2's history is full of packaging defects (missing files
# in the tarball, broken postinstall) found only after users hit them.
# `npm pack` -> install the tarball into a scratch project -> run the CLI.
#
# It exercises the spine (outcome, log, inbox, decide) and not just the Phase 0
# surface, because the spine is the only code path that opens node:sqlite and
# writes to the state dir — exactly the packaging-defect class this script says
# it exists to catch. doctor and version load almost nothing by comparison, so a
# tarball missing dist/kernel/store could pass the old script comfortably.
#
# Every command below runs under an isolated HOME. That is not tidiness: `doctor`
# and `cleanup` inspect the user's real state directory, so before the isolation
# was added this script's own runs were reading the developer's ~/.construct.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

fail() {
  echo "smoke-packaged-install: FAIL — $1" >&2
  [ $# -gt 1 ] && printf '%s\n' "$2" >&2
  exit 1
}

expect_contains() {
  case "$2" in
    *"$3"*) ;;
    *) fail "$1 did not mention \"$3\"" "$2" ;;
  esac
}

echo "== building =="
cd "$repo_root"
npm run build --silent

echo "== packing =="
tarball="$(npm pack --silent --pack-destination "$scratch")"
tarball_path="$scratch/$tarball"

echo "== installing into scratch project =="
project="$scratch/project"
mkdir -p "$project"
cd "$project"
npm init -y --silent >/dev/null
npm install --silent "$tarball_path"

# From here on the packaged CLI sees a home of its own. Set after `npm install`,
# which needs the real one for its cache and registry config. XDG_* are pinned
# rather than unset so a machine that already exports them cannot escape.
export HOME="$scratch/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_STATE_HOME="$HOME/.local/state"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
# Whoever runs this script is itself very likely a detected host. In-session
# outcome does not staff from the keyword map; this smoke is the terminal-first
# packaged path and must not inherit the runner's session markers.
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CURSOR_AGENT CURSOR_CLI BOB_SHELL_CLI_IDE_SERVER_PORT
mkdir -p "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
store="$XDG_DATA_HOME/construct/construct.db"

echo "== running construct doctor from the packaged install =="
npx --no-install construct doctor

echo "== running construct version =="
npx --no-install construct version

# The skills ship inside the tarball, so a consumer who never touches git can
# still install one into a host's skills directory. The path from the built
# `dist/` back to `skills/` is the thing that breaks silently: it resolves
# relative to the module, and the checkout and the package lay out differently.
# So this installs a real skill from the packaged install and compares bytes.
echo "== the packaged install carries the skills and can plant one =="
skills_list="$(npx --no-install construct skills list 2>&1)" \
  || fail "skills list exited non-zero" "$skills_list"
printf '%s\n' "$skills_list"
case "$skills_list" in
  *"carries no skill files"*) fail "the packaged install found no skills" "$skills_list" ;;
esac
expect_contains "skills list" "$skills_list" "investigative-research"

host_skills="$scratch/host-skills"
install_out="$(npx --no-install construct skills install investigative-research --dir="$host_skills" 2>&1)" \
  || fail "skills install exited non-zero" "$install_out"
printf '%s\n' "$install_out"
planted="$host_skills/investigative-research/SKILL.md"
[ -f "$planted" ] || fail "skills install wrote no SKILL.md" "$install_out"
cmp -s "$planted" "$repo_root/skills/investigative-research/SKILL.md" \
  || fail "the planted skill is not byte-identical to the one this repository ships"

installed_out="$(npx --no-install construct skills installed --dir="$host_skills" 2>&1)" \
  || fail "skills installed exited non-zero" "$installed_out"
expect_contains "skills installed" "$installed_out" "current"

echo "== running construct cleanup --dry-run from the packaged install =="
npx --no-install construct cleanup --dry-run

echo "== recording an outcome from the packaged install =="
outcome_out="$(npx --no-install construct outcome \
  'launch a paid beta to EU users next month')" \
  || fail "construct outcome exited non-zero" "$outcome_out"
printf '%s\n' "$outcome_out"

run_id="$(printf '%s\n' "$outcome_out" | awk '/^run /{print $2; exit}')"
[ -n "$run_id" ] || fail "construct outcome printed no run id" "$outcome_out"
expect_contains "construct outcome" "$outcome_out" "implicated domains"

# The point of the whole addition: the store has to exist, on disk, written by
# the tarball's own copy of node:sqlite. A dist/ or files[] change that drops
# the store module fails here and nowhere earlier.
[ -f "$store" ] || fail "the spine did not create its store at $store"

echo "== reading the run back =="
log_out="$(npx --no-install construct log --run "$run_id")" \
  || fail "construct log exited non-zero" "$log_out"
printf '%s\n' "$log_out"
expect_contains "construct log" "$log_out" "entries (append-only)"
case "$log_out" in
  *"no work log entries"*) fail "the run was not recorded — construct log read back nothing" ;;
esac

echo "== reading the decision inbox =="
inbox_out="$(npx --no-install construct inbox)" \
  || fail "construct inbox exited non-zero" "$inbox_out"
printf '%s\n' "$inbox_out"
# Empty is the correct state: no roles have been dispatched, so nothing has
# disagreed yet. Asserting the empty message rather than just the exit code is
# what makes this a read of the store instead of a read of nothing.
expect_contains "construct inbox" "$inbox_out" "decision inbox: empty"

echo "== resolving a decision that does not exist =="
# `decide` needs a decision, and raising one needs roles to have disagreed —
# which needs a host, which this script deliberately does not have. So the
# command is exercised against a missing id. That still proves what this script
# is for: the command loaded, opened the store from the tarball, queried it, and
# failed for the one reason it should. A packaging defect fails differently.
set +e
decide_out="$(npx --no-install construct decide no-such-decision 'ship it' 2>&1)"
decide_status=$?
set -e
printf '%s\n' "$decide_out"
[ "$decide_status" -ne 0 ] || fail "construct decide accepted a decision that does not exist"
expect_contains "construct decide" "$decide_out" "no open decision no-such-decision"

echo "== a state dir the CLI cannot write =="
# A past regression lived here: doctor called an unwritable data dir
# healthy, and the next command died with a node:sqlite stack trace. chmod does
# not bind root, so under a root CI container the check would pass vacuously —
# skip it out loud instead.
if [ "$(id -u)" -eq 0 ]; then
  echo "   skipped: running as root, chmod would not bind"
else
  closed="$scratch/closed"
  mkdir -p "$closed"
  chmod 500 "$closed"
  trap 'chmod 700 "$closed" 2>/dev/null; rm -rf "$scratch"' EXIT

  set +e
  closed_doctor="$(XDG_DATA_HOME="$closed" npx --no-install construct doctor 2>&1)"
  closed_doctor_status=$?
  closed_outcome="$(XDG_DATA_HOME="$closed" npx --no-install construct outcome 'ship a thing' 2>&1)"
  closed_outcome_status=$?
  set -e

  [ "$closed_doctor_status" -ne 0 ] || fail "doctor exited 0 on a store it cannot open" "$closed_doctor"
  expect_contains "construct doctor" "$closed_doctor" "FAIL store"
  expect_contains "construct doctor" "$closed_doctor" "permission denied"

  [ "$closed_outcome_status" -ne 0 ] || fail "outcome exited 0 with no store" "$closed_outcome"
  expect_contains "construct outcome" "$closed_outcome" "cannot open the store at"
  case "$closed_outcome" in
    *"    at "*) fail "a permissions problem printed a stack trace" "$closed_outcome" ;;
    *node:sqlite*) fail "the error named node:sqlite at the user" "$closed_outcome" ;;
  esac

  chmod 700 "$closed"
  trap 'rm -rf "$scratch"' EXIT
fi

# The successor must survive its own uninstaller. v3 resolves its
# directories from the same XDG variables under the same app name as the
# predecessor, so `~/.local/share/construct` is at once "a v2 trace" and the
# running Construct's home. Before the fix, `construct cleanup --yes` deleted the
# store holding every work log entry, task row and raised decision, plus the
# capability secret — and the append-only triggers do not help, because the file
# is unlinked rather than written to.
#
# This runs LAST on purpose: by now the spine has written a real store through
# the packaged install, which is the only state in which the bug is reachable.
echo "== cleanup must not eat the store it is standing in =="
[ -f "$store" ] || fail "the store should exist by now — the earlier spine steps write it"
store_before="$(wc -c < "$store")"

cleanup_out="$(npx --no-install construct cleanup --yes --all 2>&1)" \
  || fail "cleanup exited non-zero" "$cleanup_out"
printf '%s\n' "$cleanup_out"

[ -f "$store" ] || fail "cleanup deleted the running Construct's store" "$cleanup_out"
store_after="$(wc -c < "$store")"
[ "$store_before" = "$store_after" ] \
  || fail "cleanup altered the store ($store_before -> $store_after bytes)" "$cleanup_out"
expect_contains "cleanup" "$cleanup_out" "kept"

echo "smoke-packaged-install: pass"
