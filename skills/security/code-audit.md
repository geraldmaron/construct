<!--
skills/security/code-audit.md — Code Audit — Use this skill when reviewing source code for security vulnerabilities through s

Use this skill when reviewing source code for security vulnerabilities through static analysis. ## Taint Analysis
-->
# Code Audit

Use this skill when reviewing source code for security vulnerabilities through static analysis.

## Taint Analysis

Trace data flow from sources to sinks. Any path from untrusted input to a dangerous operation without sanitization is a finding.

### Sources (Untrusted Input)
- HTTP request: params, headers, cookies, body, uploaded files
- Database reads (if user-influenced)
- Environment variables from external config
- File reads, IPC, message queue payloads
- Third-party API responses
- URL fragments and query strings

### Sinks (Dangerous Operations)
- SQL/NoSQL query construction
- OS command execution (`exec`, `system`, `spawn`, `popen`)
- File system operations (open, read, write, delete, path construction)
- HTML/template rendering
- HTTP redirects and URL construction
- Deserialization (`pickle`, `unserialize`, `JSON.parse` of untrusted classes)
- Dynamic code evaluation (`eval`, `Function()`, `exec()`)
- Logging (sensitive data leakage)

### Sanitization Verification
- Is the sanitizer appropriate for the sink? (HTML escaping does not prevent SQL injection)
- Is the sanitizer applied consistently on all paths?
- Is the sanitizer applied before the sink, not after?
- Does the sanitizer handle edge cases: null bytes, Unicode normalization, double encoding?

## Dangerous Function Patterns

### Language-Specific Red Flags

**JavaScript/TypeScript**: `eval`, `Function()`, `innerHTML`, `document.write`, `child_process.exec`, `require()` with dynamic input
**Python**: `eval`, `exec`, `pickle.loads`, `subprocess.shell=True`, `os.system`, `yaml.load` (use safe_load)
**Java**: `Runtime.exec`, `ProcessBuilder`, `ObjectInputStream.readObject`, `Statement.execute` (use PreparedStatement)
**Go**: `os/exec.Command` with user input, `html/template` vs `text/template` confusion, `unsafe` package usage
**Rust**: `unsafe` blocks, `Command::new` with user input, raw pointer operations
**PHP**: `eval`, `system`, `exec`, `passthru`, `preg_replace` with `e` modifier, `unserialize`

## Authentication and Session Review

- Password comparison uses constant-time comparison
- Session tokens generated with CSPRNG
- Session invalidated on logout and password change
- Token expiry enforced server-side
- No session data in URLs

## Access Control Review

- Authorization checked on every request, not cached from prior request
- Role checks happen server-side
- Object-level authorization verified (not just endpoint-level)
- Admin functionality isolated from user-facing code paths

## Cryptography Review

- No custom cryptographic implementations
- Key material not hardcoded or logged
- IV/nonce never reused with the same key
- Signatures verified before trusting data
- Constant-time comparison for MAC/signature verification

## File and Path Operations

- User input never directly used in file paths
- Path traversal prevention: canonicalize then validate prefix
- File uploads: validate type, limit size, store outside webroot, randomize names
- Temporary files created securely and cleaned up

## Error Handling Review

- Exceptions do not expose internal state to users
- Catch blocks do not silently swallow security-relevant errors
- Fallback behavior does not weaken security (fail-open vs fail-closed)
- Resource cleanup happens in all exit paths

## Reporting Format

For each finding:
1. **Location**: file, line, function
2. **Category**: injection, auth, crypto, data exposure, etc.
3. **Severity**: Critical / High / Medium / Low
4. **Data flow**: source -> [transforms] -> sink
5. **Proof**: concrete exploit scenario or test case
6. **Fix**: specific remediation with code example
