/**
 * tests/visual/lib/witness.mjs — follow-along logging for visual test runs.
 *
 * Prints human-readable action lines to stderr so you can watch typing, prompts,
 * and streaming events while the harness executes.
 */

export function createWitness({ enabled = true, label = 'visual' } = {}) {
  if (!enabled) {
    return {
      onAction() {},
      onOutput() {},
      onEvent() {},
      log() {},
    };
  }

  const prefix = `[${label}]`;

  const log = (kind, message) => {
    const ts = new Date().toISOString().slice(11, 23);
    process.stderr.write(`${prefix} ${ts} ${kind} ${message}\n`);
  };

  return {
    onAction(kind, detail) {
      log('ACTION', `${kind}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    },
    onOutput(stream, chunk) {
      const snippet = String(chunk).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(0, 120).replace(/\n/g, '↵');
      if (snippet.trim()) log(stream.toUpperCase(), snippet);
    },
    onEvent(event) {
      if (event.type === 'text' && event.text) {
        log('EVENT', `text +${event.text.length} chars`);
      } else if (event.type === 'tool_call') {
        log('EVENT', `tool ${event.title || event.id}`);
      } else if (event.type === 'usage') {
        log('EVENT', `usage in=${event.tokens?.input ?? '?'} out=${event.tokens?.output ?? '?'}`);
      } else if (event.type === 'error') {
        log('EVENT', `error ${event.message}`);
      }
    },
    log,
  };
}
