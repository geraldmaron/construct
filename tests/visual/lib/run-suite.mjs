/**
 * tests/visual/lib/run-suite.mjs — orchestrates hermetic and live visual scenarios.
 *
 * Rolls up slash-command stages, per-role depth audits, and UX nitpicks into one
 * evidence bundle for specialist/skill tuning review.
 */

import { measureDepth, formatDepthReport, stripAnsi } from './depth-rubric.mjs';
import { ROLE_EXPECTATIONS, getRoleExpectation } from './role-expectations.mjs';
import { createEvidenceRun } from './evidence.mjs';
import { auditSlashHelpOutput, auditRoleSurfaceUX, rollupUxFindings } from './ux-audit.mjs';
import { runSlashMatrix } from './session-runner.mjs';
import { runRoleConversation, visualLiveSkipReason, resolveVisualModel } from './live-turn.mjs';
import { createWitness } from './witness.mjs';

export async function runHermeticVisualSuite({ witness = null, evidence = null, paceMs = 0 } = {}) {
  const ev = evidence || createEvidenceRun({ label: 'hermetic' });
  const w = witness || createWitness({ enabled: false });
  ev.record('suite-start', { mode: 'hermetic' });

  const slashStages = await runSlashMatrix(w, { paceMs });
  ev.writeJson('slash-stages.json', slashStages);

  const uxFindings = [];
  for (const stage of slashStages) {
    if (stage.name === 'help') uxFindings.push(...auditSlashHelpOutput(stage.stdout));
  }
  const uxRollup = rollupUxFindings(uxFindings);
  ev.writeJson('ux-findings.json', uxRollup);

  const slashOk = slashStages.every((s) => s.ok);
  const summary = {
    mode: 'hermetic',
    ok: slashOk && uxRollup.ok,
    slashStages: slashStages.length,
    slashFailures: slashStages.filter((s) => !s.ok).map((s) => s.name),
    ux: uxRollup,
    evidenceDir: ev.dir,
  };
  ev.finalize(summary);
  return { ev, summary, slashStages, uxRollup };
}

export async function runLiveRoleSuite({
  roleIds = null,
  witness = null,
  evidence = null,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const skip = visualLiveSkipReason(env);
  if (skip) return { skipped: true, reason: skip };

  const roles = (roleIds || ROLE_EXPECTATIONS.map((r) => r.id))
    .map((id) => getRoleExpectation(id))
    .filter(Boolean);

  const ev = evidence || createEvidenceRun({ label: 'live-roles' });
  const w = witness || createWitness({ enabled: true, label: 'live' });
  ev.record('suite-start', { mode: 'live', model: resolveVisualModel(env), roles: roles.map((r) => r.id) });

  const roleResults = [];
  const depthReports = [];
  const uxFindings = [];

  for (const role of roles) {
    w.log('ROLE', `starting ${role.label} (${role.id})`);
    ev.record('role-start', { roleId: role.id });

    const conversation = await runRoleConversation(role, { env, cwd, witness: w });
    const depth = measureDepth(conversation.transcript, {
      ...role.depthRubric,
      expectedSkills: role.expectedSkills,
      expectedSpecialists: role.specialistIds,
    });
    const report = formatDepthReport(depth, { roleLabel: role.label });

    roleResults.push({
      roleId: role.id,
      label: role.label,
      scenarioId: conversation.scenarioId,
      model: conversation.primary.model,
      elapsedMs: conversation.primary.elapsedMs + (conversation.followUp?.elapsedMs || 0),
      depth,
      specialistIds: role.specialistIds,
      expectedSkills: role.expectedSkills,
    });

    depthReports.push(report);
    ev.writeText(`depth-${role.id}.md`, report);
    ev.writeText(`transcript-${role.id}.txt`, conversation.transcript);

    uxFindings.push(...auditRoleSurfaceUX({
      stdout: conversation.transcript,
      stderr: '',
      role,
      piped: true,
    }));

    if (w.depth) {
      w.depth(role.label, depth.depthGrade, depth.failures[0] || depth.warnings[0] || `score ${depth.score}`);
    }

    ev.record('role-finish', {
      roleId: role.id,
      depthGrade: depth.depthGrade,
      score: depth.score,
      failures: depth.failures,
    });
  }

  const uxRollup = rollupUxFindings(uxFindings);
  ev.writeJson('role-results.json', roleResults);
  ev.writeJson('ux-findings.json', uxRollup);
  ev.writeText('depth-audit.md', depthReports.join('\n\n---\n\n'));

  const depthFailures = roleResults.filter((r) => !r.depth.ok);
  const summary = {
    mode: 'live',
    model: resolveVisualModel(env),
    ok: depthFailures.length === 0 && uxRollup.ok,
    rolesRun: roleResults.length,
    depthFailures: depthFailures.map((r) => ({
      roleId: r.roleId,
      grade: r.depth.depthGrade,
      failures: r.depth.failures,
      warnings: r.depth.warnings,
    })),
    tuningSignals: roleResults.flatMap((r) => (r.depth.warnings || []).map((w) => ({ roleId: r.roleId, warning: w }))),
    ux: uxRollup,
    evidenceDir: ev.dir,
  };

  ev.finalize(summary);
  return { skipped: false, ev, summary, roleResults, uxRollup };
}

export async function runVisualSuite({
  mode = 'hermetic',
  roleIds = null,
  watch = false,
  witness = null,
  paceMs = 0,
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const w = witness || createWitness({ enabled: watch && !witness, label: mode });
  if (mode === 'live') {
    return runLiveRoleSuite({ roleIds, witness: w, env, cwd });
  }
  return runHermeticVisualSuite({ witness: w, paceMs });
}
