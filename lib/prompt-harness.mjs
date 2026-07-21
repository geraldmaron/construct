/**
 * lib/prompt-harness.mjs — scripted interactive prompt responses for tests and CI.
 *
 * When CONSTRUCT_PROMPT_SCRIPT or CONSTRUCT_PROMPT_SCRIPT_FILE is set,
 * tty-prompts and init confirm() consume queued answers instead of requiring
 * a real TTY. Real TTY sessions ignore the harness unless the env vars are set.
 *
 * Script shape:
 *   { select: string[], multiSelect: string[][], confirm: boolean[] }
 */

import fs from 'node:fs';

let loaded = undefined;

export function isPromptHarnessActive(env = process.env) {
  return Boolean(env.CONSTRUCT_PROMPT_SCRIPT || env.CONSTRUCT_PROMPT_SCRIPT_FILE);
}

export function loadPromptScript(env = process.env) {
  if (loaded !== undefined) return loaded;
  const raw = env.CONSTRUCT_PROMPT_SCRIPT_FILE
    ? fs.readFileSync(env.CONSTRUCT_PROMPT_SCRIPT_FILE, 'utf8')
    : env.CONSTRUCT_PROMPT_SCRIPT;
  if (!raw) {
    loaded = null;
    return null;
  }
  loaded = JSON.parse(raw);
  if (!loaded || typeof loaded !== 'object') {
    throw new Error('CONSTRUCT_PROMPT_SCRIPT must be a JSON object');
  }
  loaded.select = Array.isArray(loaded.select) ? [...loaded.select] : [];
  loaded.multiSelect = Array.isArray(loaded.multiSelect) ? loaded.multiSelect.map((entry) => [...entry]) : [];
  loaded.confirm = Array.isArray(loaded.confirm) ? [...loaded.confirm] : [];
  return loaded;
}

export function resetPromptHarnessForTests() {
  loaded = undefined;
}

function queueLabel(kind) {
  return `Prompt harness exhausted: no ${kind} value queued (set CONSTRUCT_PROMPT_SCRIPT)`;
}

export function nextSelectValue(env = process.env) {
  const script = loadPromptScript(env);
  if (!script?.select?.length) throw new Error(queueLabel('select'));
  return script.select.shift();
}

export function nextMultiSelectValue(env = process.env) {
  const script = loadPromptScript(env);
  if (!script?.multiSelect?.length) throw new Error(queueLabel('multiSelect'));
  return script.multiSelect.shift();
}

export function nextConfirmValue({ defaultYes = true, env = process.env } = {}) {
  const script = loadPromptScript(env);
  if (!script?.confirm?.length) return defaultYes;
  return script.confirm.shift();
}
