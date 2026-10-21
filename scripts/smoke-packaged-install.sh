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

cd "$repo_root"
if [ "$#" -eq 2 ] && [ "$1" = "--tarball" ]; then
  tarball_path="$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$2")"
  [ -f "$tarball_path" ] || fail "candidate tarball is absent"
  # Build the source for module-parity checks without repacking the candidate.
  npm run build --silent
elif [ "$#" -eq 0 ]; then
  echo "== building and packing =="
  npm run build --silent
  tarball="$(npm pack --silent --pack-destination "$scratch")"
  tarball_path="$scratch/$tarball"
else
  fail "usage: smoke-packaged-install.sh [--tarball <candidate.tgz>]"
fi

echo "== every packed module has a source =="
orphans="$(tar -tzf "$tarball_path" | sed -n 's#^package/dist/\(.*\)\.js$#\1#p' | while read -r m; do [ -f "src/$m.ts" ] || echo "dist/$m.js"; done)"
[ -z "$orphans" ] || fail "the tarball ships compiled modules with no source (a stale dist)" "$orphans"
shipped_evals="$(tar -tzf "$tarball_path" | grep -E '(^|/)evals/' || true)"
[ -z "$shipped_evals" ] || fail "the tarball ships evals, which are maintainer-local" "$shipped_evals"

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
init_out="$(npx --no-install construct init --client=claude-code --scale=solo --outcome='prove the packaged spine' --constraint='never write outside the scratch project' 2>&1)" \
  || fail "construct init exited non-zero" "$init_out"
printf '%s\n' "$init_out"
expect_contains "init" "$init_out" "Initialized Construct project"
[ -f "$project/.construct/project.json" ] || fail "init wrote no project.json"
[ -f "$project/.construct/constitution.json" ] || fail "init wrote no constitution.json"
[ -f "$project/.construct/sources.json" ] || fail "init wrote no sources.json"
[ -f "$project/.construct/registry.lock.json" ] || fail "init wrote no registry.lock.json"

[ -f "$project/.construct/state/construct.sqlite" ] || fail "the spine did not create its database"
state_files="$(ls "$project/.construct/state" | sort | tr '\n' ' ')"
[ "$state_files" = "construct.sqlite installed.json launcher " ] || fail "the state directory holds something other than the database, the hooks' launcher, and the record of what Construct installed" "$state_files"

echo "== installed coordination hook runs from packaged bytes =="
npx --no-install construct hooks install --host=claude-code >/dev/null
hook_command="$(node -e 'const fs=require("node:fs"); const s=JSON.parse(fs.readFileSync(".claude/settings.local.json","utf8")); process.stdout.write(s.hooks.PostToolUse.at(-1).hooks[0].command)')"
printf '{}' | CONSTRUCT_HOOKS= /bin/sh -c "$hook_command"
node -e 'const fs=require("node:fs"); const h=JSON.parse(fs.readFileSync(".construct/state/hook-health.json","utf8")); if (!(h["claude-code:post-tool-use"]?.runs >= 1)) process.exit(1)'
[ -f "$project/.claude/skills/construct/SKILL.md" ] || fail "init did not plant the operational skill in the project" "$init_out"
cmp -s "$project/.claude/skills/construct/SKILL.md" "$repo_root/skills/construct/SKILL.md" \
  || fail "the planted operational skill is not byte-identical to the shipped one"
[ ! -e "$project/.claude/skills/construct/evals" ] || fail "init planted evals into the project's skills"
[ ! -e "$HOME/.claude/skills/construct" ] || fail "init planted a personal copy that would load in every repository"
expect_contains "init" "$init_out" "Next, in Claude Code:"
grep -q '^\.construct/state/$' "$project/.gitignore" || fail "init did not ignore .construct/state/"

echo "== the host file starts the project's construct with no machine path =="
[ -f "$project/.mcp.json" ] || fail "init --client=claude-code wrote no .mcp.json" "$init_out"
mcp_launch="$(node -e '
const e = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).mcpServers.construct;
const parts = [e.command, ...e.args];
if (parts.some((p) => require("node:path").isAbsolute(p) || p.startsWith("--project="))) { console.error(parts.join(" ")); process.exit(1); }
process.stdout.write(JSON.stringify(parts));
' "$project/.mcp.json")" || fail ".mcp.json carries a machine path" "$(cat "$project/.mcp.json")"
[ "$mcp_launch" = '["npx","--no-install","construct","serve","--client=claude-code"]' ] \
  || fail ".mcp.json does not start npx --no-install construct serve" "$mcp_launch"
written_out="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node -e '
const { spawn } = require("node:child_process");
const [command, ...args] = JSON.parse(process.argv[1]);
const child = spawn(command, args, { stdio: ["pipe", "inherit", "ignore"] });
process.stdin.pipe(child.stdin);
child.on("exit", (code) => process.exit(code ?? 1));
' "$mcp_launch")" || fail "the server would not start the way .mcp.json says" "$written_out"
expect_contains "the server started from .mcp.json" "$written_out" '"name":"construct"'
[ ! -e "$XDG_DATA_HOME/construct" ] || fail "init created a per-user data directory; project truth must stay in the project"

echo "== the hooks live in this machine's settings and find Node through the launcher =="
launcher="$project/.construct/state/launcher"
[ "$(wc -l < "$launcher" | tr -d ' ')" = "2" ] || fail "the launcher is not two lines (Node, then Construct)" "$(cat "$launcher")"
{ IFS= read -r launcher_node; IFS= read -r launcher_construct; } < "$launcher"
"$launcher_node" "$launcher_construct" version >/dev/null || fail "the launcher does not start this install" "$(cat "$launcher")"
[ -f "$project/.claude/settings.local.json" ] || fail "init --client=claude-code put no hooks in .claude/settings.local.json" "$init_out"
node -e '
const fs = require("node:fs");
const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {});
const ours = (settings) => Object.entries(settings.hooks ?? {}).flatMap(([event, list]) => list.flatMap((e) => e.hooks.map((h) => [event, h.command]))).filter(([, c]) => / hook (?:post-tool|stop|session-start) --client=claude-code /.test(c));
const local = ours(read(process.argv[1]));
const events = local.map(([e]) => e).sort().join(",");
if (events !== "PostToolUse,SessionStart,Stop") { console.error(`local: ${events}`); process.exit(1); }
if (local.some(([, c]) => !c.includes(process.argv[3]))) { console.error("a hook does not run through the launcher"); process.exit(1); }
if (ours(read(process.argv[2])).length > 0) { console.error("the shared .claude/settings.json holds construct hooks"); process.exit(1); }
' "$project/.claude/settings.local.json" "$project/.claude/settings.json" "$launcher" \
  || fail "the three grounding hooks are not in .claude/settings.local.json alone" "$(cat "$project/.claude/settings.local.json")"
git -C "$project" check-ignore -q .claude/settings.local.json || fail ".claude/settings.local.json is not kept out of git"

echo "== plain init with no agent host installed says no session can reach Construct =="
bare="$scratch/bare"
bare_bin="$scratch/bare-bin"
mkdir -p "$bare/home" "$bare/project" "$bare_bin"
for tool in node npm npx git; do
  found="$(command -v "$tool")" || fail "$tool is not on PATH"
  ln -s "$found" "$bare_bin/$tool"
done
git -C "$bare/project" init -q .
printf '# Bare\n\nA project on a machine with no agent host.\n' > "$bare/project/README.md"
bare_init="$(cd "$bare/project" && env -i HOME="$bare/home" PATH="$bare_bin" "$project/node_modules/.bin/construct" init 2>&1)" \
  || fail "plain init exited non-zero" "$bare_init"
expect_contains "plain init" "$bare_init" "host: not connected"
expect_contains "plain init" "$bare_init" "no agent session can reach Construct"
case "$bare_init" in *"answer the questions in your agent session"*) fail "plain init points at an agent session that cannot reach Construct" "$bare_init" ;; esac
set +e
bare_doctor="$(cd "$bare/project" && env -i HOME="$bare/home" PATH="$bare_bin" "$project/node_modules/.bin/construct" doctor 2>&1)"
bare_doctor_status=$?
set -e
[ "$bare_doctor_status" -ne 0 ] || fail "doctor called a project no host is wired to healthy" "$bare_doctor"
expect_contains "plain doctor" "$bare_doctor" "FAIL host-wiring"

echo "== status and doctor =="
status_out="$(npx --no-install construct status 2>&1)" || fail "status exited non-zero" "$status_out"
printf '%s\n' "$status_out"
expect_contains "status" "$status_out" "setup: confirmed"
doctor_out="$(npx --no-install construct doctor 2>&1)" || fail "doctor exited non-zero" "$doctor_out"
printf '%s\n' "$doctor_out"
expect_contains "doctor" "$doctor_out" "doctor: installation healthy"
expect_contains "doctor readiness" "$doctor_out" "Live host connection: unverified. Task execution: unverified."
doctor_json="$(npx --no-install construct doctor --json)"
node --input-type=module -e 'const r=JSON.parse(process.argv[1]); if(!r.healthy || r.scope!=="installation" || r.readiness.connected!=="unverified" || r.readiness.exercised!=="unverified") throw new Error("doctor must distinguish installed from connected and exercised readiness")' "$doctor_json"
status_json="$(npx --no-install construct status --json)" || fail "status --json exited non-zero"
node -e 'const r=JSON.parse(process.argv[1]); if (r.onboarding.state!=="confirmed") process.exit(1)' "$status_json" || fail "status --json did not report confirmed onboarding" "$status_json"

echo "== configuration is explained =="
explain_out="$(npx --no-install construct config explain locale)" || fail "config explain exited non-zero"
expect_contains "config explain" "$explain_out" "built-in default"
npx --no-install construct config set review.cadence weekly >/dev/null || fail "config set exited non-zero"
get_out="$(npx --no-install construct config get review.cadence)"
[ "$get_out" = "weekly" ] || fail "config get read back \"$get_out\", expected weekly"

echo "== native work from packaged bytes: a session's unrooted work waits as proposed, with its structure =="
outcome_json="$(npx --no-install construct work add --kind=outcome --json 'Packaged outcome' 2>/dev/null)" || fail "work add outcome exited non-zero" "$outcome_json"
outcome_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$outcome_json")"
expect_contains "work add outcome" "$outcome_json" '"status":"proposed"'
work_add="$(npx --no-install construct work add --kind=task --parent="$outcome_id" --accept='the ledger round-trips' --description='prove the packaged ledger' 'Packaged work item' 2>&1)" \
  || fail "work add exited non-zero" "$work_add"
expect_contains "work add" "$work_add" "proposed"
expect_contains "work add" "$work_add" "construct work admit"
work_list="$(npx --no-install construct work list --parent="$outcome_id" 2>&1)" || fail "work list exited non-zero" "$work_list"
expect_contains "work list" "$work_list" "Packaged work item"
work_ready="$(npx --no-install construct work ready 2>&1)" || fail "work ready exited non-zero" "$work_ready"
case "$work_ready" in *"Packaged work item"*) fail "proposed work is listed as ready" "$work_ready" ;; esac
work_show="$(npx --no-install construct work show "$outcome_id" 2>&1)" || fail "work show exited non-zero" "$work_show"
expect_contains "work show" "$work_show" "children: 0 of 1 finished"

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
wf_run="$(npx --no-install construct workflow run design-conformance --input=target=README.md --json 2>/dev/null)" || fail "workflow run exited non-zero" "$wf_run"
run_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).run.id)' "$wf_run")"
[ -n "$run_id" ] || fail "workflow run printed no run id" "$wf_run"
run_show="$(npx --no-install construct run show "$run_id" 2>&1)" || fail "run show exited non-zero" "$run_show"
expect_contains "run show" "$run_show" "step gather: ready"
inbox_out="$(npx --no-install construct inbox list 2>&1)" || fail "inbox list exited non-zero" "$inbox_out"
expect_contains "inbox list" "$inbox_out" "proposal"
cancel_out="$(npx --no-install construct run cancel "$run_id" 2>&1)" || fail "run cancel exited non-zero" "$cancel_out"
expect_contains "run cancel" "$cancel_out" "cancelled"

echo "== the whole loop over the packaged server: bootstrap, decide, remember, managed workflow, exact draft held for native review =="
loop_project="$scratch/loop"
mkdir -p "$loop_project" && cd "$loop_project" && git init -q . && printf '# Loop\n\nA project for the packaged loop.\n' > README.md && printf '# Design\n\n- Keep the kernel host-agnostic\n' > design.md
npm init -y --silent >/dev/null && npm install --silent "$tarball_path"
loop_init="$(npx --no-install construct init --no-wire --skills-dir="$skills_dir" 2>&1)" || fail "loop init exited non-zero" "$loop_init"
expect_contains "loop init" "$loop_init" "still to answer (3)"
cat > "$scratch/drive.mjs" <<'DRIVER'
import { spawn, execFileSync } from 'node:child_process';
const child = spawn(process.execPath, [process.argv[2], 'serve', '--client=cursor'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = ''; const pending = new Map(); let nextId = 1;
child.stdout.on('data', (chunk) => { buffer += chunk; let nl; while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); if (!line.trim()) continue; const msg = JSON.parse(line); const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); } } });
const rpc = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); if (r.error) throw new Error(`${name}: ${r.error.message}`); if (r.result.isError) throw new Error(`${name}: ${r.result.structuredContent?.error ?? r.result.content[0].text}`); return r.result.structuredContent ?? JSON.parse(r.result.content[0].text); };
const must = (cond, what) => { if (!cond) throw new Error(`loop: ${what}`); };
const init = await rpc('initialize', {}); must(init.result.serverInfo.name === 'construct', 'server name');
const delegation = await call('delegate', { action: 'status' });
must(delegation.executors.length === 3 && delegation.executors.every(executor => !executor.configured && !executor.liveVerified), 'packaged delegation is disabled without authorization');
const boot = await call('bootstrap'); must(boot.profile.openQuestions.length === 3, 'three questions open at bootstrap'); must(/setup question/.test(boot.next), 'next action names the questions');
const scale = boot.profile.openQuestions.find((q) => q.options); await call('decide', { decisionId: scale.id, resolution: 'solo' });
for (const q of boot.profile.openQuestions.filter((q) => !q.options)) await call('decide', { decisionId: q.id, resolution: q.question.includes('result') ? 'prove the packaged loop' : 'never write outside this project' });
const boot2 = await call('bootstrap'); must(boot2.profile.onboarding === 'confirmed', 'onboarding confirmed after decisions');
const cls = await call('classify_request', { words: 'Remember that we will not add schema migration until stable', kind: 'remember' }); must(/^Call remember/.test(cls.next) && cls.recorded === false, 'a remember reading is told to call remember');
const mem = await call('remember', { kind: 'decision', text: 'we will not add schema migration until stable' }); must(mem.nothingElseCreated === true, 'remember created nothing else');
const statements = await call('project_context', { topic: 'statements', query: 'migration' }); must(statements.items.length === 1, 'one statement remembered');
const rooted = await call('work', { action: 'add', kind: 'outcome', title: 'Hold schema changes until stable', serves: mem.remembered.id }); must(rooted.status === 'open' && rooted.admittedBy === 'serves', 'work serving a remembered decision is admitted');
const sub = await call('work', { action: 'add', title: 'Guard the migration path', parent: rooted.id, acceptance: ['no migration runs before 1.0'] }); must(sub.status === 'open', 'a child of admitted work is admitted');
const loose = await call('work', { action: 'add', title: 'An idea with no reason' }); must(loose.status === 'proposed', 'unrooted work from a session is proposed');
const ready = await call('work', { action: 'ready' }); must(ready.some((w) => w.id === sub.id) && !ready.some((w) => w.id === loose.id), 'ready holds admitted work only');
const cls2 = await call('classify_request', { words: 'Review this implementation against our design principles', kind: 'manage', deliverable: { kind: 'review/design-conformance' }, target: 'README.md', stakes: { reversible: true, affects: [] } }); must(cls2.matches[0]?.workflowId === 'design-conformance' && cls2.matches[0].missing.length === 0, `the typed reading matches design-conformance with nothing missing: ${JSON.stringify(cls2.matches[0])}`);
const resolved = await call('workflows', { action: 'resolve', id: 'design-conformance', input: { target: 'README.md' } }); must(resolved.status === 'runnable', `resolvable: ${resolved.summary}`);
const started = await call('start_outcome', { workflowId: 'design-conformance', intake: cls2.intake }); must(started.started === true && started.run.state === 'ready', 'run ready from the intake');
const outputs = { gather: { principles: ['Keep the kernel host-agnostic'], targetSummary: 'the README', unknownPrinciples: [] }, deterministic: { findings: [] }, review: { summary: 'conforms', findings: [], assumptions: [] }, record: { driftFindingIds: [], decisionIds: [] } };
for (let i = 0; i < 4; i += 1) { const c = await call('claim_work', { runId: started.run.id, includeSkillBody: i === 0 }); must(c.work, `step ${i} claimable`); if (i === 0) must(typeof c.work.skill.body === 'string' && c.work.skill.body.startsWith('---'), 'skill body loaded only when asked'); if (c.work.step.id === 'deterministic') { const observed = JSON.parse(execFileSync(process.execPath, [process.argv[2], 'run', 'verify', started.run.id, '--step=' + c.work.stepRunId, '--token=' + c.work.token, '--subject=design.md', '--command=' + JSON.stringify([process.execPath, '-e', 'require("node:assert").match(require("node:fs").readFileSync("design.md","utf8"),/host-agnostic/)'])], { encoding: 'utf8' })); outputs.deterministic.verification = { executionRef: observed.executionRef }; } const r = await call('submit_work', { stepRunId: c.work.stepRunId, token: c.work.token, output: outputs[c.work.step.id], evidence: [{ ref: 'design.md' }] }); if (c.work.step.id === 'record') must(r.step.state === 'leased' && r.semanticReview?.preparedRef && r.deliverable?.trust === 'draft', 'final draft and lease wait for native review'); else must(r.step.state === 'succeeded', `step ${c.work.step.id} succeeded: ${r.step.reason}`); }
const status = await call('run_status', { runId: started.run.id }); must(status.run.state === 'running', 'unreviewed run is not succeeded');
const draft = status.deliverables.find((d) => d.trust === 'draft'); must(draft, 'exact final draft is preserved');
for (const to of ['validated', 'challenged', 'accepted', 'final']) {
 const denied = await rpc('tools/call', { name: 'promote_deliverable', arguments: { deliverableId: draft.id, to } });
 must(denied.result?.isError === true, `unreviewed pending draft cannot be promoted to ${to}`);
}
await call('sources', { action: 'declare', id: 'wiki', kind: 'docs' });
const list = await rpc('tools/list'); must(!list.result.tools.some((t) => t.name === 'claim_step'), 'headless tools absent from the interactive surface');
const sourceSchema = list.result.tools.find((t) => t.name === 'sources').inputSchema;
must(['principal', 'scope', 'operation', 'mode', 'transport', 'expiresAt'].every((key) => sourceSchema.properties.observation.required.includes(key)), 'access requirements discoverable before first report');
must(sourceSchema.properties.items.items.required.includes('ref'), 'item identity discoverable before first report');
const observation = { principal: 'synthetic-reader', scope: '98765', operation: 'read_page', mode: 'read', transport: 'mcp', expiresAt: new Date(Date.now() + 60000).toISOString() };
const updatedAt = '2026-09-02T12:00:00Z';
await call('sources', { action: 'report', id: 'wiki', observation, partial: true, items: [{ ref: '98765', url: 'https://wiki.example.com/pages/98765', title: 'Retries', updatedAt, text: 'Checkout retries each payment call up to 3 times.' }] });
const access = await call('sources', { action: 'check', id: 'wiki', request: { principal: observation.principal, scope: observation.scope, operation: observation.operation, mode: observation.mode } });
must(access.ready === false && access.grantsPermission === false && access.problems.some((p) => p.includes('host-reported')), 'reported principal is never witnessed access');
const invalidReport = await rpc('tools/call', { name: 'sources', arguments: { action: 'report', id: 'wiki', observation: { ...observation, expiresAt: undefined }, items: [{ ref: 'bad', text: 'Should never be stored.' }] } });
must(invalidReport.result?.isError && invalidReport.result.structuredContent.field === 'observation.expiresAt', 'missing expiry names its nested field');
const initialContext = await call('context_search', { query: 'How does checkout handle payment failures?', expansions: ['checkout retry payment call'], sourceId: 'wiki', limit: 3 });
must(initialContext.items.length > 0 && initialContext.coverage.usedChars <= initialContext.coverage.budgetChars, 'ranked bounded admitted context from installed bytes');
const capturedRef = initialContext.items[0].ref;
const byUrl = await call('check_answer', { answer: 'Checkout retries each payment call up to 3 times.', citations: [{ ref: 'https://wiki.example.com/pages/98765#retries', excerpt: 'up to 3 times' }] }); must(byUrl.ok === true && byUrl.evidence.reported === 1, `a recorded page is citable by its url: ${JSON.stringify(byUrl.problems)}`);
const invented = await call('check_answer', { answer: 'Checkout retries each payment call up to 3 times.', citations: [{ ref: 'wiki:12345' }] }); must(invented.ok === false && invented.problems.some((p) => p.problem.includes('names nothing this project holds')), 'an invented item is refused');
await call('sources', { action: 'report', id: 'wiki', partial: true, items: [{ ref: '98765', url: 'https://wiki.example.com/pages/98765', updatedAt, text: 'Checkout retries each payment call up to 4 times.' }] });
const stale = await call('check_answer', { answer: 'Checkout retries each payment call up to 3 times.', citations: [{ ref: 'wiki:98765', excerpt: 'up to 3 times' }] });
must(stale.ok === false, 'changed bytes invalidate the old passage even with unchanged provider time');
const history = await call('project_context', { topic: 'source_history', query: 'wiki' });
must(history.items.filter((item) => item.kind === 'source.changed').length === 2, 'both source generations retained');
const historical = await call('check_answer', { answer: 'The earlier captured policy retried up to 3 times.', historicalEvidence: [{ref:capturedRef,why:'Historical policy before its correction.'}], citations:[{ref:capturedRef,excerpt:'up to 3 times'}] });
must(historical.ok, 'immutable historical citation resolves to captured bytes');
const wronglyCurrent = await call('check_answer', { answer: 'Checkout retries up to 3 times.', citations:[{ref:capturedRef}] });
must(!wronglyCurrent.ok, 'historical capture cannot silently support a current claim');
const portableReading = await call('classify_request', { words:'Explain the host-neutral boundary in this design.', kind:'manage', deliverable:{kind:'other',describe:'design brief'}, intent:{outcome:'A source-backed design brief',path:'artifact',acceptance:['Identify the kernel boundary'],priorWork:['design.md']},destination:{kind:'chat'},stakes:{reversible:true,affects:[]} });
must(portableReading.matches[0].workflowId === 'guided-outcome' && !portableReading.matches[0].verification.executionRequired, 'portable path requires no code test');
const portable = await call('start_outcome', {workflowId:'guided-outcome',intake:portableReading.intake});
let pw = (await call('claim_work',{runId:portable.run.id})).work;
const submitPortable = async(output) => call('submit_work',{stepRunId:pw.stepRunId,token:pw.token,output,evidence:[{ref:'design.md'}]});
await submitPortable({plan:['Read the design and explain its boundary'],assumptions:[],blockers:[]});
pw=(await call('claim_work',{runId:portable.run.id})).work;
await call('checkpoint_work',{stepRunId:pw.stepRunId,token:pw.token,summary:'The kernel stays host-agnostic.',remaining:['Check the brief'],unknowns:[],gatherCalls:1});
await submitPortable({summary:'The kernel stays host-agnostic.',findings:['Keep the kernel host-agnostic.'],changes:[],artifact:null});
pw=(await call('claim_work',{runId:portable.run.id})).work;
const delivered=await submitPortable({verification:{kind:'self_review',checks:['Inspected the actual brief against its requested boundary']},limits:['Independent semantic review was not performed']});
must(delivered.run.state==='succeeded' && !delivered.deliverable.verification.semanticSupportVerified,'portable delivery is complete with explicit structural assurance');
const portableStatus=await call('run_status',{runId:portable.run.id});
must(portableStatus.delivery.state==='available' && portableStatus.delivery.acceptance==='not_accepted' && portableStatus.checkpoints.length===1,'checkpoint and assurance survive the public ledger');
const held = await call('work', { action: 'claim', id: sub.id, agent: 'smoke', paths: ['design.md'] });
await call('work', { action: 'complete', id: sub.id, agent: 'smoke', token: held.claimToken, reason: 'The fixture applied no schema migration and verified the ledger round trip.' });
child.stdin.end(); await new Promise((r) => child.on('exit', r));
console.log('loop: bootstrap → remember → rooted work claimed/completed → managed steps → draft held for native review → schema-led source report → reported access refused → changed bytes invalidate old citation → immutable history → ranked retrieval → portable chat delivery with checkpoints and explicit assurance: ok');
DRIVER
loop_out="$(node "$scratch/drive.mjs" "$loop_project/node_modules/.bin/construct")" || fail "the packaged loop over the MCP server failed" "$loop_out"
echo "$loop_out"
loop_inbox="$(cd "$loop_project" && npx --no-install construct inbox list 2>&1)" || fail "loop inbox list exited non-zero" "$loop_inbox"
[ ! -e "$XDG_DATA_HOME/construct" ] || fail "the loop created a per-user data directory"
cd "$project"

echo "== the packaged install can describe the surface it would serve =="
serve_out="$(npx --no-install construct serve --client=cursor --describe 2>&1)" || fail "serve --describe exited non-zero" "$serve_out"
expect_contains "serve --describe" "$serve_out" "would serve the interactive surface for cursor"
mcp_out="$(printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx --no-install construct serve --client=cursor 2>/dev/null)" || fail "serve over stdio exited non-zero" "$mcp_out"
expect_contains "serve initialize" "$mcp_out" '"name":"construct"'
expect_contains "serve tools/list" "$mcp_out" '"name":"bootstrap"'
expect_contains "serve tools/list" "$mcp_out" '"name":"work"'

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

echo "== unknown commands are refused =="
set +e
unknown_out="$(npx --no-install construct ask 'ship a thing' 2>&1)"
unknown_status=$?
set -e
[ "$unknown_status" -ne 0 ] || fail "an unknown verb should be refused"
expect_contains "unknown verb" "$unknown_out" "unknown command"

echo "smoke-packaged-install: pass"
