#!/usr/bin/env node
/**
 * Refuse a green-but-empty Playwright full-stack run.
 *
 * Playwright exits zero when every collected test is skipped, and also when a
 * grep/config change collects no tests. The product-path smoke is a CI gate,
 * so its exit code is not enough: the JSON report must contain exactly the
 * reviewed spec/title, exactly once, with one passing execution and no skipped,
 * flaky, unexpected, or extra work.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = 'fullstack-e2e'
const SPEC_FILE = /\.(test|spec)\.tsx?$/
const PASSING_TEST_STATUS = 'expected'
const PASSING_RESULT_STATUS = 'passed'

export const REQUIRED_FULLSTACK_TESTS = Object.freeze({
  [`${TEST_DIR}/app.spec.ts`]: Object.freeze([
    'serves the built product and completes every core scene path against FastAPI',
  ]),
})

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

export function listFullstackSpecFiles(webRoot) {
  const root = toPosix(resolve(webRoot))
  return walk(resolve(webRoot, TEST_DIR))
    .map((file) => posix.relative(root, toPosix(file)))
    .filter((path) => SPEC_FILE.test(path))
    .sort()
}

export function auditFullstackSpecInventory(actualSpecs) {
  const expected = Object.keys(REQUIRED_FULLSTACK_TESTS).sort()
  const counts = new Map()
  const problems = []

  for (const path of actualSpecs) {
    const normalized = toPosix(path)
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  for (const path of expected) {
    const count = counts.get(path) ?? 0
    if (count !== 1) {
      problems.push(`${path}: found ${count} time(s) on disk (expected exactly once)`)
    }
  }
  for (const [path, count] of counts) {
    if (!Object.hasOwn(REQUIRED_FULLSTACK_TESTS, path)) {
      problems.push(`${path}: unmanifested full-stack spec found ${count} time(s) on disk`)
    }
  }
  return problems
}

function collectSpecs(report) {
  const specs = []
  const queue = Array.isArray(report?.suites) ? [...report.suites] : []
  while (queue.length > 0) {
    const suite = queue.shift()
    if (suite === null || typeof suite !== 'object') continue
    if (Array.isArray(suite.specs)) {
      specs.push(...suite.specs.filter((spec) => spec !== null && typeof spec === 'object'))
    }
    if (Array.isArray(suite.suites)) queue.push(...suite.suites)
  }
  return specs
}

function reportedPathMatches(expected, reported) {
  const normalized = toPosix(reported)
  if (normalized === expected) return true
  const prefix = `${TEST_DIR}/`
  return expected.startsWith(prefix) && normalized === expected.slice(prefix.length)
}

function expectedEntry(file, title) {
  for (const [expectedFile, titles] of Object.entries(REQUIRED_FULLSTACK_TESTS)) {
    if (reportedPathMatches(expectedFile, file) && titles.includes(title)) {
      return `${expectedFile}\u0000${title}`
    }
  }
  return undefined
}

/** Problems found in a Playwright JSON report; an empty list means acceptable. */
export function auditFullstackRun(report, webRoot) {
  const problems = []
  const expectedTestDir = resolve(webRoot, TEST_DIR)

  if (report?.config?.updateSnapshots !== 'none') {
    problems.push(
      `config.updateSnapshots = ${JSON.stringify(report?.config?.updateSnapshots)} ` +
        '(expected "none")',
    )
  }
  if (
    typeof report?.config?.rootDir !== 'string' ||
    resolve(report.config.rootDir) !== expectedTestDir
  ) {
    problems.push(
      `config.rootDir = ${JSON.stringify(report?.config?.rootDir)} ` +
        `(expected ${JSON.stringify(expectedTestDir)})`,
    )
  }
  const projects = report?.config?.projects
  if (!Array.isArray(projects) || projects.length !== 1) {
    problems.push(
      `config.projects has ${Array.isArray(projects) ? projects.length : 0} ` +
        'project(s) (expected 1)',
    )
  } else if (
    typeof projects[0]?.testDir !== 'string' ||
    resolve(projects[0].testDir) !== expectedTestDir
  ) {
    problems.push(
      `config.projects[0].testDir = ${JSON.stringify(projects[0]?.testDir)} ` +
        `(expected ${JSON.stringify(expectedTestDir)})`,
    )
  }
  if (!Array.isArray(report?.errors)) {
    problems.push('the report has no top-level errors array')
  } else if (report.errors.length > 0) {
    problems.push(`the report contains ${report.errors.length} top-level error(s)`)
  }

  const specs = collectSpecs(report)
  const seenEntries = new Map()
  let executions = 0

  for (const spec of specs) {
    const file = toPosix(spec.file)
    const title = String(spec.title ?? '')
    const where = `${file || '<missing file>'} > ${JSON.stringify(title)}`
    const entry = expectedEntry(file, title)
    if (entry === undefined) {
      problems.push(`${where}: unmanifested test appeared in the report`)
    } else {
      seenEntries.set(entry, (seenEntries.get(entry) ?? 0) + 1)
    }

    if (spec.ok !== true) problems.push(`${where}: did not pass (ok = ${String(spec.ok)})`)
    const tests = Array.isArray(spec.tests) ? spec.tests : []
    executions += tests.length
    if (tests.length !== 1) {
      problems.push(`${where}: ran ${tests.length} execution(s) (expected exactly one)`)
    }
    for (const test of tests) {
      if (test.status !== PASSING_TEST_STATUS) {
        problems.push(`${where}: test status is ${JSON.stringify(test.status)}`)
      }
      const results = Array.isArray(test.results) ? test.results : []
      if (results.length !== 1) {
        problems.push(`${where}: produced ${results.length} result(s) (expected exactly one)`)
      }
      for (const result of results) {
        if (result.status !== PASSING_RESULT_STATUS) {
          problems.push(`${where}: result status is ${JSON.stringify(result.status)}`)
        }
      }
    }
  }

  for (const [file, titles] of Object.entries(REQUIRED_FULLSTACK_TESTS)) {
    for (const title of titles) {
      const count = seenEntries.get(`${file}\u0000${title}`) ?? 0
      if (count !== 1) {
        problems.push(`${file} > ${JSON.stringify(title)}: found ${count} report entry/entries`)
      }
    }
  }
  if (executions !== 1) {
    problems.push(`the report contains ${executions} test execution(s) (expected exactly one)`)
  }

  const stats = report?.stats
  const expectedStats = { expected: 1, unexpected: 0, flaky: 0, skipped: 0 }
  for (const [name, expected] of Object.entries(expectedStats)) {
    if (stats?.[name] !== expected) {
      problems.push(`stats.${name} = ${JSON.stringify(stats?.[name])} (expected ${expected})`)
    }
  }
  return problems
}

function main() {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const reportPath = resolve(
    webRoot,
    process.argv[2] ?? 'test-results/fullstack/results.json',
  )
  if (!existsSync(reportPath)) {
    console.error(
      `assert-fullstack-run: ${reportPath} does not exist; Playwright wrote no JSON report.`,
    )
    process.exit(1)
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
  const problems = [
    ...auditFullstackSpecInventory(listFullstackSpecFiles(webRoot)),
    ...auditFullstackRun(report, webRoot),
  ]
  if (problems.length > 0) {
    console.error(`assert-fullstack-run: ${problems.length} problem(s) in ${reportPath}:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(
    'assert-fullstack-run: the required product-path test ran exactly once and passed; ' +
      '0 skipped, flaky, unexpected, missing, duplicate, or extra tests.',
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
