/**
 * Hand-written declarations for assert-visual-run.mjs so src/visualGate.test.ts
 * can import it under `allowJs: false`. Keep in step with the .mjs exports.
 *
 * Every field is optional, and every union is widened with `string`: a
 * malformed or future-shaped report must FAIL the audit at run time, not fail
 * to type-check at authoring time or -- worse -- be narrowed by the compiler
 * into a shape the audit then assumes.
 */

/** One attempt at one test, as written by Playwright's JSON reporter. */
export interface PlaywrightResult {
  status?: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted' | string
}

/** One test (one spec under one project), with an attempt per retry. */
export interface PlaywrightTest {
  status?: 'expected' | 'unexpected' | 'flaky' | 'skipped' | string
  results?: PlaywrightResult[]
}

/** One `test()` call in a spec file. `file` is relative to the config root. */
export interface PlaywrightSpec {
  title?: string
  file?: string
  ok?: boolean
  tests?: PlaywrightTest[]
}

/** A file-level or `describe`-level suite; suites nest arbitrarily deep. */
export interface PlaywrightSuite {
  title?: string
  file?: string
  specs?: PlaywrightSpec[]
  suites?: PlaywrightSuite[]
}

/** The top-level document written by the `json` reporter. */
export interface PlaywrightJsonReport {
  /**
   * The RESOLVED config, CLI overrides folded in -- which is what makes
   * `updateSnapshots` worth reading here rather than in playwright.config.ts.
   */
  config?: {
    updateSnapshots?: 'all' | 'changed' | 'missing' | 'none' | string
  }
  errors?: unknown[]
  suites?: PlaywrightSuite[]
  stats?: {
    expected?: number
    unexpected?: number
    flaky?: number
    skipped?: number
  }
}

/** e2e spec files under `<webRoot>/e2e`, sorted, as web-root-relative posix paths. */
export function listVisualSpecFiles(webRoot: string): string[]

/** Problems found in `report`; empty when every expected spec ran and every test passed. */
export function auditVisualRun(
  report: PlaywrightJsonReport,
  expectedSpecs: readonly string[],
): string[]
