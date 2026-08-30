/**
 * The browser process returning zero is not proof that the product smoke ran.
 * These tests exercise the post-run JSON auditor against the empty, skipped,
 * duplicated, extra, and malformed shapes that Playwright itself accepts as a
 * successful invocation.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  REQUIRED_FULLSTACK_TESTS,
  auditFullstackRun,
  auditFullstackSpecInventory,
  listFullstackSpecFiles,
} from '../scripts/assert-fullstack-run.mjs'
import type { FullstackPlaywrightReport } from '../scripts/assert-fullstack-run.mjs'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))
const REQUIRED_SPEC = 'fullstack-e2e/app.spec.ts'
const REPORTED_SPEC = 'app.spec.ts'
const REQUIRED_TITLE = REQUIRED_FULLSTACK_TESTS[REQUIRED_SPEC]![0]!

function passingReport(): FullstackPlaywrightReport {
  return {
    config: {
      updateSnapshots: 'none',
      rootDir: join(WEB_ROOT, 'fullstack-e2e'),
      projects: [{ testDir: join(WEB_ROOT, 'fullstack-e2e') }],
    },
    errors: [],
    suites: [
      {
        title: REPORTED_SPEC,
        file: REPORTED_SPEC,
        specs: [
          {
            title: REQUIRED_TITLE,
            file: REPORTED_SPEC,
            ok: true,
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          },
        ],
      },
    ],
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  }
}

function spec(report: FullstackPlaywrightReport) {
  return report.suites![0]!.specs![0]!
}

describe('assert-fullstack-run: passing shape and inventory', () => {
  it('accepts exactly one passing execution of the required product path', () => {
    expect(auditFullstackRun(passingReport(), WEB_ROOT)).toEqual([])
  })

  it('accepts both reporter path spellings for the same bound test root', () => {
    const report = passingReport()
    spec(report).file = REQUIRED_SPEC
    expect(auditFullstackRun(report, WEB_ROOT)).toEqual([])
    spec(report).file = REQUIRED_SPEC.replaceAll('/', '\\')
    expect(auditFullstackRun(report, WEB_ROOT)).toEqual([])
  })

  it('binds the on-disk browser suite to the closed manifest', () => {
    const discovered = listFullstackSpecFiles(WEB_ROOT)
    expect(discovered).toEqual([REQUIRED_SPEC])
    expect(auditFullstackSpecInventory(discovered)).toEqual([])
  })

  it('rejects a missing, duplicated, or unmanifested spec file', () => {
    expect(auditFullstackSpecInventory([]).join('\n')).toContain('found 0 time(s)')
    expect(auditFullstackSpecInventory([REQUIRED_SPEC, REQUIRED_SPEC]).join('\n')).toContain(
      'found 2 time(s)',
    )
    expect(
      auditFullstackSpecInventory([REQUIRED_SPEC, 'fullstack-e2e/extra.spec.ts']).join('\n'),
    ).toContain('unmanifested full-stack spec')
  })
})

const reportMutations: ReadonlyArray<
  readonly [string, (report: FullstackPlaywrightReport) => void, string]
> = [
  [
    'snapshot-update mode',
    (report) => (report.config!.updateSnapshots = 'all'),
    'updateSnapshots',
  ],
  [
    'a same-named spec from another test root',
    (report) => {
      report.config!.rootDir = join(WEB_ROOT, 'other-e2e')
      report.config!.projects = [{ testDir: join(WEB_ROOT, 'other-e2e') }]
    },
    'config.rootDir',
  ],
  ['a top-level runner error', (report) => report.errors!.push('boom'), 'top-level error'],
  [
    'zero collected suites',
    (report) => {
      report.suites = []
      report.stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
    },
    '0 test execution(s)',
  ],
  ['the wrong spec path', (report) => (spec(report).file = 'other/app.spec.ts'), 'unmanifested test'],
  ['a renamed required title', (report) => (spec(report).title = 'renamed'), 'unmanifested test'],
  ['a non-passing spec', (report) => (spec(report).ok = false), 'did not pass'],
  ['no test execution', (report) => (spec(report).tests = []), 'ran 0 execution(s)'],
  [
    'a skipped test',
    (report) => {
      spec(report).tests![0]!.status = 'skipped'
      spec(report).tests![0]!.results = [{ status: 'skipped' }]
      report.stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 1 }
    },
    'test status is "skipped"',
  ],
  ['no attempt result', (report) => (spec(report).tests![0]!.results = []), 'produced 0 result(s)'],
  [
    'a failed attempt',
    (report) => {
      spec(report).tests![0]!.status = 'unexpected'
      spec(report).tests![0]!.results = [{ status: 'failed' }]
      report.stats = { expected: 0, unexpected: 1, flaky: 0, skipped: 0 }
    },
    'result status is "failed"',
  ],
  [
    'two project executions',
    (report) => spec(report).tests!.push({ status: 'expected', results: [{ status: 'passed' }] }),
    'ran 2 execution(s)',
  ],
  [
    'two retry results',
    (report) => spec(report).tests![0]!.results!.push({ status: 'passed' }),
    'produced 2 result(s)',
  ],
  ['missing summary statistics', (report) => (report.stats = undefined), 'stats.expected'],
  [
    'a malformed suite tree',
    (report) => (report.suites = [null as unknown as NonNullable<typeof report.suites>[number]]),
    '0 test execution(s)',
  ],
  [
    'an extra passing test',
    (report) => {
      report.suites![0]!.specs!.push({
        title: 'unreviewed extra',
        file: REPORTED_SPEC,
        ok: true,
        tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
      })
      report.stats = { expected: 2, unexpected: 0, flaky: 0, skipped: 0 }
    },
    'unmanifested test',
  ],
]

describe('assert-fullstack-run: rejected report shapes', () => {
  it.each(reportMutations)('rejects %s', (_label, mutate, expectedProblem) => {
    const report = passingReport()
    mutate(report)
    expect(auditFullstackRun(report, WEB_ROOT).join('\n')).toContain(expectedProblem)
  })
})

describe('assert-fullstack-run: command exit code', () => {
  const script = fileURLToPath(new URL('../scripts/assert-fullstack-run.mjs', import.meta.url))

  function run(report: FullstackPlaywrightReport) {
    const directory = mkdtempSync(join(tmpdir(), 'quviz-fullstack-gate-'))
    const reportPath = join(directory, 'report.json')
    writeFileSync(reportPath, JSON.stringify(report), 'utf-8')
    return spawnSync(process.execPath, [script, reportPath], { encoding: 'utf-8' })
  }

  it('returns zero for a complete passing report', () => {
    const result = run(passingReport())
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('required product-path test ran exactly once')
  })

  it('returns nonzero for a green-but-empty report', () => {
    const report = passingReport()
    report.suites = []
    report.stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
    const result = run(report)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('0 test execution(s)')
  })

  it('returns nonzero when Playwright wrote no report', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'quviz-fullstack-gate-')), 'missing.json')
    const result = spawnSync(process.execPath, [script, missing], { encoding: 'utf-8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('wrote no JSON report')
  })
})
