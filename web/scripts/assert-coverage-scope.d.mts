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

/**
 * The coverage configuration the run must RESOLVE, as captured from vitest's
 * own resolved config by scripts/capture-resolved-coverage.mjs.
 *
 * `coverage` is deep-equalled WHOLE by the gate, so it carries every key of
 * vitest's resolved coverage options, not only the ones named here; the index
 * signature is that remainder. The named fields are the ones the gate also
 * checks against absolute expectations, so that no edit to the manifest can
 * license a config the gate is supposed to refuse.
 */
export interface ResolvedCoverageExpectation {
  /** Root-relative, and non-empty: something must write the capture. */
  globalSetup: string[]
  coverage: {
    provider: string
    enabled: boolean
    all: boolean
    include: string[]
    exclude: string[]
    thresholds: CoverageThresholds
    /** Resolved form: `[name, options]` tuples. Must contain `json`. */
    reporter: unknown
    /** Root-relative; the directory the gate reads the report from. */
    reportsDirectory: string
    [option: string]: unknown
  }
}

/** coverage-scope.json: the one manifest both gates check themselves against. */
export interface CoverageScopeManifest {
  /** Modules vitest must instrument and hold to a per-file threshold. */
  coverageGated: string[]
  /** `coverageGated` plus the type-only modules still scanned for coverage pragmas. */
  pragmaScanned: string[]
  /** Deep-equalled against vitest.config.ts's `coverage.thresholds` by the guard suite. */
  thresholds: CoverageThresholds
  /** Deep-equalled against the config the run resolved. */
  resolvedCoverage: ResolvedCoverageExpectation
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

/**
 * Every place two JSON documents differ, as `path: actual vs expected` lines;
 * empty when they are deep-equal. Objects are compared by key SET, so an
 * unexpected extra key is a difference in its own right.
 */
export function jsonDifferences(actual: unknown, expected: unknown, path?: string): string[]

/**
 * Problems found comparing the coverage config vitest RESOLVED for this run
 * -- captured by scripts/capture-resolved-coverage.mjs -- against
 * coverage-scope.json's `resolvedCoverage`; empty when the run used exactly
 * the configuration the manifest describes.
 *
 * This is the only check that sees the config the run actually had: a CLI
 * flag, a plugin `config()` hook or an env override leaves vitest.config.ts
 * byte-identical, and a custom provider decides for itself what the coverage
 * report says.
 */
export function auditResolvedCoverage(
  captured: unknown,
  expected: unknown,
  webRoot: string,
): string[]

/** The shape-checked manifest. Throws if it is missing, malformed or empty. */
export function readCoverageScope(webRoot: string): CoverageScopeManifest
