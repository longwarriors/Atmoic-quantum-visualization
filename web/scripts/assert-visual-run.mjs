#!/usr/bin/env node
/**
 * Gate `npm run test:visual` on what Playwright actually ran, not on its exit
 * code.
 *
 * This is the visual counterpart of scripts/assert-no-skips.mjs, and it exists
 * for the same reason: a runner's exit code answers "did anything fail?", not
 * "was anything checked?". Three green-but-empty runs are reachable here:
 *
 *   1. Every test SKIPPED. `playwright test` exits 0 and prints "1 skipped".
 *      A `test.skip()` on a condition that is true in CI (no display, a
 *      missing browser, an env var) reads as success in the job log.
 *   2. NO spec file collected at all -- `testDir` moved, `testIgnore` grew, a
 *      `--grep` that matches nothing, a spec renamed out of the match. Exit 0,
 *      "0 tests", and the screenshot comparison this suite exists for never
 *      happened.
 *   3. The run was `--update-snapshots`. That flag makes every screenshot
 *      assertion pass by WRITING the pixels it was asked to compare against,
 *      so a regression is not detected, it is committed. playwright.config.ts
 *      sets `updateSnapshots: 'none'`, but a CLI flag overrides the config
 *      file, and the resulting report is indistinguishable from a real one
 *      except for the `config.updateSnapshots` field the reporter copies out
 *      of the RESOLVED config. This gate reads that field and refuses anything
 *      but 'none'. It is the anti-tautology latch: without it, the fix for a
 *      red visual suite is one flag away and leaves the suite green forever.
 *
 * Usage (wired into `test:visual` in package.json):
 *
 *   playwright test
 *   node scripts/assert-visual-run.mjs [path/to/report.json]
 *
 * The report is written under `test-results/`, which is Playwright's
 * `outputDir` and is wiped at the start of every run, so a stale report from
 * an earlier run is not normally there to be mistaken for this one. That is
 * the same argument scripts/assert-no-skips.mjs makes about coverage/, and it
 * has the same limit: it depends on the runner reaching the point where it
 * cleans. A run that never starts leaves whatever was there, which is why
 * `test:visual` chains with `&&` -- Playwright must exit 0 before this script
 * is asked anything at all.
 *
 * Plain ESM with no dependencies; src/visualGate.test.ts imports
 * `auditVisualRun` and `listVisualSpecFiles` and exercises them against
 * synthetic report documents in the ordinary vitest suite. That split is
 * deliberate: Playwright cannot run on the Windows dev machines (the config
 * throws off Linux by design), so the gate's logic must be verifiable without
 * it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Mirrors `testMatch`'s effect in playwright.config.ts (testDir `e2e`). */
const SPEC_FILE = /\.(test|spec)\.tsx?$/

/** The only per-test status Playwright uses for "this test asserted and passed". */
const PASSING_TEST_STATUS = 'expected'
/** The only per-attempt status that means the attempt itself passed. */
const PASSING_RESULT_STATUS = 'passed'
/** The only `updateSnapshots` value under which a screenshot assertion COMPARES. */
const COMPARING_UPDATE_SNAPSHOTS = 'none'

/** Forward slashes everywhere, and no leading `./`. */
function toPosix(path) {
  return String(path).split('\\').join('/').replace(/^\.\//, '')
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
 * Every e2e spec file on disk, as a sorted list of posix-style paths relative
 * to the web root (`e2e/webgl.spec.ts`) -- the same spelling Playwright's JSON
 * reporter uses for `spec.file`.
 *
 * Read off disk rather than written out as a literal so that adding a second
 * e2e spec cannot leave this gate quietly checking only the first one. A
 * missing `e2e/` directory throws here rather than yielding an empty list: an
 * empty expectation is exactly the vacuous pass this gate exists to refuse.
 */
export function listVisualSpecFiles(webRoot) {
  const root = toPosix(resolve(webRoot))
  return walk(resolve(webRoot, 'e2e'))
    .map((file) => posix.relative(root, toPosix(file)))
    .filter((path) => SPEC_FILE.test(path))
    .sort()
}

/** Every spec in the report, flattened out of the nested suite tree. */
function collectSpecs(report) {
  const specs = []
  const queue = Array.isArray(report.suites) ? [...report.suites] : []
  while (queue.length > 0) {
    const suite = queue.shift()
    if (suite === null || typeof suite !== 'object') {
      continue
    }
    if (Array.isArray(suite.specs)) {
      specs.push(...suite.specs.filter((spec) => spec !== null && typeof spec === 'object'))
    }
    if (Array.isArray(suite.suites)) {
      queue.push(...suite.suites)
    }
  }
  return specs
}

/**
 * Audit one Playwright JSON report document. Returns a list of human-readable
 * problems; an empty list means the run is acceptable.
 */
export function auditVisualRun(report, expectedSpecs) {
  const problems = []

  const updateSnapshots = report.config?.updateSnapshots
  if (updateSnapshots !== COMPARING_UPDATE_SNAPSHOTS) {
    problems.push(
      `config.updateSnapshots = ${JSON.stringify(updateSnapshots)} (expected ` +
        `"${COMPARING_UPDATE_SNAPSHOTS}"): this run WROTE its baselines instead of comparing ` +
        'against them, so every screenshot assertion in it passed by construction',
    )
  }

  const specs = collectSpecs(report)
  const ran = new Set(specs.map((spec) => toPosix(spec.file)))
  for (const spec of expectedSpecs) {
    if (!ran.has(spec)) {
      problems.push(`${spec}: not run (absent from the Playwright report)`)
    }
  }

  let tested = 0
  for (const spec of specs) {
    const where = `${toPosix(spec.file)} > "${spec.title}"`
    if (spec.ok !== true) {
      problems.push(`${where}: did not pass (ok = ${String(spec.ok)})`)
    }
    const tests = Array.isArray(spec.tests) ? spec.tests : []
    if (tests.length === 0) {
      problems.push(`${where}: ran zero tests`)
    }
    for (const test of tests) {
      tested += 1
      if (test.status !== PASSING_TEST_STATUS) {
        problems.push(`${where}: test status is "${test.status}"`)
      }
      const results = Array.isArray(test.results) ? test.results : []
      if (results.length === 0) {
        problems.push(`${where}: produced no result`)
      }
      for (const result of results) {
        if (result.status !== PASSING_RESULT_STATUS) {
          problems.push(`${where}: result status is "${result.status}"`)
        }
      }
    }
  }

  if (tested === 0) {
    problems.push('the report contains zero tests (nothing was compared against a baseline)')
  }

  return problems
}

function main() {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const reportPath = resolve(webRoot, process.argv[2] ?? 'test-results/visual-report.json')
  if (!existsSync(reportPath)) {
    console.error(
      `assert-visual-run: ${reportPath} does not exist; Playwright wrote no JSON report.`,
    )
    process.exit(1)
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
  const specs = listVisualSpecFiles(webRoot)
  const problems = auditVisualRun(report, specs)
  if (problems.length > 0) {
    console.error(`assert-visual-run: ${problems.length} problem(s) in ${reportPath}:`)
    for (const problem of problems) {
      console.error(`  - ${problem}`)
    }
    process.exit(1)
  }
  console.log(
    `assert-visual-run: every test in ${specs.length} e2e spec file(s) passed, ` +
      'compared against committed baselines (updateSnapshots = none).',
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
