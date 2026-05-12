#!/usr/bin/env node
/**
 * lib/hooks/scan-secrets.mjs — Scan secrets hook — detects potential secrets in files before they are committed.
 *
 * Runs as PostToolUse after Edit/Write. Scans the modified file content against known secret patterns (API keys, tokens, passwords) and blocks (exit 2) on matches.
 *
 * @p95ms 30
 * @maxBlockingScope PostToolUse
 */
import { readFileSync } from 'fs';
import { extname } from 'path';
import { logHookFailure } from './_lib/log.mjs';

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

// Patterns are matched per-line so multiple findings in one file are
// surfaced together. Capture group 1 is included in the JSONL log if
// present; otherwise the full match is used.
const SECRET_PATTERNS = [
  { name: 'Anthropic API key', pattern: /ANTHROPIC_API_KEY\s*=\s*(sk-ant-[a-zA-Z0-9\-_]{20,})/i },
  { name: 'Anthropic admin key', pattern: /(sk-ant-admin-[a-zA-Z0-9\-_]{20,})/ },
  { name: 'OpenAI API key', pattern: /OPENAI_API_KEY\s*=\s*(sk-[a-zA-Z0-9]{40,})/i },
  { name: 'OpenAI project key', pattern: /(sk-proj-[a-zA-Z0-9_\-]{40,})/ },
  { name: 'OpenAI organization key', pattern: /(sk-svcacct-[a-zA-Z0-9_\-]{40,})/ },
  { name: 'OpenRouter key', pattern: /(sk-or-v1-[a-zA-Z0-9]{40,})/ },
  { name: 'AWS access key', pattern: /(AKIA[0-9A-Z]{16})/ },
  { name: 'AWS secret access key', pattern: /aws[_\-]?secret[_\-]?access[_\-]?key\s*[:=]\s*['"]?([A-Za-z0-9\/\+=]{40})/i },
  { name: 'AWS session token', pattern: /(ASIA[0-9A-Z]{16})/ },
  { name: 'GCP service account JSON key', pattern: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/ },
  { name: 'GCP API key', pattern: /(AIza[0-9A-Za-z\-_]{35})/ },
  { name: 'Azure storage account key', pattern: /AccountKey\s*=\s*([A-Za-z0-9\+\/=]{88})/ },
  { name: 'Private key (PEM)', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'SSH private key', pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  { name: 'GitHub personal access token (classic)', pattern: /(ghp_[a-zA-Z0-9]{36})/ },
  { name: 'GitHub fine-grained PAT', pattern: /(github_pat_[A-Z0-9]{22}_[A-Za-z0-9]{59})/ },
  { name: 'GitHub Actions token', pattern: /(ghs_[a-zA-Z0-9]{36})/ },
  { name: 'GitHub OAuth token', pattern: /(gho_[a-zA-Z0-9]{36})/ },
  { name: 'GitHub user-to-server token', pattern: /(ghu_[a-zA-Z0-9]{36})/ },
  { name: 'GitHub server-to-server token', pattern: /(ghr_[a-zA-Z0-9]{36})/ },
  { name: 'Slack bot token', pattern: /(xoxb-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{24,})/ },
  { name: 'Slack user token', pattern: /(xoxp-[0-9]{10,}-[0-9]{10,}-[0-9]{10,}-[a-z0-9]{32,})/ },
  { name: 'Slack webhook URL', pattern: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{24})/ },
  { name: 'Stripe live secret', pattern: /(sk_live_[A-Za-z0-9]{20,})/ },
  { name: 'Stripe restricted key', pattern: /(rk_live_[A-Za-z0-9]{20,})/ },
  { name: 'Twilio account SID', pattern: /(AC[a-f0-9]{32})/ },
  { name: 'Twilio auth token', pattern: /TWILIO_AUTH_TOKEN\s*=\s*([a-f0-9]{32})/i },
  { name: 'SendGrid API key', pattern: /(SG\.[a-zA-Z0-9_\-]{22}\.[a-zA-Z0-9_\-]{43})/ },
  { name: 'Mailgun API key', pattern: /(key-[a-z0-9]{32})/ },
  { name: 'JWT (signed)', pattern: /(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-]{10,})/ },
  { name: 'Database URL with credentials', pattern: /(?:DATABASE|POSTGRES|MYSQL|MONGODB)_URL\s*=\s*([a-z]+:\/\/[^:\s]+:[^@\s]+@)/i },
  { name: 'Generic API key (env-style)', pattern: /(?:^|\s)([A-Z][A-Z0-9_]*(?:API|SECRET|TOKEN|PASSWORD|PRIVATE)_KEY)\s*=\s*['"]?([A-Za-z0-9_\-+/=]{30,})['"]?/, captureGroup: 2 },
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
} catch (err) {
  logHookFailure({ hook: 'scan-secrets', err, phase: 'read', input: { filePath } });
  process.exit(0);
}

const lines = content.split('\n');
const findings = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const { name, pattern, captureGroup } of SECRET_PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const captured = match[captureGroup ?? 1] ?? match[0];
    if (isPlaceholder(captured)) continue;
    findings.push({ name, line: i + 1, value: String(captured).slice(0, 20) + '...' });
  }
}

if (findings.length === 0) process.exit(0);

process.stderr.write('[scan-secrets] BLOCKED: Secret(s) detected in ' + filePath + '\n');
for (const { name, line, value } of findings) {
  process.stderr.write(`  Line ${line}: ${name} — matched value starts with: ${value}\n`);
}
process.stderr.write('Remove or rotate the secret before writing this file.\n');

try {
  const { emitRoleEvent } = await import('../roles/hook-emit.mjs');
  emitRoleEvent({
    type: 'secrets.detected',
    summary: `Secret(s) detected in ${filePath}: ${findings.map((f) => f.name).join(', ')}`,
    hookInput: {},
    context: { filePath, findings },
  });
} catch { /* best effort */ }

process.exit(2);
