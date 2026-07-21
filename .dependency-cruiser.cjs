/**
 * .dependency-cruiser.cjs — Warn-first dependency graph rules for Construct.
 *
 * Detection-only: reports direction violations and orphan candidates without
 * failing CI. Entry points mirror the knip inventory so both tools agree on
 * what is reachable from shipped surfaces.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-lib-to-apps",
      severity: "warn",
      comment: "Core lib must not import apps workspace code",
      from: { path: "^lib/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-bin-to-apps",
      severity: "warn",
      comment: "CLI entry must not import apps workspace code",
      from: { path: "^bin/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-tests-to-apps",
      severity: "warn",
      comment: "Tests should not reach apps build surfaces directly",
      from: { path: "^tests/" },
      to: { path: "^apps/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    combinedDependencies: true,
    exclude: {
      path: "(^node_modules/)|(^coverage/)|(^\\.construct/)|(^dist/)|(^apps/docs/\\.next/)",
    },
    tsPreCompilationDeps: false,
  },
};
