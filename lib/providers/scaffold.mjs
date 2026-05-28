/**
 * lib/providers/scaffold.mjs — provider scaffold generator.
 *
 * Reads the template files from `templates/provider-scaffold/`, substitutes
 * the %%PROVIDER_NAME%% and %%CAPABILITIES%% placeholders, and writes the
 * result into `lib/providers/<name>/`. Returns the list of files created so
 * the CLI can report them to the user.
 *
 * Supported capabilities: read, search, write, watch, webhook.
 * The `read` and `search` methods are always included in the generated
 * index.mjs; additional capabilities listed in `options.capabilities` add
 * stub implementations for write, watch, and webhook.
 *
 * `scaffoldProvider` is idempotent with respect to the directory: it will
 * not overwrite an existing file unless `options.force = true`. This prevents
 * accidental loss of work when a developer reruns the command.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'templates', 'provider-scaffold');

const ALL_CAPABILITIES = ['read', 'search', 'write', 'watch', 'webhook'];

function capabilityStub(cap) {
  const stubs = {
    write: `
    async write(payload, config = {}) {
      // Replace with a real write operation against the remote system. // construct-lint-ignore
      throw new Error('not implemented');
    },`,
    watch: `
    async watch(config = {}, callback) {
      // Replace with a real subscription; call callback(item) on new events. // construct-lint-ignore
      throw new Error('not implemented');
    },`,
    webhook: `
    async webhook(config = {}, request) {
      // Replace with real webhook signature verification and dispatch. // construct-lint-ignore
      return { ok: false, error: 'not implemented' };
    },`,
  };
  return stubs[cap] || '';
}

function renderIndex(name, capabilities) {
  const capList = capabilities.filter((c) => ALL_CAPABILITIES.includes(c));
  const capString = capList.join(', ');

  const extraStubs = capList
    .filter((c) => !['read', 'search'].includes(c))
    .map(capabilityStub)
    .join('\n');

  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.mjs'), 'utf8');
  let rendered = template
    .replace(/%%PROVIDER_NAME%%/g, name)
    .replace(/%%CAPABILITIES%%/g, capString);

  if (extraStubs) {
    rendered = rendered.replace(
      /(\s+async search\(query, config = \{\}\) \{[\s\S]*?throw new Error\('not implemented'\);\n\s+\},)/,
      `$1\n${extraStubs}`,
    );
  }

  return rendered;
}

function renderTest(name) {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'health.test.mjs'), 'utf8');
  return template.replace(/%%PROVIDER_NAME%%/g, name);
}

export async function scaffoldProvider(name, options = {}) {
  const {
    capabilities = ['read', 'search'],
    cwd = process.cwd(),
    force = false,
  } = options;

  if (!name || typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`scaffoldProvider: name must be a lowercase alphanumeric-and-hyphen string, got '${name}'`);
  }

  const providerDir = path.join(cwd, 'lib', 'providers', name);
  fs.mkdirSync(providerDir, { recursive: true });

  const files = [];

  const indexPath = path.join(providerDir, 'index.mjs');
  if (force || !fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, renderIndex(name, capabilities), 'utf8');
    files.push(indexPath);
  }

  const testPath = path.join(providerDir, 'health.test.mjs');
  if (force || !fs.existsSync(testPath)) {
    fs.writeFileSync(testPath, renderTest(name), 'utf8');
    files.push(testPath);
  }

  return { providerDir, files };
}
