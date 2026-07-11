/**
 * mcp-manager.test.mjs — Integration tests for MCP server registration and config management.
 *
 * Covers: add/remove/list for Claude and OpenCode configs, path resolution,
 * catalog validation, and migration of legacy memory config entries.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function tempDir(prefix, t) {
  const dir = fs.mkdtempSync(path.join('/tmp', prefix));
  if (t && typeof t.after === "function") {
    t.after(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    });
  }
  return dir;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const mcpManagerPath = path.join(root, "lib", "mcp-manager.mjs");


function hasPathSegment(relPath, segment) {
  return relPath.split(path.sep).includes(segment);
}

function makeRepoCopy(t) {
  const dest = tempDir("construct-sync-repo-", t);
  fs.cpSync(root, dest, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(root, source);
      if (!rel) return true;
      if (hasPathSegment(rel, "node_modules")) return false;
      if (hasPathSegment(rel, ".git")) return false;
      if (hasPathSegment(rel, "cache")) return false;
      if (hasPathSegment(rel, ".tmp")) return false;
      if (hasPathSegment(rel, "coverage")) return false;

      // Carrying the config dir into the copy is a flake source: a stale sync.lock from any earlier
      // sync (local or CI step) gets cloned, and acquireLock() then aborts when process.kill(N, 0)
      // happens to find a live PID on the runner. sync regenerates .construct/ in the copy, so
      // excluding it (plus the legacy .cx/) loses nothing. (construct-edkj moved the lock to .construct/.)
      if (hasPathSegment(rel, ".construct")) return false;
      if (hasPathSegment(rel, ".cx")) return false;

      // `.claude/` is host-local Claude Code state that post-commit hooks mutate
      // (sync-specialists writes ~/.claude/CLAUDE.md and the project .claude/agents
      // catalog on every commit). cpSync's readdir → lstat is not atomic, so a
      // racing write between those calls produces ENOENT mid-walk. The test sets
      // HOME to a tmpdir and lets the harness rebuild .claude/ there.
      if (hasPathSegment(rel, ".claude")) return false;

      // `.beads/` carries an embedded dolt database that rotates internal
      // manifest files (.beads/embeddeddolt/beads/.dolt/noms/nbs_manifest_*)
      // whenever beads writes — same readdir → lstat race as above. The test
      // does not need the beads DB; sync paths it exercises don't touch it.
      if (hasPathSegment(rel, ".beads")) return false;

      // apps/*/.next and apps/*/out are Next.js build output. A parallel
      // `next build` (apps/docs) can overwrite these trees, so cpSync's
      // readdir → lstat races and throws ENOENT on a build artifact mid-walk.
      // Sync paths under test don't read Next build artifacts.

      if (hasPathSegment(rel, ".next")) return false;
      if (hasPathSegment(rel, "out") && rel.startsWith("apps/")) return false;

      return true;
    },
  });
  // Sync validates specialist prompts (js-yaml). The tree copy skips node_modules for
  // speed; symlink the workspace install so isolated sync invocations resolve deps.

  const nmSrc = path.join(root, "node_modules");
  const nmDest = path.join(dest, "node_modules");
  if (fs.existsSync(nmSrc) && !fs.existsSync(nmDest)) {
    fs.symlinkSync(nmSrc, nmDest, process.platform === "win32" ? "junction" : "dir");
  }
  return dest;
}

function runMcpAdd(id, { home, cwd, env = {}, auto = true }) {
  const script = `
    process.argv = ["node", "inline-test", ${JSON.stringify(id)}${auto ? ', "--auto"' : ""}];
    const { cmdMcpAdd } = await import(${JSON.stringify(mcpManagerPath)});
    await cmdMcpAdd(${JSON.stringify(id)});
  `;

  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      ...env,
    },
    stdio: "pipe",
  });
}

function runMcpRemove(id, { home, cwd, env = {} }) {
  const script = `
    process.argv = ["node", "inline-test", ${JSON.stringify(id)}];
    const { cmdMcpRemove } = await import(${JSON.stringify(mcpManagerPath)});
    cmdMcpRemove(${JSON.stringify(id)});
  `;

  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      ...env,
    },
    stdio: "pipe",
  });
}

function runMcpList({ home, cwd, env = {} }) {
  const script = `
    const { cmdMcpList } = await import(${JSON.stringify(mcpManagerPath)});
    cmdMcpList();
  `;

  return execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      ...env,
    },
    stdio: "pipe",
    encoding: "utf8",
  });
}

function runSync({ home, cwd, env = {}, t }) {
  const repoRoot = makeRepoCopy(t);
  // Tests in this file assert on user-scope OpenCode/Claude config, so opt
  // into global mode explicitly. The repo copy carries a `.cx/` marker which
  // would otherwise trigger auto-detected project mode.

  // repoRoot here is makeRepoCopy()'s disposable tmp copy, not the real repo —
  // CX_TOOLKIT_DIR pins sync-specialists.mjs's self-derived root to that exact
  // (symlink-unresolved) path string, matching this test's literal expected
  // path rather than the macOS /tmp-to-/private/tmp symlink-resolved form
  // import.meta.dirname would otherwise produce.

  execFileSync(process.execPath, ["scripts/sync-specialists.mjs", "--global"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CX_TOOLKIT_DIR: repoRoot,
      ...env,
    },
    stdio: "pipe",
  });
  return repoRoot;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("memory MCP wires the stdio bridge into Claude and OpenCode with the configured port", (t) => {
  const home = tempDir("construct-mcp-home-", t);
  const cwd = tempDir("construct-mcp-cwd-", t);
  const claudePath = path.join(home, ".claude.json");

  runMcpAdd("memory", {
    home,
    cwd,
    env: {
      MEMORY_PORT: "9901",
    },
  });

  const opencodePath = path.join(home, ".config", "opencode", "opencode.json");
  assert.equal(fs.existsSync(opencodePath), true);
  assert.equal(fs.existsSync(path.join(home, ".config", "opencode", "config.json")), false);

  const claude = readJson(claudePath);
  const config = readJson(opencodePath);
  const bridgePath = path.join(root, "lib", "mcp", "memory-bridge.mjs");

  assert.deepEqual(
    claude.mcpServers.memory,
    {
      command: "node",
      args: [bridgePath],
      env: { CONSTRUCT_MEMORY_BRIDGE_URL: "http://127.0.0.1:9901/" },
    },
    "Claude memory wires the stdio MCP bridge, not the broken HTTP endpoint",
  );

  assert.deepEqual(
    config.mcp.memory,
    {
      type: "local",
      command: ["node", bridgePath],
      environment: { CONSTRUCT_MEMORY_BRIDGE_URL: "http://127.0.0.1:9901/" },
    },
    "OpenCode memory wires the stdio MCP bridge, not the broken remote/SSE endpoint",
  );
});

test("github MCP wires Claude/OpenCode directly and skips a standalone Codex MCP entry", (t) => {
  const home = tempDir("construct-github-home-", t);
  const cwd = tempDir("construct-github-cwd-", t);
  const token = process.env.GITHUB_TOKEN || "github-token-placeholder";

  runMcpAdd("github", {
    home,
    cwd,
    env: {
      GITHUB_TOKEN: token,
    },
  });

  const opencodePath = path.join(home, ".config", "opencode", "opencode.json");
  const claudePath = path.join(home, ".claude.json");
  const codexPath = path.join(home, ".codex", "config.toml");
  const opencode = readJson(opencodePath);
  const claude = readJson(claudePath);

  // OAuth is the default: the entry is URL-only with no header and no token,
  // so the host runs the browser OAuth flow and keeps the credential off disk.
  assert.deepEqual(opencode.mcp.github, {
    type: "remote",
    url: "https://api.githubcopilot.com/mcp/",
  });

  assert.deepEqual(claude.mcpServers.github, {
    type: "http",
    url: "https://api.githubcopilot.com/mcp/",
  });

  assert.ok(
    !fs.readFileSync(opencodePath, "utf8").includes(token) &&
      !fs.readFileSync(claudePath, "utf8").includes(token),
    "no GitHub token must be written into any host config file under OAuth",
  );

  if (fs.existsSync(codexPath)) {
    const codex = fs.readFileSync(codexPath, "utf8");
    assert.doesNotMatch(codex, /\[mcp_servers\."github"\]/);
    assert.doesNotMatch(codex, /api\.githubcopilot\.com\/mcp\//);
    assert.doesNotMatch(codex, /bearer_token_env_var = "GITHUB_TOKEN"/);
  }
});

test("mcp list distinguishes catalog entries from active and disabled config", (t) => {
  const home = tempDir("construct-mcp-list-home-", t);
  const cwd = tempDir("construct-mcp-list-cwd-", t);
  const opencodeDir = path.join(home, ".config", "opencode");
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(opencodeDir, "opencode.json"),
    JSON.stringify({
      mcp: {
        "construct-mcp": { type: "local", command: ["node", "/tmp/construct.mjs"] },
        context7: { type: "local", command: ["npx", "-y", "@upstash/context7-mcp@latest"], enabled: false },
      },
    }, null, 2) + "\n",
  );

  const output = runMcpList({ home, cwd });
  assert.match(output, /● active\s+Construct MCP/i, "construct-mcp should render active");
  assert.match(output, /\[surfaces: opencode\]/i, "active entry should name its surface");
  assert.match(output, /◌ installed-disabled\s+Context7/i, "disabled optional entry should not render active");
  assert.match(output, /`catalog` = known but not configured here/i, "legend should explain catalog vs active");
});

test("mcp remove clears the entry from VS Code (servers) and Cursor (mcpServers) too", (t) => {
  const home = tempDir("construct-remove-editors-home-", t);
  const cwd = tempDir("construct-remove-editors-cwd-", t);

  const vscodeDir = os.platform() === "darwin"
    ? path.join(home, "Library", "Application Support", "Code", "User")
    : os.platform() === "win32"
      ? path.join(home, "AppData", "Roaming", "Code", "User")
      : path.join(home, ".config", "Code", "User");
  const vscodePath = path.join(vscodeDir, "mcp.json");
  const cursorPath = path.join(home, ".cursor", "mcp.json");
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
  fs.writeFileSync(vscodePath, JSON.stringify({ servers: { playwright: { command: "npx" }, context7: { command: "npx" } } }));
  fs.writeFileSync(cursorPath, JSON.stringify({ mcpServers: { playwright: { command: "npx" }, github: {} } }));

  runMcpRemove("playwright", { home, cwd });

  const vscode = readJson(vscodePath);
  assert.deepEqual(Object.keys(vscode.servers).sort(), ["context7"], "playwright cleared from VS Code, context7 kept");
  const cursor = readJson(cursorPath);
  assert.deepEqual(Object.keys(cursor.mcpServers).sort(), ["github"], "playwright cleared from Cursor, github kept");
});

test("catalog declares setup modes for auto/manual capable integrations", (t) => {
  const catalogPath = path.join(root, "lib", "mcp-catalog.json");
  const catalog = readJson(catalogPath);
  const byId = new Map(catalog.mcps.map((mcp) => [mcp.id, mcp]));

  assert.deepEqual(byId.get("memory").setupModes, ["auto", "manual"]);
  assert.deepEqual(byId.get("github").setupModes, ["auto", "manual"]);
  assert.deepEqual(byId.get("atlassian").setupModes, ["auto"]);
  assert.equal(byId.get("github").hostSupport.codex.mode, "plugin");
  assert.equal(byId.get("github").hostSupport.codex.plugin, "github@openai-curated");
  assert.equal(byId.get("context7").hostSupport.codex.mode, "managed");
  assert.equal(byId.get("atlassian").hostSupport.codex.mode, "managed");
});

test("external plugin manifest entries are available to mcp add without editing built-ins", (t) => {
  const home = tempDir("construct-plugin-mcp-home-", t);
  const cwd = tempDir("construct-plugin-mcp-cwd-", t);
  const pluginDir = path.join(cwd, ".construct", "plugins");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "acme.json"), JSON.stringify({
    version: 1,
    plugins: [
      {
        id: "acme",
        name: "Acme",
        version: "0.1.0",
        description: "Acme plugin",
        mcps: [
          {
            id: "acme-search",
            name: "Acme Search",
            category: "integration",
            description: "Search Acme",
            command: "npx",
            args: ["-y", "@acme/search-mcp"],
            env: {},
            requiredEnv: [],
            setupModes: ["manual"],
            hostSupport: {
              claude: { mode: "managed" },
              opencode: { mode: "managed" },
              codex: { mode: "managed" },
            },
            usedBy: ["construct"],
            degradedMessage: "Acme unavailable.",
          },
        ],
      },
    ],
  }, null, 2));

  runMcpAdd("acme-search", { home, cwd });

  const opencode = readJson(path.join(home, ".config", "opencode", "opencode.json"));
  const claude = readJson(path.join(home, ".claude.json"));
  const codex = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");

  assert.deepEqual(opencode.mcp["acme-search"], {
    type: "local",
    command: ["npx", "-y", "@acme/search-mcp"],
  });
  assert.deepEqual(claude.mcpServers["acme-search"], {
    command: "npx",
    args: ["-y", "@acme/search-mcp"],
  });
  assert.match(codex, /\[mcp_servers\."acme-search"\]/);
});

test("atlassian MCP uses official remote OAuth server across managed configs", (t) => {
  const home = tempDir("construct-atlassian-home-", t);
  const cwd = tempDir("construct-atlassian-cwd-", t);

  runMcpAdd("atlassian", { home, cwd });

  const opencode = readJson(path.join(home, ".config", "opencode", "opencode.json"));
  const claude = readJson(path.join(home, ".claude.json"));
  const codex = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");

  assert.deepEqual(opencode.mcp.atlassian, {
    type: "remote",
    url: "https://mcp.atlassian.com/v1/mcp",
  });
  assert.deepEqual(claude.mcpServers.atlassian, {
    type: "http",
    url: "https://mcp.atlassian.com/v1/mcp",
  });
  assert.match(codex, /\[mcp_servers\."atlassian"\]/);
  assert.match(codex, /url = "https:\/\/mcp\.atlassian\.com\/v1\/mcp"/);
  assert.doesNotMatch(codex, /mcp-atlassian/);
  assert.doesNotMatch(codex, /ATLASSIAN_API_TOKEN/);
});

test("user env config path can be written during setup-style flows", async (t) => {
  const { getUserEnvPath, writeEnvValues, parseEnvFile } = await import(path.join(root, 'lib', 'env-config.mjs'));
  const home = tempDir('construct-user-env-home-', t);
  const envPath = getUserEnvPath(home);
  writeEnvValues(envPath, { CONSTRUCT_TELEMETRY_URL: 'https://telemetry.example.com', CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk-lf-test' });
  const parsed = parseEnvFile(envPath);
  assert.equal(parsed.CONSTRUCT_TELEMETRY_URL, 'https://telemetry.example.com');
  assert.equal(parsed.CONSTRUCT_TELEMETRY_PUBLIC_KEY, 'pk-lf-test');
});

test("user env config can persist hybrid backend settings", async (t) => {
  const { getUserEnvPath, writeEnvValues, parseEnvFile } = await import(path.join(root, 'lib', 'env-config.mjs'));
  const home = tempDir('construct-hybrid-env-home-', t);
  const envPath = getUserEnvPath(home);
  writeEnvValues(envPath, {
    DATABASE_URL: 'postgresql://user:pass@db.local:5432/construct',
    CONSTRUCT_VECTOR_URL: 'https://vector.local',
    CONSTRUCT_VECTOR_MODEL: 'text-embedding-3-small',
  });
  const parsed = parseEnvFile(envPath);
  assert.equal(parsed.DATABASE_URL, 'postgresql://user:pass@db.local:5432/construct');
  assert.equal(parsed.CONSTRUCT_VECTOR_URL, 'https://vector.local');
  assert.equal(parsed.CONSTRUCT_VECTOR_MODEL, 'text-embedding-3-small');
});

test("sync wires managed OpenCode runtime plugin and construct-mcp telemetry env", (t) => {
  const home = tempDir("construct-opencode-plugin-home-", t);
  const cwd = root;
  const opencodeDir = path.join(home, ".config", "opencode");
  const opencodePath = path.join(opencodeDir, "opencode.json");
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(
    opencodePath,
    `${JSON.stringify({
      "$schema": "https://opencode.ai/config.json",
      mcp: {
        "construct-mcp": {
          type: "local",
          command: ["node", "/tmp/construct/lib/mcp/server.mjs"],
        },
      },
    }, null, 2)}\n`,
  );

  const repoCopy = runSync({
    home,
    cwd,
    t,
    env: {
      CONSTRUCT_TELEMETRY_URL: "https://telemetry.example.com",
      CONSTRUCT_TELEMETRY_PUBLIC_KEY: "pk-lf-test",
    },
  });

  const config = readJson(opencodePath);
  assert.ok(config.plugin.includes(path.join(home, ".config", "opencode", "plugins", "construct-fallback.js")));
  assert.ok(config.mcp["construct-mcp"] !== undefined);
  assert.deepEqual(config.mcp["construct-mcp"].command, ["node", path.join(repoCopy, "lib", "mcp", "server.mjs")]);
  assert.equal(fs.existsSync(path.join(home, ".config", "opencode", "plugins", "construct-fallback.js")), true);
});

test("sync rewrites a stale OpenCode HTTP memory entry to the stdio bridge", (t) => {
  const home = tempDir("construct-sync-home-", t);
  const cwd = root;
  const opencodeDir = path.join(home, ".config", "opencode");
  const opencodePath = path.join(opencodeDir, "opencode.json");
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(
    opencodePath,
    `${JSON.stringify({
      "$schema": "https://opencode.ai/config.json",
      mcp: {
        memory: {
          type: "remote",
          url: "http://127.0.0.1:8765/",
        },
      },
    }, null, 2)}\n`,
  );

  const repoCopy = runSync({ home, cwd, env: { MEMORY_PORT: "9901" }, t });

  const config = readJson(opencodePath);
  assert.deepEqual(config.mcp.memory, {
    type: "local",
    command: ["node", path.join(repoCopy, "lib", "mcp", "memory-bridge.mjs")],
    environment: { CONSTRUCT_MEMORY_BRIDGE_URL: "http://127.0.0.1:9901/" },
  });
});

test("sync drops the legacy OpenCode cass entry and writes the stdio bridge", (t) => {
  const home = tempDir("construct-sync-home-", t);
  const cwd = root;
  const opencodeDir = path.join(home, ".config", "opencode");
  const opencodePath = path.join(opencodeDir, "opencode.json");
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(
    opencodePath,
    `${JSON.stringify({
      "$schema": "https://opencode.ai/config.json",
      mcp: {
        cass: {
          type: "remote",
          url: "http://127.0.0.1:8765/",
        },
      },
    }, null, 2)}\n`,
  );

  const repoCopy = runSync({ home, cwd, env: { MEMORY_PORT: "9901" }, t });

  const config = readJson(opencodePath);
  assert.equal(config.mcp.cass, undefined);
  assert.deepEqual(config.mcp.memory, {
    type: "local",
    command: ["node", path.join(repoCopy, "lib", "mcp", "memory-bridge.mjs")],
    environment: { CONSTRUCT_MEMORY_BRIDGE_URL: "http://127.0.0.1:9901/" },
  });
});

test("memory MCP recovers from malformed OpenCode config", (t) => {
  const home = tempDir("construct-bad-opencode-home-", t);
  const cwd = tempDir("construct-bad-opencode-cwd-", t);
  const opencodeDir = path.join(home, ".config", "opencode");
  const opencodePath = path.join(opencodeDir, "opencode.json");
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(opencodePath, "{ this is not valid json }\n");

  runMcpAdd("memory", {
    home,
    cwd,
    env: {
      MEMORY_PORT: "9902",
    },
  });

  const bridgePath = path.join(root, "lib", "mcp", "memory-bridge.mjs");
  const config = readJson(opencodePath);
  assert.deepEqual(
    config.mcp.memory,
    {
      type: "local",
      command: ["node", bridgePath],
      environment: { CONSTRUCT_MEMORY_BRIDGE_URL: "http://127.0.0.1:9902/" },
    },
    "OpenCode memory wires the stdio MCP bridge after recovering from malformed config",
  );
});

test("removing a Claude-only MCP does not create a new OpenCode config", (t) => {
  const home = tempDir("construct-remove-home-", t);
  const cwd = tempDir("construct-remove-cwd-", t);
  const claudePath = path.join(home, ".claude.json");
  const opencodePath = path.join(home, ".config", "opencode", "opencode.json");
  fs.writeFileSync(
    claudePath,
    `${JSON.stringify({
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
        },
      },
    }, null, 2)}\n`,
  );

  runMcpRemove("github", { home, cwd });

  const claude = readJson(claudePath);
  assert.equal("github" in claude.mcpServers, false);
  if (fs.existsSync(opencodePath)) {
    const opencode = readJson(opencodePath);
    assert.equal("github" in (opencode?.mcp ?? {}), false);
  }
});
