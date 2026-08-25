/**
 * Hand-written declarations for assert-coverage-scope.mjs so src/guards.test.ts
 * can import it under `allowJs: false`, exactly as assert-no-skips.d.mts does
 * for the skip gate. Keep in step with the .mjs exports.
 */

/** The per-file percentages every gated module must reach. */
export interface CoverageThresholds {
  /** Always true: the gate scores each module on its own, never an aggregate. */
  perFile: boolean
  statements: number
  branches: number
  functions: number
  lines: number
}

/** coverage-scope.json: the one manifest both gates check themselves against. */
export interface CoverageScopeManifest {
  /** Modules vitest must instrument and hold to a per-file threshold. */
  coverageGated: string[]
  /** `coverageGated` plus the type-only modules still scanned for coverage pragmas. */
  pragmaScanned: string[]
  /** Deep-equalled against vitest.config.ts's `coverage.thresholds` by the guard suite. */
  thresholds: CoverageThresholds
}

/** One metric of one file: `pct` is `covered / total`, truncated to 2 decimals. */
export interface CoverageMetric {
  total: number
  covered: number
  pct: number
}

/** The four metrics vitest's per-file threshold check compares. */
export interface FileCoverageSummary {
  statements: CoverageMetric
  branches: CoverageMetric
  functions: CoverageMetric
  lines: CoverageMetric
}

/** One absolute coverage-report key as a web-root-relative posix path. */
export function toWebRelative(webRoot: string, filePath: string): string

/**
 * Problems found comparing a parsed coverage-final.json against the expected
 * file list; empty when the two sets are exactly equal. Both inputs are
 * `unknown` on purpose: a malformed report or expectation must fail the
 * audit, not crash it. (`readonly string[] | unknown` would say the same to a
 * reader and collapse to `unknown` to the compiler, so it just says `unknown`.)
 */
export function auditCoverageScope(
  coverage: unknown,
  expected: unknown,
  webRoot: string,
): string[]

/**
 * One coverage-final.json file entry reduced to the four percentages, exactly
 * as istanbul-lib-coverage's FileCoverage.toSummary() does it. Throws on an
 * entry that is not istanbul-shaped rather than scoring it.
 */
export function summarizeFileCoverage(entry: unknown): FileCoverageSummary

/**
 * Problems found holding each `coverageGated` module in a parsed
 * coverage-final.json to the manifest's `thresholds`; empty when every one
 * meets every threshold. A gated module with zero coverable statements is a
 * problem, not a pass: istanbul scores an empty metric 100%.
 */
export function auditCoverageThresholds(
  coverage: unknown,
  manifest: unknown,
  webRoot: string,
): string[]

/** The shape-checked manifest. Throws if it is missing, malformed or empty. */
export function readCoverageScope(webRoot: string): CoverageScopeManifest
