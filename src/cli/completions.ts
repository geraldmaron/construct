/**
 * cli/completions.ts — shell completion scripts derived from the command
 * registry, so a command that exists is completable and one that does not is
 * not.
 */

import { GLOBAL_FLAGS, type CommandSpec } from './commands.ts';

export const SHELLS = ['bash', 'zsh', 'fish'] as const;
export type Shell = (typeof SHELLS)[number];

function words(commands: readonly CommandSpec[]): { readonly first: string[]; readonly second: Record<string, string[]>; readonly flags: Record<string, string[]> } {
  const first = [...new Set(commands.map((c) => c.path[0]!))].sort();
  const second: Record<string, string[]> = {};
  const flags: Record<string, string[]> = {};
  for (const c of commands) {
    if (c.path.length > 1) (second[c.path[0]!] ??= []).push(c.path[1]!);
    flags[c.path.join(' ')] = [...c.flags, ...GLOBAL_FLAGS].map((f) => `--${f.name}`);
  }
  for (const k of Object.keys(second)) second[k] = [...new Set(second[k])].sort();
  return { first, second, flags };
}

export function completionScript(shell: Shell, commands: readonly CommandSpec[]): string {
  const w = words(commands);
  if (shell === 'bash') {
    const cases = Object.entries(w.second).map(([verb, subs]) => `      ${verb}) COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") ); return;;`).join('\n');
    return [
      '_construct() {',
      '  local cur prev',
      '  cur="${COMP_WORDS[COMP_CWORD]}"',
      '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
      '  if [ "$COMP_CWORD" -eq 1 ]; then',
      `    COMPREPLY=( $(compgen -W "${w.first.join(' ')}" -- "$cur") ); return`,
      '  fi',
      '  if [ "$COMP_CWORD" -eq 2 ]; then',
      '    case "$prev" in',
      cases,
      '    esac',
      '  fi',
      `  COMPREPLY=( $(compgen -W "${[...new Set(Object.values(w.flags).flat())].sort().join(' ')}" -- "$cur") )`,
      '}',
      'complete -F _construct construct',
      '',
    ].join('\n');
  }
  if (shell === 'zsh') {
    const subs = Object.entries(w.second).map(([verb, s]) => `    ${verb}) _values 'subcommand' ${s.join(' ')};;`).join('\n');
    return [
      '#compdef construct',
      '_construct() {',
      '  if (( CURRENT == 2 )); then',
      `    _values 'command' ${w.first.join(' ')}`,
      '  elif (( CURRENT == 3 )); then',
      '    case "$words[2]" in',
      subs,
      '    esac',
      '  else',
      `    _values 'flag' ${[...new Set(Object.values(w.flags).flat())].sort().join(' ')}`,
      '  fi',
      '}',
      '_construct "$@"',
      '',
    ].join('\n');
  }
  const lines = [`complete -c construct -f -n '__fish_use_subcommand' -a '${w.first.join(' ')}'`];
  for (const [verb, subs] of Object.entries(w.second)) {
    lines.push(`complete -c construct -f -n '__fish_seen_subcommand_from ${verb}' -a '${subs.join(' ')}'`);
  }
  for (const flag of [...new Set(Object.values(w.flags).flat())].sort()) lines.push(`complete -c construct -l ${flag.slice(2)}`);
  return `${lines.join('\n')}\n`;
}
