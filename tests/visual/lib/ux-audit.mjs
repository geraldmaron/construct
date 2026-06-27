/**
 * tests/visual/lib/ux-audit.mjs — surface UX nitpicks for terminal chat.
 *
 * Complements depth-rubric.mjs: checks links, slash help, accessibility labels,
 * and role-specific surface expectations a human would notice while following along.
 */

import { stripAnsi } from './depth-rubric.mjs';
import { HELP } from '../../../lib/chat/commands.mjs';

export function auditSlashHelpOutput(stdout) {
  const plain = stripAnsi(stdout);
  const findings = [];
  if (!/commands/i.test(plain)) findings.push({ severity: 'fail', code: 'slash-help-missing-header', message: '/help did not print a commands header' });
  for (const [name] of HELP) {
    const token = name.split(/\s/)[0];
    if (!plain.includes(token)) {
      findings.push({ severity: 'fail', code: 'slash-help-missing-command', message: `/help missing catalog entry for ${token}` });
    }
  }
  return findings;
}

export function auditStartupSurface(stdout, stderr, { piped = false } = {}) {
  if (piped) return [];
  const plain = stripAnsi(`${stdout}\n${stderr}`);
  const findings = [];
  if (!/\/help for commands/i.test(plain)) {
    findings.push({ severity: 'warn', code: 'startup-no-help-hint', message: 'bare construct should hint /help for commands' });
  }
  if (/Run 'construct --help' for available commands/i.test(plain) && !/\/help for commands/i.test(plain)) {
    findings.push({ severity: 'fail', code: 'wrong-entry-surface', message: 'showed CLI help menu instead of chat REPL' });
  }
  return findings;
}

export function auditOsc8Links(raw, { piped = false } = {}) {
  if (piped) {
    return [{ severity: 'info', code: 'osc8-skipped-piped', message: 'OSC-8 link audit deferred to live TTY witness runs' }];
  }
  const findings = [];
  const osc8 = (raw.match(/\x1b\]8;;[^\x07]+\x07/g) || []).length;
  if (osc8 === 0) {
    findings.push({ severity: 'warn', code: 'no-osc8-links', message: 'no OSC-8 hyperlinks in output — doc/path links may not be clickable' });
  } else {
    findings.push({ severity: 'info', code: 'osc8-present', message: `${osc8} OSC-8 link(s) detected` });
  }
  const plain = stripAnsi(raw);
  const barePaths = (plain.match(/(?:docs\/|lib\/|skills\/)[\w./-]+\.md/g) || []).length;
  if (barePaths > 0 && osc8 === 0) {
    findings.push({ severity: 'fail', code: 'paths-not-linked', message: 'repo paths appear as plain text without OSC-8 links' });
  }
  return findings;
}

export function auditAccessibilityLabels(raw) {
  const plain = stripAnsi(raw);
  const findings = [];
  const labels = ['[thinking]', '[tool]', 'construct', '[usage]', 'you'];
  for (const label of labels) {
    if (!plain.toLowerCase().includes(label.toLowerCase())) {
      findings.push({ severity: 'warn', code: 'missing-a11y-label', message: `transcript missing screen-reader label: ${label}` });
    }
  }
  return findings;
}

export function auditRoleSurfaceUX({ stdout, stderr, role, piped = false }) {
  const findings = [
    ...auditStartupSurface(stdout, stderr, { piped }),
    ...auditOsc8Links(`${stdout}${stderr}`, { piped }),
  ];
  const surface = role?.surfaceUX || {};
  if (surface.mustShowHelpHint && !/\/help/i.test(stripAnsi(`${stdout}${stderr}`))) {
    findings.push({ severity: 'warn', code: 'role-help-hint', message: `${role.label} expects visible /help guidance early in session` });
  }
  return findings;
}

export function rollupUxFindings(findings) {
  const fails = findings.filter((f) => f.severity === 'fail');
  const warns = findings.filter((f) => f.severity === 'warn');
  return {
    ok: fails.length === 0,
    failCount: fails.length,
    warnCount: warns.length,
    findings,
  };
}
