/**
 * cli/json.ts — the one place `--json` is recognized and printed, for every
 * read verb that offers it.
 *
 * The shape printed is the stored record — the fields the human rendering is
 * built from — never the rendered prose. A deliverable or a log line is
 * localized and laid out for a person reading a terminal; the record behind
 * it is the data, and a script parsing `--json` output gets that data intact.
 * `JSON.stringify` already escapes every control character inside a string
 * value as a `\u00XX` sequence, so JSON output needs none of the terminal
 * escaping the human-facing renderers apply — the escaping and the JSON
 * encoding guard the same boundary by different, non-overlapping means.
 */

/** Whether this invocation asked for the record rather than the rendering. */
export function jsonFlag(argv: readonly string[]): boolean {
  return argv.includes('--json');
}

/** Print one record as a single line of JSON, newline-terminated like every other line this CLI writes. */
export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
