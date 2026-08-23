/**
 * Hand-written declarations for assert-no-skips.mjs so src/guards.test.ts can
 * import it under `allowJs: false`. Keep in step with the .mjs exports.
 */

/** One test, as written by vitest's JSON reporter (`assertionResults[]`). */
export interface VitestAssertionResult {
  fullName: string
  status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'disabled'
  failureMessages: string[]
}

/** One spec file, as written by vitest's JSON reporter (`testResults[]`). */
export interface VitestFileResult {
  /** Absolute path; forward slashes on every platform in practice. */
  name: string
  status: 'passed' | 'failed' | 'skipped' | 'pending'
  assertionResults: VitestAssertionResult[]
}

/** The top-level document. Every field optional: a malformed file must fail the audit, not crash it. */
export interface VitestJsonResults {
  success?: boolean
  numTotalTests?: number
  numPassedTests?: number
  numFailedTests?: number
  numPendingTests?: number
  numTodoTests?: number
  numFailedTestSuites?: number
  numPendingTestSuites?: number
  testResults?: VitestFileResult[]
}

/** Spec files under `<webRoot>/src`, sorted, as web-root-relative posix paths. */
export function listSpecFiles(webRoot: string): string[]

/** Problems found in `results`; empty when every expected spec ran and every test passed. */
export function auditRun(
  results: VitestJsonResults,
  expectedSpecs: readonly string[],
  webRoot: string,
): string[]
