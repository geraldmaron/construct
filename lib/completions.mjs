/**
 * completions.mjs — generates bash and zsh completion scripts for construct.
 *
 * Called by sync-agents.mjs after each sync.
 * Outputs to a platform-appropriate per-user completions directory.
 */

import { CLI_COMMANDS } from './cli-commands.mjs';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const COMPLETIONS_DIR = process.platform === 'win32'
  ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'construct', 'completions')
  : join(homedir(), '.local', 'share', 'construct', 'completions');

function buildBash() {
  const names = CLI_COMMANDS.map(c => c.name).join(' ');

  const subcommandCases = CLI_COMMANDS
    .filter(c => c.subcommands?.length)
    .map(c => {
      const subs = c.subcommands.map(s => s.name).join(' ');
      return `        ${c.name}) COMPREPLY=($(compgen -W "${subs}" -- "$cur")) ;;`;
    })
    .join('\n');

  const dirCommands = CLI_COMMANDS
    .filter(c => c.usage?.includes('<dir>'))
    .map(c => c.name)
    .join('|');

  const optionCases = CLI_COMMANDS
    .filter(c => c.options?.length)
    .map(c => {
      const flags = c.options.map(o => o.flag.split('=')[0]).join(' ');
      return `        ${c.name}) COMPREPLY=($(compgen -W "${flags}" -- "$cur")) ;;`;
    })
    .join('\n');

  return `# bash completion for construct
# Source this file in ~/.bashrc:
#   source ~/.local/share/construct/completions/construct.bash

_construct_completions() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    words=("\${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  }

  local commands="${names}"

  # First argument: complete command names
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return 0
  fi

  local cmd="\${words[1]}"

  # Subcommands
  if [[ $cword -eq 2 ]]; then
    case "$cmd" in
${subcommandCases}
      ${dirCommands ? `${dirCommands}) _filedir -d ;;` : ''}
    esac
    return 0
  fi

  # Options (flags starting with -)
  if [[ "$cur" == -* ]]; then
    case "$cmd" in
${optionCases}
    esac
    return 0
  fi
}

complete -F _construct_completions construct
`;
}

function buildZsh() {
  const commandDescriptions = CLI_COMMANDS
    .map(c => `    '${c.name}:${c.emoji || ''} ${(c.description || '').replace(/'/g, "\\'")}' \\`)
    .join('\n');

  const subcommandFunctions = CLI_COMMANDS
    .filter(c => c.subcommands?.length)
    .map(c => {
      const subs = c.subcommands
        .map(s => `      '${(s.name || '')}:${(s.desc || '').replace(/'/g, "\\'")}'`)
        .join('\n');
      return `_construct_${(c.name || '').replace(/-/g, '_')}() {
  local subcmds
  subcmds=(
${subs}
  )
  _describe -t subcommands '${c.name}' subcmds
}`;
    })
    .join('\n\n');

  const subcommandDispatch = CLI_COMMANDS
    .filter(c => c.subcommands?.length)
    .map(c => `      ${c.name}) _construct_${c.name.replace(/-/g, '_')} ;;`)
    .join('\n');

  const dirCommands = CLI_COMMANDS
    .filter(c => c.usage?.includes('<dir>'))
    .map(c => c.name)
    .join('|');

  return `#compdef construct
# zsh completion for construct
# Add to fpath: fpath=(~/.local/share/construct/completions $fpath)
# Then: autoload -Uz compinit && compinit

${subcommandFunctions}

_construct_commands() {
  local commands
  commands=(
${commandDescriptions}
  )
  _describe -t commands 'construct command' commands
}

_construct() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C \\
    '1: :_construct_commands' \\
    '*:: :->args'

  case $state in
    args)
      case $words[1] in
${subcommandDispatch}
        ${dirCommands ? `${dirCommands}) _files -/ ;;` : ''}
        *) ;;
      esac
      ;;
  esac
}

_construct
`;
}

export function generateCompletions() {
  try {
    mkdirSync(COMPLETIONS_DIR, { recursive: true });

    writeFileSync(join(COMPLETIONS_DIR, 'construct.bash'), buildBash());
    writeFileSync(join(COMPLETIONS_DIR, '_construct'), buildZsh());

    return COMPLETIONS_DIR;
  } catch (err) {
    process.stderr.write(`[completions] failed to write: ${err.message}\n`);
    return null;
  }
}

export { COMPLETIONS_DIR };
