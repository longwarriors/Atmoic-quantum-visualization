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
import { minimatch } from 'minimatch'
import { describe, expect, it } from 'vitest'

import {
  auditCoverageScope,
  readCoverageScope,
  toWebRelative,
} from '../scripts/assert-coverage-scope.mjs'
import {
  auditRun,
  listSpecFiles,
  type VitestAssertionResult,
  type VitestFileResult,
  type VitestJsonResults,
} from '../scripts/assert-no-skips.mjs'
// `defineConfig` (vitest/dist/config.cjs) is the identity function for a
// plain-object argument, and vitest.config.ts calls it with one, so this
// import is that file's declared config verbatim -- not a copy, not a
// default-merged approximation.
//
// It is NOT vitest's RESOLVED config, and the difference is a hole this file
// cannot see on its own. A CLI flag (`--coverage.include=src/scene/color.ts`),
// a Vite plugin `config()` hook, or an env-driven override changes what
// vitest actually measures while leaving the arrays below untouched: every
// assertion in this file stays green and the coverage table quietly lists one
// module. What closes that is scripts/assert-coverage-scope.mjs, which reads
// the coverage report the run WROTE and checks it against coverage-scope.json
// after vitest exits. Treat the two as a pair -- this import binds the
// derivation to the config source, that script binds the run to the manifest
// -- and do not let either stand alone.
//
// If a future PR switches vitest.config.ts to a config FUNCTION, this import
// becomes a function, `.test` is undefined, and the shape guards in the
// "coverage scope binding" test hard-fail. That is intended. A `projects`
// config does NOT hard-fail them (see that test), which is why their absence
// is asserted explicitly there.
import vitestConfig from '../vitest.config'

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
 * The literal `coverage.include` / `coverage.exclude` arrays vitest.config.ts
 * declares. Deep-equalled against the real, resolved config in the "coverage
 * scope binding" test below: editing either array in vitest.config.ts
 * without a matching, reviewed edit here fails `npm test` instead of
 * silently shrinking what `isCoverageGatedSource` / `isPragmaScannedSource`
 * below (and therefore `scan scope` and the pragma scan in "committed suite
 * integrity") treat as gated.
 *
 * `isCoverageGatedSource` derives its matching from THESE arrays via
 * `minimatch`, not from a separately hand-maintained regex, so there is no
 * second piece of gating logic that could be narrowed independently of what
 * the deep-equal test binds to the live config.
 */
const EXPECTED_COVERAGE_INCLUDE = ['src/api/**/*.ts', 'src/scene/**/*.ts']
const EXPECTED_COVERAGE_EXCLUDE = [
  'src/scene/shaders/**',
  'src/**/*.{test,spec}.{ts,tsx}',
  'src/**/__tests__/**',
  'src/api/types.ts',
]

/**
 * `walk()` paths are posix, relative to src/ (e.g. `api/qvpc.ts`); the
 * coverage patterns above are `src/...`-prefixed, matching how vitest itself
 * matches them (relative to the vitest.config.ts root, one level up from
 * src/). Prepend `src/` to the walked path rather than stripping it from the
 * patterns, so EXPECTED_COVERAGE_INCLUDE / EXPECTED_COVERAGE_EXCLUDE stay
 * byte-for-byte identical to coverage.include / coverage.exclude in
 * vitest.config.ts -- which is what the deep-equal test below compares.
 */
const toConfigPath = (path: string): string => `src/${path}`

/**
 * `dot: true` is not a preference here, it is what the provider does.
 * @vitest/coverage-v8 decides instrumentation through test-exclude@7.0.2,
 * which matches every include / exclude pattern with `{ dot: true }`
 * (node_modules/test-exclude/index.js:97-98) and sweeps the tree for
 * `coverage.all` with `dot: true` as well (ibid. 107, 121). minimatch
 * defaults to `dot: false`, under which a leading-dot segment matches no `*`
 * or globstar -- so with the default this derivation disagreed with the
 * provider on precisely the paths an author chooses freely. A hidden module
 * such as `src/api/.hidden.ts` was instrumented by vitest yet fell outside
 * `pragmaScannedSources` here, so it was never scanned for coverage-ignore
 * pragmas; and a whole-file pragma leaves zero coverable statements, which
 * the per-file threshold does not trip on either (measured: such a file
 * reports 0/0/0/0 and the run still exits 0). Nothing went red. Do not
 * "simplify" this back to a bare `minimatch(path, pattern)`; the hidden-path
 * regressions in "scan scope" below pin it.
 *
 * `nocase: false` is already minimatch's default and is stated only to keep
 * it that way: test-exclude passes no case option either, so matching is
 * case-sensitive on every platform, and this derivation must never end up
 * more permissive than the provider it models.
 */
const MINIMATCH_OPTIONS = { dot: true, nocase: false } as const
const matchesAnyPattern = (patterns: string[], path: string): boolean =>
  patterns.some((pattern) => minimatch(path, pattern, MINIMATCH_OPTIONS))

/**
 * A pattern with no glob metacharacter whose last segment carries no
 * extension -- i.e. one that reads as a bare directory. test-exclude rewrites
 * those (`prepGlobPatterns`, index.js:133-147) into the pattern PLUS the
 * pattern with a globstar appended, so files inside the directory match; a
 * plain `some(minimatch)` over the literal pattern, which is all this file
 * does, matches only the directory entry itself. Asserted against below so an
 * unsupported form goes red instead of being silently mis-derived.
 */
const looksLikeBareDirectory = (pattern: string): boolean => {
  if (/[*?[\]{}]/.test(pattern)) {
    return false
  }
  const lastSegment = pattern.split('/').pop() ?? ''
  return !lastSegment.includes('.')
}

/**
 * A .ts module that vitest's coverage instruments and holds to its per-file
 * threshold: matches some EXPECTED_COVERAGE_INCLUDE pattern and no
 * EXPECTED_COVERAGE_EXCLUDE pattern. EXACTLY include-minus-exclude, and
 * deliberately nothing more -- this predicate has to be able to go wrong the
 * same way the provider would.
 *
 * It used to carry a third term, `&& !isTestFile(path)`. That looked like
 * defence in depth and worked as a mask: had the spec-file exclude pattern
 * been narrowed (say to `.spec.` only), the provider would have started
 * instrumenting every `.test.ts`, while this predicate went on producing the
 * correct gated set because the extra term re-excluded them behind its back.
 * The check is kept, promoted to an INDEPENDENT invariant: "excludes every
 * committed spec file through a canonical exclude pattern" below asserts each
 * path in `testFiles` is caught by one of EXPECTED_COVERAGE_EXCLUDE's own
 * patterns. Same depth, but a broken glob now fails loudly there instead of
 * being absorbed here.
 *
 * Verified below against coverage-scope.json, not just spot-checked, so a
 * glob-semantics surprise (globstar matching zero segments, brace expansion,
 * dotfile handling) is caught in-suite rather than silently mis-gating.
 */
const isCoverageGatedSource = (path: string): boolean => {
  const configPath = toConfigPath(path)
  return (
    matchesAnyPattern(EXPECTED_COVERAGE_INCLUDE, configPath) &&
    !matchesAnyPattern(EXPECTED_COVERAGE_EXCLUDE, configPath)
  )
}

/**
 * Coverage-gated sources, plus src/api/types.ts: excluded from the coverage
 * *thresholds* (type-only, no runtime statements) but still scanned for
 * coverage-ignore pragmas on purpose -- a pointless pragma there is the kind
 * that gets copy-pasted into a gated file next.
 */
const isPragmaScannedSource = (path: string): boolean =>
  isCoverageGatedSource(path) || path === 'api/types.ts'

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

/**
 * The expected file lists, read from coverage-scope.json -- the ONE manifest
 * two independent checks hold themselves to:
 *
 *   - this file asserts the minimatch derivation above produces exactly
 *     `coverageGated` / `pragmaScanned` (derivation vs manifest);
 *   - scripts/assert-coverage-scope.mjs, run by `npm test` after vitest,
 *     asserts the coverage report that run actually WROTE lists exactly
 *     `coverageGated` (runtime vs manifest).
 *
 * Deliberately not a second hand-maintained array in this file: two mirrors
 * of the same list drift, and the one that drifts is never the one anybody
 * reads. Read with the gate script's own shape-checking reader rather than a
 * JSON import, so the manifest cannot be malformed or empty in a way that
 * makes either check pass vacuously, and so `npm test` fails the same way
 * whichever check hits it first.
 *
 * The canonical EXPECTED_COVERAGE_INCLUDE / EXPECTED_COVERAGE_EXCLUDE arrays
 * above stay literal and stay here on purpose: they are what the deep-equal
 * against vitest.config.ts compares, and sourcing them from shared config
 * would turn that cross-check into a tautology.
 */
const COVERAGE_SCOPE = readCoverageScope(WEB_ROOT)

const allFiles = walk(SRC_ROOT)
const testFiles = allFiles.filter(isTestFile)
const coverageGatedSources = allFiles.filter(isCoverageGatedSource)
const pragmaScannedSources = allFiles.filter(isPragmaScannedSource)

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

  it('coverage-gates exactly the modules coverage-scope.json lists, and nothing excluded on purpose', () => {
    // Pinned against the whole manifest, not just spot-checked with
    // toContain/not.toContain: a glob-semantics surprise would otherwise have
    // to be caught one file at a time by the assertions below instead of
    // failing here directly. The same manifest is what
    // scripts/assert-coverage-scope.mjs holds the real run to, so a new gated
    // module has to be added here, deliberately, by a human.
    expect(coverageGatedSources.map(toConfigPath)).toEqual(COVERAGE_SCOPE.coverageGated)

    expect(coverageGatedSources).toContain('api/qvpc.ts')
    expect(coverageGatedSources).toContain('api/client.ts')
    expect(coverageGatedSources).toContain('scene/color.ts')
    expect(coverageGatedSources).not.toContain('scene/shaders/orbitalPoints.ts')
    expect(coverageGatedSources).not.toContain('api/qvpc.test.ts')
    expect(coverageGatedSources.some((path) => path.endsWith('.tsx'))).toBe(false)
  })

  it('pragma-scans the coverage-gated modules plus api/types.ts, and nothing else', () => {
    expect(pragmaScannedSources.map(toConfigPath)).toEqual(COVERAGE_SCOPE.pragmaScanned)
    // types.ts is the one file this scan covers that coverage gating does
    // not: excluded from the per-file thresholds, but not from the pragma
    // scan (see the comment on isPragmaScannedSource above).
    expect(isCoverageGatedSource('api/types.ts')).toBe(false)
    expect(isPragmaScannedSource('api/types.ts')).toBe(true)
  })

  it('keeps coverage-scope.json sorted, duplicate-free, and a superset chain', () => {
    // The two toEqual assertions above compare against this manifest in the
    // order walk() produces. A manifest that was unsorted or carried a
    // duplicate would fail them for a reason that has nothing to do with the
    // gate, so pin its shape here where the message says so.
    for (const [field, files] of [
      ['coverageGated', COVERAGE_SCOPE.coverageGated],
      ['pragmaScanned', COVERAGE_SCOPE.pragmaScanned],
    ] as const) {
      expect([...files].sort(), `coverage-scope.json: ${field} is not sorted`).toEqual(files)
      expect(new Set(files).size, `coverage-scope.json: ${field} has duplicates`).toBe(files.length)
    }
    // Every gated module is pragma-scanned; api/types.ts is the one extra,
    // and any second one is a scope decision that needs its own review.
    const gated = new Set<string>(COVERAGE_SCOPE.coverageGated)
    expect(
      COVERAGE_SCOPE.pragmaScanned.filter((file) => !gated.has(file)),
      'coverage-scope.json: pragmaScanned must be coverageGated plus type-only modules',
    ).toEqual(['src/api/types.ts'])
  })

  it('agrees with the coverage provider on hidden paths (test-exclude matches with dot:true)', () => {
    // The gap this closes: test-exclude runs minimatch with `{ dot: true }`
    // (index.js:97-98) and globs the tree with `dot: true` (107, 121), so a
    // hidden module IS instrumented and IS held to a per-file threshold.
    // minimatch's default `dot: false` said otherwise, which left
    // `src/api/.hidden.ts` coverage-gated by vitest but absent from
    // `pragmaScannedSources` -- a coverage-ignore pragma could sit there
    // untouched by the scan, in a file neither manifest listed. Synthetic
    // paths, so this holds whether or not such a file exists on disk.
    expect(isCoverageGatedSource('api/.hidden.ts')).toBe(true)
    expect(isCoverageGatedSource('api/.hidden/x.ts')).toBe(true)
    expect(isCoverageGatedSource('scene/.hidden.ts')).toBe(true)
    expect(isPragmaScannedSource('api/.hidden.ts')).toBe(true)
    // Excludes keep applying to hidden paths for the same reason.
    expect(isCoverageGatedSource('scene/shaders/.hidden.ts')).toBe(false)
    expect(isCoverageGatedSource('api/.hidden.test.ts')).toBe(false)
  })

  it('excludes every committed spec file through a canonical exclude pattern', () => {
    // isCoverageGatedSource is exactly include-minus-exclude; it no longer
    // carries an `isTestFile` term that would mask a narrowed spec-file
    // exclude pattern (see the comment on that predicate). This is that
    // defence, kept as an independent invariant: every spec on disk must be
    // caught by one of EXPECTED_COVERAGE_EXCLUDE's own patterns.
    const leaked = testFiles.filter(
      (path) => !matchesAnyPattern(EXPECTED_COVERAGE_EXCLUDE, toConfigPath(path)),
    )
    expect(leaked, 'spec files no canonical exclude pattern catches').toEqual([])
    expect(coverageGatedSources.filter(isTestFile), 'spec files inside the gated set').toEqual([])
  })

  it('refuses canonical pattern forms this derivation cannot faithfully model', () => {
    // `matchesAnyPattern` is a plain some(minimatch) over the literal
    // patterns. test-exclude is not: it moves negated patterns into a
    // separate `excludeNegated` list applied AFTER the excludes
    // (handleNegation, index.js:60-74), and it rewrites a bare directory
    // pattern into that pattern plus a globstar form (prepGlobPatterns,
    // 133-147). Either would make this derivation quietly disagree with the
    // provider, so refuse them outright rather than mis-derive.
    for (const pattern of [...EXPECTED_COVERAGE_INCLUDE, ...EXPECTED_COVERAGE_EXCLUDE]) {
      expect(
        pattern.startsWith('!'),
        `${pattern}: a negated pattern is applied by test-exclude after the excludes, ` +
          'not as one more some(minimatch) term; this derivation does not model that form',
      ).toBe(false)
      expect(
        looksLikeBareDirectory(pattern),
        `${pattern}: test-exclude expands a bare directory pattern to also match everything ` +
          'beneath it; this derivation matches the literal pattern only. Write it with an ' +
          'explicit trailing globstar',
      ).toBe(false)
    }
    // Positive controls: without these the loop could pass because the helper
    // never returns true, not because the patterns are safe.
    expect(looksLikeBareDirectory('src/scene/shaders')).toBe(true)
    expect(looksLikeBareDirectory('src/scene/shaders/')).toBe(true)
    expect(looksLikeBareDirectory('src/scene/shaders/**')).toBe(false)
    expect(looksLikeBareDirectory('src/api/types.ts')).toBe(false)
  })

  it('keeps the HTTP layer inside the coverage include (no .tsx under api/)', () => {
    // `coverage.include` is `src/api/**/*.ts`; a `.tsx` module under api/
    // would carry runtime code outside every per-file threshold. The API
    // layer has no JSX, so any such file is a scope leak, not a component.
    const leaked = allFiles.filter((path) => path.startsWith('api/') && path.endsWith('.tsx'))
    expect(leaked, 'runtime modules outside the coverage include').toEqual([])
  })

  it('binds the coverage-gated derivation to the real coverage.include / coverage.exclude in vitest.config.ts', () => {
    // `isCoverageGatedSource` derives its matching from EXPECTED_COVERAGE_INCLUDE
    // / EXPECTED_COVERAGE_EXCLUDE via minimatch; nothing before this test made
    // those canonical arrays agree with the config vitest actually runs
    // coverage against. This reads the resolved config object itself (not a
    // re-parsed copy) and fails the moment the two disagree, e.g. a file
    // appended to `coverage.exclude` to drop it from measured coverage
    // without a matching edit to EXPECTED_COVERAGE_EXCLUDE.
    // `test.coverage` is typed as a `provider`-discriminated union (v8 /
    // istanbul / custom), and the `custom` branch has no `include` /
    // `exclude` at all, so TS won't let those fields be read without first
    // narrowing on a `provider` value this file has no reason to hard-code.
    // The cast only widens to "has these two optional fields, of unknown
    // element type"; it does not assert their contents, which is what the
    // shape checks and the two `toEqual` calls below actually verify against
    // runtime data.
    const coverage = vitestConfig.test?.coverage as
      | { include?: unknown; exclude?: unknown }
      | undefined
    // This whole binding depends on vitest.config.ts exporting a PLAIN
    // OBJECT (defineConfig(identity) -- see the comment on the vitestConfig
    // import above). A config FUNCTION does break these two checks, and is
    // meant to: the import is then a function with no `test` property, so
    // `coverage` is undefined and both Array.isArray calls fail loudly here
    // instead of showing up as an inscrutable `toEqual` mismatch below.
    expect(
      Array.isArray(coverage?.include),
      'vitestConfig.test.coverage.include is not an array -- the config shape ' +
        'this binding assumes (a plain object from defineConfig) no longer holds; ' +
        'see the import comment above and redo the binding',
    ).toBe(true)
    expect(
      Array.isArray(coverage?.exclude),
      'vitestConfig.test.coverage.exclude is not an array -- the config shape ' +
        'this binding assumes (a plain object from defineConfig) no longer holds; ' +
        'see the import comment above and redo the binding',
    ).toBe(true)
    // A `projects` (or the legacy `workspace`) config, on the other hand,
    // does NOT fail the two checks above -- top-level `test.coverage` can
    // stay exactly as it is while each project resolves its own test config,
    // leaving the deep-equals below passing against settings vitest no longer
    // runs under. Nothing infers that from shape, so assert it outright.
    const testConfig = vitestConfig.test as { projects?: unknown; workspace?: unknown } | undefined
    const singleProject =
      ' is set. This binding reads ONE top-level test config, and ' +
      'scripts/assert-no-skips.mjs keys a Map by spec file path, which collapses the same ' +
      'spec run under several projects into one entry: both assume a SINGLE project. A ' +
      'browser/projects setup needs a project-aware gate before this assertion is relaxed.'
    expect(testConfig?.projects, `vitestConfig.test.projects${singleProject}`).toBeUndefined()
    expect(testConfig?.workspace, `vitestConfig.test.workspace${singleProject}`).toBeUndefined()
    expect(coverage?.include).toEqual(EXPECTED_COVERAGE_INCLUDE)
    expect(coverage?.exclude).toEqual(EXPECTED_COVERAGE_EXCLUDE)
  })

})

describe('committed suite integrity', () => {
  it('has no skipped, todo, focused or conditionally-run tests', () => {
    const hits = scan(testFiles, matchesForbiddenTestForm)
    expect(hits, `forbidden test modifiers:\n${describeHits(hits)}`).toEqual([])
  })

  it('has no coverage-ignore pragmas in gated source modules', () => {
    const hits = scan(pragmaScannedSources, (line) => PRAGMA_PATTERN.test(line))
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

describe('coverage scope gate (scripts/assert-coverage-scope.mjs)', () => {
  // This gate is the only check that sees the coverage scope the run actually
  // MEASURED rather than the scope vitest.config.ts declares. Its report is
  // coverage/coverage-final.json, whose keys are absolute paths, backslashed
  // on Windows as the v8 provider writes them. Build that shape by hand so
  // the audit logic is exercised on the failure paths too, not only on the
  // happy one a green run happens to produce.
  const absolute = (spec: string): string => `${WEB_ROOT.split(sep).join('/')}${spec}`
  const report = (specs: readonly string[]): Record<string, unknown> =>
    Object.fromEntries(specs.map((spec) => [absolute(spec), { path: absolute(spec) }]))

  const gated = COVERAGE_SCOPE.coverageGated

  it('accepts a report measuring exactly the derived, manifest-listed set', () => {
    // Fed from the DERIVED file list rather than from the manifest, so this
    // pins that the walk-and-minimatch derivation, the absolute-path
    // normalisation in the gate, and the manifest all describe one single
    // list end to end.
    const derived = report(coverageGatedSources.map(toConfigPath))
    expect(auditCoverageScope(derived, gated, WEB_ROOT)).toEqual([])
  })

  it('accepts the backslashed absolute keys the provider writes on Windows', () => {
    const windows = Object.fromEntries(
      gated.map((spec) => [absolute(spec).split('/').join('\\'), {}]),
    )
    expect(auditCoverageScope(windows, gated, WEB_ROOT)).toEqual([])
  })

  it('rejects a run whose measured scope shrank, naming every module that vanished', () => {
    // The bypass this gate exists for: `--coverage.include=src/scene/color.ts`
    // on the command line (or a plugin config() hook) leaves vitest.config.ts
    // byte-for-byte intact, so every other assertion in this file stays green
    // while two modules drop out of coverage AND out of the per-file
    // thresholds that are supposed to hold them at 90%.
    const problems = auditCoverageScope(report(['src/scene/color.ts']), gated, WEB_ROOT)
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toContain('src/api/client.ts')
    expect(problems.join('\n')).toContain('src/api/qvpc.ts')
    expect(problems.join('\n')).toContain('NOT measured')
  })

  it('rejects a module measured but absent from the manifest', () => {
    // The other direction, and the one a hidden file trips: `coverage.all`
    // sweeps the include patterns with dot:true, so src/api/.hidden.ts is
    // instrumented the moment it exists. Not being listed is the failure.
    const problems = auditCoverageScope(report([...gated, 'src/api/.hidden.ts']), gated, WEB_ROOT)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/api/.hidden.ts')
    expect(problems[0]).toContain('NOT in coverage-scope.json')
  })

  it('reports a measured file outside the web root as its own path, not a walk up', () => {
    expect(toWebRelative(WEB_ROOT, absolute('src/api/client.ts'))).toBe('src/api/client.ts')
    expect(toWebRelative(WEB_ROOT, '/elsewhere/x.ts')).toBe('/elsewhere/x.ts')
    expect(auditCoverageScope({ '/elsewhere/x.ts': {} }, gated, WEB_ROOT).join('\n')).toContain(
      '/elsewhere/x.ts',
    )
  })

  it('rejects a missing, malformed or empty report instead of passing vacuously', () => {
    // Each of these is what the gate is handed when coverage was disabled,
    // written with no json reporter, or never run at all. Since
    // scripts/clean-coverage.mjs deletes the previous report before vitest
    // starts, "no report" is the normal shape of a bypass attempt, not an
    // exotic one -- so none of them may audit clean.
    for (const [label, document] of [
      ['undefined', undefined],
      ['null', null],
      ['a string', 'text'],
      ['a number', 42],
      ['an array', []],
      ['an empty object', {}],
    ] as const) {
      expect(
        auditCoverageScope(document, gated, WEB_ROOT).length,
        `audited ${label} clean as a coverage report`,
      ).toBeGreaterThan(0)
    }
  })

  it('refuses to certify any run against an empty or malformed expectation', () => {
    for (const [label, expected] of [
      ['undefined', undefined],
      ['null', null],
      ['an empty array', []],
      ['a bare string', 'src/api/client.ts'],
    ] as const) {
      expect(
        auditCoverageScope(report(gated), expected, WEB_ROOT).length,
        `certified a run against ${label} as the expected manifest`,
      ).toBeGreaterThan(0)
    }
  })

  it('refuses a missing manifest instead of falling back to an empty expectation', () => {
    expect(() => readCoverageScope(join(WEB_ROOT, 'no-such-directory'))).toThrow(
      /coverage-scope\.json/,
    )
    // And the manifest that does exist meets the reader's shape rules, so the
    // throw above is the reader working, not the only path it can take.
    for (const files of [COVERAGE_SCOPE.coverageGated, COVERAGE_SCOPE.pragmaScanned]) {
      expect(files.length).toBeGreaterThan(0)
      expect(files.every((file) => file.startsWith('src/'))).toBe(true)
    }
  })
})
