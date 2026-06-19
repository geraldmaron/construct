/**
 * lib/chat/demo-guide.mjs — slash-command helpers for construct chat demo mode.
 */

export function formatDemoStepLine(step, colors = {}) {
  const dim = colors.dim || '';
  const reset = colors.reset || '';
  const bold = colors.bold || '';
  const lines = [`${bold}Step ${step.index}${reset}: ${step.title || 'prompt'}`];
  if (step.prompt) lines.push(`${step.prompt}`);
  if (step.command) lines.push(`${dim}command: ${step.command}${reset}`);
  return lines.join('\n');
}

export function formatDemoStepsList(guide, colors = {}) {
  const dim = colors.dim || '';
  const reset = colors.reset || '';
  const bold = colors.bold || '';
  const lines = [`${bold}Demo steps${reset}`];
  guide.script.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step.title || step.prompt?.slice(0, 50) || 'step'}`);
  });
  lines.push(`${dim}Use /demo next for the next prompt${reset}`);
  return lines.join('\n');
}

export function registerDemoCommands(HELP, demoGuide) {
  if (!demoGuide) return HELP;
  return [
    ...HELP.slice(0, 1),
    ['/demo [next|steps|reset]', 'walk the active demo script'],
    ...HELP.slice(1),
  ];
}

export function handleDemoCommand(arg, { demoGuide, output, colors }) {
  if (!demoGuide) {
    output.write(`${colors.dim}No active demo. Launch with \`construct demo <name>\`.${colors.reset}\n`);
    return;
  }
  const action = (arg || 'steps').toLowerCase();
  if (action === 'reset') {
    demoGuide.reset();
    output.write(`${colors.green}Demo reset to step 1.${colors.reset}\n`);
    return;
  }
  if (action === 'next') {
    const step = demoGuide.next();
    if (!step) {
      output.write(`${colors.dim}Demo complete — all steps shown.${colors.reset}\n`);
      return;
    }
    output.write(`\n${formatDemoStepLine(step, colors)}\n\n`);
    return;
  }
  output.write(`${formatDemoStepsList(demoGuide, colors)}\n`);
  const peek = demoGuide.peek();
  if (peek) {
    output.write(`${colors.dim}Next: /demo next → ${peek.title || 'step'}${colors.reset}\n`);
  }
}
