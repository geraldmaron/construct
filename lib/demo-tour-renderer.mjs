/**
 * lib/demo-tour-renderer.mjs — linear, screen-reader-friendly demo tour renderer.
 *
 * Renders a loaded demo script (lib/demo-script.mjs) as a numbered, top-to-bottom
 * walkthrough with no Ink/interactive widgets, so `construct demo tour --accessible`
 * stays WCAG-plain: color is opt-in via the caller's palette and off under
 * NO_COLOR / non-TTY, prose wraps at a readable width, and every step is announced
 * as "Step N of M". Headless runs pass { skipInput: true } to auto-advance without
 * touching stdin; an interactive run without that flag pauses for Enter between
 * steps. This renderer never imports the chat TUI — the tour is built on the demo
 * surface only.
 */

import { resolveColors, termWidth, wrapText } from './term-format.mjs';

function writeWrapped(output, text, width) {
  output.write(`${wrapText(String(text), width)}\n`);
}

function renderHeader(output, script, colors, width, total) {
  output.write(`${colors.bold}Demo tour: ${script.title}${colors.reset}\n`);
  if (script.summary) writeWrapped(output, `${colors.dim}${script.summary}${colors.reset}`, width);
  output.write(`\n${colors.dim}${total} step${total === 1 ? '' : 's'}. Each step shows the prompt to ask and the command it runs.${colors.reset}\n`);
}

function renderStep(output, step, position, total, colors, width) {
  const title = step.title || step.prompt?.slice(0, 60) || `Step ${position}`;
  output.write(`\n${colors.bold}Step ${position} of ${total}: ${title}${colors.reset}\n`);
  if (step.prompt) {
    output.write(`${colors.dim}Prompt:${colors.reset}\n`);
    writeWrapped(output, `  ${step.prompt}`, width);
  }
  if (step.command) {
    output.write(`${colors.dim}Command:${colors.reset}\n`);
    output.write(`  ${step.command}\n`);
  }
}

// Pause for Enter only when a real interactive TTY is driving and the caller did
// not request auto-advance. A single readable() line keeps the wait keyboard-only
// and free of cursor positioning so screen readers track it as plain output.

function waitForEnter(input, output, colors) {
  return new Promise((resolve) => {
    output.write(`${colors.dim}Press Enter for the next step…${colors.reset}`);
    const onData = () => {
      input.removeListener('data', onData);
      input.pause?.();
      output.write('\n');
      resolve();
    };
    input.resume?.();
    input.once('data', onData);
  });
}

export async function renderTour({
  script,
  output = process.stdout,
  input = process.stdin,
  env = process.env,
  accessible = false,
  plain = false,
  skipInput = false,
  color,
} = {}) {
  if (!script || !Array.isArray(script.steps)) {
    return { ok: false, steps: 0, message: 'No demo script to tour' };
  }

  const linear = accessible || plain;
  const useColor = color !== undefined ? color : (!linear);
  const colors = resolveColors({ enabled: useColor, stream: output, env });
  const width = termWidth(output);
  const total = script.steps.length;

  // Linear and headless contexts never block on input; interactivity requires a
  // TTY on both ends so a piped or CI run advances on its own.
  const interactive = !skipInput && !linear && Boolean(input?.isTTY) && Boolean(output?.isTTY);

  renderHeader(output, script, colors, width, total);

  for (let i = 0; i < total; i += 1) {
    renderStep(output, script.steps[i], i + 1, total, colors, width);
    if (interactive && i < total - 1) {
      await waitForEnter(input, output, colors);
    }
  }

  output.write(`\n${colors.bold}Tour complete.${colors.reset} ${colors.dim}Run any step above in \`construct\` chat, or run \`construct demo ${script.name}\` to drive it live.${colors.reset}\n`);
  return { ok: true, steps: total, surface: 'tour', accessible: linear };
}
