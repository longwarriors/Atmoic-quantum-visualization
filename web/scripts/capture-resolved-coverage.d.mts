/**
 * Hand-written declarations for capture-resolved-coverage.mjs so
 * src/guards.test.ts can import it under `allowJs: false`, exactly as
 * assert-coverage-scope.d.mts does for the gate. Keep in step with the .mjs
 * exports.
 */

/**
 * vitest's resolved `coverage` options with the two machine-dependent values
 * normalised (`reportsDirectory` made root-relative, `processingConcurrency`
 * replaced by a marker) and every other key preserved, so the gate can
 * deep-equal the whole object.
 *
 * `coverage` is `unknown` because a resolved config this module cannot read
 * must throw, not be captured as something the gate would pass.
 */
export function normalizeResolvedCoverage(
  coverage: unknown,
  root: string,
): Record<string, unknown>

/**
 * vitest's `globalSetup` entry point: writes coverage/resolved-coverage.json
 * from the project's RESOLVED config. Throws rather than writing a capture
 * the gate could misread as "nothing to check".
 */
export function setup(project: unknown): void
