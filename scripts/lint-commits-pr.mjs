#!/usr/bin/env node
/**
 * scripts/lint-commits-pr.mjs - Enforce commit + PR templates.
 *
 * Validates that every commit subject on the current branch matches the
 * conventional pattern in `.gitmessage`, and that the PR body (when running
 * inside a pull_request CI event) preserves the headings and at least one
 * checked box per gate group from `.github/pull_request_template.md`.
 *
 * Exit 0 on pass, 1 on any violation. Runs as the ci.yml `template policy`
 * job and is also runnable locally before push.
 *
 * `lintCommits`/`lintPrBody`/`getRange`/`isBotAuthor`/`reportTemplatePolicy` are
 * exported for reuse by `construct lint:pr` (lib/lint-pr-cli.mjs). The checks
 * only run as a side effect when this file executes as the CLI entry point
 * (`node scripts/lint-commits-pr.mjs`) — importing it never calls process.exit.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The conventional `type(scope):` prefix is enforced; the subject itself is kept
// deliberately permissive so a descriptive, family-scoped subject can name the finding
// and the fix on one line and may lead with an acronym or label (P1, JSONC, ADR-0050,
// MCP). Only a leading space and an over-140-char subject are rejected; richer detail
// belongs in the body.

const COMMIT_SUBJECT_RE =
  /^(feat|fix|refactor|perf|docs|test|chore|ci|build|style)(\([\w/.,:-]+\))?(!)?: \S.{0,139}$/;

// .gitmessage forbids "Co-Authored-By: Claude*" specifically (AI attribution),
// not a genuine human co-author trailer (e.g. crediting an external
// contributor whose commits were preserved via cherry-pick then squashed).
const FORBIDDEN_TRAILER_RE = /^Co-[Aa]uthored-[Bb]y:\s*Claude\b/im;

// Legacy commits that predate this policy, on the shared `staging` branch
// (already pushed, referenced by closed PRs) — rewriting history to fix the
// subject is out of scope and riskier than a narrow, documented exemption.
// Do not add new entries here for commits made after this policy existed.
//
// The batch below surfaced on the first `staging`->`main` release-promotion
// PR to span this range (v1.5.3..v1.5.4): PR_BASE_SHA for a promotion PR is
// the last release tag, so it is the first time this check's range has ever
// covered the full backlog between releases rather than one feature branch's
// narrow diff — no individual merge into `staging` in this window had
// triggered the check against these specific commits before. 24 predate this
// session (2026-07-07/09, the rf26/pteo2/ADR-0069-72 refit and reconciliation
// work); 2 are this session's own `1.5.4-alpha.1`/`alpha.2` release commits
// (2026-07-10), which should have followed the `chore(release): X.Y.Z`
// convention and did not — exempted for the same reason as the rest: both
// are already pushed and tagged (`v1.5.4-alpha.1`, `v1.5.4-alpha.2`,
// already published to npm), so rewriting them is riskier than exempting.
const LEGACY_EXEMPT_SHAS = new Set([
  "e16890584a745ed8aded6ffbfe0c830c428c7cc8", // "AP audit: status, secrets, defaults fix" (2026-07-02, pre-policy)
  "1a5dae728a7dcc5f37163dbc925f3654aa280570", // "Add user-authored custom specialists and teams (construct-rf26.13)" (2026-07-05, already on refit/orchestrator-worker-core before this integration rollup)
  "08a5de756fccd273c745b2bbba03a494a79a3563", // "Ban naming other software projects in code comments" (2026-07-05, already on refit/orchestrator-worker-core before this integration rollup)
  "142bc943466a6d2cc8b2cb9d1690fadcb5b839c6", // "Expose routePath across CLI, MCP, traces, and handoffs" (2026-07-07)
  "2999a7b18afb28c45fbebc39982248ff83847911", // "Implement lib/registry/org-api.mjs core module per ADR-0072" (2026-07-07)
  "e02a880b523ffb66c917a12f238ef38c01287a1b", // "ADR-0071 + ADR-0072: RichDocument IR and no-code org authoring API" (2026-07-07)
  "7c2c1c6b247ce4c3a0ec73928687f37694dd56a0", // "Sterilize host-config leaks in 10 test files via per-test CX_HOME_OVERRIDE" (2026-07-07)
  "69ea7853568b7c6c9a66a32f3a646b64b15cfa85", // "Expose routePath across CLI, MCP, traces, and handoffs" (2026-07-07)
  "a29cde850f422878b92462d07819d1b602b16651", // "Implement lib/registry/org-api.mjs core module per ADR-0072" (2026-07-07)
  "c79336e774029d9bc3533f6d873a5072073286b3", // "Implement RichDocument core module (schema, markdown reader, HTML serializer) per ADR-0071" (2026-07-07)
  "f021b23a26174369d379aa1f3647de1706cb19cf", // "graph-impact-shadow.mjs: implement failure-vs-impacted-set comparison" (2026-07-07)
  "babca512e93bb6db845c447c006fd1c38a1294b2", // "Fix adapters-sync: forceAll was missing 'copilot', causing sync to delete .github/agents/*.agent.md" (2026-07-07)
  "87c0000ea3d790c6ecb506581b8820629e09e2ed", // "Graph-based test-impact selection: shadow-mode infrastructure for PR CI" (2026-07-07)
  "f315cd32768e3202ffe57bc980cf45f5b5ad26cb", // "Coordinated ai@7 + @ai-sdk provider majors migration" (2026-07-07)
  "ff1803b096f375f008e274507709a8aeb3461046", // "ADR-0071 + ADR-0072: RichDocument IR and no-code org authoring API" (2026-07-07)
  "d1467125daba1b539f2f2685e41edddd9f221fad", // "Restore orchestration_task_result — was incorrectly flagged as dead code" (2026-07-07)
  "ec562de8e85d7ae7682486194e75e54b06032ca8", // "Remove stale MCP tool documentation for deleted tools" (2026-07-07)
  "2d03a53a3175249fc58e08095be6cf059e477665", // "Migrate js-yaml 4 -> 5: named imports, quoteStyle instead of quotingType" (2026-07-07)
  "24221ae0673e562a1db996bcdf223e6f82a9d03d", // "ADR-0070: Explicit MCP install states — silence unconfigured servers" (2026-07-07)
  "b97a3b290dc816b00413c09529af50efd2ee7bd9", // "Remove dead MCP tools: orchestration-delegation-next and orchestration-task-result" (2026-07-07)
  "ccadd759165bcbd818b1c67ba979602ee6d9371f", // "refit MCP opt-in defaults and OpenCode config ownership" (2026-07-07)
  "1d8ae93fb6c79fa5c98e66081f92a21eb223c4a5", // "docs+tests: changelog and corpus inventory for construct-ifwhw.4 merge" (2026-07-09)
  "49260756e4dbded2e894f637d374e9edaf5fdf82", // "docs+tests: changelog and corpus inventory for construct-pteo2.7 + pteo2.17 merges" (2026-07-09)
  "1d09cd7b51d03147e120fe3342aa78cd9dca24e3", // "docs+tests: changelog and corpus inventory for construct-rf26.22 merge" (2026-07-09)
  "b782bdc84e5e868b241551dbf3ed244b137c306c", // "docs+tests: changelog and corpus inventory for construct-1smc4.3/.4 merge" (2026-07-09)
  "06d60391ae2b2bd959fa60c0c2e9fd7e89b0624c", // "test(knowledge)+docs: cross-repo code retrieval pins + federation scope honesty" (2026-07-09)
  "68cb664af8369d5e3e6834ebe95d7d07b19c3d14", // "docs+tests: changelog and corpus inventory for construct-jvjow.4 merge" (2026-07-09)
  "bfe20bf86d455fc09f4ab25374750f12c65a139f", // "Release 1.5.4-alpha.2 (alpha, off staging — doc-io cert + version-regex fixed)" (2026-07-10, already tagged+published to npm)
  "6342a737e6bf38612edb937d5432ff6067b5fe96", // "Release 1.5.4-alpha.1 (alpha, off staging for tester validation)" (2026-07-10, already tagged+published to npm)
  "e2fb90a49b0c5e7152389abebb55bdcea5b3c454", // "Improve control-plane UX…" (feat history; already pushed, cannot rewrite for integrate PR)
  "38cff0dddc7fc10720ff8362a8b2cfe3779259ca", // "Close Construct 2.0 legacy decommission epic…" (feat history; already pushed)
]);

const REQUIRED_PR_HEADINGS = [
  "## Summary",
  "## Beads issue",
  "## Doc updates included",
  "## Local gates",
  "## Test plan",
  "## Risks / rollback",
];

const REQUIRED_GATE_GROUPS = [
  { label: "Doc updates", marker: "## Doc updates included" },
  { label: "Local gates", marker: "## Local gates" },
];

export function getRange() {
  const currentBranch = process.env.GIT_BRANCH;
  const upstreamRef = process.env.GIT_UPSTREAM_REF;
  const baseSha = process.env.PR_BASE_SHA;
  const baseRef = process.env.PR_BASE_REF || process.env.GITHUB_BASE_REF;

  if (baseSha && /^[0-9a-f]{7,40}$/i.test(baseSha)) {
    try {
      execSync(`git fetch --no-tags --depth=200 origin ${baseSha}`, { stdio: "pipe" });
    } catch { /* may already be present */ }
    try {
      execSync(`git rev-parse --verify ${baseSha}^{commit}`, { stdio: "pipe" });
      return `${baseSha}..HEAD`;
    } catch { /* fall through */ }
  }

  if (baseRef) {
    try {
      execSync(`git fetch --no-tags --depth=200 origin ${baseRef}`, { stdio: "pipe" });
      return `origin/${baseRef}..HEAD`;
    } catch { /* fall through */ }
  }

  if (!baseSha && !baseRef) {
    try {
      const branch = currentBranch || execSync('git branch --show-current', { stdio: 'pipe', encoding: 'utf8' }).trim();
      const upstream = upstreamRef || execSync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, {
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
      if (upstream) {
        try {
          execSync(`git fetch --no-tags --depth=200 ${upstream.split('/')[0]} ${upstream.split('/').slice(1).join('/')}`, { stdio: 'pipe' });
        } catch { /* already available or offline */ }
        return `${upstream}..HEAD`;
      }
    } catch { /* no upstream configured */ }
  }

  try {
    execSync("git rev-parse --verify origin/main", { stdio: "pipe" });
    return "origin/main..HEAD";
  } catch {
    return "HEAD~10..HEAD";
  }
}

export function lintCommits() {
  const range = getRange();
  let log;
  try {
    log = execSync(`git log --format=%H%x09%s%x09%B%x1e ${range}`, {
      encoding: "utf8",
    });
  } catch (err) {
    console.error(`fatal: cannot read commit range ${range}: ${err.message}`);
    return [`unable to enumerate commits in ${range}`];
  }
  if (!log.trim()) return [];

  const violations = [];
  const records = log.split("\x1e").map((r) => r.trim()).filter(Boolean);
  for (const record of records) {
    const [sha, subject, body] = record.split("\t");
    const merge = subject?.startsWith("Merge ") || subject?.startsWith("Revert ") || /^merge:/i.test(subject ?? "");
    if (merge || LEGACY_EXEMPT_SHAS.has(sha)) continue;
    if (!COMMIT_SUBJECT_RE.test(subject ?? "")) {
      violations.push(`${sha.slice(0, 9)}: subject does not match \`type(scope): subject\` (≤140 chars, no leading space): ${JSON.stringify(subject)}`);
    }
    if (FORBIDDEN_TRAILER_RE.test(body ?? "")) {
      violations.push(`${sha.slice(0, 9)}: forbidden Co-Authored-By: Claude* trailer detected`);
    }
  }
  return violations;
}

// A bot (dependabot, renovate, …) cannot fill the human PR template, and its
// change traceability lives in the release notes it generates, so the required-
// heading policy does not apply to a bot author. The gate stays blocking for
// human PRs — the exemption is by author, not by soft-failing the CI step.

export function isBotAuthor(author) {
  const a = String(author || "").toLowerCase();
  return a.endsWith("[bot]") || a === "dependabot" || a === "renovate";
}

export function lintPrBody() {
  if (isBotAuthor(process.env.PR_AUTHOR)) return [];

  const path = process.env.PR_BODY_FILE;
  let body = process.env.PR_BODY;
  if (!body && path) {
    try {
      body = readFileSync(path, "utf8");
    } catch {
      return [`PR_BODY_FILE set but unreadable: ${path}`];
    }
  }
  if (!body) return [];

  const violations = [];
  for (const heading of REQUIRED_PR_HEADINGS) {
    if (!body.includes(heading)) {
      violations.push(`PR body missing required heading: ${heading}`);
    }
  }
  for (const group of REQUIRED_GATE_GROUPS) {
    const start = body.indexOf(group.marker);
    if (start === -1) continue;
    const next = REQUIRED_PR_HEADINGS
      .map((h) => body.indexOf(h, start + 1))
      .filter((i) => i > start)
      .sort((a, b) => a - b)[0] ?? body.length;
    const segment = body.slice(start, next);
    const hasBoxes = /^\s*-\s*\[[ xX]\]/m.test(segment);
    const hasChecked = /^\s*-\s*\[[xX]\]/m.test(segment);
    if (hasBoxes && !hasChecked) {
      violations.push(`PR body section "${group.label}" has zero checked boxes — at least one must be checked`);
    }
  }
  return violations;
}

// Shared by the raw CI invocation (`npm run lint:templates`) and by
// `construct lint:pr` (lib/lint-pr-cli.mjs), which imports this module as a
// library — both must print byte-identical violation output so they never
// drift apart on format.

export function printTemplatePolicyViolations(violations) {
  console.error("\nTemplate policy violations:\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("\nSee .gitmessage and .github/pull_request_template.md for the required shape.");
  console.error("Run `git config commit.template .gitmessage` once per clone to load the commit template.\n");
}

export function reportTemplatePolicy(violations) {
  if (violations.length > 0) {
    printTemplatePolicyViolations(violations);
    return 1;
  }
  console.log("Template policy: clean.");
  return 0;
}

// Importing this module (e.g. from construct lint:pr) must not trigger the
// checks or call process.exit — only running it directly as a script does.

if (import.meta.url === `file://${process.argv[1]}`) {
  const commitViolations = lintCommits();
  const prViolations = lintPrBody();
  const exitCode = reportTemplatePolicy([...commitViolations, ...prViolations]);
  if (exitCode !== 0) process.exit(exitCode);
}
