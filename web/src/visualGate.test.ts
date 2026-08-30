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
 *   - a required title or screenshot/WebGL assertion can disappear while
 *     unrelated tests in the same file still pass.
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
import {
  REQUIRED_VISUAL_TESTS,
  auditVisualRun,
  auditVisualSources,
  auditVisualSpecInventory,
  auditVisualSpecSource,
  listVisualSpecFiles,
} from '../scripts/assert-visual-run.mjs'
import type { PlaywrightJsonReport } from '../scripts/assert-visual-run.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * The spec files the visual suite must always have run, as the GATE names them:
 * relative to the web root, which is what `listVisualSpecFiles` reads off disk.
 */
const WEBGL_SPEC = 'e2e/webgl.spec.ts'
const SLICE_SPEC = 'e2e/slice.spec.ts'

/**
 * The same two files as PLAYWRIGHT'S REPORTER writes them -- relative to
 * `testDir`, so with no `e2e/` on the front.
 *
 * Measured, not assumed: in the JSON report from the first all-green CI run
 * (33098730686) every `spec.file` reads `"slice.spec.ts"` or `"webgl.spec.ts"`,
 * while `config.rootDir` and `config.projects[0].testDir` are both the absolute
 * path of `.../web/e2e`. The two spellings are the same files described from
 * different roots.
 *
 * The synthetic reports below are built in THIS shape, and that is the whole
 * point of this constant existing. They were built in the expected shape once,
 * which meant every case here validated a document Playwright never produces --
 * so a gate that could not match a single real report passed its own tests, and
 * the first run against a genuine one reported both specs "not run".
 */
const REPORTED_WEBGL = 'webgl.spec.ts'
const REPORTED_SLICE = 'slice.spec.ts'
const REQUIRED_SPECS = Object.keys(REQUIRED_VISUAL_TESTS).sort()

function requiredSpecForReportedPath(file: string): string {
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '')
  const match = REQUIRED_SPECS.find(
    (spec) => normalized === spec || normalized === spec.replace(/^e2e\//, ''),
  )
  if (match === undefined) {
    throw new Error(`passingReport: ${file} is not a required visual spec`)
  }
  return match
}

/**
 * A report of every required test per given spec file, in the shape Playwright's
 * `json` reporter writes: a file-level suite, a `describe`-level suite nested
 * inside it, and specs carrying `tests[].results[]`. Defaults to every
 * committed e2e spec; tests that need an ABSENT spec pass a shorter list.
 * `REPORTED_WEBGL` stays first so mutation tests can address `suites[0]`.
 */
function passingReport(...files: string[]): PlaywrightJsonReport {
  const reported = files.length > 0 ? files : [REPORTED_WEBGL, REPORTED_SLICE]
  const expectedCount = reported.reduce(
    (count, file) => count + REQUIRED_VISUAL_TESTS[requiredSpecForReportedPath(file)]!.length,
    0,
  )
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
          specs: REQUIRED_VISUAL_TESTS[requiredSpecForReportedPath(file)]!.map((title) => ({
            title,
            ok: true,
            file,
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          })),
        },
      ],
    })),
    stats: { expected: expectedCount, unexpected: 0, flaky: 0, skipped: 0 },
  }
}

function reportSpecs(report: PlaywrightJsonReport, reportedFile: string) {
  return report.suites!.find((suite) => suite.file === reportedFile)!.suites![0]!.specs!
}

const REQUIRED_TEST_CASES = Object.entries(REQUIRED_VISUAL_TESTS).flatMap(([spec, titles]) =>
  titles.map((title) => [spec, title] as const),
)

function visualSpecSource(spec: string): string {
  return readFileSync(join(WEB_ROOT, ...spec.split('/')), 'utf-8')
}

function mutateInsideTest(source: string, title: string, needle: string, replacement: string): string {
  const start = source.indexOf(`test('${title}'`)
  if (start < 0) {
    throw new Error(`test fixture has no title: ${title}`)
  }
  const next = source.indexOf('\ntest(', start + 1)
  const end = next < 0 ? source.length : next
  const body = source.slice(start, end)
  const mutated = body.replace(needle, replacement)
  if (mutated === body) {
    throw new Error(`test fixture "${title}" has no mutation target: ${needle}`)
  }
  return `${source.slice(0, start)}${mutated}${source.slice(end)}`
}

function mutateSource(source: string, needle: string, replacement: string): string {
  const mutated = source.replace(needle, replacement)
  if (mutated === source) {
    throw new Error(`source fixture has no mutation target: ${needle}`)
  }
  return mutated
}

const SLICE_SOURCE_MUTATIONS = [
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![0]!,
    'screenshotOptions()',
    'notAuditedOptions()',
    'the 2p_z positive screenshot',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![1]!,
    'screenshotOptions()',
    'notAuditedOptions()',
    'the 2p(+1) phase positive screenshot',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![2]!,
    'screenshotOptions()',
    'notAuditedOptions()',
    'both stationary-density positive screenshots',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![3]!,
    'screenshotOptions()',
    'notAuditedOptions()',
    'the t=0 positive screenshot',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![4]!,
    'screenshotOptions()',
    'notAuditedOptions()',
    'the t=8.4 positive screenshot',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![4]!,
    'halfPeriodRejectionOptions()',
    'notAuditedOptions() /* halfPeriodRejectionOptions() */',
    'the half-period negated screenshot control',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![5]!,
    'transposeRejectionOptions()',
    'notAuditedOptions()',
    'the transposition negated screenshot control',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![6]!,
    'screenshotOptions()',
    'notAuditedOptions()',
    'the geometry-control positive screenshot',
  ],
  [
    REQUIRED_VISUAL_TESTS[SLICE_SPEC]![6]!,
    'geometryRejectionOptions()',
    'notAuditedOptions()',
    'the geometry negated screenshot control',
  ],
] as const

const WEBGL_SOURCE_MUTATIONS = [
  ['report.supported', 'report.wasSupported', 'the WebGL2 availability assertion'],
  ['report.unmasked', 'report.wasUnmasked', 'the unmasked-renderer assertion'],
  ['report.renderer', 'report.otherRenderer', 'the SwiftShader renderer assertion'],
] as const

const GEOMETRY_NEGATED_ASSERTION = `await expect(canvasOf(page)).not.toHaveScreenshot(
    'degenerate-stationary-xz.png',
    geometryRejectionOptions(),
  )`

const REQUIRED_TEST_CONTROL_FLOW_MUTATIONS = [
  ['an unconditional return', 'return;', 'return'],
  ['a conditional return', 'if (true) return;', 'if'],
  ['a throw', "throw new Error('stop');", 'throw'],
  ['a switch', 'switch (true) { case true: return; }', 'switch'],
  ['a try', 'try { return; } finally {}', 'try'],
  ['a for loop', 'for (;;) { return; }', 'for'],
  ['a while loop', 'while (true) { return; }', 'while'],
  ['a do loop', 'do { return; } while (false);', 'do'],
  ['a for-in loop', 'for (const key in {}) { return; }', 'for-in'],
  ['a for-of loop', 'for (const item of []) { return; }', 'for-of'],
] as const

const SLICE_CONFIGURATION_VALUE_MUTATIONS = [
  [
    'the positive per-pixel threshold',
    'threshold: 0.02',
    'threshold: 0.2 /* threshold: 0.02 */',
    'COMPARISON.threshold must be the numeric literal 0.02',
  ],
  [
    'the positive changed-pixel ratio',
    'maxDiffPixelRatio: 0.001',
    'maxDiffPixelRatio: 1 /* maxDiffPixelRatio: 0.001 */',
    'COMPARISON.maxDiffPixelRatio must be the numeric literal 0.001',
  ],
  [
    'the comparison timeout',
    'timeout: 30_000,',
    'timeout: 3_000 /* timeout: 30_000 */,',
    'COMPARISON.timeout must be the numeric literal 30000',
  ],
  [
    'the half-period rejection threshold',
    'rejectionComparison(0.05)',
    'rejectionComparison(0.01 /* rejectionComparison(0.05) */)',
    'HALF_PERIOD_REJECTION must be rejectionComparison(0.05)',
  ],
  [
    'the transpose rejection threshold',
    'const TRANSPOSE_REJECTION = rejectionComparison(0.1)',
    'const TRANSPOSE_REJECTION = rejectionComparison(0.01) /* rejectionComparison(0.1) */',
    'TRANSPOSE_REJECTION must be rejectionComparison(0.1)',
  ],
  [
    'the geometry rejection threshold',
    'const GEOMETRY_REJECTION = rejectionComparison(0.1)',
    'const GEOMETRY_REJECTION = rejectionComparison(0.01) /* rejectionComparison(0.1) */',
    'GEOMETRY_REJECTION must be rejectionComparison(0.1)',
  ],
  [
    'the geometry mutation scale',
    'const GEOMETRY_SCALE = 1.02',
    "const GEOMETRY_SCALE = 1 /* 'const GEOMETRY_SCALE = 1.02' */",
    'GEOMETRY_SCALE must be the numeric literal 1.02',
  ],
] as const

const SLICE_CONFIGURATION_RELATION_MUTATIONS = [
  [
    'the rejection threshold guard',
    'if (threshold < COMPARISON.threshold) {',
    'if (threshold > COMPARISON.threshold) { /* threshold < COMPARISON.threshold */',
    'rejectionComparison must guard threshold < COMPARISON.threshold',
  ],
  [
    'the rejection option constructor',
    'return { ...COMPARISON, threshold } as const',
    'return { ...COMPARISON } as const /* return { ...COMPARISON, threshold } */',
    'rejectionComparison must guard threshold < COMPARISON.threshold',
  ],
  [
    'the positive options spread',
    '({ ...COMPARISON })',
    '({ ...HALF_PERIOD_REJECTION /* ...COMPARISON */ })',
    'screenshotOptions must return { ...COMPARISON } exactly',
  ],
  [
    'the half-period options spread',
    '({ ...HALF_PERIOD_REJECTION })',
    '({ ...COMPARISON /* ...HALF_PERIOD_REJECTION */ })',
    'halfPeriodRejectionOptions must return { ...HALF_PERIOD_REJECTION }',
  ],
  [
    'the transpose options spread',
    '({ ...TRANSPOSE_REJECTION })',
    '({ ...COMPARISON /* ...TRANSPOSE_REJECTION */ })',
    'transposeRejectionOptions must return { ...TRANSPOSE_REJECTION }',
  ],
  [
    'the geometry options spread',
    '({ ...GEOMETRY_REJECTION })',
    '({ ...COMPARISON /* ...GEOMETRY_REJECTION */ })',
    'geometryRejectionOptions must return { ...GEOMETRY_REJECTION }',
  ],
] as const

describe('assert-visual-run: the passing shape', () => {
  it('reports no problem for a report in which every expected spec passed', () => {
    expect(auditVisualRun(passingReport(), [SLICE_SPEC, WEBGL_SPEC])).toEqual([])
  })
})

describe('assert-visual-run: the required test-title manifest', () => {
  it.each(REQUIRED_TEST_CASES)('fails when %s loses required test "%s"', (spec, title) => {
    const report = passingReport()
    const reportedFile = spec.replace(/^e2e\//, '')
    const specs = reportSpecs(report, reportedFile)
    specs.splice(
      specs.findIndex((candidate) => candidate.title === title),
      1,
    )
    // Keep a report entry for a one-test file. This proves an unrelated green
    // test cannot make the FILE-presence check hide the missing title.
    if (specs.length === 0) {
      specs.push({
        title: 'an unrelated extra visual test',
        ok: true,
        file: reportedFile,
        tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
      })
    }

    const problems = auditVisualRun(report, REQUIRED_SPECS).join('\n')
    expect(problems).toContain(spec)
    expect(problems).toContain(`"${title}"`)
    expect(problems).toContain('ran 0 time(s)')
  })

  it('does not let an extra passing test substitute for a missing required one', () => {
    const report = passingReport()
    const specs = reportSpecs(report, REPORTED_SLICE)
    const missing = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![0]!
    specs.splice(
      specs.findIndex((candidate) => candidate.title === missing),
      1,
    )
    specs.push({
      title: 'more pixels are pretty',
      ok: true,
      file: REPORTED_SLICE,
      tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
    })

    const problems = auditVisualRun(report, REQUIRED_SPECS).join('\n')
    expect(problems).toContain(`"${missing}"`)
    expect(problems).not.toContain('more pixels are pretty')
  })

  it('fails when the same required title appears in two report entries', () => {
    const report = passingReport()
    const specs = reportSpecs(report, REPORTED_SLICE)
    specs.push({ ...specs[0]!, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] })

    const problems = auditVisualRun(report, REQUIRED_SPECS).join('\n')
    expect(problems).toContain(`"${REQUIRED_VISUAL_TESTS[SLICE_SPEC]![0]}"`)
    expect(problems).toContain('ran 2 time(s) in 2 report entry/entries')
  })

  it('fails when one required title has two project executions', () => {
    const report = passingReport()
    const required = reportSpecs(report, REPORTED_WEBGL)[0]!
    required.tests!.push({ status: 'expected', results: [{ status: 'passed' }] })

    expect(auditVisualRun(report, REQUIRED_SPECS).join('\n')).toContain(
      'ran 2 time(s) in 1 report entry/entries',
    )
  })

  it('does not accept the right title from the wrong spec file', () => {
    const report = passingReport()
    const sliceSpecs = reportSpecs(report, REPORTED_SLICE)
    const missing = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![4]!
    const [moved] = sliceSpecs.splice(
      sliceSpecs.findIndex((candidate) => candidate.title === missing),
      1,
    )
    reportSpecs(report, REPORTED_WEBGL).push({ ...moved!, file: REPORTED_WEBGL })

    const problems = auditVisualRun(report, REQUIRED_SPECS).join('\n')
    expect(problems).toContain(`${SLICE_SPEC} > "${missing}"`)
    expect(problems).toContain('ran 0 time(s)')
  })
})

describe('assert-visual-run: the slice comparison configuration contract', () => {
  it.each(SLICE_CONFIGURATION_VALUE_MUTATIONS)(
    'rejects a changed %s even when a comment preserves the old text',
    (_label, needle, replacement, expectedProblem) => {
      const mutated = mutateSource(visualSpecSource(SLICE_SPEC), needle, replacement)
      expect(auditVisualSpecSource(SLICE_SPEC, mutated).join('\n')).toContain(expectedProblem)
    },
  )

  it.each(SLICE_CONFIGURATION_RELATION_MUTATIONS)(
    'rejects a broken %s construction relation',
    (_label, needle, replacement, expectedProblem) => {
      const mutated = mutateSource(visualSpecSource(SLICE_SPEC), needle, replacement)
      expect(auditVisualSpecSource(SLICE_SPEC, mutated).join('\n')).toContain(expectedProblem)
    },
  )

  it('does not let a string literal replace the real changed-pixel ratio', () => {
    const changed = mutateSource(
      visualSpecSource(SLICE_SPEC),
      'maxDiffPixelRatio: 0.001',
      'maxDiffPixelRatio: 1',
    )
    const mutated = `${changed}\nconst comparisonDecoy = 'maxDiffPixelRatio: 0.001'\n`
    expect(auditVisualSpecSource(SLICE_SPEC, mutated).join('\n')).toContain(
      'COMPARISON.maxDiffPixelRatio must be the numeric literal 0.001',
    )
  })

  it('rejects an extra comparison option that can override the pinned budget', () => {
    const mutated = mutateSource(
      visualSpecSource(SLICE_SPEC),
      'maxDiffPixelRatio: 0.001,',
      'maxDiffPixelRatio: 0.001,\n  maxDiffPixels: 1_000_000,',
    )
    expect(auditVisualSpecSource(SLICE_SPEC, mutated).join('\n')).toContain(
      'COMPARISON must contain exactly threshold, maxDiffPixelRatio and timeout',
    )
  })
})

describe('assert-visual-run: assertions omitted from Playwright JSON', () => {
  it('accepts the committed slice and WebGL source', () => {
    expect(auditVisualSpecSource(SLICE_SPEC, visualSpecSource(SLICE_SPEC))).toEqual([])
    expect(auditVisualSpecSource(WEBGL_SPEC, visualSpecSource(WEBGL_SPEC))).toEqual([])
    expect(auditVisualSources(WEB_ROOT)).toEqual([])
  })

  it.each(SLICE_SOURCE_MUTATIONS)(
    'fails when "%s" loses %s',
    (title, needle, replacement, expectedLabel) => {
      const mutated = mutateInsideTest(visualSpecSource(SLICE_SPEC), title, needle, replacement)
      const problems = auditVisualSpecSource(SLICE_SPEC, mutated)
      expect(problems).toEqual([
        expect.stringContaining(expectedLabel) as unknown as string,
      ])
    },
  )

  it.each(WEBGL_SOURCE_MUTATIONS)(
    'fails when the WebGL assertion subject %s is removed',
    (needle, replacement, expectedLabel) => {
      const title = REQUIRED_VISUAL_TESTS[WEBGL_SPEC]![0]!
      const mutated = mutateInsideTest(visualSpecSource(WEBGL_SPEC), title, needle, replacement)
      const problems = auditVisualSpecSource(WEBGL_SPEC, mutated)
      expect(problems).toEqual([
        expect.stringContaining(expectedLabel) as unknown as string,
      ])
    },
  )

  it('does not mistake assertion text in a comment for an executable control', () => {
    const title = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![4]!
    const mutated = mutateInsideTest(
      visualSpecSource(SLICE_SPEC),
      title,
      'halfPeriodRejectionOptions()',
      'notAuditedOptions() /* halfPeriodRejectionOptions() */',
    )
    expect(auditVisualSpecSource(SLICE_SPEC, mutated).join('\n')).toContain(
      'half-period negated screenshot control',
    )
  })

  it('rejects a required assertion below a dead conditional', () => {
    const title = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![6]!
    const mutated = mutateInsideTest(
      visualSpecSource(SLICE_SPEC),
      title,
      GEOMETRY_NEGATED_ASSERTION,
      `if (false) ${GEOMETRY_NEGATED_ASSERTION}`,
    )
    const problems = auditVisualSpecSource(SLICE_SPEC, mutated).join('\n')
    expect(problems).toContain('top-level if statement')
    expect(problems).toContain('geometry negated screenshot control')
  })

  it.each(REQUIRED_TEST_CONTROL_FLOW_MUTATIONS)(
    'rejects %s before an otherwise direct required assertion',
    (_label, statement, expectedKind) => {
      const title = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![6]!
      const mutated = mutateInsideTest(
        visualSpecSource(SLICE_SPEC),
        title,
        GEOMETRY_NEGATED_ASSERTION,
        `${statement}\n  ${GEOMETRY_NEGATED_ASSERTION}`,
      )
      expect(auditVisualSpecSource(SLICE_SPEC, mutated)).toEqual([
        expect.stringContaining(`top-level ${expectedKind} statement`) as unknown as string,
      ])
    },
  )

  it('allows return and branching inside a nested helper callback', () => {
    const title = REQUIRED_VISUAL_TESTS[WEBGL_SPEC]![0]!
    const mutated = mutateInsideTest(
      visualSpecSource(WEBGL_SPEC),
      title,
      "await page.goto('/')",
      "await page.goto('/')\n  const nestedHelper = () => { if (true) return; throw new Error('nested') }",
    )
    expect(auditVisualSpecSource(WEBGL_SPEC, mutated)).toEqual([])
  })

  it('rejects a required assertion nested in an uncalled function', () => {
    const title = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![6]!
    const mutated = mutateInsideTest(
      visualSpecSource(SLICE_SPEC),
      title,
      GEOMETRY_NEGATED_ASSERTION,
      `const neverCalled = async () => {\n    ${GEOMETRY_NEGATED_ASSERTION}\n  }`,
    )
    expect(auditVisualSpecSource(SLICE_SPEC, mutated)).toEqual([
      expect.stringContaining('geometry negated screenshot control') as unknown as string,
    ])
  })

  it('rejects a required assertion nested in an unawaited callback', () => {
    const title = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![6]!
    const mutated = mutateInsideTest(
      visualSpecSource(SLICE_SPEC),
      title,
      GEOMETRY_NEGATED_ASSERTION,
      `void (async () => {\n    ${GEOMETRY_NEGATED_ASSERTION}\n  })()`,
    )
    expect(auditVisualSpecSource(SLICE_SPEC, mutated)).toEqual([
      expect.stringContaining('geometry negated screenshot control') as unknown as string,
    ])
  })

  it('rejects a top-level screenshot assertion that is not awaited', () => {
    const title = REQUIRED_VISUAL_TESTS[SLICE_SPEC]![6]!
    const mutated = mutateInsideTest(
      visualSpecSource(SLICE_SPEC),
      title,
      GEOMETRY_NEGATED_ASSERTION,
      GEOMETRY_NEGATED_ASSERTION.replace(/^await /, ''),
    )
    expect(auditVisualSpecSource(SLICE_SPEC, mutated)).toEqual([
      expect.stringContaining('geometry negated screenshot control') as unknown as string,
    ])
  })

  it('requires the WebGL assertions to be direct and awaited too', () => {
    const title = REQUIRED_VISUAL_TESTS[WEBGL_SPEC]![0]!
    const mutated = mutateInsideTest(
      visualSpecSource(WEBGL_SPEC),
      title,
      'await expect(\n    report.supported,',
      'expect(\n    report.supported,',
    )
    expect(auditVisualSpecSource(WEBGL_SPEC, mutated)).toEqual([
      expect.stringContaining('WebGL2 availability assertion') as unknown as string,
    ])
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
      // Named in the message by the spelling the REPORT used, because that is
      // the string a reader will search the report for.
      expect(problems[0]).toContain(REPORTED_WEBGL)
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
    // A report carrying only webgl, in the reporter's own shape, against an
    // expectation of both. The slice spec is genuinely missing -- which is the
    // state this block is for, and is NOT the same thing as a slice spec that
    // ran under a different spelling.
    const report = passingReport(REPORTED_WEBGL)
    const problems = auditVisualRun(report, [WEBGL_SPEC, SLICE_SPEC])
    // Named by the EXPECTED spelling: nothing in the report mentions it, so the
    // reporter's spelling of it is not available to be printed.
    expect(problems).toEqual([expect.stringContaining(SLICE_SPEC) as unknown as string])
    expect(problems[0]).toContain('not run')
  })

  // Both other spellings of the same file stay acceptable. The gate matches a
  // testDir-relative path against a web-root-relative expectation, so it must
  // not thereby stop accepting the web-root-relative spelling it was written
  // for -- a future reporter change, or another tool feeding it a report, can
  // legitimately produce either.
  it.each([
    ['the web-root-relative spelling', 'e2e/webgl.spec.ts'],
    ['a Windows path with backslashes', 'e2e\\webgl.spec.ts'],
    ['the testDir-relative spelling Playwright actually writes', REPORTED_WEBGL],
  ] as const)('accepts %s', (_label, file) => {
    const report = passingReport()
    report.suites![0]!.suites![0]!.specs![0]!.file = file
    expect(auditVisualRun(report, [WEBGL_SPEC])).toEqual([])
  })

  // ...and strictness is not lost in the process: stripping the testDir segment
  // must not degrade into matching on basename, or a spec of the same name from
  // any other directory would satisfy an expectation it has nothing to do with.
  it('does not accept a same-named spec from some other directory', () => {
    const report = passingReport()
    report.suites![0]!.suites![0]!.specs![0]!.file = 'other/webgl.spec.ts'
    const problems = auditVisualRun(report, [WEBGL_SPEC])
    expect(problems).toEqual([expect.stringContaining(WEBGL_SPEC) as unknown as string])
    expect(problems[0]).toContain('not run')
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
  // Discovery is compared with the closed manifest rather than used AS the
  // expectation. Otherwise deleting a file would delete its requirement too.
  it('lists the committed e2e spec files', () => {
    const discovered = listVisualSpecFiles(WEB_ROOT)
    expect(discovered).toEqual([SLICE_SPEC, WEBGL_SPEC])
    expect(discovered).toEqual(REQUIRED_SPECS)
    expect(auditVisualSpecInventory(discovered)).toEqual([])
  })

  it('fails when a manifest spec is absent from disk', () => {
    expect(auditVisualSpecInventory([WEBGL_SPEC]).join('\n')).toContain(
      `${SLICE_SPEC}: found 0 time(s)`,
    )
  })

  it('fails an unmanifested extra spec instead of silently treating it as coverage', () => {
    expect(auditVisualSpecInventory([...REQUIRED_SPECS, 'e2e/extra.spec.ts']).join('\n')).toContain(
      'e2e/extra.spec.ts: unmanifested visual spec',
    )
  })

  it('does not accept the right basename from a nested path', () => {
    const problems = auditVisualSpecInventory([
      WEBGL_SPEC,
      'e2e/other/slice.spec.ts',
    ]).join('\n')
    expect(problems).toContain(`${SLICE_SPEC}: found 0 time(s)`)
    expect(problems).toContain('e2e/other/slice.spec.ts: unmanifested visual spec')
  })
})
