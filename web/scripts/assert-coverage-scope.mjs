#!/usr/bin/env node
/**
 * Gate `npm test` on the coverage vitest ACTUALLY measured and ACTUALLY
 * enforced, not on what its config source says it should measure and enforce.
 *
 * src/guards.test.ts binds coverage by importing vitest.config.ts and
 * deep-equalling its `coverage.include` / `coverage.exclude` / `thresholds`.
 * That catches an edit to those keys -- and nothing else. It reads the config
 * SOURCE object, so anything that overrides the RESOLVED config leaves them
 * untouched and every guard green while the run measures, or enforces, less:
 *
 *   vitest run --coverage --coverage.include=src/scene/color.ts
 *     -> exit 0, all guard tests pass, coverage table lists only color.ts;
 *        api/client.ts and api/qvpc.ts are gone from coverage AND from the
 *        per-file thresholds that are supposed to hold them at 90%.
 *   vitest run --coverage --coverage.thresholds.lines=0 ...=0 ...=0 ...=0
 *     -> exit 0 with a module at 70% in the table: the scope is intact, the
 *        thresholds that make the scope mean anything are gone.
 *
 * A CLI flag persisted into the `test` script, a Vite plugin `config()` hook,
 * or an env-driven override all do the same thing. The only check that can
 * see either is one that reads the report the run produced. That is this
 * file, and it makes two passes over coverage/coverage-final.json:
 *
 *   SCOPE       its key set is exactly the files the v8 provider instrumented,
 *               so it IS the measured scope. Compared against `coverageGated`.
 *   THRESHOLDS  its per-file `s` / `b` / `f` hit maps are what vitest's own
 *               threshold check reduces to percentages, so recomputing them
 *               here re-runs that check independently of whether vitest still
 *               ran it. Compared against `thresholds`.
 *
 * Both expectations live in coverage-scope.json -- the same manifest
 * src/guards.test.ts checks its minimatch derivation and its literal
 * EXPECTED_COVERAGE_THRESHOLDS against. Two independent checks, one manifest:
 * the config must agree with the manifest, and the run must agree with the
 * manifest. Editing vitest.config.ts, the test script, or the guard file
 * alone cannot satisfy both.
 *
 * FAIL-CLOSED throughout. A missing, unparseable, non-object or empty report
 * is a failure, never a pass -- `--coverage.enabled=false` and a reporter
 * list without `json` both simply produce no report, and scripts/
 * clean-coverage.mjs deletes the previous one before vitest starts so a
 * green report from an earlier run can never stand in for this one. So is a
 * gated module with zero coverable statements: istanbul scores an empty
 * metric 100%, so a whole-file coverage pragma passes every threshold vitest
 * has (measured: such a file reports 0/0/0/0 and the run still exits 0).
 *
 * Usage (wired into `npm test` in package.json, after vitest):
 *
 *   node scripts/assert-coverage-scope.mjs
 *
 * Unlike assert-no-skips.mjs this takes no path argument: the report it reads
 * is fixed at coverage/coverage-final.json relative to the web root, so there
 * is no lever for pointing the gate at a friendlier file.
 *
 * Plain ESM with no dependencies; src/guards.test.ts imports the pure
 * functions below and exercises them against synthetic coverage documents.
 */
import { existsSync, readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COVERAGE_REPORT = 'coverage/coverage-final.json'
const MANIFEST = 'coverage-scope.json'
/** The four metrics vitest thresholds, in the order vitest.config.ts writes them. */
const METRICS = ['statements', 'branches', 'functions', 'lines']

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
 * istanbul-lib-coverage's own percentage, reproduced exactly
 * (node_modules/istanbul-lib-coverage/lib/percent.js):
 *
 *   percent(covered, total) = total > 0
 *     ? Math.floor(((1000 * 100 * covered) / total) / 10) / 100
 *     : 100
 *
 * Two details are load-bearing and must not be "simplified". It TRUNCATES to
 * two decimals rather than rounding -- 12/17 is 70.588..., which vitest
 * prints and threshold-checks as 70.58, not 70.59 -- and it scores an empty
 * metric 100, which is why a module with zero coverable statements is
 * rejected outright below instead of being threshold-checked.
 */
function percent(covered, total) {
  return total > 0 ? Math.floor((1000 * 100 * covered) / total / 10) / 100 : 100
}

/** `{ total, covered, pct }` over a hit map, istanbul's computeSimpleTotals. */
function simpleTotals(hits) {
  const counts = Object.values(hits)
  const covered = counts.filter((count) => count > 0).length
  return { total: counts.length, covered, pct: percent(covered, counts.length) }
}

/** One `s` / `f` hit map off a report entry, shape-checked. */
function hitMap(entry, field) {
  const hits = entry[field]
  if (hits === null || typeof hits !== 'object' || Array.isArray(hits)) {
    throw new Error(`"${field}" is not a hit map -- this is not an istanbul coverage entry`)
  }
  for (const [id, count] of Object.entries(hits)) {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      throw new Error(`"${field}"."${id}" is ${JSON.stringify(count)}, not a hit count`)
    }
  }
  return hits
}

/**
 * Line coverage, istanbul's FileCoverage.getLineCoverage(): each statement's
 * hit count is folded onto the line its statementMap entry STARTS on, keeping
 * the highest count when several statements share a line, and a statement
 * with no statementMap entry is skipped (istanbul does the same -- it guards
 * on `!statementMap[st]`). So "lines" is derived from the statement map, not
 * measured separately; there is no line data in the report to derive it from
 * any other way, and this is exactly what vitest threshold-checks.
 */
function lineTotals(statementMap, statements) {
  const perLine = new Map()
  for (const [id, count] of Object.entries(statements)) {
    if (!Object.hasOwn(statementMap, id)) {
      continue
    }
    const line = statementMap[id]?.start?.line
    if (typeof line !== 'number' || !Number.isInteger(line)) {
      throw new Error(`"statementMap"."${id}".start.line is ${JSON.stringify(line)}, not a line`)
    }
    const previous = perLine.get(line)
    if (previous === undefined || previous < count) {
      perLine.set(line, count)
    }
  }
  const covered = [...perLine.values()].filter((count) => count > 0).length
  return { total: perLine.size, covered, pct: percent(covered, perLine.size) }
}

/**
 * The four coverage percentages for one coverage-final.json file entry, each
 * as `{ total, covered, pct }`.
 *
 * This is istanbul-lib-coverage's FileCoverage.toSummary() (lib/
 * file-coverage.js:351-422) recomputed from the same report vitest hands it,
 * because vitest's own per-file threshold check is
 * `coverageMap.fileCoverageFor(file).toSummary().data[metric].pct < threshold`
 * -- so recomputing the left-hand side here re-runs that check on the run's
 * real numbers, whatever the resolved config did to the right-hand side.
 * Validated against vitest's printed table, not against the source: an
 * uncovered exported function appended to src/scene/color.ts makes vitest
 * print `70.58 | 100 | 75 | 70.58`, and src/guards.test.ts pins those four
 * numbers against this function.
 *
 * Throws on anything that is not an istanbul entry rather than scoring it:
 * an unreadable entry must fail the gate, never satisfy it.
 */
export function summarizeFileCoverage(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    const shape = Array.isArray(entry) ? 'an array' : String(entry === null ? 'null' : typeof entry)
    throw new Error(`coverage entry is ${shape}, not an object`)
  }
  const statementMap = entry.statementMap
  if (statementMap === null || typeof statementMap !== 'object' || Array.isArray(statementMap)) {
    throw new Error('"statementMap" is missing or not an object -- no statements to score')
  }
  const statements = hitMap(entry, 's')
  const functions = hitMap(entry, 'f')

  const branches = entry.b
  if (branches === null || typeof branches !== 'object' || Array.isArray(branches)) {
    throw new Error('"b" is not a branch map -- this is not an istanbul coverage entry')
  }
  let branchTotal = 0
  let branchCovered = 0
  for (const [id, counts] of Object.entries(branches)) {
    if (!Array.isArray(counts) || counts.some((count) => typeof count !== 'number' || count < 0)) {
      throw new Error(`"b"."${id}" is not an array of hit counts`)
    }
    branchTotal += counts.length
    branchCovered += counts.filter((count) => count > 0).length
  }

  return {
    statements: simpleTotals(statements),
    branches: {
      total: branchTotal,
      covered: branchCovered,
      pct: percent(branchCovered, branchTotal),
    },
    functions: simpleTotals(functions),
    lines: lineTotals(statementMap, statements),
  }
}

/**
 * Problems with the manifest's `thresholds` object; empty means it is usable.
 *
 * `perFile` must be true because this gate only implements the per-file
 * reading: it scores each gated module on its own, so a manifest asking for
 * an aggregate would be enforced as something stricter than it says. A
 * non-positive or absent metric is refused for the same reason an empty
 * `coverageGated` is -- certifying a run against "0%" certifies nothing.
 */
function thresholdProblems(thresholds) {
  if (thresholds === null || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
    return [`${MANIFEST}: "thresholds" is missing or not an object`]
  }
  const problems = []
  if (thresholds.perFile !== true) {
    problems.push(
      `${MANIFEST}: "thresholds".perFile must be true -- this gate scores every gated ` +
        'module on its own and cannot enforce an aggregate threshold',
    )
  }
  for (const metric of METRICS) {
    const value = thresholds[metric]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
      problems.push(
        `${MANIFEST}: "thresholds".${metric} is ${JSON.stringify(value)} -- every metric ` +
          'needs a percentage in (0, 100]',
      )
    }
  }
  return problems
}

/**
 * Check what the run actually achieved against the thresholds the manifest
 * carries. Returns a list of human-readable problems; empty means every gated
 * module met every threshold.
 *
 * Deliberately iterates the MANIFEST rather than the report, so a module that
 * is missing from the report is a problem here too and not silently unscored;
 * `auditCoverageScope` reports that case in more detail, and main() runs it
 * first.
 */
export function auditCoverageThresholds(coverage, manifest, webRoot) {
  const expected = manifest?.coverageGated
  if (!Array.isArray(expected) || expected.length === 0) {
    return [
      `${MANIFEST}: "coverageGated" is missing, not an array, or empty -- ` +
        'refusing to certify a run against an empty expectation',
    ]
  }
  const problems = thresholdProblems(manifest?.thresholds)
  if (problems.length > 0) {
    return problems
  }
  const thresholds = manifest.thresholds
  if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage)) {
    return [
      `${COVERAGE_REPORT}: not a JSON object -- no usable coverage report was written for this run`,
    ]
  }

  const measured = new Map(
    Object.entries(coverage).map(([key, entry]) => [toWebRelative(webRoot, key), entry]),
  )
  for (const file of [...expected].sort()) {
    if (!measured.has(file)) {
      problems.push(`${file}: absent from ${COVERAGE_REPORT}, so no threshold held it`)
      continue
    }
    let summary
    try {
      summary = summarizeFileCoverage(measured.get(file))
    } catch (error) {
      problems.push(`${file}: unreadable coverage entry -- ${error.message}`)
      continue
    }
    if (summary.statements.total === 0) {
      problems.push(
        `${file}: zero coverable statements. istanbul scores an empty metric 100%, so this ` +
          'module satisfies every threshold while testing nothing -- a whole-file coverage ' +
          'pragma looks exactly like this. Remove the pragma, or take the module out of ' +
          `"coverageGated" in ${MANIFEST} in a reviewed commit.`,
      )
      continue
    }
    for (const metric of METRICS) {
      const { pct, covered, total } = summary[metric]
      if (pct < thresholds[metric]) {
        problems.push(
          `${file}: ${metric} ${pct}% (${covered}/${total}) is below the ${thresholds[metric]}% ` +
            `threshold ${MANIFEST} carries`,
        )
      }
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
  const [firstProblem] = thresholdProblems(parsed?.thresholds)
  if (firstProblem !== undefined) {
    throw new Error(firstProblem.replace(`${MANIFEST}:`, `${manifestPath}:`))
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

  const scopeProblems = auditCoverageScope(coverage, manifest.coverageGated, webRoot)
  if (scopeProblems.length > 0) {
    console.error(
      `assert-coverage-scope: ${scopeProblems.length} problem(s) -- the coverage scope this run ` +
        `MEASURED does not match ${MANIFEST}:`,
    )
    for (const problem of scopeProblems) {
      console.error(`  - ${problem}`)
    }
    console.error(
      'assert-coverage-scope: a coverage override (CLI flag, plugin config() hook) can shrink ' +
        'the measured scope while vitest.config.ts still reads correctly. If this change is ' +
        `intended, update ${MANIFEST} in the same reviewed commit.`,
    )
    process.exit(1)
  }

  // Only once the scope is exactly right: otherwise every threshold problem
  // would just restate the missing module the scope pass already named.
  const thresholdFailures = auditCoverageThresholds(coverage, manifest, webRoot)
  if (thresholdFailures.length > 0) {
    console.error(
      `assert-coverage-scope: ${thresholdFailures.length} problem(s) -- the coverage this run ` +
        `MEASURED does not meet the thresholds ${MANIFEST} carries:`,
    )
    for (const problem of thresholdFailures) {
      console.error(`  - ${problem}`)
    }
    console.error(
      'assert-coverage-scope: these percentages are recomputed from the run\'s own report, so ' +
        'they hold whether or not vitest still checked its thresholds -- a CLI flag ' +
        '(--coverage.thresholds.lines=0) or a plugin config() hook can delete them while ' +
        'vitest.config.ts still reads correctly.',
    )
    process.exit(1)
  }

  const { thresholds } = manifest
  console.log(
    `assert-coverage-scope: ${manifest.coverageGated.length} module(s) instrumented, ` +
      `exactly matching ${MANIFEST}.`,
  )
  console.log(
    `assert-coverage-scope: all ${manifest.coverageGated.length} meet the per-file thresholds ` +
      `(${METRICS.map((metric) => `${metric} ${thresholds[metric]}%`).join(', ')}), ` +
      "recomputed from this run's report.",
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
