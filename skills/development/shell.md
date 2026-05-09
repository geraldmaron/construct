<!--
skills/development/shell.md — Shell Scripting Best Practices — Use this skill when writing, reviewing, or debugging Bash, Zsh, or POSIX shell s

Use this skill when writing, reviewing, or debugging Bash, Zsh, or POSIX shell scripts. ## Script Header
-->
# Shell Scripting Best Practices

Use this skill when writing, reviewing, or debugging Bash, Zsh, or POSIX shell scripts.

## Script Header

```bash
#!/usr/bin/env bash
set -euo pipefail
```

- `set -e`: exit on error
- `set -u`: treat unset variables as errors
- `set -o pipefail`: propagate pipe failures
- Use `#!/usr/bin/env bash` for portability; `#!/bin/sh` for POSIX-only scripts

## Variables

- Always quote variables: `"$var"` prevents word splitting and globbing
- Use `${var:-default}` for default values
- Use `${var:?error message}` to fail on unset required variables
- Local variables in functions: `local var="value"`
- Uppercase for exported/environment variables; lowercase for script-local

## Functions

```bash
function_name() {
  local input="$1"
  # function body
}
```

- Use functions for any logic reused or exceeding 10 lines
- Declare local variables with `local`
- Return exit codes (0 = success, non-zero = failure)
- Use `return` for status; use stdout for data output

## Conditionals and Testing

- `[[ ]]` for conditionals in Bash (safer than `[ ]`)
- `(( ))` for arithmetic comparisons
- String comparison: `[[ "$a" == "$b" ]]`
- File tests: `[[ -f "$file" ]]`, `[[ -d "$dir" ]]`, `[[ -r "$file" ]]`
- Regex: `[[ "$str" =~ ^pattern$ ]]`
- Always quote variables inside conditionals

## Input Handling

- Validate all arguments before processing
- Use `getopts` or manual parsing for flags
- Provide usage/help output with `--help`
- Check required tools exist: `command -v tool >/dev/null || { echo "tool required"; exit 1; }`
- Sanitize any input used in commands to prevent injection

## Error Handling

- Use `trap` for cleanup: `trap cleanup EXIT`
- Check command return codes explicitly for critical operations
- Log errors to stderr: `echo "Error: message" >&2`
- Exit with meaningful codes: 1 = general error, 2 = usage error
- Use `|| true` only when a failure is genuinely acceptable

## Temporary Files

```bash
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
```

- Always use `mktemp` for temporary files and directories
- Clean up with EXIT trap
- Never hardcode temporary paths

## Process and Subshell

- `$()` for command substitution (not backticks)
- Avoid unnecessary subshells; they add overhead
- Use `read` with `IFS` for parsing: `IFS=: read -r user pass <<< "$line"`
- Process substitution `<()` for feeding command output as a file
- `xargs` or `while read` for processing lists; avoid `for f in $(ls)`

## Portability

- Test on the target shell (Bash 3.x on macOS, 5.x on Linux)
- Avoid Bash-specific features in `#!/bin/sh` scripts
- Use `printf` over `echo` for consistent behavior across platforms
- Check for GNU vs BSD tool differences (sed, date, grep flags)

## Security

- Never use `eval` with user input
- Quote all variable expansions
- Use `--` to terminate option parsing before user input: `grep -- "$pattern" file`
- Validate file paths; prevent directory traversal
- Avoid storing secrets in variables visible in `/proc` or `ps` output
- Use `mktemp` with restrictive permissions

## Testing

- Use `bats` (Bash Automated Testing System) for shell script tests
- Test exit codes, stdout, and stderr output
- Test with various inputs: empty, spaces, special characters, long strings
- Run with `shellcheck` for static analysis; fix all warnings
- Test on CI with the target shell version

## Performance

- Avoid unnecessary external commands; use Bash builtins when possible
- `[[ ]]` is faster than `[ ]` (no separate process)
- Parameter expansion (`${var##*/}`) over `basename "$var"`
- Bulk operations over loops: `find ... -exec cmd {} +` over `for f in; do cmd "$f"; done`
- If performance matters significantly, consider Python or Go instead

## Anti-Patterns

- Parsing `ls` output (use glob patterns or `find`)
- Unquoted variable expansions
- `cat file | grep` instead of `grep pattern file`
- `cd` without checking success: use `cd dir || exit 1`
- Scripts longer than 200 lines without functions
- Storing structured data in variables (use files or jq for JSON)
