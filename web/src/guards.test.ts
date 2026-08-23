/**
 * Suite-integrity guards: the web counterpart of the Python conftest that
 * fails the session on any skipped test.
 *
 * Two things can make `npm run test` report green while measuring less than
 * it claims:
 *
 *   1. A committed skip / todo / focus / conditional-run modifier on a runner
 *      call in a spec. `allowOnly: false` in vitest.config.ts already refuses
 *      the focus form at run time; skips and todos are merely reported as
 *      "skipped" and do not fail the run on their own.
 *   2. A coverage pragma (the v8 / c8 / istanbul / node:coverage "ignore
 *      next|start|else", "disable|enable" comment forms) in a gated source
 *      module, which carves lines out of the per-file threshold without any
 *      test exercising them.
 *
 * Skips are gated twice, and the two layers have different jobs:
 *
 *   - The authoritative gate is `scripts/assert-no-skips.mjs`, which `npm test`
 *     runs against vitest's own JSON result file after the run. Whatever a
 *     skip was spelled as (a modifier chained through `.concurrent` or
 *     `.sequential`, a bracket-indexed modifier, a modifier destructured off
 *     the runner, an aliased runner, or a runtime call on the test context
 *     inside the test body), the runner reports it as a non-passed test, and
 *     the gate fails on any such test, any spec file the runner never visited,
 *     and any summary counter that disagrees with "everything passed". Its
 *     audit logic is exercised below with synthetic result fixtures.
 *   - The source scan in this file is the secondary guard: it cannot see every
 *     spelling (an aliased runner carrying `todo` defeats it), but when it
 *     does hit it points at the exact line, which the JSON gate cannot. It
 *     covers the chained, bracket-indexed, destructured and runtime-context
 *     forms as well as the plain `runner.modifier` one.
 *
 * Plain `node:fs`, no DOM: this walks the committed tree and greps it. The
 * patterns are assembled from fragments at runtime so this file never contains
 * the literal tokens it forbids and therefore cannot trip itself (it is a
 * `.test.ts` under src/, so it is inside its own scan).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  auditRun,
  listSpecFiles,
  type VitestAssertionResult,
  type VitestFileResult,
  type VitestJsonResults,
} from '../scripts/assert-no-skips.mjs'

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url))
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Every file under src/, as a posix-style path relative to src/. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else {
      out.push(relative(SRC_ROOT, full).split(sep).join('/'))
    }
  }
  return out.sort()
}

const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.tsx?$/
const isTestFile = (path: string): boolean => TEST_FILE.test(path)

/**
 * Mirrors `coverage.include` / `coverage.exclude` in vitest.config.ts: the
 * .ts modules under src/api/ and src/scene/ at any depth, minus the GLSL
 * string modules in src/scene/shaders/ and minus the tests themselves.
 * types.ts is excluded from the coverage *thresholds* there but is still
 * scanned here: a pragma in it would be pointless, and pointless pragmas are
 * the kind that get copy-pasted into a gated file next.
 */
const isGatedSource = (path: string): boolean =>
  /^(api|scene)\/.*\.ts$/.test(path) && !path.startsWith('scene/shaders/') && !isTestFile(path)

// Fragments, joined at runtime, so that this file never spells out a token it
// forbids. Each list is a positive control below, asserted against the very
// regex built from it.
const RUNNER_NAMES = ['it', 'test', 'describe', 'suite', 'bench']
const SKIP = 'sk' + 'ip'
const TODO = 'to' + 'do'
const MODIFIER_NAMES = [SKIP, 'on' + 'ly', TODO, SKIP + 'If', 'run' + 'If']
// `node:coverage` is Node's own test-runner spelling, but the v8-to-istanbul
// bundled in @vitest/coverage-v8 honours it too (`ignore next [N]` and the
// `disable` ... `enable` pair); ast-v8-to-istanbul additionally honours its
// `ignore start|stop|if|else|file`. The verb list is the union of every
// pragma verb any of those remappers understands.
//
// `|8` is not a tool: v8-to-istanbul spells its start/stop regex `[c|v]8`,
// a character class in which the `|` is a literal, so `/* |8 ignore start */`
// is honoured by the remapper like `v8`. It is matched without the `\b` the
// word-like names get (a `|` has no word boundary after a space).
const PRAGMA_TOOLS = ['v8', 'c8', 'istan' + 'bul', 'node:cov' + 'erage']
const PRAGMA_TOOL_QUIRKS = ['\\|8']
const PRAGMA_VERB = 'ig' + 'nore'
const PRAGMA_VERBS = [PRAGMA_VERB, 'dis' + 'able', 'en' + 'able']

const RUNNERS = RUNNER_NAMES.join('|')
const MODIFIERS = MODIFIER_NAMES.join('|')
/** `.concurrent`, `.sequential`, `['concurrent']`, ...: any chain between runner and modifier. */
const CHAIN = `(?:\\.\\w+|\\[['"\`]\\w+['"\`]\\])*`
/** The modifier itself, as `.name` or as `['name']` / `["name"]` / `` [`name`] ``. */
const MEMBER = `(?:\\.(?:${MODIFIERS})\\b|\\[['"\`](?:${MODIFIERS})['"\`]\\])`

/**
 * Any runner name (`it`, `describe`, ...) followed by a forbidden modifier,
 * either directly, through a chain of other members (`.concurrent`,
 * `.sequential`), or as a bracket-indexed property, with or without a
 * trailing `(` or `.each(`.
 */
const MODIFIER_PATTERN = new RegExp(`\\b(?:${RUNNERS})${CHAIN}${MEMBER}`)
/** A modifier pulled off a runner by destructuring: `{ name } = test`, `{ name: alias } = it`. */
const DESTRUCTURE_PATTERN = new RegExp(
  `\\{[^}]*\\b(?:${MODIFIERS})\\b[^}]*\\}\\s*=\\s*(?:${RUNNERS})\\b`,
)
/**
 * The runtime form: a call named like the skip modifier on any receiver
 * (`context`, `ctx`, `t`, ...) inside a test body. vitest's test context
 * exposes exactly that method, and it marks the running test as skipped.
 */
const RUNTIME_SKIP_PATTERN = new RegExp(`\\.${SKIP}\\s*\\(`)
const FORBIDDEN_TEST_PATTERNS = [MODIFIER_PATTERN, DESTRUCTURE_PATTERN, RUNTIME_SKIP_PATTERN]
const matchesForbiddenTestForm = (line: string): boolean =>
  FORBIDDEN_TEST_PATTERNS.some((pattern) => pattern.test(line))
/** `<tool> <verb> ...` for each tool in PRAGMA_TOOLS (+ quirks) and verb in PRAGMA_VERBS, any casing. */
const PRAGMA_PATTERN = new RegExp(
  `(?:\\b(?:${PRAGMA_TOOLS.join('|')})|${PRAGMA_TOOL_QUIRKS.join('|')})\\s+(${PRAGMA_VERBS.join('|')})\\b`,
  'i',
)

interface Hit {
  file: string
  line: number
  text: string
}

function scan(files: string[], matches: (line: string) => boolean): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    const lines = readFileSync(join(SRC_ROOT, file), 'utf-8').split('\n')
    lines.forEach((text, index) => {
      if (matches(text)) {
        hits.push({ file, line: index + 1, text: text.trim() })
      }
    })
  }
  return hits
}

const describeHits = (hits: Hit[]): string =>
  hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n')

const allFiles = walk(SRC_ROOT)
const testFiles = allFiles.filter(isTestFile)
const gatedSources = allFiles.filter(isGatedSource)

describe('guard patterns (positive controls)', () => {
  // If a fragment join ever produced a regex that matches nothing, the scans
  // below would pass vacuously. Pin that each forbidden form is recognised.
  it.each(
    RUNNER_NAMES.flatMap((runner) =>
      MODIFIER_NAMES.map((modifier) => [`${runner}.${modifier}`] as const),
    ),
  )('recognises %s as a forbidden test modifier', (form) => {
    expect(MODIFIER_PATTERN.test(`  ${form}('case', () => {})`)).toBe(true)
    expect(MODIFIER_PATTERN.test(`  ${form}.each([1])('case %i', () => {})`)).toBe(true)
  })

  // The spellings an external review found the plain `runner.modifier` regex
  // missing, each of which vitest 3.2.7 honours as a real skip / todo.
  it.each([
    [`it.concurrent.${SKIP}('case', () => {})`],
    [`describe.sequential.${SKIP}('block', () => {})`],
    [`it.concurrent.${TODO}('case')`],
    [`it['${SKIP}']('case', () => {})`],
    [`it["${TODO}"]('case')`],
    [`test[\`${SKIP}If\`](flag)('case', () => {})`],
    [`it['concurrent'].${SKIP}('case', () => {})`],
  ])('recognises the chained / bracket-indexed form %s', (line) => {
    expect(matchesForbiddenTestForm(line)).toBe(true)
  })

  it.each([
    [`const { ${SKIP} } = test`],
    [`const { ${SKIP}: pending } = it`],
    [`const { each, ${TODO} } = describe`],
    [`let { ${SKIP} }=test`],
  ])('recognises the destructured form %s', (line) => {
    expect(matchesForbiddenTestForm(line)).toBe(true)
  })

  it.each([
    [`it('case', (context) => { context.${SKIP}() })`],
    [`    ctx.${SKIP}('not on this platform')`],
    [`    t.${SKIP} ()`],
  ])('recognises the runtime test-context form %s', (line) => {
    expect(matchesForbiddenTestForm(line)).toBe(true)
  })

  it('does not flag the ordinary runner forms', () => {
    for (const line of [
      "it('case', () => {})",
      "it.each([1])('case %i', () => {})",
      "describe('block', () => {})",
      "it.concurrent('case', () => {})",
      "it.sequential.each([1])('case %i', () => {})",
      "describe.concurrent('block', () => {})",
      'expect(result.only).toBe(1)',
      '// exposes only the fields a scene consumer needs',
      'const { count, stride } = parsePointCloud(buffer, headers)',
      "const { skipped } = summary('x')",
      "it('keeps every channel inside the unit range', () => {",
    ]) {
      expect(matchesForbiddenTestForm(line), line).toBe(false)
    }
  })

  it.each(
    PRAGMA_TOOLS.flatMap((tool) => [
      [`/* ${tool} ${PRAGMA_VERB} next */`],
      [`/* ${tool} ${PRAGMA_VERB} start */`],
      [`// ${tool.toUpperCase()} ${PRAGMA_VERB.toUpperCase()} else`],
    ]),
  )('recognises %s as a coverage pragma', (form) => {
    expect(PRAGMA_PATTERN.test(form)).toBe(true)
  })

  // Spelled out independently of PRAGMA_TOOLS / PRAGMA_VERBS so that widening
  // those lists can never make this control pass by construction. These are
  // the exact forms the bundled v8-to-istanbul in @vitest/coverage-v8 3.2.7
  // honours (`_parseIgnore`): `node:coverage ignore next [N]` and the
  // `node:coverage disable` ... `enable` pair, both of which hid an untested
  // function in scene/color.ts at "100%" while the old guard stayed green.
  it.each([
    [`/* node:cov${'erage'} ig${'nore'} next */`],
    [`/* node:cov${'erage'} ig${'nore'} next 3 */`],
    [`/* node:cov${'erage'} ig${'nore'} start */`],
    [`/* node:cov${'erage'} ig${'nore'} stop */`],
    [`/* node:cov${'erage'} dis${'able'} */`],
    [`/* node:cov${'erage'} en${'able'} */`],
    [`// NODE:COV${'ERAGE'} IG${'NORE'} file`],
  ])('recognises %s as a coverage pragma (node:coverage family)', (form) => {
    expect(PRAGMA_PATTERN.test(form)).toBe(true)
  })

  // The bundled v8-to-istanbul spells its start/stop regex `[c|v]8`, a
  // character class that also matches a literal `|`: `/* |8 ignore start */`
  // is honoured by the coverage remapper exactly like `/* v8 ignore start */`,
  // and it hid an untested function at "100%" while the tool list here only
  // knew c8 and v8.
  it.each([
    [`/* |8 ig${'nore'} start */`],
    [`/* |8 ig${'nore'} stop */`],
    [`const x = 1 /* |8 ig${'nore'} start */`],
  ])('recognises %s as a coverage pragma (the [c|v]8 regex quirk)', (form) => {
    expect(PRAGMA_PATTERN.test(form)).toBe(true)
  })

  it('does not flag prose that merely mentions the tools', () => {
    expect(PRAGMA_PATTERN.test("provider: 'v8',")).toBe(false)
    expect(PRAGMA_PATTERN.test(`// ${PRAGMA_VERB} the v8 provider here`)).toBe(false)
    expect(PRAGMA_PATTERN.test('// honours the node:coverage pragma family')).toBe(false)
    expect(PRAGMA_PATTERN.test('const mask = flags | 8')).toBe(false)
    expect(PRAGMA_PATTERN.test(`if (a || 8) ${PRAGMA_VERB}s(b)`)).toBe(false)
  })
})

describe('scan scope', () => {
  it('includes this guard file and every committed spec', () => {
    expect(testFiles).toContain('guards.test.ts')
    expect(testFiles).toContain('api/qvpc.test.ts')
    expect(testFiles).toContain('api/client.test.ts')
    expect(testFiles).toContain('scene/color.test.ts')
  })

  it('covers the coverage-gated modules and nothing that is excluded on purpose', () => {
    expect(gatedSources).toContain('api/qvpc.ts')
    expect(gatedSources).toContain('api/client.ts')
    expect(gatedSources).toContain('scene/color.ts')
    expect(gatedSources).not.toContain('scene/shaders/orbitalPoints.ts')
    expect(gatedSources).not.toContain('api/qvpc.test.ts')
    expect(gatedSources.some((path) => path.endsWith('.tsx'))).toBe(false)
  })

  it('keeps the HTTP layer inside the coverage include (no .tsx under api/)', () => {
    // `coverage.include` is `src/api/**/*.ts`; a `.tsx` module under api/
    // would carry runtime code outside every per-file threshold. The API
    // layer has no JSX, so any such file is a scope leak, not a component.
    const leaked = allFiles.filter((path) => path.startsWith('api/') && path.endsWith('.tsx'))
    expect(leaked, 'runtime modules outside the coverage include').toEqual([])
  })
})

describe('committed suite integrity', () => {
  it('has no skipped, todo, focused or conditionally-run tests', () => {
    const hits = scan(testFiles, matchesForbiddenTestForm)
    expect(hits, `forbidden test modifiers:\n${describeHits(hits)}`).toEqual([])
  })

  it('has no coverage-ignore pragmas in gated source modules', () => {
    const hits = scan(gatedSources, (line) => PRAGMA_PATTERN.test(line))
    expect(hits, `coverage pragmas inside gated modules:\n${describeHits(hits)}`).toEqual([])
  })
})

describe('result gate (scripts/assert-no-skips.mjs)', () => {
  // Build the vitest JSON reporter shape by hand. Real output (vitest 3.2.7)
  // reports `success: true` and file status "passed" even when every test in
  // the file was skipped, so the gate must read the per-test statuses and the
  // summary counters, never the top-level verdict.
  const test = (
    fullName: string,
    status: VitestAssertionResult['status'] = 'passed',
  ): VitestAssertionResult => ({ fullName, status, failureMessages: [] })

  const file = (
    spec: string,
    tests: VitestAssertionResult[],
    status: VitestFileResult['status'] = 'passed',
  ): VitestFileResult => ({
    // vitest writes absolute, forward-slash paths on every platform.
    name: `${WEB_ROOT.split(sep).join('/')}${spec}`,
    status,
    assertionResults: tests,
  })

  const summary = (files: VitestFileResult[]): VitestJsonResults => {
    const tests = files.flatMap((entry) => entry.assertionResults)
    const count = (status: string): number => tests.filter((t) => t.status === status).length
    return {
      success: count('failed') === 0,
      numTotalTests: tests.length,
      numPassedTests: count('passed'),
      numFailedTests: count('failed'),
      numPendingTests: count('skipped') + count('pending'),
      numTodoTests: count('todo'),
      numPendingTestSuites: 0,
      numFailedTestSuites: 0,
      testResults: files,
    }
  }

  const specs = ['src/a.test.ts', 'src/nested/b.test.ts']
  const cleanRun = (): VitestFileResult[] => [
    file('src/a.test.ts', [test('a one'), test('a two')]),
    file('src/nested/b.test.ts', [test('b one')]),
  ]

  it('lists exactly the spec files this guard scans, as web-root-relative posix paths', () => {
    expect(listSpecFiles(WEB_ROOT)).toEqual(testFiles.map((path) => `src/${path}`))
    expect(listSpecFiles(WEB_ROOT)).toContain('src/guards.test.ts')
  })

  it('accepts a run where every expected spec ran and every test passed', () => {
    expect(auditRun(summary(cleanRun()), specs, WEB_ROOT)).toEqual([])
  })

  it('accepts backslash file names from a Windows-style reporter path', () => {
    const files = cleanRun()
    files[0].name = files[0].name.split('/').join('\\')
    expect(auditRun(summary(files), specs, WEB_ROOT)).toEqual([])
  })

  it.each(['skipped', 'todo', 'pending', 'failed'] as const)(
    'rejects a test whose status is %s, naming the file and the test',
    (status) => {
      const files = cleanRun()
      files[1].assertionResults.push(test('b hidden', status))
      const problems = auditRun(summary(files), specs, WEB_ROOT)
      expect(problems.join('\n')).toContain('src/nested/b.test.ts')
      expect(problems.join('\n')).toContain('b hidden')
      expect(problems.join('\n')).toContain(status)
    },
  )

  it('rejects a run in which an expected spec file was never visited', () => {
    const files = cleanRun().slice(0, 1)
    const problems = auditRun(summary(files), specs, WEB_ROOT)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/nested/b.test.ts')
    expect(problems[0]).toContain('not run')
  })

  it('rejects a file whose status is not passed even when its tests are', () => {
    const files = cleanRun()
    files[0].status = 'failed'
    const problems = auditRun(summary(files), specs, WEB_ROOT)
    expect(problems.join('\n')).toContain('src/a.test.ts')
    expect(problems.join('\n')).toContain('failed')
  })

  it('rejects a file that ran zero tests', () => {
    const files = cleanRun()
    files[1].assertionResults = []
    const problems = auditRun(summary(files), specs, WEB_ROOT)
    expect(problems.join('\n')).toContain('src/nested/b.test.ts')
    expect(problems.join('\n')).toContain('zero tests')
  })

  it('rejects summary counters that disagree with the per-test list', () => {
    // Every listed test passed, but the reporter claims a pending one exists:
    // the two views must agree, so the gate trusts neither alone.
    const results = { ...summary(cleanRun()), numPendingTests: 1 }
    expect(auditRun(results, specs, WEB_ROOT).join('\n')).toContain('numPendingTests')
    const todo = { ...summary(cleanRun()), numTodoTests: 2 }
    expect(auditRun(todo, specs, WEB_ROOT).join('\n')).toContain('numTodoTests')
  })

  it('rejects a run with no tests at all, or one the reporter itself marked unsuccessful', () => {
    expect(auditRun(summary([]), [], WEB_ROOT).join('\n')).toContain('numTotalTests')
    const unsuccessful = { ...summary(cleanRun()), success: false }
    expect(auditRun(unsuccessful, specs, WEB_ROOT).join('\n')).toContain('success')
  })

  it('rejects a missing or malformed result document instead of passing vacuously', () => {
    expect(auditRun({}, specs, WEB_ROOT).length).toBeGreaterThan(0)
    expect(auditRun({ testResults: [] }, specs, WEB_ROOT).join('\n')).toContain('not run')
  })
})
