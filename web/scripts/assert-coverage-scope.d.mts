/**
 * Hand-written declarations for assert-coverage-scope.mjs so src/guards.test.ts
 * can import it under `allowJs: false`, exactly as assert-no-skips.d.mts does
 * for the skip gate. Keep in step with the .mjs exports.
 */

/** coverage-scope.json: the one manifest both gates check themselves against. */
export interface CoverageScopeManifest {
  /** Modules vitest must instrument and hold to a per-file threshold. */
  coverageGated: string[]
  /** `coverageGated` plus the type-only modules still scanned for coverage pragmas. */
  pragmaScanned: string[]
}

/** One absolute coverage-report key as a web-root-relative posix path. */
export function toWebRelative(webRoot: string, filePath: string): string

/**
 * Problems found comparing a parsed coverage-final.json against the expected
 * file list; empty when the two sets are exactly equal. `coverage` is
 * `unknown` on purpose: a malformed report must fail the audit, not crash it.
 */
export function auditCoverageScope(
  coverage: unknown,
  expected: readonly string[] | unknown,
  webRoot: string,
): string[]

/** The shape-checked manifest. Throws if it is missing, malformed or empty. */
export function readCoverageScope(webRoot: string): CoverageScopeManifest
