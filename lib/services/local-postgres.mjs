/**
 * lib/services/local-postgres.mjs — local Postgres helper exports.
 *
 * Compatibility wrappers live in telemetry-backend.mjs until downstream imports
 * move, but new service-management code should use this name.
 */
export {
  POSTGRES_LOCAL_PORT,
  isRemoteTelemetry,
  servicesComposePath,
  pruneStashDir,
  verifyPostgresHealth,
  verifyTelemetryKeys,
  startManagedServices,
} from './telemetry-backend.mjs';
