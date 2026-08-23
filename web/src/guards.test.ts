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
 *   2. A coverage pragma (the v8 / c8 / istanbul "ignore next|start|else"
 *      comment forms) in a gated source module, which carves lines out of the per-file threshold
 *      without any test exercising them.
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

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url))

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
 * client.ts and types.ts are excluded from the coverage *thresholds* there but
 * are still scanned here: a pragma in either would be pointless, and pointless
 * pragmas are the kind that get copy-pasted into a gated file next.
 */
const isGatedSource = (path: string): boolean =>
  /^(api|scene)\/.*\.ts$/.test(path) && !path.startsWith('scene/shaders/') && !isTestFile(path)

// Fragments, joined at runtime, so that this file never spells out a token it
// forbids. Each list is a positive control below, asserted against the very
// regex built from it.
const RUNNER_NAMES = ['it', 'test', 'describe', 'suite', 'bench']
const MODIFIER_NAMES = ['sk' + 'ip', 'on' + 'ly', 'to' + 'do', 'skip' + 'If', 'run' + 'If']
// `node:coverage` is Node's own test-runner spelling, but the v8-to-istanbul
// bundled in @vitest/coverage-v8 honours it too (`ignore next [N]` and the
// `disable` ... `enable` pair); ast-v8-to-istanbul additionally honours its
// `ignore start|stop|if|else|file`. The verb list is the union of every
// pragma verb any of those remappers understands.
const PRAGMA_TOOLS = ['v8', 'c8', 'istan' + 'bul', 'node:cov' + 'erage']
const PRAGMA_VERB = 'ig' + 'nore'
const PRAGMA_VERBS = [PRAGMA_VERB, 'dis' + 'able', 'en' + 'able']

/**
 * Any runner name (`it`, `describe`, ...) immediately followed by `.` and a
 * forbidden modifier, with or without a trailing `(` or `.each(`. The bare
 * `.<modifier>(` forms are covered by the same regex because a modifier is
 * always written on a runner name.
 */
const MODIFIER_PATTERN = new RegExp(
  `\\b(${RUNNER_NAMES.join('|')})\\.(${MODIFIER_NAMES.join('|')})\\b`,
)
/** `<tool> <verb> ...` for each tool in PRAGMA_TOOLS and verb in PRAGMA_VERBS, any casing. */
const PRAGMA_PATTERN = new RegExp(
  `\\b(${PRAGMA_TOOLS.join('|')})\\s+(${PRAGMA_VERBS.join('|')})\\b`,
  'i',
)

interface Hit {
  file: string
  line: number
  text: string
}

function scan(files: string[], pattern: RegExp): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    const lines = readFileSync(join(SRC_ROOT, file), 'utf-8').split('\n')
    lines.forEach((text, index) => {
      if (pattern.test(text)) {
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

  it('does not flag the ordinary runner forms', () => {
    for (const line of [
      "it('case', () => {})",
      "it.each([1])('case %i', () => {})",
      "describe('block', () => {})",
      "it.concurrent('case', () => {})",
      'expect(result.only).toBe(1)',
      '// exposes only the fields a scene consumer needs',
    ]) {
      expect(MODIFIER_PATTERN.test(line)).toBe(false)
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

  it('does not flag prose that merely mentions the tools', () => {
    expect(PRAGMA_PATTERN.test("provider: 'v8',")).toBe(false)
    expect(PRAGMA_PATTERN.test(`// ${PRAGMA_VERB} the v8 provider here`)).toBe(false)
    expect(PRAGMA_PATTERN.test('// honours the node:coverage pragma family')).toBe(false)
  })
})

describe('scan scope', () => {
  it('includes this guard file and every committed spec', () => {
    expect(testFiles).toContain('guards.test.ts')
    expect(testFiles).toContain('api/qvpc.test.ts')
    expect(testFiles).toContain('scene/color.test.ts')
  })

  it('covers the coverage-gated modules and nothing that is excluded on purpose', () => {
    expect(gatedSources).toContain('api/qvpc.ts')
    expect(gatedSources).toContain('scene/color.ts')
    expect(gatedSources).not.toContain('scene/shaders/orbitalPoints.ts')
    expect(gatedSources).not.toContain('api/qvpc.test.ts')
    expect(gatedSources.some((path) => path.endsWith('.tsx'))).toBe(false)
  })
})

describe('committed suite integrity', () => {
  it('has no skipped, todo, focused or conditionally-run tests', () => {
    const hits = scan(testFiles, MODIFIER_PATTERN)
    expect(hits, `forbidden test modifiers:\n${describeHits(hits)}`).toEqual([])
  })

  it('has no coverage-ignore pragmas in gated source modules', () => {
    const hits = scan(gatedSources, PRAGMA_PATTERN)
    expect(hits, `coverage pragmas inside gated modules:\n${describeHits(hits)}`).toEqual([])
  })
})
