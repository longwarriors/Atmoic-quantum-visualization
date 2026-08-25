#!/usr/bin/env node
/**
 * Gate `npm test` on the coverage scope vitest ACTUALLY measured, not on the
 * scope its config source says it should measure.
 *
 * src/guards.test.ts binds the coverage scope by importing vitest.config.ts
 * and deep-equalling its `coverage.include` / `coverage.exclude` arrays. That
 * catches an edit to those arrays -- and nothing else. It reads the config
 * SOURCE object, so anything that overrides the RESOLVED config leaves the
 * arrays untouched and every guard green while the measured scope shrinks:
 *
 *   vitest run --coverage --coverage.include=src/scene/color.ts
 *     -> exit 0, all guard tests pass, coverage table lists only color.ts;
 *        api/client.ts and api/qvpc.ts are gone from coverage AND from the
 *        per-file thresholds that are supposed to hold them at 90%.
 *
 * A CLI flag persisted into the `test` script, a Vite plugin `config()` hook,
 * or an env-driven override all do the same thing. The only check that can
 * see it is one that reads the report the run produced. That is this file:
 * coverage/coverage-final.json lists exactly the files the v8 provider
 * instrumented, so its key set IS the measured scope.
 *
 * It is checked against `coverageGated` in coverage-scope.json -- the same
 * manifest src/guards.test.ts checks its minimatch derivation against. Two
 * independent checks, one manifest: the derivation must agree with the
 * config, and the run must agree with the manifest. Editing vitest.config.ts,
 * the test script, or the guard file alone cannot satisfy both.
 *
 * FAIL-CLOSED throughout. A missing, unparseable, non-object or empty report
 * is a failure, never a pass -- `--coverage.enabled=false` and a reporter
 * list without `json` both simply produce no report, and scripts/
 * clean-coverage.mjs deletes the previous one before vitest starts so a
 * green report from an earlier run can never stand in for this one.
 *
 * Usage (wired into `npm test` in package.json, after vitest):
 *
 *   node scripts/assert-coverage-scope.mjs
 *
 * Unlike assert-no-skips.mjs this takes no path argument: the report it reads
 * is fixed at coverage/coverage-final.json relative to the web root, so there
 * is no lever for pointing the gate at a friendlier file.
 *
 * Plain ESM with no dependencies; src/guards.test.ts imports the two pure
 * functions below and exercises them against synthetic coverage documents.
 */
import { existsSync, readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COVERAGE_REPORT = 'coverage/coverage-final.json'
const MANIFEST = 'coverage-scope.json'

/** Forward slashes everywhere, and a lower-case drive letter on Windows. */
function toPosix(path) {
  const slashed = path.split('\\').join('/')
  return /^[A-Za-z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed
}

/**
 * One coverage-report key (an absolute path, backslashed on Windows) as a
 * web-root-relative posix path (`src/api/client.ts`).
 *
 * A file outside the web root is returned as its own posix path rather than a
 * `../..` walk, so it lands in the "unexpected" list looking like what it is.
 */
export function toWebRelative(webRoot, filePath) {
  const root = toPosix(resolve(webRoot))
  const file = toPosix(String(filePath))
  const relative = posix.relative(root, file)
  return relative === '' || relative.startsWith('../') ? file : relative
}

/**
 * Compare the files a coverage report measured against the expected manifest.
 * Returns a list of human-readable problems; empty means the two sets are
 * exactly equal.
 *
 * `coverage` is whatever JSON.parse returned, deliberately untyped: a
 * malformed report must fail the audit, not crash it.
 */
export function auditCoverageScope(coverage, expected, webRoot) {
  const problems = []

  if (!Array.isArray(expected) || expected.length === 0) {
    problems.push(
      `${MANIFEST}: "coverageGated" is missing, not an array, or empty -- ` +
        'refusing to certify a run against an empty expectation',
    )
    return problems
  }
  if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage)) {
    problems.push(
      `${COVERAGE_REPORT}: not a JSON object (got ${
        Array.isArray(coverage) ? 'an array' : String(coverage === null ? 'null' : typeof coverage)
      }) -- no usable coverage report was written for this run`,
    )
    return problems
  }

  const measured = new Set(Object.keys(coverage).map((key) => toWebRelative(webRoot, key)))
  if (measured.size === 0) {
    problems.push(
      `${COVERAGE_REPORT}: lists zero files -- nothing was instrumented, so no ` +
        'per-file threshold held anything',
    )
    return problems
  }

  const wanted = new Set(expected)
  for (const file of [...wanted].sort()) {
    if (!measured.has(file)) {
      problems.push(`${file}: in ${MANIFEST} but NOT measured by this run (coverage scope shrank)`)
    }
  }
  for (const file of [...measured].sort()) {
    if (!wanted.has(file)) {
      problems.push(`${file}: measured by this run but NOT in ${MANIFEST} (unreviewed gated module)`)
    }
  }

  return problems
}

/**
 * The manifest, shape-checked. Throws with a specific message on anything a
 * later comparison could misread as "nothing to check".
 */
export function readCoverageScope(webRoot) {
  const manifestPath = resolve(webRoot, MANIFEST)
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} does not exist; the coverage-scope manifest is missing`)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (error) {
    throw new Error(`${manifestPath} is not valid JSON: ${error.message}`)
  }
  for (const field of ['coverageGated', 'pragmaScanned']) {
    const value = parsed?.[field]
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${manifestPath}: "${field}" must be a non-empty array`)
    }
    if (!value.every((entry) => typeof entry === 'string' && entry.startsWith('src/'))) {
      throw new Error(`${manifestPath}: every "${field}" entry must be a "src/..." string`)
    }
  }
  return parsed
}

function main() {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const reportPath = resolve(webRoot, COVERAGE_REPORT)

  let manifest
  try {
    manifest = readCoverageScope(webRoot)
  } catch (error) {
    console.error(`assert-coverage-scope: ${error.message}`)
    process.exit(1)
  }

  if (!existsSync(reportPath)) {
    console.error(
      `assert-coverage-scope: ${reportPath} does not exist; this run wrote no coverage ` +
        'report. Coverage must be enabled with the json reporter (see the `test` script).',
    )
    process.exit(1)
  }
  let coverage
  try {
    coverage = JSON.parse(readFileSync(reportPath, 'utf-8'))
  } catch (error) {
    console.error(`assert-coverage-scope: ${reportPath} is not valid JSON: ${error.message}`)
    process.exit(1)
  }

  const problems = auditCoverageScope(coverage, manifest.coverageGated, webRoot)
  if (problems.length > 0) {
    console.error(
      `assert-coverage-scope: ${problems.length} problem(s) -- the coverage scope this run ` +
        `MEASURED does not match ${MANIFEST}:`,
    )
    for (const problem of problems) {
      console.error(`  - ${problem}`)
    }
    console.error(
      'assert-coverage-scope: a coverage override (CLI flag, plugin config() hook) can shrink ' +
        'the measured scope while vitest.config.ts still reads correctly. If this change is ' +
        `intended, update ${MANIFEST} in the same reviewed commit.`,
    )
    process.exit(1)
  }

  console.log(
    `assert-coverage-scope: ${manifest.coverageGated.length} module(s) instrumented, ` +
      `exactly matching ${MANIFEST}.`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
