/**
 * lib/project-profile.mjs — agnostic tech-stack detection for a project directory.
 *
 * Deliberately host-agnostic: the detection layer uses only filesystem signals
 * (package.json, pyproject.toml, go.mod, etc.) and knows nothing about Claude
 * Code, OpenCode, Codex, or Copilot. Host-specific filter generation happens
 * in a later layer that consumes the profile produced here.
 *
 * The profile is written to `<cwd>/.cx/project-profile.json` and consumed by:
 *   - `construct skills scope` — reports relevant vs irrelevant skills
 *   - `construct setup` — runs detection on bootstrap
 *   - future per-host filter generators (.claude/settings.json filter,
 *     opencode.json agent filters, etc.)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Detection rules. Each rule checks a filesystem signal and emits one or more
// tags. Keep rules tight — false positives cascade into bad filter decisions.
const RULES = [
  // --- Languages by manifest ---
  { file: 'package.json', tags: ['javascript', 'node'], inspect: (json) => {
    const tags = [];
    const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
    if (deps.typescript || deps['@types/node']) tags.push('typescript');
    if (deps.react || deps['react-dom']) tags.push('react', 'frontend');
    if (deps.next) tags.push('nextjs', 'frontend');
    if (deps.vue) tags.push('vue', 'frontend');
    if (deps.svelte) tags.push('svelte', 'frontend');
    if (deps['@angular/core']) tags.push('angular', 'frontend');
    if (deps.express || deps.fastify || deps.hono || deps.koa) tags.push('backend');
    if (deps['@nestjs/core']) tags.push('nestjs', 'backend');
    if (deps.jest || deps.vitest || deps.mocha || deps['@playwright/test']) tags.push('testing');
    if (deps['@playwright/test'] || deps.playwright) tags.push('e2e');
    if (deps.remotion) tags.push('remotion');
    return tags;
  }},
  { file: 'tsconfig.json', tags: ['typescript'] },
  { file: 'pyproject.toml', tags: ['python'], inspect: (_, text) => {
    const tags = [];
    if (/django/i.test(text)) tags.push('django', 'backend');
    if (/fastapi/i.test(text)) tags.push('fastapi', 'backend');
    if (/flask/i.test(text)) tags.push('flask', 'backend');
    if (/pytest/i.test(text)) tags.push('testing');
    if (/pandas|numpy|polars/i.test(text)) tags.push('data');
    if (/torch|tensorflow|scikit-learn|transformers/i.test(text)) tags.push('ml');
    return tags;
  }},
  { file: 'requirements.txt', tags: ['python'], inspect: (_, text) => {
    const tags = [];
    if (/django/i.test(text)) tags.push('django', 'backend');
    if (/fastapi/i.test(text)) tags.push('fastapi', 'backend');
    if (/flask/i.test(text)) tags.push('flask', 'backend');
    if (/pytest/i.test(text)) tags.push('testing');
    return tags;
  }},
  { file: 'go.mod', tags: ['golang', 'backend'], inspect: (_, text) => {
    const tags = [];
    if (/gin-gonic\/gin|labstack\/echo|gofiber\/fiber/.test(text)) tags.push('go-web');
    return tags;
  }},
  { file: 'Cargo.toml', tags: ['rust'], inspect: (_, text) => {
    const tags = [];
    if (/actix-web|axum|rocket|tokio/i.test(text)) tags.push('backend');
    if (/solana|ethers|alloy|web3/i.test(text)) tags.push('web3');
    return tags;
  }},
  { file: 'pom.xml', tags: ['java', 'maven'], inspect: (_, text) => {
    const tags = [];
    if (/spring-boot/.test(text)) tags.push('spring-boot', 'backend');
    return tags;
  }},
  { file: 'build.gradle', tags: ['jvm'], inspect: (_, text) => {
    const tags = [];
    if (/kotlin/i.test(text)) tags.push('kotlin');
    if (/spring-boot/i.test(text)) tags.push('spring-boot', 'backend');
    if (/android/i.test(text)) tags.push('android', 'mobile');
    if (/ktor/i.test(text)) tags.push('ktor', 'backend');
    return tags;
  }},
  { file: 'build.gradle.kts', tags: ['jvm', 'kotlin'] },
  { file: 'Gemfile', tags: ['ruby'], inspect: (_, text) => {
    const tags = [];
    if (/rails/.test(text)) tags.push('rails', 'backend');
    return tags;
  }},
  { file: 'composer.json', tags: ['php'], inspect: (json) => {
    const tags = [];
    const deps = { ...(json.require || {}), ...(json['require-dev'] || {}) };
    if (deps['laravel/framework']) tags.push('laravel', 'backend');
    if (deps['symfony/framework-bundle']) tags.push('symfony', 'backend');
    if (deps['phpunit/phpunit']) tags.push('testing');
    return tags;
  }},
  { file: 'Package.swift', tags: ['swift'] },
  { file: 'Gemfile.lock', tags: ['ruby'] },
  { file: 'CMakeLists.txt', tags: ['cpp'] },
  { file: 'Makefile', tags: [], inspect: (_, text) => {
    const tags = [];
    if (/\.cpp|\.cc|\.hpp|g\+\+|clang\+\+/.test(text)) tags.push('cpp');
    if (/\.c\b|gcc\b/.test(text)) tags.push('c');
    return tags;
  }},
  { file: 'cpanfile', tags: ['perl'] },
  { file: 'Dockerfile', tags: ['docker', 'deployment'] },
  { file: 'docker-compose.yml', tags: ['docker', 'deployment'] },
  { file: 'docker-compose.yaml', tags: ['docker', 'deployment'] },
  // --- Mobile ---
  { file: 'ios/Podfile', tags: ['ios', 'mobile'] },
  { file: 'android/build.gradle', tags: ['android', 'mobile'] },
  { file: 'pubspec.yaml', tags: ['dart', 'flutter', 'mobile'] },
  // --- Infrastructure ---
  { file: 'terraform.tf', tags: ['terraform', 'infrastructure'] },
  { file: 'main.tf', tags: ['terraform', 'infrastructure'] },
  { file: 'Pulumi.yaml', tags: ['pulumi', 'infrastructure'] },
  { file: 'kustomization.yaml', tags: ['kubernetes', 'deployment'] },
  // --- Data / DB ---
  { file: 'prisma/schema.prisma', tags: ['prisma', 'database'] },
  { file: 'alembic.ini', tags: ['alembic', 'database'] },
  { file: 'dbt_project.yml', tags: ['dbt', 'data'] },
  // --- CI ---
  { file: '.github/workflows', tags: ['github-actions', 'ci'] },
  { file: '.gitlab-ci.yml', tags: ['gitlab-ci', 'ci'] },
  { file: '.circleci/config.yml', tags: ['circleci', 'ci'] },
];

// Maps skill paths (like "devops/data-engineering" or "django-patterns")
// to the project tags that justify loading them. A skill is deemed "relevant"
// if the project profile contains ANY of its required tags.
//
// This is a curated set — the default for unlisted skills is "always relevant"
// since we don't want to hide something by omission.
export const SKILL_RELEVANCE = {
  // Language-specific patterns
  'python-patterns': ['python'],
  'python-testing': ['python'],
  'django-patterns': ['django'],
  'django-security': ['django'],
  'django-verification': ['django'],
  'django-tdd': ['django'],
  'golang-patterns': ['golang'],
  'golang-testing': ['golang'],
  'rust-patterns': ['rust'],
  'rust-testing': ['rust'],
  'cpp-testing': ['cpp', 'c'],
  'cpp-coding-standards': ['cpp', 'c'],
  'kotlin-patterns': ['kotlin'],
  'kotlin-testing': ['kotlin'],
  'kotlin-coroutines-flows': ['kotlin'],
  'kotlin-exposed-patterns': ['kotlin'],
  'kotlin-ktor-patterns': ['ktor'],
  'compose-multiplatform-patterns': ['kotlin', 'android'],
  'android-clean-architecture': ['android'],
  'dart-flutter-patterns': ['flutter', 'dart'],
  'swiftui-patterns': ['swift', 'ios'],
  'swift-concurrency-6-2': ['swift'],
  'swift-actor-persistence': ['swift'],
  'swift-protocol-di-testing': ['swift'],
  'foundation-models-on-device': ['ios', 'swift'],
  'liquid-glass-design': ['ios', 'swift'],
  'springboot-patterns': ['spring-boot'],
  'springboot-security': ['spring-boot'],
  'springboot-tdd': ['spring-boot'],
  'springboot-verification': ['spring-boot'],
  'jpa-patterns': ['spring-boot', 'java'],
  'java-coding-standards': ['java', 'jvm'],
  'laravel-patterns': ['laravel'],
  'laravel-security': ['laravel'],
  'laravel-tdd': ['laravel'],
  'laravel-verification': ['laravel'],
  'laravel-plugin-discovery': ['laravel'],
  'perl-patterns': ['perl'],
  'perl-testing': ['perl'],
  'perl-security': ['perl'],
  'dotnet-patterns': ['dotnet'],
  'csharp-testing': ['dotnet'],
  // Web / frontend
  'frontend-patterns': ['frontend'],
  'frontend-design': ['frontend'],
  'frontend-slides': ['frontend'],
  'remotion-video-creation': ['remotion'],
  'nestjs-patterns': ['nestjs'],
  'e2e-testing': ['e2e', 'frontend'],
  // Data / infra
  'postgres-patterns': ['database', 'backend'],
  'clickhouse-io': ['data'],
  'database-migrations': ['database'],
  'docker-patterns': ['docker'],
  'deployment-patterns': ['deployment', 'docker'],
  // Web3
  'defi-amm-security': ['web3'],
  'llm-trading-agent-security': ['web3'],
  'evm-token-decimals': ['web3'],
  'nodejs-keccak256': ['web3', 'node'],
  // Video / media (rare — keep targeted)
  'manim-video': ['python'],
  'video-editing': [],
  'fal-ai-media': [],
};

/**
 * Skills that must NEVER be filtered out of a project, regardless of the
 * detected stack. Protects the "R&D org in a box" framing: any skill that
 * could be called by a cx-* specialist, or that provides cross-cutting
 * capability (research, docs, planning, verification), stays available.
 *
 * Tests match the skill name prefix — "anthropic-skills:" matches
 * "anthropic-skills:pdf", "anthropic-skills:docx", etc.
 */
export const NEVER_FILTER_PREFIXES = [
  // Construct-native — orchestration, skills, personas
  'construct',
  'cx-',
  'construct-mcp',
  // Generic / cross-cutting capabilities every agent may need
  'brand-voice',
  'coding-standards',
  'comments',
  'council',
  'continuous-learning',
  'search-first',
  'verification-loop',
  'agentic-engineering',
  'ai-first-engineering',
  'iterative-retrieval',
  'tdd-workflow',
  'quality-gate',
  'blueprint',
  'prompt-optimizer',
  'security-review',
  'security-scan',
  'ai-regression-testing',
  'strategic-compact',
  'context-hash-cache-pattern',
  'regex-vs-llm-structured-text',
  'santa-loop',
  'knowledge-ops',
  'research-ops',
  'deep-research',
  'exa-search',
  'eval-harness',
  'learn',
  'learn-eval',
  'team-builder',
  'terminal-ops',
  'token-budget-advisor',
  'workspace-surface-audit',
  'skill-stocktake',
  'skill-health',
  'configure-ecc',
  'agent-sort',
  // MCP / platform patterns (often needed in any project)
  'mcp-server-patterns',
  'api-connector-builder',
  // Document processing (Anthropic native skills) — called on demand
  'anthropic-skills:',
  // Plugin infrastructure
  'cowork-plugin-management:',
  // Productivity + engineering + PM + ops + legal namespace skills — the
  // "org in a box" roles. These are role-domain skills that specialists
  // (or users) may invoke at any time.
  'productivity:',
  'engineering:',
  'product-management:',
  'operations:',
  'legal:',
  'data:',
  // Claude Code + Claude API development — likely needed in any ECC project
  'claude-api',
  'claude-devfleet',
  'claude-in-chrome',
  'hookify',
  'autonomous-loops',
  'continuous-agent-loop',
  'dmux-workflows',
  'agent-harness-construction',
  'agent-introspection-debugging',
  'enterprise-agent-ops',
  // Core Construct/ECC native routing / setup
  'init',
  'review',
  'resume-session',
  'save-session',
];

/**
 * Returns true if a skill name matches any NEVER_FILTER prefix.
 */
export function isProtectedSkill(name) {
  return NEVER_FILTER_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix));
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readTextSafe(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function pathExists(cwd, rel) {
  const p = join(cwd, rel);
  try { return existsSync(p); } catch { return false; }
}

/**
 * Returns true if a Docker- or deployment-related file exists anywhere in
 * the first two levels of the project tree (root or one level deep). Needed
 * because monorepos often put compose/Dockerfile in subpackage directories
 * (langfuse/docker-compose.yml, services/api/Dockerfile, etc.).
 */
function hasDockerSignalAtDepth2(cwd) {
  const dockerNames = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'];
  try {
    for (const name of dockerNames) {
      if (existsSync(join(cwd, name))) return true;
    }
    const entries = readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const sub = join(cwd, entry.name);
      for (const name of dockerNames) {
        if (existsSync(join(sub, name))) return true;
      }
    }
  } catch { /* best effort */ }
  return false;
}

/**
 * Walks the detection rules against the given directory and returns a
 * { tags, signals } object. Tags are deduplicated and sorted.
 */
export function detectProjectProfile(cwd = process.cwd()) {
  const root = resolve(cwd);
  const tags = new Set();
  const signals = [];

  for (const rule of RULES) {
    const relPath = rule.file;
    if (!pathExists(root, relPath)) continue;
    signals.push(relPath);
    for (const tag of rule.tags || []) tags.add(tag);

    if (typeof rule.inspect === 'function') {
      const fullPath = join(root, relPath);
      try {
        const isDir = statSync(fullPath).isDirectory();
        if (isDir) continue;
        const text = readTextSafe(fullPath);
        const json = relPath.endsWith('.json') ? readJsonSafe(fullPath) : null;
        const extras = rule.inspect(json, text) || [];
        for (const tag of extras) tags.add(tag);
      } catch { /* best effort */ }
    }
  }

  // Subdirectory scan for docker signals (monorepo support)
  if (!tags.has('docker') && hasDockerSignalAtDepth2(root)) {
    tags.add('docker');
    tags.add('deployment');
    signals.push('(subdir docker)');
  }

  return {
    root,
    detectedAt: new Date().toISOString(),
    tags: Array.from(tags).sort(),
    signals: signals.sort(),
  };
}

/**
 * Given a profile and a list of installed skill names, returns which are
 * relevant to the project and which are not.
 *
 * Skills not in SKILL_RELEVANCE are treated as always-relevant (the default
 * is safe — we don't hide a skill we don't know about).
 */
export function classifySkillRelevance(profile, installedSkills) {
  const tagSet = new Set(profile.tags || []);
  const relevant = [];
  const irrelevant = [];
  const unknown = [];
  const protectedSkills = [];

  for (const name of installedSkills) {
    if (isProtectedSkill(name)) {
      protectedSkills.push(name);
      relevant.push(name);
      continue;
    }
    const required = SKILL_RELEVANCE[name];
    if (!required) {
      unknown.push(name);
      continue;
    }
    if (required.length === 0) {
      relevant.push(name);
      continue;
    }
    const matches = required.some((tag) => tagSet.has(tag));
    (matches ? relevant : irrelevant).push(name);
  }

  return { relevant, irrelevant, unknown, protected: protectedSkills };
}

/**
 * Persists the profile to `<cwd>/.cx/project-profile.json`. Returns the path.
 */
export function writeProfile(profile, cwd = profile.root || process.cwd()) {
  const dir = join(cwd, '.cx');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'project-profile.json');
  writeFileSync(path, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  return path;
}

/**
 * Best-effort enumeration of installed skills across hosts. Returns a
 * unique sorted list of skill names. Fully agnostic — looks at all known
 * skill directories and merges.
 */
export function enumerateInstalledSkills(homeDir = process.env.HOME || '') {
  const skills = new Set();
  const candidates = [
    // Claude Code / OpenCode shared global
    join(homeDir, '.claude', 'skills'),
    join(homeDir, '.claude', 'plugins'),
    // Codex
    join(homeDir, '.codex', 'skills'),
    // Construct native
    join(homeDir, '.construct', 'skills'),
  ];
  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() || entry.name.endsWith('.md')) {
          skills.add(entry.name.replace(/\.md$/, ''));
        }
      }
    } catch { /* best effort */ }
  }
  return Array.from(skills).sort();
}
