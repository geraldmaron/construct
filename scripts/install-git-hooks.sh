#!/usr/bin/env bash
# install-git-hooks.sh — wires secret-scan as a real git pre-commit hook, so
# it fires regardless of which tool or agent makes the commit. Run once after
# clone. Not run automatically by npm install — a postinstall that mutates
# .git/hooks is exactly the kind of silent host-config mutation this rebirth
# is trying not to repeat.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$repo_root/.git/hooks/pre-commit"

cat > "$hook" <<'EOF'
#!/usr/bin/env bash
node "$(git rev-parse --show-toplevel)/scripts/hooks/secret-scan.mjs"
EOF
chmod +x "$hook"
echo "installed pre-commit hook -> $hook"
