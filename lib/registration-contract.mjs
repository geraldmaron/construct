/**
 * lib/registration-contract.mjs — canonical registration contracts for tools,
 * providers, and host capability detection.
 *
 * Each family keeps a distinct contract (a tool is not a provider is not a host
 * probe). This module documents required exports and validation entry points so
 * new surfaces register through one named contract per family.
 */

export const TOOL_MODULE_REGISTRATION = Object.freeze({
  family: 'mcp-tool',
  moduleSuffix: '.tool.mjs',
  scanEntry: 'scanToolModules',
  scanModule: 'lib/mcp/tool-registry.mjs',
  requiredExports: Object.freeze(['TOOL_DEFS', 'TOOL_HANDLERS']),
  requiredDefFields: Object.freeze(['name', 'description', 'inputSchema', 'safety']),
  optionalDefFields: Object.freeze(['outputSchema']),
  safetyFields: Object.freeze(['class', 'filesystem', 'network', 'process']),
});

export const PROVIDER_FACTORY_REGISTRATION = Object.freeze({
  family: 'data-source-provider',
  factoryExport: 'create',
  contractModule: 'lib/providers/contract.mjs',
  assertEntry: 'assertProviderContract',
  registryEntry: 'resolveProviders',
  registryModule: 'lib/providers/registry.mjs',
  requiredFactoryFields: Object.freeze(['meta', 'configSchema', 'health']),
  metaFields: Object.freeze(['id', 'displayName', 'capabilities', 'description']),
});

export const HOST_DETECTION_REGISTRATION = Object.freeze({
  family: 'host-capability',
  modules: Object.freeze([
    { path: 'lib/host-capabilities.mjs', exports: Object.freeze(['detectHostCapabilities', 'hostProbe']) },
    { path: 'lib/host/readiness.mjs', exports: Object.freeze(['classifyHostReadiness']) },
    { path: 'lib/host-disposition.mjs', exports: Object.freeze(['IGNORED_PATTERNS', 'ADAPTER_DIRS']) },
  ]),
  note: 'Host detection remains split across three modules; each export set is documented here until a single registry lands.',
});

export function assertProviderFactoryModule(mod, { source = '<unknown>' } = {}) {
  const exportName = PROVIDER_FACTORY_REGISTRATION.factoryExport;
  const factory = mod?.[exportName] ?? mod?.default;
  if (typeof factory !== 'function') {
    throw new Error(
      `${source}: provider module must export '${exportName}' ` +
      `(see ${PROVIDER_FACTORY_REGISTRATION.contractModule})`,
    );
  }
}

export function assertToolDefShape(def, { filePath = '<unknown>' } = {}) {
  if (!def || typeof def.name !== 'string' || !def.name.trim()) {
    throw new Error(`${filePath}: TOOL_DEFS entry missing a string 'name'`);
  }
  for (const field of TOOL_MODULE_REGISTRATION.requiredDefFields) {
    if (field === 'name') continue;
    if (field === 'safety') {
      if (!def.safety || typeof def.safety !== 'object' || Array.isArray(def.safety)) {
        throw new Error(
          `tool-safety: "${def.name}" (${filePath}) has no safety classification — ` +
          `every self-registered tool must export an inline 'safety' block ` +
          `({ class, filesystem, network, process }) on its TOOL_DEFS entry.`,
        );
      }
      continue;
    }
    if (def[field] === undefined || def[field] === null) {
      throw new Error(`${filePath}: TOOL_DEFS entry "${def.name}" missing required field '${field}'`);
    }
  }
}
