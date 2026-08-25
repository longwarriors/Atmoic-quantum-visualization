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
 * or an env-driven override all do the same thing. So this file makes three
 * passes, over two files the RUN produced:
 *
 *   RESOLVED    coverage/resolved-coverage.json, written by scripts/
 *               capture-resolved-coverage.mjs from vitest's own resolved
 *               config (wired in as `globalSetup`). This is the config the
 *               run really used, overrides folded in. Compared against
 *               `resolvedCoverage`.
 *   SCOPE       coverage-final.json's key set is exactly the files the
 *               provider instrumented, so it IS the measured scope. Compared
 *               against `coverageGated`.
 *   THRESHOLDS  its per-file `s` / `b` / `f` hit maps are what vitest's own
 *               threshold check reduces to percentages, so recomputing them
 *               here re-runs that check independently of whether vitest still
 *               ran it. Compared against `thresholds`.
 *
 * The RESOLVED pass is first because it is the one that says the other two
 * are worth anything. Reading the report only proves something while
 * something else guarantees the report came from real instrumentation:
 * `--coverage.provider=custom --coverage.customProviderModule=...`, whether
 * persisted into the `test` script or set by a plugin `config()` hook, makes
 * the report a file the run hand-wrote, and every content check downstream
 * then certifies a forgery (measured, twice, with an uncovered exported
 * function shipping in a gated module and `check.ps1` at exit 0). Binding one
 * more coverage key each round is how three reviews in a row found the next
 * one, so this pass deep-equals the WHOLE resolved coverage object -- every
 * key, not a list of the ones that looked dangerous -- on top of naming the
 * security-relevant ones explicitly.
 *
 * All three expectations live in coverage-scope.json -- the same manifest
 * src/guards.test.ts checks its minimatch derivation and its literal
 * EXPECTED_COVERAGE_THRESHOLDS against. Two independent checks, one manifest:
 * the config must agree with the manifest, and the run must agree with the
 * manifest. Editing vitest.config.ts, the test script, or the guard file
 * alone cannot satisfy both. The manifest cannot be made permissive either:
 * `readCoverageScope` applies the same invariants to the EXPECTATION that
 * this file applies to the capture, so a `provider: "custom"` written into
 * coverage-scope.json throws instead of licensing itself.
 *
 * WHAT THIS GATE DOES NOT DEFEND AGAINST
 *
 * It stops coverage being weakened by CONFIGURATION -- a shrunken scope,
 * deleted or zeroed thresholds, `perFile:false`, a stale report, a deleted
 * chain stage, a pragma, a module parked under an extension the include misses
 * -- whether that weakening was careless or deliberate. It does not stop code
 * written to lie about coverage. Every observer above runs inside the vitest
 * process, and vitest assigns `config.coverage = coverageProvider
 * .resolveOptions()` before globalSetup runs, so a custom provider hands the
 * capture module a clean-looking config while instrumenting nothing --
 * measured, `check.ps1` at exit 0 with an uncovered exported function
 * shipping. The capture file is never touched. That is not a bug in the layers
 * below; it is what "the process vouches for itself" means, and no further
 * layer inside the process can close it.
 *
 * What bounds it instead is that WIRING a provider in now costs a reviewed
 * diff: tests/test_check_script.py forbids `--coverage.` in the `test` script,
 * forbids a `plugins` key in vitest.config.ts, pins the `test` chain to an
 * exact stage tuple, and pins the file list under scripts/ -- all from
 * outside, where the run cannot reach them. Closing the class itself means
 * instrumenting independently of this chain (a second, separately configured
 * coverage run) or diffing the coverage configuration against a protected
 * baseline in CI. Both are deliberately out of scope here; see
 * docs/project/status.md, "门禁的防护边界".
 *
 * FAIL-CLOSED throughout. A missing, unparseable, non-object or empty report
 * or capture is a failure, never a pass -- `--coverage.enabled=false` and a
 * reporter list without `json` both simply produce no report, removing the
 * `globalSetup` produces no capture, and scripts/clean-coverage.mjs deletes
 * all three files before vitest starts so a green one from an earlier run can
 * never stand in for this one. So is a gated module with zero coverable
 * statements: istanbul scores an empty metric 100%, so a whole-file coverage
 * pragma passes every threshold vitest has (measured: such a file reports
 * 0/0/0/0 and the run still exits 0).
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
/** Written by scripts/capture-resolved-coverage.mjs, vitest's `globalSetup`. */
const RESOLVED_CAPTURE = 'coverage/resolved-coverage.json'
const MANIFEST = 'coverage-scope.json'
/** The four metrics vitest thresholds, in the order vitest.config.ts writes them. */
const METRICS = ['statements', 'branches', 'functions', 'lines']
/** The capture shape this file knows how to read. */
const CAPTURE_SCHEMA = 2

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
 * Every place two JSON documents differ, as `path: actual vs expected` lines.
 * Objects are compared by key SET, so a missing key and an extra key are both
 * differences and neither can hide behind the other -- which is the whole
 * point of deep-equalling the resolved coverage config rather than a list of
 * fields somebody chose.
 */
export function jsonDifferences(actual, expected, path = '') {
  const at = path === '' ? '' : `${path}: `
  const show = (value) => JSON.stringify(value) ?? String(value)

  const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return [`${at}${show(actual)} is not the expected ${show(expected)}`]
    }
    const differences = []
    if (actual.length !== expected.length) {
      differences.push(`${at}has ${actual.length} entr(ies), expected ${expected.length}`)
    }
    for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
      differences.push(...jsonDifferences(actual[index], expected[index], `${path}[${index}]`))
    }
    return differences
  }
  if (isPlainObject(expected) || isPlainObject(actual)) {
    if (!isPlainObject(expected) || !isPlainObject(actual)) {
      return [`${at}${show(actual)} is not the expected ${show(expected)}`]
    }
    const differences = []
    for (const key of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      const where = path === '' ? key : `${path}.${key}`
      if (!Object.hasOwn(expected, key)) {
        differences.push(`${where}: present as ${show(actual[key])}, but not expected at all`)
      } else if (!Object.hasOwn(actual, key)) {
        differences.push(`${where}: missing; expected ${show(expected[key])}`)
      } else {
        differences.push(...jsonDifferences(actual[key], expected[key], where))
      }
    }
    return differences
  }
  return Object.is(actual, expected) ? [] : [`${at}${show(actual)}, expected ${show(expected)}`]
}

/**
 * The invariants a resolved coverage config must satisfy no matter what any
 * manifest says. Applied twice, on purpose: to the config the run RESOLVED,
 * and -- by `readCoverageScope` -- to the EXPECTATION coverage-scope.json
 * carries for it. A deep-equal against the manifest alone would let one edit
 * to the manifest license the very config it is supposed to forbid; these
 * make that edit fail at the manifest instead.
 *
 * Each item is here because dropping it hands the gate a report the run wrote
 * itself, or removes the thing the report is measured against:
 *
 *   provider / customProviderModule  a custom provider IS the report author.
 *   enabled                          `--coverage.enabled=false` instruments
 *                                    nothing; without this the only signal is
 *                                    the missing report.
 *   all                              with `all:false` only files a test
 *                                    imported are instrumented, so an
 *                                    untested module is absent rather than 0%.
 *   include / exclude                the measured scope.
 *   thresholds                       what measuring it has to prove.
 *   reporter                         no `json` reporter, no report at all.
 */
function resolvedCoverageProblems(coverage, source) {
  if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage)) {
    return [`${source}: "coverage" is missing or not an object`]
  }
  const problems = []
  if (coverage.provider !== 'v8') {
    problems.push(
      `${source}: coverage.provider is ${JSON.stringify(coverage.provider)}, not "v8" -- a ` +
        'custom or istanbul provider writes the report this gate reads, so the report would ' +
        'no longer be evidence of anything',
    )
  }
  if (Object.hasOwn(coverage, 'customProviderModule')) {
    problems.push(
      `${source}: coverage.customProviderModule is set (${JSON.stringify(
        coverage.customProviderModule,
      )}) -- that module hand-writes coverage-final.json`,
    )
  }
  if (coverage.enabled !== true) {
    problems.push(
      `${source}: coverage.enabled is ${JSON.stringify(coverage.enabled)}, not true -- ` +
        'nothing was instrumented and no per-file threshold held anything',
    )
  }
  if (coverage.all !== true) {
    problems.push(
      `${source}: coverage.all is ${JSON.stringify(coverage.all)}, not true -- only files a ` +
        'test imported would be measured, so an untested module goes missing instead of ' +
        'reporting 0%',
    )
  }
  for (const field of ['include', 'exclude']) {
    const value = coverage[field]
    if (!Array.isArray(value) || value.length === 0 || !value.every((p) => typeof p === 'string')) {
      problems.push(`${source}: coverage.${field} is not a non-empty array of patterns`)
    }
  }
  problems.push(
    ...thresholdProblems(coverage.thresholds).map((problem) =>
      problem.replace(`${MANIFEST}: "thresholds"`, `${source}: coverage.thresholds`),
    ),
  )
  // Resolved form is [[name, options], ...] (vitest's resolveCoverageReporters).
  const reporters = Array.isArray(coverage.reporter)
    ? coverage.reporter.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
    : []
  if (!reporters.includes('json')) {
    problems.push(
      `${source}: coverage.reporter is ${JSON.stringify(coverage.reporter)} -- without the ` +
        '"json" reporter no coverage-final.json is written and every check below has nothing ' +
        'to read',
    )
  }
  return problems
}

/**
 * Check the coverage config vitest RESOLVED for this run -- captured by
 * scripts/capture-resolved-coverage.mjs from `project.config` inside
 * `globalSetup` -- against the manifest's `resolvedCoverage`.
 *
 * Returns a list of human-readable problems; empty means the run used exactly
 * the coverage configuration the manifest describes.
 *
 * This is the only check in the repo that sees the config the run actually
 * had. src/guards.test.ts reads the config SOURCE (a CLI flag or a plugin
 * `config()` hook leaves it byte-identical) and the two passes below read the
 * report (whoever wrote it decides what it says).
 */
export function auditResolvedCoverage(captured, expected, webRoot) {
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured)) {
    return [
      `${RESOLVED_CAPTURE}: not a JSON object (got ${
        Array.isArray(captured) ? 'an array' : String(captured === null ? 'null' : typeof captured)
      }) -- no resolved coverage config was captured for this run`,
    ]
  }
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    return [
      `${MANIFEST}: "resolvedCoverage" is missing or not an object -- refusing to certify a ` +
        'run against no expectation at all',
    ]
  }

  const problems = []
  if (captured.schema !== CAPTURE_SCHEMA) {
    return [
      `${RESOLVED_CAPTURE}: schema is ${JSON.stringify(captured.schema)}, not ${CAPTURE_SCHEMA} ` +
        '-- this gate does not know how to read that capture, so it refuses to pass it',
    ]
  }
  const capturedRoot = typeof captured.root === 'string' ? toPosix(resolve(captured.root)) : null
  if (capturedRoot !== toPosix(resolve(webRoot))) {
    problems.push(
      `${RESOLVED_CAPTURE}: root is ${JSON.stringify(captured.root)}, not ${JSON.stringify(
        toPosix(resolve(webRoot)),
      )} -- this capture describes a different checkout's run`,
    )
  }
  if (captured.isRootProject !== true) {
    problems.push(
      `${RESOLVED_CAPTURE}: isRootProject is ${JSON.stringify(captured.isRootProject)} -- the ` +
        'capture came from a non-root project, whose config is not the one this gate pins',
    )
  }
  if (captured.projectName !== '') {
    problems.push(
      `${RESOLVED_CAPTURE}: projectName is ${JSON.stringify(captured.projectName)}, expected ` +
        'the unnamed single project this gate assumes',
    )
  }
  // The provider OBJECT vitest loaded, next to the provider NAME the resolved
  // options claim. They come apart only for a fake that did not bother to
  // disguise itself -- one that declares `name = "v8"` satisfies both -- so
  // this is one more layer, not the wall. See the boundary note at the top.
  if (captured.coverageProviderName !== 'v8') {
    problems.push(
      `${RESOLVED_CAPTURE}: coverageProviderName is ${JSON.stringify(
        captured.coverageProviderName,
      )}, not "v8" -- vitest loaded some other coverage provider, and a provider that is not ` +
        'the v8 one WRITES coverage-final.json instead of instrumenting anything',
    )
  }
  problems.push(
    ...jsonDifferences(captured.globalSetup, expected.globalSetup, 'globalSetup').map(
      (difference) =>
        `${RESOLVED_CAPTURE}: resolved ${difference} -- the globalSetup list is what writes ` +
        'this capture; changing it changes who vouches for the run',
    ),
  )
  problems.push(...resolvedCoverageProblems(captured.coverage, RESOLVED_CAPTURE))
  problems.push(
    ...jsonDifferences(captured.coverage, expected.coverage, 'coverage').map(
      (difference) => `${RESOLVED_CAPTURE}: resolved ${difference}`,
    ),
  )
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
  // The expectation for the resolved config is held to the same invariants as
  // the resolved config itself, so it cannot be edited into permitting a
  // custom provider, disabled coverage or a zeroed threshold. Its `include` /
  // `exclude` / `globalSetup` are bound to vitest.config.ts on the other side,
  // by src/guards.test.ts.
  const resolved = parsed?.resolvedCoverage
  if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new Error(`${manifestPath}: "resolvedCoverage" must be an object`)
  }
  if (
    !Array.isArray(resolved.globalSetup) ||
    resolved.globalSetup.length === 0 ||
    !resolved.globalSetup.every((file) => typeof file === 'string' && file.endsWith('.mjs'))
  ) {
    throw new Error(
      `${manifestPath}: "resolvedCoverage".globalSetup must be a non-empty array of .mjs paths ` +
        '-- without a globalSetup nothing captures the config the run resolved',
    )
  }
  const [firstResolvedProblem] = resolvedCoverageProblems(
    resolved.coverage,
    `${manifestPath}: "resolvedCoverage"`,
  )
  if (firstResolvedProblem !== undefined) {
    throw new Error(firstResolvedProblem)
  }
  const thresholdDifferences = jsonDifferences(
    resolved.coverage.thresholds,
    parsed.thresholds,
    'thresholds',
  )
  if (thresholdDifferences.length > 0) {
    throw new Error(
      `${manifestPath}: "resolvedCoverage".coverage.${thresholdDifferences[0]} -- the thresholds ` +
        'the run must resolve and the thresholds the report is scored against are one value',
    )
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

  // Provenance first: the two passes below read a file, and reading a file
  // only proves something once something else says who was allowed to write
  // it. scripts/clean-coverage.mjs deleted this capture before vitest started,
  // so "missing" means this run's globalSetup did not write one -- which is
  // what removing the globalSetup from vitest.config.ts looks like.
  const capturePath = resolve(webRoot, RESOLVED_CAPTURE)
  if (!existsSync(capturePath)) {
    console.error(
      `assert-coverage-scope: ${capturePath} does not exist; this run captured no resolved ` +
        'coverage config. vitest.config.ts must keep scripts/capture-resolved-coverage.mjs in ' +
        'its `globalSetup` (see coverage-scope.json: "resolvedCoverage").',
    )
    process.exit(1)
  }
  let captured
  try {
    captured = JSON.parse(readFileSync(capturePath, 'utf-8'))
  } catch (error) {
    console.error(`assert-coverage-scope: ${capturePath} is not valid JSON: ${error.message}`)
    process.exit(1)
  }
  const resolvedProblems = auditResolvedCoverage(captured, manifest.resolvedCoverage, webRoot)
  if (resolvedProblems.length > 0) {
    console.error(
      `assert-coverage-scope: ${resolvedProblems.length} problem(s) -- the coverage config this ` +
        `run RESOLVED does not match ${MANIFEST}:`,
    )
    for (const problem of resolvedProblems) {
      console.error(`  - ${problem}`)
    }
    console.error(
      'assert-coverage-scope: this is the config vitest actually ran under, overrides folded ' +
        'in, so it catches what no assertion over vitest.config.ts can see -- a persisted CLI ' +
        'flag, a plugin config() hook, an env override. A custom coverage provider in ' +
        'particular WRITES coverage-final.json, which would make every check below certify a ' +
        `report the run made up. If this change is intended, update ${MANIFEST} in the same ` +
        'reviewed commit.',
    )
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
    `assert-coverage-scope: this run RESOLVED the coverage config ${MANIFEST} carries ` +
      `(provider ${captured.coverage.provider}, no custom provider module), captured from ` +
      "vitest's own resolved config by globalSetup.",
  )
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
