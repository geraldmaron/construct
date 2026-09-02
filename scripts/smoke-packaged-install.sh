#!/usr/bin/env bash
# smoke-packaged-install.sh — the consumer's experience from packaged bytes.
# npm pack -> install the tarball into a scratch project -> run the CLI there.
#
# It runs the spine that opens node:sqlite and writes the project's one state
# database, because that is the code path a packaging defect breaks: a tarball
# missing dist/kernel/state passes `version` comfortably and fails here.
# Every command runs under an isolated HOME so nothing reads the developer's.
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

echo "== installing into a scratch project =="
project="$scratch/project"
mkdir -p "$project"
cd "$project"
npm init -y --silent >/dev/null
npm install --silent "$tarball_path"
git init -q .
printf '# Scratch\n\nA scratch project for the packaged smoke.\n' > README.md

export HOME="$scratch/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_STATE_HOME="$HOME/.local/state"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CURSOR_AGENT CURSOR_CLI BOB_SHELL_CLI_IDE_SERVER_PORT
mkdir -p "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

echo "== version =="
npx --no-install construct version

echo "== doctor before init refuses to call a missing project healthy =="
set +e
predoctor="$(npx --no-install construct doctor 2>&1)"
predoctor_status=$?
set -e
[ "$predoctor_status" -ne 0 ] || fail "doctor exited 0 with no project" "$predoctor"
expect_contains "doctor" "$predoctor" "FAIL project"

echo "== init from the packaged install =="
skills_dir="$scratch/host-skills"
init_out="$(npx --no-install construct init --scale=solo --outcome='prove the packaged spine' --constraint='never write outside the scratch project' --skills-dir="$skills_dir" 2>&1)" \
  || fail "construct init exited non-zero" "$init_out"
printf '%s\n' "$init_out"
expect_contains "init" "$init_out" "Initialized Construct project"
[ -f "$project/.construct/project.json" ] || fail "init wrote no project.json"
[ -f "$project/.construct/constitution.json" ] || fail "init wrote no constitution.json"
[ -f "$project/.construct/sources.json" ] || fail "init wrote no sources.json"
[ -f "$project/.construct/registry.lock.json" ] || fail "init wrote no registry.lock.json"
[ -f "$project/.construct/state/construct.sqlite" ] || fail "the spine did not create its database"
[ "$(ls "$project/.construct/state" | wc -l | tr -d ' ')" = "1" ] || fail "more than one file under .construct/state"
[ -f "$skills_dir/construct/SKILL.md" ] || fail "init did not plant the operational skill" "$init_out"
cmp -s "$skills_dir/construct/SKILL.md" "$repo_root/skills/construct/SKILL.md" \
  || fail "the planted operational skill is not byte-identical to the shipped one"
grep -q '^\.construct/state/$' "$project/.gitignore" || fail "init did not ignore .construct/state/"
[ ! -e "$XDG_DATA_HOME/construct" ] || fail "init created a per-user data directory; project truth must stay in the project"

echo "== status and doctor =="
status_out="$(npx --no-install construct status 2>&1)" || fail "status exited non-zero" "$status_out"
printf '%s\n' "$status_out"
expect_contains "status" "$status_out" "setup: confirmed"
doctor_out="$(npx --no-install construct doctor 2>&1)" || fail "doctor exited non-zero" "$doctor_out"
printf '%s\n' "$doctor_out"
expect_contains "doctor" "$doctor_out" "doctor: healthy"
status_json="$(npx --no-install construct status --json)" || fail "status --json exited non-zero"
node -e 'const r=JSON.parse(process.argv[1]); if (r.onboarding.state!=="confirmed") process.exit(1)' "$status_json" || fail "status --json did not report confirmed onboarding" "$status_json"

echo "== configuration is explained =="
explain_out="$(npx --no-install construct config explain locale)" || fail "config explain exited non-zero"
expect_contains "config explain" "$explain_out" "built-in default"
npx --no-install construct config set review.cadence weekly >/dev/null || fail "config set exited non-zero"
get_out="$(npx --no-install construct config get review.cadence)"
[ "$get_out" = "weekly" ] || fail "config get read back \"$get_out\", expected weekly"

echo "== a directory source is declared, read, and re-read unchanged =="
add_out="$(npx --no-install construct source add repo --kind=directory --purpose='the project files' --locator="$project" --authority=authoritative --authoritative-for=code_component 2>&1)" \
  || fail "source add exited non-zero" "$add_out"
refresh1="$(npx --no-install construct source refresh repo 2>&1)" || fail "source refresh exited non-zero" "$refresh1"
expect_contains "source refresh" "$refresh1" "changed"
refresh2="$(npx --no-install construct source refresh repo 2>&1)" || fail "second source refresh exited non-zero" "$refresh2"
expect_contains "second source refresh" "$refresh2" "unchanged"
list_out="$(npx --no-install construct source list)" || fail "source list exited non-zero"
expect_contains "source list" "$list_out" "reachable"

echo "== a workflow resolves, starts, and is read back from packaged bytes =="
wf_list="$(npx --no-install construct workflow list 2>&1)" || fail "workflow list exited non-zero" "$wf_list"
expect_contains "workflow list" "$wf_list" "design-conformance"
wf_run="$(npx --no-install construct workflow run design-conformance --input=target=README.md --json 2>&1)" || fail "workflow run exited non-zero" "$wf_run"
run_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).run.id)' "$wf_run")"
[ -n "$run_id" ] || fail "workflow run printed no run id" "$wf_run"
run_show="$(npx --no-install construct run show "$run_id" 2>&1)" || fail "run show exited non-zero" "$run_show"
expect_contains "run show" "$run_show" "step gather: ready"
inbox_out="$(npx --no-install construct inbox list 2>&1)" || fail "inbox list exited non-zero" "$inbox_out"
expect_contains "inbox list" "$inbox_out" "nothing waits on you"
cancel_out="$(npx --no-install construct run cancel "$run_id" 2>&1)" || fail "run cancel exited non-zero" "$cancel_out"
expect_contains "run cancel" "$cancel_out" "cancelled"

echo "== the whole loop over the packaged server: bootstrap, decide, remember, managed workflow, final deliverable =="
loop_project="$scratch/loop"
mkdir -p "$loop_project" && cd "$loop_project" && git init -q . && printf '# Loop\n\nA project for the packaged loop.\n' > README.md && printf '# Design\n\n- Keep the kernel host-agnostic\n' > design.md
npm init -y --silent >/dev/null && npm install --silent "$tarball_path"
loop_init="$(npx --no-install construct init --no-wire --skills-dir="$skills_dir" 2>&1)" || fail "loop init exited non-zero" "$loop_init"
expect_contains "loop init" "$loop_init" "still to answer (3)"
cat > "$scratch/drive.mjs" <<'DRIVER'
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, [process.argv[2], 'serve', '--client=cursor'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = ''; const pending = new Map(); let nextId = 1;
child.stdout.on('data', (chunk) => { buffer += chunk; let nl; while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); if (!line.trim()) continue; const msg = JSON.parse(line); const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); } } });
const rpc = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); if (r.error) throw new Error(`${name}: ${r.error.message}`); if (r.result.isError) throw new Error(`${name}: ${r.result.structuredContent?.error ?? r.result.content[0].text}`); return r.result.structuredContent ?? JSON.parse(r.result.content[0].text); };
const must = (cond, what) => { if (!cond) throw new Error(`loop: ${what}`); };
const init = await rpc('initialize', {}); must(init.result.serverInfo.name === 'construct', 'server name');
const boot = await call('bootstrap'); must(boot.profile.openQuestions.length === 3, 'three questions open at bootstrap'); must(/setup question/.test(boot.next), 'next action names the questions');
const scale = boot.profile.openQuestions.find((q) => q.options); await call('decide', { decisionId: scale.id, resolution: 'solo' });
for (const q of boot.profile.openQuestions.filter((q) => !q.options)) await call('decide', { decisionId: q.id, resolution: q.question.includes('result') ? 'prove the packaged loop' : 'never write outside this project' });
const boot2 = await call('bootstrap'); must(boot2.profile.onboarding === 'confirmed', 'onboarding confirmed after decisions');
const cls = await call('classify_request', { text: 'Remember that we will not add schema migration until stable' }); must(cls.class === 'remember', 'classified as remember');
const mem = await call('remember', { kind: 'decision', text: 'we will not add schema migration until stable' }); must(mem.nothingElseCreated === true, 'remember created nothing else');
const statements = await call('project_context', { topic: 'statements', query: 'migration' }); must(statements.length === 1, 'one statement remembered');
const cls2 = await call('classify_request', { text: 'Review this implementation against our design principles' }); must(cls2.class === 'manage', 'classified as manage');
const resolved = await call('workflows', { action: 'resolve', id: 'design-conformance', input: { target: 'README.md' } }); must(resolved.status === 'runnable', `resolvable: ${resolved.summary}`);
const started = await call('start_outcome', { workflowId: 'design-conformance', input: { target: 'README.md' } }); must(started.run.state === 'ready', 'run ready');
const outputs = { gather: { principles: ['Keep the kernel host-agnostic'], targetSummary: 'the README', unknownPrinciples: [] }, deterministic: { findings: [] }, review: { summary: 'conforms', findings: [], assumptions: [] }, record: { driftFindingIds: [], decisionIds: [] } };
for (let i = 0; i < 4; i += 1) { const c = await call('claim_work', { runId: started.run.id, includeSkillBody: i === 0 }); must(c.work, `step ${i} claimable`); if (i === 0) must(typeof c.work.skill.body === 'string' && c.work.skill.body.startsWith('---'), 'skill body loaded only when asked'); const r = await call('submit_work', { stepRunId: c.work.stepRunId, owner: c.work.owner, token: c.work.token, output: outputs[c.work.step.id], evidence: [{ ref: 'design.md' }] }); must(r.step.state === 'succeeded', `step ${c.work.step.id} succeeded: ${r.step.reason}`); }
const status = await call('run_status', { runId: started.run.id }); must(status.run.state === 'succeeded', 'run succeeded');
const validated = status.deliverables.find((d) => d.trust === 'validated'); must(validated, 'final deliverable validated');
await call('promote_deliverable', { deliverableId: validated.id, to: 'challenged', reason: 'challenged in the loop' });
await call('promote_deliverable', { deliverableId: validated.id, to: 'accepted', reason: 'accepted by the person' });
const fin = await call('promote_deliverable', { deliverableId: validated.id, to: 'final' }); must(fin.deliverable.trust === 'final', 'deliverable final');
const list = await rpc('tools/list'); must(!list.result.tools.some((t) => t.name === 'claim_step'), 'headless tools absent from the interactive surface');
child.stdin.end(); await new Promise((r) => child.on('exit', r));
console.log('loop: bootstrap → decide ×3 → remember → resolve → start → claim/submit ×4 → status → promote to final: ok');
DRIVER
node "$scratch/drive.mjs" "$loop_project/node_modules/.bin/construct" || fail "the packaged loop over the MCP server failed"
[ ! -e "$XDG_DATA_HOME/construct" ] || fail "the loop created a per-user data directory"
cd "$project"

echo "== the packaged install can describe the surface it would serve =="
serve_out="$(npx --no-install construct serve --client=cursor --describe 2>&1)" || fail "serve --describe exited non-zero" "$serve_out"
expect_contains "serve --describe" "$serve_out" "would serve the interactive surface for cursor"
mcp_out="$(printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx --no-install construct serve --client=cursor 2>/dev/null)" || fail "serve over stdio exited non-zero" "$mcp_out"
expect_contains "serve initialize" "$mcp_out" '"name":"construct"'
expect_contains "serve tools/list" "$mcp_out" '"name":"bootstrap"'

echo "== the packaged install carries the skills =="
skills_list="$(npx --no-install construct skill list 2>&1)" || fail "skill list exited non-zero" "$skills_list"
expect_contains "skill list" "$skills_list" "investigative-research"
install_out="$(npx --no-install construct skill install investigative-research --dir="$skills_dir" 2>&1)" || fail "skill install exited non-zero" "$install_out"
cmp -s "$skills_dir/investigative-research/SKILL.md" "$repo_root/skills/investigative-research/SKILL.md" \
  || fail "the planted skill is not byte-identical to the one this repository ships"
verify_out="$(npx --no-install construct skill verify --dir="$skills_dir" 2>&1)" || fail "skill verify exited non-zero" "$verify_out"
expect_contains "skill verify" "$verify_out" "investigative-research: current"

echo "== a database the CLI cannot open =="
if [ "$(id -u)" -eq 0 ]; then
  echo "   skipped: running as root, chmod would not bind"
else
  chmod 000 "$project/.construct/state/construct.sqlite"
  set +e
  closed_status="$(npx --no-install construct status 2>&1)"
  closed_code=$?
  set -e
  chmod 600 "$project/.construct/state/construct.sqlite"
  [ "$closed_code" -ne 0 ] || fail "status exited 0 on a database it cannot open" "$closed_status"
  case "$closed_status" in
    *"    at "*) fail "a permissions problem printed a stack trace" "$closed_status" ;;
  esac
fi

echo "== reset previews, then removes exactly what it named =="
preview="$(npx --no-install construct reset 2>&1)" || fail "reset preview exited non-zero" "$preview"
expect_contains "reset" "$preview" "Nothing was removed"
[ -f "$project/.construct/state/construct.sqlite" ] || fail "a reset preview removed the database"
confirm_out="$(npx --no-install construct reset --confirm 2>&1)" || fail "reset --confirm exited non-zero" "$confirm_out"
expect_contains "reset --confirm" "$confirm_out" "Fresh state"
[ -f "$project/.construct/project.json" ] || fail "reset removed the committed project file without being asked to"

echo "== unknown and retired commands are refused =="
set +e
retired_out="$(npx --no-install construct ask 'ship a thing' 2>&1)"
retired_status=$?
set -e
[ "$retired_status" -ne 0 ] || fail "a retired verb should be unknown after the cutover"
expect_contains "retired verb" "$retired_out" "unknown command"

echo "smoke-packaged-install: pass"
