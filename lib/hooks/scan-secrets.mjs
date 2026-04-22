#!/usr/bin/env node
/**
 * lib/hooks/scan-secrets.mjs — Scan secrets hook — detects potential secrets in files before they are committed.
 *
 * Runs as PostToolUse after Edit/Write. Scans the modified file content against known secret patterns (API keys, tokens, passwords) and blocks (exit 2) on matches.
 */
import { readFileSync } from 'fs';
import { extname } from 'path';

const SCAN_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.go', '.rs', '.rb', '.php', '.java', '.kt', '.swift',
  '.sh', '.bash', '.zsh',
  '.env', '.yaml', '.yml', '.toml', '.json', '.tf', '.tfvars', '.config',
]);

const PLACEHOLDER_PATTERNS = [
  /\.\.\./,
  /YOUR_KEY/i,
  /<[^>]+>/,
  /^sk-\.\.\./,
  /^pk-lf-\.\.\./,
  /__[A-Z_]+__/,
];

const SECRET_PATTERNS = [
  { name: 'Anthropic API key', pattern: /ANTHROPIC_API_KEY\s*=\s*(sk-ant-[a-zA-Z0-9\-_]{20,})/i },
  { name: 'OpenAI API key', pattern: /OPENAI_API_KEY\s*=\s*(sk-[a-zA-Z0-9]{40,})/i },
  { name: 'OpenRouter key', pattern: /(sk-or-v1-[a-zA-Z0-9]{40,})/ },
  { name: 'AWS access key', pattern: /(AKIA[0-9A-Z]{16})/ },
  { name: 'Private key (PEM)', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub personal access token', pattern: /(ghp_[a-zA-Z0-9]{36})/ },
  { name: 'GitHub Actions token', pattern: /(ghs_[a-zA-Z0-9]{36})/ },
  { name: 'Database URL with credentials', pattern: /DATABASE_URL\s*=\s*(postgresql:\/\/[^@]+:[^@]+@)/i },
];

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value));
}

const filePath = process.env.TOOL_INPUT_FILE_PATH;

if (!filePath) process.exit(0);

const ext = extname(filePath).toLowerCase();
if (!SCAN_EXTENSIONS.has(ext)) process.exit(0);

let content;
try {
  content = readFileSync(filePath, 'utf8');
} catch {
  process.exit(0);
}

const lines = content.split('\n');
const findings = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const captured = match[1] ?? match[0];
    if (isPlaceholder(captured)) continue;
    findings.push({ name, line: i + 1, value: captured.slice(0, 20) + '...' });
  }
}

if (findings.length === 0) process.exit(0);

process.stderr.write('[scan-secrets] BLOCKED: Secret(s) detected in ' + filePath + '\n');
for (const { name, line, value } of findings) {
  process.stderr.write(`  Line ${line}: ${name} — matched value starts with: ${value}\n`);
}
process.stderr.write('Remove or rotate the secret before writing this file.\n');
process.exit(2);
