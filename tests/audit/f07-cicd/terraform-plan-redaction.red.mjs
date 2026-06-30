/**
 * tests/audit/f07-cicd/terraform-plan-redaction.red.mjs — F07/R29 plan-comment secret-leak proof.
 *
 * RED fixtures (must FAIL against the current deploy.yml). The `tf-plan` job runs
 * `terraform plan` with TF_VAR_dashboard_token / TF_VAR_anthropic_api_key
 * supplied from GitHub secrets, captures the full plan into plan.txt, then the
 * `Post plan to PR` step (actions/github-script) reads plan.txt and posts it
 * verbatim (sliced to 60000 chars, no redaction) as a PR comment. Terraform
 * surfaces variable values and resource attributes in plan output; a secret that
 * appears in a planned attribute, or a `terraform plan` error echoing a TF_VAR,
 * is published to a PR comment — readable by anyone with repo read access and
 * permanent in the PR timeline.
 *
 * The flow is modelled hermetically: a fake plan.txt carrying a sentinel secret
 * is written into an fs.mkdtemp scratch dir, then the EXACT transform deploy.yml's
 * github-script step applies (read file → slice at 60000 → wrap in a fenced
 * ## Terraform Plan comment) runs over it, asserting the sentinel cannot appear
 * in the resulting comment body. The current transform copies the plan through
 * unredacted, so the sentinel leaks and the assertion fails.
 *
 * The transform under test is reproduced verbatim from deploy.yml's
 * `Post plan to PR` script (lines ~108-118) — the redaction fix must update both
 * the workflow and `redactPlanComment` together so this fixture flips green.
 *
 * No real terraform, no AWS, no network. fs.mkdtemp for scratch; cleaned up.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SENTINEL = 'sk-ant-SENTINEL-DO-NOT-LEAK-9f3a2b1c';

// Verbatim port of deploy.yml `Post plan to PR` github-script body. The current
// pipeline has NO redaction here — this is the behavior the fixture pins as
// failing. The fix introduces redactPlanComment() and rewires the workflow to
// it; until then this function is what the workflow actually does.
function postPlanCommentBody(planPath) {
  const plan = readFileSync(planPath, 'utf8');
  const truncated = plan.length > 60000 ? plan.slice(0, 60000) + '\n... (truncated)' : plan;
  const status = '✅ Plan succeeded';
  return `## Terraform Plan — ${status}\n\`\`\`\n${truncated}\n\`\`\``;
}

// The redaction the fix must provide. Stubbed to identity so the RED fixture
// fails against today's no-redaction behavior; the fix replaces this with a real
// scrubber (and points the workflow at it) to turn the fixture green.
function redactPlanComment(body) {
  return body;
}

function makeFakePlan(dir) {
  const planPath = join(dir, 'plan.txt');
  const planText = [
    'Terraform used the selected providers to generate the following execution plan.',
    'Resource actions are indicated with the following symbols:',
    '  ~ update in-place',
    '',
    'Terraform will perform the following actions:',
    '',
    '  # aws_ecs_task_definition.app will be updated in-place',
    '  ~ resource "aws_ecs_task_definition" "app" {',
    '      ~ container_definitions = jsonencode([',
    '          ~ {',
    '              ~ environment = [',
    `                  ~ { name = "DASHBOARD_TOKEN", value = "${SENTINEL}" },`,
    '                ]',
    '            },',
    '        ])',
    '    }',
    '',
    'Plan: 0 to add, 1 to change, 0 to destroy.',
  ].join('\n');
  writeFileSync(planPath, planText, 'utf8');
  return planPath;
}

test('the PR-plan comment must not contain a secret that appears in the plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f07-tfplan-'));
  try {
    const planPath = makeFakePlan(dir);
    const rawBody = postPlanCommentBody(planPath);

    // Sanity: the unredacted transform really does carry the sentinel — proves
    // the fixture exercises a genuine leak path, not a strawman.
    assert.ok(
      rawBody.includes(SENTINEL),
      'fixture setup error: sentinel never reached the comment transform',
    );

    const safeBody = redactPlanComment(rawBody);
    assert.ok(
      !safeBody.includes(SENTINEL),
      'deploy.yml posts terraform plan output to the PR without redaction — a secret in a planned '
        + 'attribute leaks into the PR comment. The plan-comment path needs a redaction step.',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deploy.yml plan-comment step must route plan output through a redaction step', () => {
  // Structural backstop: even with a redactor in place, the workflow must
  // actually call it. Assert deploy.yml references a redaction step on the
  // plan-to-PR path rather than slicing plan.txt straight into the comment body.
  const deployYml = join(
    new URL('.', import.meta.url).pathname, '..', '..', '..', '.github', 'workflows', 'deploy.yml',
  );
  const text = readFileSync(deployYml, 'utf8');
  const mentionsRedaction = /redact|scrub|mask|sanitiz/i.test(text);
  assert.ok(
    mentionsRedaction,
    'deploy.yml has no redaction/scrub/mask step on the terraform-plan → PR-comment path '
      + '(Post plan to PR posts plan.txt verbatim)',
  );
});
