/**
 * tests/mcp-manager.test.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const mcpManagerPath = path.join(root, "lib", "mcp-manager.mjs");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join('/tmp', prefix));
}

function makeRepoCopy() {
  const dest = tempDir("construct-sync-repo-");
  fs.cpSync(root, dest, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(root, source);
      if (!rel) return true;
      if (rel === "node_modules") return false;
      if (rel.startsWith(`node_modules${path.sep}`)) return false;
      if (rel === ".git") return false;
      if (rel.startsWith(`.git${path.sep}`)) return false;
      return true;
    },
  });
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

function runSync({ home, cwd, env = {} }) {
  const repoRoot = makeRepoCopy();
  execFileSync(process.execPath, ["sync-agents.mjs"], {
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

test("memory MCP uses the configured port for Claude and memory for OpenCode", () => {
  const home = tempDir("construct-mcp-home-");
  const cwd = tempDir("construct-mcp-cwd-");
  const claudePath = path.join(home, ".claude", "settings.json");

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
  assert.deepEqual(claude.mcpServers.memory, {
    type: "http",
    url: "http://127.0.0.1:9901/",
  });
  assert.deepEqual(config.mcp.memory, {
    type: "remote",
    url: "http://127.0.0.1:9901/",
  });
});

test("github MCP wires Claude/OpenCode directly and skips a standalone Codex MCP entry", () => {
  const home = tempDir("construct-github-home-");
  const cwd = tempDir("construct-github-cwd-");
  const token = process.env.GITHUB_TOKEN || "github-token-placeholder";

  runMcpAdd("github", {
    home,
    cwd,
    env: {
      GITHUB_TOKEN: token,
    },
  });

  const opencodePath = path.join(home, ".config", "opencode", "opencode.json");
  const claudePath = path.join(home, ".claude", "settings.json");
  const codexPath = path.join(home, ".codex", "config.toml");
  const opencode = readJson(opencodePath);
  const claude = readJson(claudePath);

  assert.deepEqual(opencode.mcp.github, {
    type: "remote",
    url: "https://api.githubcopilot.com/mcp/",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert.deepEqual(claude.mcpServers.github, {
    type: "http",
    url: "https://api.githubcopilot.com/mcp/",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (fs.existsSync(codexPath)) {
    const codex = fs.readFileSync(codexPath, "utf8");
    assert.doesNotMatch(codex, /\[mcp_servers\."github"\]/);
    assert.doesNotMatch(codex, /api\.githubcopilot\.com\/mcp\//);
    assert.doesNotMatch(codex, /bearer_token_env_var = "GITHUB_TOKEN"/);
  }
});

test("catalog declares setup modes for auto/manual capable integrations", () => {
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

test("external plugin manifest entries are available to mcp add without editing built-ins", () => {
  const home = tempDir("construct-plugin-mcp-home-");
  const cwd = tempDir("construct-plugin-mcp-cwd-");
  const pluginDir = path.join(cwd, ".cx", "plugins");
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
  const claude = readJson(path.join(home, ".claude", "settings.json"));
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

test("atlassian MCP uses official remote OAuth server across managed configs", () => {
  const home = tempDir("construct-atlassian-home-");
  const cwd = tempDir("construct-atlassian-cwd-");

  runMcpAdd("atlassian", { home, cwd });

  const opencode = readJson(path.join(home, ".config", "opencode", "opencode.json"));
  const claude = readJson(path.join(home, ".claude", "settings.json"));
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

test("user env config path can be written during setup-style flows", async () => {
  const { getUserEnvPath, writeEnvValues, parseEnvFile } = await import(path.join(root, 'lib', 'env-config.mjs'));
  const home = tempDir('construct-user-env-home-');
  const envPath = getUserEnvPath(home);
  writeEnvValues(envPath, { LANGFUSE_BASEURL: 'https://cloud.langfuse.com', LANGFUSE_PUBLIC_KEY: 'pk-lf-test' });
  const parsed = parseEnvFile(envPath);
  assert.equal(parsed.LANGFUSE_BASEURL, 'https://cloud.langfuse.com');
  assert.equal(parsed.LANGFUSE_PUBLIC_KEY, 'pk-lf-test');
});

test("user env config can persist hybrid backend settings", async () => {
  const { getUserEnvPath, writeEnvValues, parseEnvFile } = await import(path.join(root, 'lib', 'env-config.mjs'));
  const home = tempDir('construct-hybrid-env-home-');
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

test("sync wires managed OpenCode runtime plugin and construct-mcp Langfuse env", () => {
  const home = tempDir("construct-opencode-plugin-home-");
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
    env: {
      LANGFUSE_BASEURL: "https://cloud.langfuse.com",
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
    },
  });

  const config = readJson(opencodePath);
  assert.ok(config.plugin.includes(path.join(home, ".config", "opencode", "plugins", "construct-fallback.js")));
  assert.ok(config.mcp["construct-mcp"] !== undefined);
  assert.deepEqual(config.mcp["construct-mcp"].command, ["node", path.join(repoCopy, "lib", "mcp", "server.mjs")]);
  assert.equal(fs.existsSync(path.join(home, ".config", "opencode", "plugins", "construct-fallback.js")), true);
});

test("sync keeps OpenCode memory configured through memory", () => {
  const home = tempDir("construct-sync-home-");
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

  runSync({ home, cwd });

  const config = readJson(opencodePath);
  assert.deepEqual(config.mcp.memory, {
    type: "remote",
    url: "http://127.0.0.1:8765/",
  });
});

test("memory MCP recovers from malformed OpenCode config", () => {
  const home = tempDir("construct-bad-opencode-home-");
  const cwd = tempDir("construct-bad-opencode-cwd-");
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

  const config = readJson(opencodePath);
  assert.deepEqual(config.mcp.memory, {
    type: "remote",
    url: "http://127.0.0.1:9902/",
  });
});

test("removing a Claude-only MCP does not create a new OpenCode config", () => {
  const home = tempDir("construct-remove-home-");
  const cwd = tempDir("construct-remove-cwd-");
  const claudeDir = path.join(home, ".claude");
  const claudePath = path.join(claudeDir, "settings.json");
  const opencodePath = path.join(home, ".config", "opencode", "opencode.json");
  fs.mkdirSync(claudeDir, { recursive: true });
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
