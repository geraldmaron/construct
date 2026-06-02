/**
 * lib/embedded-contract/redaction.mjs — structural no-secrets guard for contract output.
 *
 * Every embedded-contract response passes through this module before
 * serialization. `redact` masks values at secret-looking keys; `assertNoSecrets`
 * is the load-bearing guard — it throws if any live credential value (drawn from
 * the environment by key name) appears anywhere in the payload, so a contract
 * surface can never leak a token even if a future field copies one in by
 * mistake. The check is generic and decoupled from the provider registry: it
 * derives the secret set from env keys at call time rather than a hardcoded list.
 */

const SECRET_KEY_RE = /(api[_-]?key|secret|token|password|passwd|credential|authorization|bearer|cookie|session[_-]?id|private[_-]?key|client[_-]?secret|access[_-]?key)/i;

const REDACTED = '[redacted]';

// Credential env values shorter than this are treated as non-secret (empty
// flags, "1", port numbers) and excluded so the guard does not false-positive.

const MIN_SECRET_LENGTH = 8;

/**
 * Deep-clone `value`, masking any value whose key name looks like a secret.
 *
 * @param {*} value
 * @returns {*}
 */
export function redact(value) {
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        out[k] = REDACTED;
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Collect non-trivial environment values whose key name looks like a secret.
 *
 * @param {Record<string,string>} [env]
 * @returns {Set<string>}
 */
export function collectSecretValues(env = process.env) {
  const out = new Set();
  for (const [key, val] of Object.entries(env || {})) {
    if (typeof val === 'string' && val.length >= MIN_SECRET_LENGTH && SECRET_KEY_RE.test(key)) {
      out.add(val);
    }
  }
  return out;
}

function walkStrings(value, visit, pathStr = '$') {
  if (typeof value === 'string') {
    visit(value, pathStr);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, visit, `${pathStr}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkStrings(v, visit, `${pathStr}.${k}`);
  }
}

/**
 * Throw if any live credential value appears as a substring of any string in
 * the payload. Returns the payload unchanged when clean.
 *
 * @param {*} value
 * @param {{env?:Record<string,string>}} [opts]
 * @returns {*}
 */
export function assertNoSecrets(value, { env = process.env } = {}) {
  const secrets = collectSecretValues(env);
  if (secrets.size === 0) return value;
  const leaks = [];
  walkStrings(value, (str, pathStr) => {
    for (const secret of secrets) {
      if (str.includes(secret)) leaks.push(pathStr);
    }
  });
  if (leaks.length) {
    throw new Error(`Secret value leaked into contract output at: ${[...new Set(leaks)].join(', ')}`);
  }
  return value;
}
