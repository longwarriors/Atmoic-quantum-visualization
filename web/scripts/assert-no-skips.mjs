#!/usr/bin/env node
/**
 * Gate `npm test` on what vitest actually ran, not on how the specs are spelled.
 *
 * `vitest run` exits 0 with skipped and todo tests: it prints
 * "109 passed | 4 skipped" and returns success. A source regex over the specs
 * (src/guards.test.ts) can forbid the common spellings, but a skip has too
 * many legal spellings for a regex to be the last word: `it.concurrent.skip`,
 * `it['skip']`, `const { skip } = test`, an aliased runner, or a runtime
 * `context.skip()` inside the test body all reach the runner as a skip while
 * looking nothing alike in the source.
 *
 * So the authoritative check reads vitest's own JSON reporter output. The run
 * is acceptable only when every spec file on disk appears in the results,
 * every file and every test in it has status "passed", and the summary
 * counters agree. Anything else is a failure, printed one line per problem.
 *
 * Usage (wired into `npm test` in package.json):
 *
 *   vitest run --coverage --reporter=default --reporter=json \
 *     --outputFile=coverage/vitest-results.json
 *   node scripts/assert-no-skips.mjs [path/to/vitest-results.json]
 *
 * The result file lives under coverage/, which the coverage provider wipes at
 * the start of every run (`coverage.clean` defaults to true), so a stale file
 * from an earlier run cannot be mistaken for this one.
 *
 * Plain ESM with no dependencies; `src/guards.test.ts` imports `auditRun` and
 * `listSpecFiles` and exercises them against synthetic result documents.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Mirrors `test.include` in vitest.config.ts. */
const SPEC_FILE = /(^|\/)__tests__\/.*\.tsx?$|\.(test|spec)\.tsx?$/

const SUMMARY_COUNTERS = [
  'numFailedTests',
  'numPendingTests',
  'numTodoTests',
  'numFailedTestSuites',
  'numPendingTestSuites',
]

/** Forward slashes everywhere, and a lower-case drive letter on Windows. */
function toPosix(path) {
  const slashed = path.split('\\').join('/')
  return /^[A-Za-z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = `${dir}${sep}${entry}`
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else {
      out.push(full)
    }
  }
  return out
}

/**
 * Every spec file vitest is configured to collect, as a sorted list of
 * posix-style paths relative to the web root (`src/api/qvpc.test.ts`).
 */
export function listSpecFiles(webRoot) {
  const root = toPosix(resolve(webRoot))
  return walk(resolve(webRoot, 'src'))
    .map((file) => posix.relative(root, toPosix(file)))
    .filter((path) => SPEC_FILE.test(path))
    .sort()
}

/**
 * Audit one vitest JSON result document. Returns a list of human-readable
 * problems; an empty list means the run is acceptable.
 */
export function auditRun(results, expectedSpecs, webRoot) {
  const problems = []
  const root = toPosix(resolve(webRoot))
  const files = Array.isArray(results.testResults) ? results.testResults : []

  const ran = new Map()
  for (const file of files) {
    ran.set(posix.relative(root, toPosix(String(file.name))), file)
  }

  for (const spec of expectedSpecs) {
    if (!ran.has(spec)) {
      problems.push(`${spec}: not run (absent from the vitest result file)`)
    }
  }

  for (const [path, file] of ran) {
    if (file.status !== 'passed') {
      problems.push(`${path}: file status is "${file.status}"`)
    }
    const tests = Array.isArray(file.assertionResults) ? file.assertionResults : []
    if (tests.length === 0) {
      problems.push(`${path}: ran zero tests`)
    }
    for (const test of tests) {
      if (test.status !== 'passed') {
        problems.push(`${path}: "${test.fullName}" has status "${test.status}"`)
      }
    }
  }

  for (const counter of SUMMARY_COUNTERS) {
    const value = results[counter]
    if (typeof value !== 'number' || value !== 0) {
      problems.push(`${counter} = ${String(value)} (expected 0)`)
    }
  }
  if (results.success !== true) {
    problems.push(`success = ${String(results.success)} (expected true)`)
  }
  if (typeof results.numTotalTests !== 'number' || results.numTotalTests <= 0) {
    problems.push(`numTotalTests = ${String(results.numTotalTests)} (expected > 0)`)
  }

  return problems
}

function main() {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const resultsPath = resolve(webRoot, process.argv[2] ?? 'coverage/vitest-results.json')
  if (!existsSync(resultsPath)) {
    console.error(`assert-no-skips: ${resultsPath} does not exist; vitest did not write results.`)
    process.exit(1)
  }
  const results = JSON.parse(readFileSync(resultsPath, 'utf-8'))
  const specs = listSpecFiles(webRoot)
  const problems = auditRun(results, specs, webRoot)
  if (problems.length > 0) {
    console.error(`assert-no-skips: ${problems.length} problem(s) in ${resultsPath}:`)
    for (const problem of problems) {
      console.error(`  - ${problem}`)
    }
    process.exit(1)
  }
  console.log(
    `assert-no-skips: ${results.numTotalTests} tests in ${specs.length} spec files, ` +
      'all passed, 0 skipped, 0 todo.',
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
