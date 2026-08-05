#!/usr/bin/env bash
# journey-sim.sh — recorded journey simulations against the packed spine.
#
# Runs a set of real user journeys through the CLI exactly as a consumer would
# meet it: npm pack -> install into a scratch project -> isolated HOME (the
# same pattern as smoke-packaged-install.sh, for the same reason). Journey
# texts are verbatim user-authored framings from tests/fixtures/rough-framings.json
# territory — never text written to fit a matcher.
#
# Every run this produces is a SIMULATION and is recorded as one. It exercises
# the spine and surfaces defects; it is not, and must never be recorded as,
# the external-user gate — the person running this built the system.
#
# Usage:
#   scripts/journey-sim.sh <results-dir> [provider/model]
#
# With a model, journey 1 runs hosted end to end (outcome -> work -> log ->
# inbox) and `work` is deliberately given NO flags: the run's recorded dispatch
# surface must carry the model, and a dispatch that lands anywhere else is a
# regression. Hosted runs need the host authenticated for the provider — for
# OpenRouter, OPENROUTER_API_KEY in the environment and nowhere else.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
results="${1:?usage: journey-sim.sh <results-dir> [provider/model]}"
model="${2:-}"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$results"

echo "== packing =="
cd "$repo_root"
tarball="$(npm pack --silent --pack-destination "$scratch")"

echo "== installing into scratch project =="
project="$scratch/project"
mkdir -p "$project"
cd "$project"
npm init -y --silent >/dev/null
npm install --silent "$scratch/$tarball"

export HOME="$scratch/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_STATE_HOME="$HOME/.local/state"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

cx() { npx --no-install construct "$@"; }

run_journey() {
  local name="$1" mode="$2" text="$3"
  echo "=== journey: $name (mode=$mode) ==="
  local out
  if [ "$mode" = "host" ]; then
    out="$(cx outcome --host=opencode --model="$model" "$text" 2>&1)"
  else
    out="$(cx outcome "$text" 2>&1)"
  fi
  printf '%s\n' "$out" | tee "$results/$name.outcome.txt"
  local run_id
  run_id="$(printf '%s' "$out" | grep -o 'run run-[0-9]*' | head -1 | awk '{print $2}')"
  printf '%s\n' "$run_id" > "$results/$name.runid"
  if [ "$mode" = "host" ] && [ -n "$run_id" ]; then
    # No flags on purpose: the recorded dispatch surface is under test.
    echo "--- work $run_id ---"
    cx work --run "$run_id" 2>&1 | tee "$results/$name.work.txt"
    echo "--- log ---"
    cx log --run "$run_id" 2>&1 | tee "$results/$name.log.txt"
    echo "--- inbox ---"
    cx inbox 2>&1 | tee "$results/$name.inbox.txt"
  fi
}

j1_mode=free
[ -n "$model" ] && j1_mode=host

run_journey "j1-legal-hire-poland" "$j1_mode" "We want to hire a contractor in Poland"
run_journey "j2-org-contracts" free "I need you to ensure the contracts that should exist within an organization that are often ignored are covered"
run_journey "j3-vague-leverage" free "I wanna make sure that we're getting the most out of the things that we have available to us"
run_journey "j4-scoring-judgment" free "I need you to think through the scoring for things like the historic safety"

echo "== journeys complete; artifacts in $results =="
