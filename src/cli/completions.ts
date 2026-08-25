/**
 * cli/completions.ts — shell completion scripts generated from the CLI's verb table.
 *
 * Completions are generated from the VERBS array rather than hand-written, so
 * they cannot drift from what the CLI actually accepts. The script emitted here
 * covers every verb and common flags. A user runs:
 *
 *   construct completions --shell=zsh > /path/to/completions
 *
 * and sources it in their shell startup file.
 */

import { VERBS } from './index.ts';

/**
 * Generates a zsh completion script covering all verbs and common flags.
 * The verbs are derived from the same table that `help` reads, so they
 * cannot drift.
 */
function generateZshCompletions(): string {
  const verbs = VERBS.filter((v) => v !== 'help'); // help is special-cased in usage
  const flags = ['help', 'host', 'model', 'binary', 'dir', 'timeout', 'workspace', 'run'];

  return `#compdef construct

# This completion script is generated from the CLI's verb table (VERBS in src/cli/index.ts).
# To update completions, run: construct completions --shell=zsh > ~/.zfunc/_construct

_construct_completions() {
  local -a verbs
  verbs=(${verbs.map((v) => `'${v}'`).join(' ')})

  local -a common_flags
  common_flags=(
    '--help'
    '--host=[opencode|claude|codex|cursor]'
    '--model=[model name]'
    '--binary=[path to binary]'
    '--dir=[directory path]'
    '--timeout=[minutes]'
    '--workspace=[workspace name]'
    '--run=[run id]'
  )

  local cur prev
  cur="\${COMP_WORDS[-1]}"
  prev="\${COMP_WORDS[-2]}"

  # Complete verbs at first position
  if (( CURRENT == 2 )); then
    _values 'construct verbs' \$verbs
  else
    # Complete flags for any verb
    _values 'flags' \$common_flags
  fi
}

_construct_completions "$@"
`;
}

/**
 * Generates a bash completion script covering all verbs and common flags.
 * The verbs are derived from the same table that `help` reads, so they
 * cannot drift.
 */
function generateBashCompletions(): string {
  const verbs = VERBS.filter((v) => v !== 'help'); // help is special-cased in usage
  const flags = ['help', 'host', 'model', 'binary', 'dir', 'timeout', 'workspace', 'run'];

  const verbsString = verbs.join(' ');
  const flagsString = flags.map((f) => `--${f}`).join(' ');

  return `# Bash completion for construct
# This completion script is generated from the CLI's verb table (VERBS in src/cli/index.ts).
# To install, run: construct completions --shell=bash | sudo tee /usr/local/etc/bash_completion.d/construct
# Or add to your .bashrc:
#   source <(construct completions --shell=bash)

_construct_completions() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words=(\${COMP_WORDS[@]})
  cword=\${COMP_CWORD}

  local verbs="${verbsString}"
  local flags="${flagsString}"

  # Complete verbs if we're at the first argument
  if [[ \$cword -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "\${verbs}" -- "\${cur}") )
    return 0
  fi

  # Complete flags
  if [[ \${cur} == -* ]]; then
    COMPREPLY=( \$(compgen -W "\${flags}" -- "\${cur}") )
    return 0
  fi

  return 0
}

complete -o bashdefault -o default -o nospace -F _construct_completions construct
`;
}

/**
 * The completions verb. Generates shell completion scripts covering every
 * verb in the CLI's own verb table (VERBS array), so they remain in sync
 * and cannot drift.
 *
 * Usage:
 *   construct completions --shell=zsh > /path/to/completions
 *   construct completions --shell=bash > /path/to/completions
 */
export function completions(argv: string[]): number {
  const hasHelp = argv.includes('--help');
  const shell = argv.find((a) => a.startsWith('--shell='))?.split('=')[1] || '';

  if (hasHelp) {
    process.stderr.write(
      'usage: construct completions --shell=zsh|bash\n' +
        '  --shell=zsh      Emit a zsh completion script\n' +
        '  --shell=bash     Emit a bash completion script\n',
    );
    return 0;
  }

  if (shell === 'zsh') {
    process.stdout.write(generateZshCompletions());
    return 0;
  }

  if (shell === 'bash') {
    process.stdout.write(generateBashCompletions());
    return 0;
  }

  if (shell === '') {
    process.stderr.write(
      'usage: construct completions --shell=zsh|bash\n' +
        '  --shell=zsh      Emit a zsh completion script\n' +
        '  --shell=bash     Emit a bash completion script\n',
    );
    return 2;
  }

  process.stderr.write(`construct: unknown shell "${shell}" (expected bash or zsh)\n`);
  return 2;
}
