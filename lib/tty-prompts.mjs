import readline, { createInterface } from 'node:readline';

const ESC = '\x1b[';
const ALT_SCREEN_ON = `${ESC}?1049h`;
const ALT_SCREEN_OFF = `${ESC}?1049l`;
const CURSOR_HIDE = `${ESC}?25l`;
const CURSOR_SHOW = `${ESC}?25h`;
const HOME_CLEAR = `${ESC}H${ESC}2J`;
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

function truncate(text, maxWidth) {
  if (!text) return '';
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, Math.max(0, maxWidth - 1))}...`;
}

function wrapText(text, width) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > width ? truncate(word, width) : word;
  }
  if (current) lines.push(current);
  return lines;
}

function renderFrame(content) {
  return `${HOME_CLEAR}${content}`;
}

function renderDetailBlock(label, text, width) {
  const lines = wrapText(text, width);
  if (!lines.length) return '';
  return `${BOLD}${label}:${RESET}\n${lines.map((line) => `  ${line}`).join('\n')}\n`;
}

function createMenuSession(render, onKeypress) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      escapeCodeTimeout: 50,
    });

    readline.emitKeypressEvents(process.stdin, rl);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(`${ALT_SCREEN_ON}${CURSOR_HIDE}`);

    function redraw() {
      process.stdout.write(renderFrame(render()));
    }

    function cleanup() {
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
      process.stdin.pause();
      process.stdout.write(`${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
    }

    function finish(value) {
      cleanup();
      resolve(value);
    }

    function cancel(error) {
      cleanup();
      reject(error);
    }

    function handleKeypress(_str, key = {}) {
      try {
        if (key.ctrl && key.name === 'c') {
          cancel(new Error('Canceled by user.'));
          return;
        }
        const result = onKeypress(key, { redraw, finish, cancel });
        if (result !== false) redraw();
      } catch (error) {
        cancel(error);
      }
    }

    process.stdin.on('keypress', handleKeypress);
    redraw();
  });
}

export async function selectOption({ title, instructions, options, initialIndex = 0 }) {
  let cursor = Math.min(Math.max(initialIndex, 0), Math.max(0, options.length - 1));

  return createMenuSession(
    () => {
      const width = Math.max(60, (process.stdout.columns || 80) - 4);
      const focused = options[cursor] ?? options[0];
      const lines = [
        `${BOLD}${title}${RESET}`,
        `${DIM}${instructions}${RESET}`,
        '',
      ];

      for (let index = 0; index < options.length; index += 1) {
        const option = options[index];
        const prefix = index === cursor ? `${CYAN}>${RESET}` : ' ';
        const label = index === cursor ? `${BOLD}${option.label}${RESET}` : option.label;
        const meta = option.meta ? `  ${DIM}${truncate(option.meta, 24)}${RESET}` : '';
        lines.push(` ${prefix} ${label}${meta}`);
      }

      lines.push('');
      if (focused) {
        lines.push(renderDetailBlock('Details', focused.description, width).trimEnd());
      }

      return `${lines.filter(Boolean).join('\n')}\n`;
    },
    (key, controls) => {
      if (key.name === 'up' || key.name === 'k' || (key.ctrl && key.name === 'p')) {
        cursor = (cursor - 1 + options.length) % options.length;
      } else if (key.name === 'down' || key.name === 'j' || (key.ctrl && key.name === 'n')) {
        cursor = (cursor + 1) % options.length;
      } else if (key.name === 'return' || key.name === 'enter') {
        controls.finish(options[cursor]?.value ?? options[cursor]?.label);
      } else if (key.name === 'escape' || key.name === 'q') {
        controls.cancel(new Error('Canceled by user.'));
      }
    },
  );
}

export async function multiSelect({ title, instructions, options }) {
  const state = options.map((option) => ({ ...option }));
  let cursor = 0;

  return createMenuSession(
    () => {
      const width = Math.max(60, (process.stdout.columns || 80) - 4);
      const focused = state[cursor] ?? state[0];
      const selected = state.filter((option) => option.checked).map((option) => option.label);
      const lines = [
        `${BOLD}${title}${RESET}`,
        `${DIM}${instructions}${RESET}`,
        '',
      ];

      for (let index = 0; index < state.length; index += 1) {
        const option = state[index];
        const prefix = index === cursor ? `${CYAN}>${RESET}` : ' ';
        const box = option.checked ? '[x]' : '[ ]';
        const label = index === cursor ? `${BOLD}${option.label}${RESET}` : option.label;
        const meta = option.meta ? `  ${DIM}${truncate(option.meta, 18)}${RESET}` : '';
        const marker = option.suggestion ? `  ${YELLOW}*${RESET}` : '';
        lines.push(` ${prefix} ${box} ${label}${meta}${marker}`);
      }

      lines.push('');
      if (focused) {
        lines.push(renderDetailBlock('Details', focused.description, width).trimEnd());
        if (focused.suggestion) {
          lines.push('');
          lines.push(renderDetailBlock('Suggested because', focused.suggestion, width).trimEnd());
        }
      }
      lines.push('');
      lines.push(renderDetailBlock('Selected', selected.length ? selected.join(', ') : 'None yet.', width).trimEnd());

      return `${lines.filter(Boolean).join('\n')}\n`;
    },
    (key, controls) => {
      if (key.name === 'up' || key.name === 'k' || (key.ctrl && key.name === 'p')) {
        cursor = (cursor - 1 + state.length) % state.length;
      } else if (key.name === 'down' || key.name === 'j' || (key.ctrl && key.name === 'n')) {
        cursor = (cursor + 1) % state.length;
      } else if (key.name === 'space') {
        state[cursor].checked = !state[cursor].checked;
      } else if (key.name === 'a') {
        const allChecked = state.every((option) => option.checked);
        state.forEach((option) => { option.checked = !allChecked; });
      } else if (key.name === 'i') {
        state.forEach((option) => { option.checked = !option.checked; });
      } else if (key.name === 'return' || key.name === 'enter') {
        controls.finish(state.filter((option) => option.checked).map((option) => option.value ?? option.label));
      } else if (key.name === 'escape' || key.name === 'q') {
        controls.cancel(new Error('Canceled by user.'));
      }
    },
  );
}
