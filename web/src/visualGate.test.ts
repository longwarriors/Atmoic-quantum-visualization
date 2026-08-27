/**
 * The visual suite's post-run gate, exercised on synthetic Playwright reports.
 *
 * `playwright test` is not self-gating in the way `npm test` needs:
 *
 *   - a run in which every test was SKIPPED exits 0;
 *   - a run that collected NO spec file at all exits 0 (`--grep` that matches
 *     nothing, a `testDir` that moved, a `testIgnore` that grew);
 *   - and `--update-snapshots` makes every screenshot comparison pass by
 *     WRITING the pixels it was supposed to compare against, which is the
 *     tautology this whole suite exists to avoid. It exits 0 too.
 *
 * So `npm run test:visual` runs `scripts/assert-visual-run.mjs` over the JSON
 * report afterwards, exactly as `npm test` runs `scripts/assert-no-skips.mjs`
 * over vitest's. Playwright cannot RUN on the Windows dev machine (the config
 * throws off Linux on purpose, so local pixels can never overwrite the CI
 * baselines), which is precisely why the gate's logic is tested HERE, in the
 * ordinary vitest suite, against report documents written by hand: the audit
 * is the part that has to be right whether or not a browser is available.
 *
 * One block per failure mode the gate exists for, plus the passing shape --
 * without that last one every assertion below could be satisfied by a function
 * that returns a problem for every input.
 */
import { auditVisualRun, listVisualSpecFiles } from '../scripts/assert-visual-run.mjs'
import type { PlaywrightJsonReport } from '../scripts/assert-visual-run.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The spec files the visual suite must always have run. */
const WEBGL_SPEC = 'e2e/webgl.spec.ts'
const SLICE_SPEC = 'e2e/slice.spec.ts'

/**
 * A report of one passing test per given spec file, in the shape Playwright's
 * `json` reporter writes: a file-level suite, a `describe`-level suite nested
 * inside it, and specs carrying `tests[].results[]`. Defaults to every
 * committed e2e spec; tests that need an ABSENT spec pass a shorter list.
 * `WEBGL_SPEC` stays first so mutation tests can address `suites[0]`.
 */
function passingReport(...files: string[]): PlaywrightJsonReport {
  const reported = files.length > 0 ? files : [WEBGL_SPEC, SLICE_SPEC]
  return {
    config: { updateSnapshots: 'none' },
    errors: [],
    suites: reported.map((file) => ({
      title: file.split('/').pop() ?? file,
      file,
      specs: [],
      suites: [
        {
          title: `${file.split('/').pop() ?? file} baseline`,
          file,
          specs: [
            {
              title: 'renders through SwiftShader',
              ok: true,
              file,
              tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
            },
          ],
        },
      ],
    })),
    stats: { expected: reported.length, unexpected: 0, flaky: 0, skipped: 0 },
  }
}

describe('assert-visual-run: the passing shape', () => {
  it('reports no problem for a report in which every expected spec passed', () => {
    expect(auditVisualRun(passingReport(), [SLICE_SPEC, WEBGL_SPEC])).toEqual([])
  })
})

describe('assert-visual-run: a test that did not pass', () => {
  // Playwright's per-test `status` is one of expected / unexpected / flaky /
  // skipped, and only `expected` means "this test asserted what it claims".
  // `skipped` is the dangerous one: the run exits 0 and the summary line reads
  // "1 skipped", which is indistinguishable from success at a glance in CI.
  it.each([['skipped'], ['unexpected'], ['flaky']] as const)(
    'fails a run whose test status is "%s"',
    (status) => {
      const report = passingReport()
      report.suites![0]!.suites![0]!.specs![0]!.tests![0]!.status = status
      const problems = auditVisualRun(report, [WEBGL_SPEC])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(status)
      expect(problems[0]).toContain(WEBGL_SPEC)
    },
  )

  // The retry-level status is a separate field, and a run can carry a failed
  // result under a test the reporter still summarised as expected (a retry
  // that passed on the second attempt). `retries: 0` in the config makes that
  // shape impossible today; the gate does not depend on the config for it.
  it('fails a run whose result status is not "passed"', () => {
    const report = passingReport()
    report.suites![0]!.suites![0]!.specs![0]!.tests![0]!.results![0]!.status = 'timedOut'
    const problems = auditVisualRun(report, [WEBGL_SPEC])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('timedOut')
  })

  it('fails a run whose spec is not ok', () => {
    const report = passingReport()
    report.suites![0]!.suites![0]!.specs![0]!.ok = false
    expect(auditVisualRun(report, [WEBGL_SPEC])).toEqual([
      expect.stringContaining('did not pass') as unknown as string,
    ])
  })
})

describe('assert-visual-run: an expected spec file that never ran', () => {
  // `testDir` moving, a `testIgnore` growing, or a `--grep` that matches
  // nothing all produce a report that is internally consistent and green
  // while the screenshot comparison this suite exists for never happened.
  it('fails when an expected spec file is absent from the report', () => {
    const report = passingReport(WEBGL_SPEC)
    const problems = auditVisualRun(report, [WEBGL_SPEC, SLICE_SPEC])
    expect(problems).toEqual([expect.stringContaining(SLICE_SPEC) as unknown as string])
    expect(problems[0]).toContain('not run')
  })

  it('accepts a spec path written with backslashes, as Windows would report it', () => {
    const report = passingReport()
    report.suites![0]!.suites![0]!.specs![0]!.file = 'e2e\\webgl.spec.ts'
    expect(auditVisualRun(report, [WEBGL_SPEC])).toEqual([])
  })
})

describe('assert-visual-run: a run with no tests in it', () => {
  it('fails an empty report', () => {
    const problems = auditVisualRun({ config: { updateSnapshots: 'none' }, suites: [] }, [])
    expect(problems).toEqual([expect.stringContaining('zero tests') as unknown as string])
  })

  it('fails a spec that carries no test', () => {
    const report = passingReport()
    report.suites![0]!.suites![0]!.specs![0]!.tests = []
    const problems = auditVisualRun(report, [WEBGL_SPEC])
    expect(problems.join('\n')).toContain('zero tests')
  })

  it('fails a test that produced no result', () => {
    const report = passingReport()
    report.suites![0]!.suites![0]!.specs![0]!.tests![0]!.results = []
    expect(auditVisualRun(report, [WEBGL_SPEC])).toEqual([
      expect.stringContaining('no result') as unknown as string,
    ])
  })
})

describe('assert-visual-run: the anti-tautology latch', () => {
  // `playwright test --update-snapshots` WRITES the baseline it was asked to
  // compare against, so every screenshot assertion in the run passes by
  // construction and the suite certifies whatever the renderer happened to
  // draw. The config sets `updateSnapshots: 'none'`, but the CLI flag
  // overrides the config file and a report from such a run is otherwise
  // indistinguishable from a real one -- the only trace is this field, which
  // the reporter copies from the RESOLVED config. So the gate reads it.
  it.each([['all'], ['changed'], ['missing'], [undefined]] as const)(
    'fails a run whose resolved updateSnapshots is %s',
    (updateSnapshots) => {
      const report = passingReport()
      report.config = updateSnapshots === undefined ? {} : { updateSnapshots }
      const problems = auditVisualRun(report, [WEBGL_SPEC])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('updateSnapshots')
    },
  )

  it('fails a report with no config block at all', () => {
    const report = passingReport()
    delete report.config
    expect(auditVisualRun(report, [WEBGL_SPEC]).join('\n')).toContain('updateSnapshots')
  })
})

describe('assert-visual-run: a malformed report', () => {
  // A gate that CRASHES on a shape it did not expect is a gate that stops the
  // build with a stack trace instead of an explanation -- and one that crashes
  // in a `try` somewhere upstream is a gate that passes. Every field in the
  // report is optional as far as this audit is concerned (see the .d.mts), so
  // the defensive reads below have to be exercised rather than asserted about
  // in a comment. Each case must PRODUCE PROBLEMS, never throw and never
  // return an empty list.
  it.each([
    ['a null entry in suites', { config: { updateSnapshots: 'none' }, suites: [null] }],
    ['a suite with neither specs nor suites', { config: { updateSnapshots: 'none' }, suites: [{}] }],
    [
      'a suite whose specs is not an array',
      { config: { updateSnapshots: 'none' }, suites: [{ specs: 'nope' }] },
    ],
    ['no suites key at all', { config: { updateSnapshots: 'none' } }],
  ] as const)('reports problems rather than throwing for %s', (_label, report) => {
    const problems = auditVisualRun(report as PlaywrightJsonReport, [WEBGL_SPEC])
    expect(problems.join('\n')).toContain('zero tests')
    expect(problems.join('\n')).toContain('not run')
  })

  it('treats a spec with no tests key as a spec that ran nothing', () => {
    const report = passingReport()
    delete report.suites![0]!.suites![0]!.specs![0]!.tests
    expect(auditVisualRun(report, [WEBGL_SPEC]).join('\n')).toContain('ran zero tests')
  })

  it('treats a test with no results key as a test that produced nothing', () => {
    const report = passingReport()
    delete report.suites![0]!.suites![0]!.specs![0]!.tests![0]!.results
    expect(auditVisualRun(report, [WEBGL_SPEC]).join('\n')).toContain('produced no result')
  })
})

describe('assert-visual-run: the exit code the chain reads', () => {
  // `npm run test:visual` is `playwright test && node scripts/assert-visual-run.mjs`,
  // so the ONLY thing that stops a bad run reaching a green build is this
  // script's exit code. Every block above tests `auditVisualRun` as a
  // function, which says nothing about whether the process that calls it ever
  // fails: a missing `process.exit(1)`, a swallowed exception, or an argv
  // default pointing at a file that is not there would leave the whole gate
  // decorative while all of the above stayed green. So run it for real.
  const script = fileURLToPath(new URL('../scripts/assert-visual-run.mjs', import.meta.url))

  const runOn = (report: unknown): { status: number | null; output: string } => {
    const path = join(mkdtempSync(join(tmpdir(), 'quviz-visual-')), 'report.json')
    writeFileSync(path, JSON.stringify(report), 'utf-8')
    const result = spawnSync(process.execPath, [script, path], { encoding: 'utf-8' })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }

  it('exits 0 and says what it checked for a report of a real, comparing run', () => {
    const result = runOn(passingReport())
    expect(result.output).toContain('updateSnapshots = none')
    expect(result.status).toBe(0)
  })

  it('exits 1 and names the problem for an --update-snapshots run', () => {
    const report = passingReport()
    report.config = { updateSnapshots: 'all' }
    const result = runOn(report)
    expect(result.output).toContain('updateSnapshots')
    expect(result.status).toBe(1)
  })

  it('exits 1 when Playwright wrote no report at all', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'quviz-visual-')), 'absent.json')
    const result = spawnSync(process.execPath, [script, missing], { encoding: 'utf-8' })
    expect(`${result.stdout}${result.stderr}`).toContain('does not exist')
    expect(result.status).toBe(1)
  })
})

describe('assert-visual-run: the expected spec list', () => {
  // The gate is handed the specs that must have run, and it reads them off
  // disk rather than from a literal, so adding a second e2e spec cannot leave
  // the gate silently checking only the first one.
  it('lists the committed e2e spec files', () => {
    expect(listVisualSpecFiles(WEB_ROOT)).toEqual([SLICE_SPEC, WEBGL_SPEC])
  })
})
