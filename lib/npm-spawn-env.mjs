/**
 * lib/npm-spawn-env.mjs — sanitize env before npm/npx child spawns.
 *
 * npm 11.2+ warns on unknown npm_config_* keys. Cursor sandbox injects
 * npm_config_devdir for node-gyp cache routing; strip it before Construct
 * spawns nested npm/npx so build chains do not duplicate the warning.
 */

export function sanitizeNpmSpawnEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (/^npm_config_devdir$/i.test(key) || key === 'NPM_CONFIG_DEVDIR') {
      delete env[key];
    }
  }
  return env;
}
