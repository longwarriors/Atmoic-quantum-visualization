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
  auditCoverageThresholds,
  readCoverageScope,
  summarizeFileCoverage,
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
 * The literal `coverage.thresholds` vitest.config.ts declares. Deep-equalled
 * against the live config below, exactly as the two arrays above are, and
 * against coverage-scope.json's copy -- three carriers pinned to each other,
 * because a threshold nobody checks is the same as no threshold at all.
 *
 * Measured, so this is not a formality: appending a genuinely uncovered
 * exported function to src/scene/color.ts makes vitest print
 * `70.58 | 100 | 75 | 70.58` for it and exit 1. Each of `perFile: true` ->
 * `false`, the four values zeroed, and the whole `thresholds` key deleted
 * makes that same uncovered function pass. All three are edits to
 * vitest.config.ts alone, and until this array existed nothing read the key.
 *
 * This is the config-SOURCE half only. A CLI flag persisted into the `test`
 * script (`--coverage.thresholds.lines=0`) or a plugin `config()` hook doing
 * `delete cfg.test.coverage.thresholds` changes the RESOLVED config and
 * leaves this file byte-identical; scripts/assert-coverage-scope.mjs is what
 * sees those, by recomputing each gated module's real percentages from the
 * report the run wrote. Neither half covers the other's case.
 */
const EXPECTED_COVERAGE_THRESHOLDS = {
  perFile: true,
  statements: 90,
  branches: 85,
  functions: 90,
  lines: 90,
}

/**
 * Extensions Vite resolves and executes as a runtime module.
 *
 * `coverage.include` matches `*.ts` only, so a module under a gated root with
 * any other runtime extension is instrumented by nothing, held to no per-file
 * threshold, and scanned for no coverage pragma. Measured: `src/api/
 * sneaky.mts`, `.cts` and `.js`, each carrying an uncovered exported
 * function, all left `npm test` at exit 0. It composes, too -- move
 * client.ts's body into `src/api/impl.mts` and re-export it and client.ts
 * still reports 100% while the measured file set is unchanged, which would
 * defeat the threshold gate as well.
 */
const RUNTIME_EXTENSION = /\.(?:[mc]?[jt]sx?)$/

/**
 * Per gated root, the runtime extensions a module there may carry. The rule
 * differs by root and the difference is deliberate: `src/scene/**` holds
 * React/three components that need a WebGL/DOM harness this suite does not
 * provide (they are PR-8, see vitest.config.ts), so `.tsx` there is expected;
 * `src/api/**` is plain TypeScript with no JSX, so anything but `.ts` is a
 * scope leak rather than a component.
 */
const ALLOWED_RUNTIME_EXTENSIONS = new Map<string, readonly string[]>([
  ['api', ['.ts']],
  ['scene', ['.ts', '.tsx']],
])

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
 * A web-root-relative posix path as the absolute, forward-slash key vitest
 * writes into its JSON reports. Shared by the two gate-fixture blocks below
 * so both describe the same file the same way.
 */
const absolute = (spec: string): string => `${WEB_ROOT.split(sep).join('/')}${spec}`

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
/**
 * An `export` that can carry runtime code. `export type`, `export interface`
 * and `export declare` are erased by the compiler and emit nothing; every
 * other export form -- `const`, `let`, `var`, `function`, `class`, `enum`,
 * `default`, a plain `export { … }` re-export (which `isolatedModules`
 * requires to be spelled `export type { … }` when it is type-only), and
 * `export * from` -- can. Positive controls below, so widening the negative
 * lookahead cannot make the scan pass by construction.
 */
const VALUE_EXPORT = /^\s*export\s+(?!type\s|interface\s|declare\s)/

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

  it('keeps every runtime module under a gated root inside the coverage include', () => {
    // `coverage.include` matches `*.ts` under api/ and scene/ and nothing
    // else, so ANY other runtime-capable extension parks executable code
    // outside every per-file threshold AND outside the pragma scan --
    // measured for `.mts`, `.cts` and `.js`, each of which left `npm test`
    // green with an uncovered exported function in it. This used to test one
    // extension (`.tsx` under api/), which is the one leak the API layer
    // would never actually use.
    //
    // The gated roots are derived from EXPECTED_COVERAGE_INCLUDE rather than
    // written out again, so a root added to the include patterns must be
    // given an explicit policy here instead of silently going unchecked.
    //
    // Spec files are skipped: they are excluded from coverage on purpose and
    // are not a way in, because vitest collects every one of them and
    // scripts/assert-no-skips.mjs fails a spec file that ran zero tests, so
    // runtime code cannot sit in one unexercised.
    const leaked: string[] = []
    for (const pattern of EXPECTED_COVERAGE_INCLUDE) {
      const root = pattern.split('/')[1]
      const allowed = ALLOWED_RUNTIME_EXTENSIONS.get(root)
      expect(
        allowed,
        `${pattern}: coverage.include gates a root with no entry in ALLOWED_RUNTIME_EXTENSIONS; ` +
          'add one saying which runtime extensions belong there',
      ).toBeDefined()
      for (const path of allFiles) {
        if (!path.startsWith(`${root}/`) || isTestFile(path) || !RUNTIME_EXTENSION.test(path)) {
          continue
        }
        const extension = path.slice(path.lastIndexOf('.'))
        if (!allowed?.includes(extension)) {
          leaked.push(`${path} (${extension} is not gated under ${root}/, ${pattern} matches .ts)`)
        }
      }
    }
    expect(
      leaked,
      'runtime modules Vite will execute but coverage.include does not match: they are held to ' +
        'no per-file threshold and never scanned for coverage pragmas. Rename to .ts, or widen ' +
        'coverage.include and coverage-scope.json in the same reviewed commit',
    ).toEqual([])
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
      | { include?: unknown; exclude?: unknown; thresholds?: unknown }
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
    // The scope above says WHICH modules are measured; this says what
    // measuring them has to prove. Deleting the key is the cheapest of the
    // three source-side bypasses, so its absence must fail as loudly as a
    // wrong value -- an `undefined` here would sail through `toEqual` against
    // a partial object, hence the shape guard first.
    expect(
      coverage?.thresholds !== null &&
        typeof coverage?.thresholds === 'object' &&
        !Array.isArray(coverage?.thresholds),
      'vitestConfig.test.coverage.thresholds is missing or not an object -- vitest enforces ' +
        'no per-file coverage at all without it, and every module below could be at 0%',
    ).toBe(true)
    expect(coverage?.thresholds).toEqual(EXPECTED_COVERAGE_THRESHOLDS)
    // The third carrier: scripts/assert-coverage-scope.mjs enforces the
    // manifest's copy against the run's real numbers, so if that copy could
    // be lowered on its own the runtime half would certify a run this half
    // rejects. All three are now one value.
    expect(
      COVERAGE_SCOPE.thresholds,
      'coverage-scope.json: "thresholds" must equal vitest.config.ts coverage.thresholds -- ' +
        'the runtime gate enforces the manifest copy, so a lower one there would silently ' +
        'become the real threshold',
    ).toEqual(EXPECTED_COVERAGE_THRESHOLDS)
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

  it('keeps the modules coverage excludes as type-only actually type-only', () => {
    // src/api/types.ts sits inside a gated root and is dropped by
    // coverage.exclude, justified there as "type-only, no runtime
    // statements". Nothing enforced that justification: an uncovered exported
    // function added to it leaves `npm test` at exit 0 (measured). It is the
    // same shape as the extension leak the scan-scope test above closes,
    // escaping through the exclude list instead of through a file name, and
    // it composes the same way -- move a gated module's body here and
    // re-export it, and the gated module reports 100% while its real code is
    // measured by nothing and held to no threshold.
    //
    // A value export is what makes that possible, so a value export is what
    // this forbids. It does not forbid a bare top-level side effect, which
    // exports nothing and so cannot host code a gated module calls; if one
    // ever belongs here, the file is no longer type-only and belongs in
    // coverage.include instead.
    const gated = new Set<string>(COVERAGE_SCOPE.coverageGated)
    const typeOnly = COVERAGE_SCOPE.pragmaScanned
      .filter((file) => !gated.has(file))
      .map((file) => file.replace(/^src\//, ''))
    expect(typeOnly.length, 'no type-only module to check -- has the manifest changed?').toBe(1)

    const hits = scan(typeOnly, (line) => VALUE_EXPORT.test(line))
    expect(
      hits,
      'value exports in a module coverage excludes as type-only. Either keep it type-only, or ' +
        `move it into coverage.include and coverage-scope.json:\n${describeHits(hits)}`,
    ).toEqual([])

    // Positive and negative controls: without these the scan could pass
    // because the pattern matches nothing, not because the file is clean.
    for (const line of [
      'export function backdoor(value: number): number {',
      'export const backdoor = (value: number): number => value',
      'export class Backdoor {}',
      'export enum Kind { A }',
      'export default backdoor',
      "export { backdoor } from './client'",
      "export * from './client'",
    ]) {
      expect(VALUE_EXPORT.test(line), line).toBe(true)
    }
    for (const line of [
      "export type BasisKind = 'real' | 'complex'",
      'export interface OrbitalParameters {',
      'export declare const version: string',
      '  n: number',
      '/** Geometry fields shared by the stationary and time-dependent isosurfaces. */',
    ]) {
      expect(VALUE_EXPORT.test(line), line).toBe(false)
    }
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
    expect(COVERAGE_SCOPE.thresholds.perFile).toBe(true)
  })
})

describe('coverage threshold gate (scripts/assert-coverage-scope.mjs)', () => {
  // The gate's other half. Binding the measured file SET to a manifest says
  // which modules were looked at; it says nothing about what looking at them
  // proved, and vitest's own per-file thresholds -- the thing that turns a
  // measured module into a gated one -- live in the RESOLVED config, where a
  // CLI flag or a plugin config() hook can remove them without touching a
  // byte of vitest.config.ts. So this recomputes each gated module's real
  // percentages from the report the run wrote and enforces them here.
  //
  // Which makes the arithmetic below load-bearing: a second, silently
  // divergent implementation of coverage math would be worse than none. It is
  // istanbul-lib-coverage's FileCoverage.toSummary() (lib/file-coverage.js:
  // 351-422), the exact function vitest calls, and the fixtures pin it to
  // numbers vitest itself printed rather than to numbers this file chose.

  /**
   * One coverage-final.json entry in the istanbul shape @vitest/coverage-v8
   * writes: `statementMap` + hit counts in `s` (one statement per source
   * line), one hit count per function in `f`, and one array of per-location
   * hit counts per branch in `b`.
   */
  const coverageEntry = (
    statements: readonly (readonly [line: number, hits: number])[],
    functions: readonly number[] = [],
    branches: readonly (readonly number[])[] = [],
  ): Record<string, unknown> => ({
    path: absolute('src/api/client.ts'),
    statementMap: Object.fromEntries(
      statements.map(([line], index) => [
        index,
        { start: { line, column: 0 }, end: { line, column: 40 } },
      ]),
    ),
    s: Object.fromEntries(statements.map(([, hits], index) => [index, hits])),
    fnMap: Object.fromEntries(
      functions.map((_, index) => [index, { name: `fn${index}`, line: index + 1 }]),
    ),
    f: Object.fromEntries(functions.map((hits, index) => [index, hits])),
    branchMap: Object.fromEntries(
      branches.map((_, index) => [index, { type: 'branch', line: index + 1 }]),
    ),
    b: Object.fromEntries(branches.map((hits, index) => [index, [...hits]])),
  })

  /** `count` statements starting at line `from`, each hit `hits` times. */
  const lines = (from: number, count: number, hits: number): [number, number][] =>
    Array.from({ length: count }, (_, index): [number, number] => [from + index, hits])

  /**
   * THE CONTROL, measured on this tree. Appending one genuinely uncovered
   * exported function to src/scene/color.ts makes vitest print
   *
   *   color.ts  |   70.58 |      100 |      75 |   70.58 | 15-19
   *   ERROR: Coverage for lines (70.58%) does not meet global threshold (90%)
   *
   * and its coverage-final.json entry carries 17 statements of which 12 were
   * hit, 4 functions of which 3 were hit, and 3 fully-hit branches. Those are
   * the counts here, so if this file's arithmetic ever drifts from vitest's
   * it fails on the one row where the difference is already known.
   */
  const control = coverageEntry(
    [...lines(1, 12, 78), ...lines(13, 5, 0)],
    [78, 78, 234, 0],
    [[78], [78], [234]],
  )

  const gated = COVERAGE_SCOPE.coverageGated
  const manifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    coverageGated: gated,
    pragmaScanned: COVERAGE_SCOPE.pragmaScanned,
    thresholds: EXPECTED_COVERAGE_THRESHOLDS,
    ...overrides,
  })
  /** A report in which every gated module carries the same entry. */
  const uniformReport = (entry: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(gated.map((spec) => [absolute(spec), structuredClone(entry)]))
  const covered = coverageEntry([...lines(1, 10, 3)], [3, 3], [[3], [3]])

  it('computes the four percentages vitest itself printed for the control module', () => {
    const summary = summarizeFileCoverage(control)
    expect(summary.statements).toEqual({ total: 17, covered: 12, pct: 70.58 })
    expect(summary.branches).toEqual({ total: 3, covered: 3, pct: 100 })
    expect(summary.functions).toEqual({ total: 4, covered: 3, pct: 75 })
    expect(summary.lines).toEqual({ total: 17, covered: 12, pct: 70.58 })
  })

  it('truncates a percentage the way istanbul does instead of rounding it', () => {
    // 12/17 is 70.588...; istanbul's percent() floors at two decimals, and
    // vitest compares that floored number against the threshold. Rounding
    // here would report 70.59 -- harmless at 90%, but the same drift at a
    // threshold of exactly 70.59 would pass a run vitest fails.
    expect(summarizeFileCoverage(control).statements.pct).toBe(70.58)
    const twoOfThree = summarizeFileCoverage(coverageEntry([...lines(1, 2, 1), ...lines(3, 1, 0)]))
    expect(twoOfThree.statements).toEqual({ total: 3, covered: 2, pct: 66.66 })
  })

  it('folds statements onto the line they start on, keeping the highest count', () => {
    // istanbul derives line coverage from the statement map -- there is no
    // separate line data in the report -- so several statements on one line
    // collapse to one line, covered if any of them was hit. Here: 3
    // statements on 2 lines, one line hit.
    const summary = summarizeFileCoverage(
      coverageEntry([
        [1, 0],
        [1, 5],
        [2, 0],
      ]),
    )
    expect(summary.statements).toEqual({ total: 3, covered: 1, pct: 33.33 })
    expect(summary.lines).toEqual({ total: 2, covered: 1, pct: 50 })
  })

  it('scores an empty metric 100%, which is why an empty gated module is rejected outright', () => {
    // The whole-file-pragma case, and the reason the zero-statement rule
    // below is a separate check rather than a threshold comparison: istanbul
    // returns 100 for 0/0, so a module carved out entirely by a coverage
    // pragma satisfies every threshold vitest has. Measured: such a file
    // reports 0/0/0/0 in the table and the run still exits 0.
    const empty = summarizeFileCoverage(coverageEntry([]))
    for (const metric of ['statements', 'branches', 'functions', 'lines'] as const) {
      expect(empty[metric], `${metric} of a module with nothing in it`).toEqual({
        total: 0,
        covered: 0,
        pct: 100,
      })
    }
    // A module with no branches at all is the same arithmetic and is normal,
    // so the rule keys on statements, not on "any empty metric".
    expect(summarizeFileCoverage(coverageEntry([[1, 1]], [1])).branches.pct).toBe(100)
  })

  it('refuses to score an entry that is not istanbul-shaped, rather than calling it covered', () => {
    // Every one of these would otherwise reduce to "no statements, no
    // functions, no branches" -- which istanbul scores 100% -- so each has to
    // throw. A report this gate cannot read is a failed gate, not a pass.
    for (const [label, entry] of [
      ['undefined', undefined],
      ['null', null],
      ['a string', 'text'],
      ['an array', []],
      ['no statementMap', { s: {}, f: {}, b: {} }],
      ['a non-numeric hit count', { statementMap: {}, s: { 0: 'yes' }, f: {}, b: {} }],
      ['a branch that is not an array', { statementMap: {}, s: {}, f: {}, b: { 0: 4 } }],
      [
        'a statement with no start line',
        { statementMap: { 0: { start: {} } }, s: { 0: 1 }, f: {}, b: {} },
      ],
    ] as const) {
      expect(() => summarizeFileCoverage(entry), `scored ${label} instead of throwing`).toThrow()
    }
  })

  it('accepts a run where every gated module meets every threshold', () => {
    expect(auditCoverageThresholds(uniformReport(covered), manifest(), WEB_ROOT)).toEqual([])
  })

  it('rejects the control module, naming the metric, the numbers and the file', () => {
    // The end-to-end shape of A17/A21: vitest was told not to enforce
    // anything, the scope is untouched, and this is what still fails.
    const problems = auditCoverageThresholds(
      { ...uniformReport(covered), [absolute('src/scene/color.ts')]: control },
      manifest(),
      WEB_ROOT,
    )
    expect(problems).toHaveLength(3)
    const text = problems.join('\n')
    expect(text).toContain('src/scene/color.ts')
    expect(text).toContain('statements 70.58% (12/17)')
    expect(text).toContain('functions 75% (3/4)')
    expect(text).toContain('lines 70.58% (12/17)')
    // branches were 100%, and 85 is met, so exactly the three vitest named.
    expect(text).not.toContain('branches')
  })

  it('rejects a gated module with zero coverable statements', () => {
    const problems = auditCoverageThresholds(
      { ...uniformReport(covered), [absolute('src/api/qvpc.ts')]: coverageEntry([]) },
      manifest(),
      WEB_ROOT,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/api/qvpc.ts')
    expect(problems[0]).toContain('zero coverable statements')
  })

  it('rejects a gated module the report never mentions', () => {
    const report = uniformReport(covered)
    delete report[absolute('src/api/client.ts')]
    const problems = auditCoverageThresholds(report, manifest(), WEB_ROOT)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/api/client.ts')
    expect(problems[0]).toContain('no threshold held it')
  })

  it('rejects an unreadable entry for a gated module rather than skipping it', () => {
    const problems = auditCoverageThresholds(
      { ...uniformReport(covered), [absolute('src/api/qvpc.ts')]: 'not an entry' },
      manifest(),
      WEB_ROOT,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/api/qvpc.ts')
    expect(problems[0]).toContain('unreadable coverage entry')
  })

  it('refuses to certify a run against thresholds that would enforce nothing', () => {
    // A zeroed or absent manifest threshold is the same bypass as a zeroed
    // config one, just one file over; `perFile: false` is refused because
    // this gate only implements the per-file reading and must not quietly
    // enforce something the manifest did not ask for.
    for (const [label, thresholds] of [
      ['missing entirely', undefined],
      ['null', null],
      ['a number', 90],
      ['zeroed', { perFile: true, statements: 0, branches: 0, functions: 0, lines: 0 }],
      ['negative', { perFile: true, statements: -1, branches: 85, functions: 90, lines: 90 }],
      ['over 100', { perFile: true, statements: 101, branches: 85, functions: 90, lines: 90 }],
      ['short one metric', { perFile: true, statements: 90, branches: 85, functions: 90 }],
      ['not per-file', { perFile: false, statements: 90, branches: 85, functions: 90, lines: 90 }],
    ] as const) {
      expect(
        auditCoverageThresholds(uniformReport(covered), manifest({ thresholds }), WEB_ROOT).length,
        `certified a run against thresholds ${label}`,
      ).toBeGreaterThan(0)
    }
    // readCoverageScope applies the same rules when it loads the real
    // manifest, so a zeroed threshold on disk never reaches the comparison at
    // all: it throws at import time and takes this whole file down with it.
    expect(auditCoverageThresholds(uniformReport(covered), COVERAGE_SCOPE, WEB_ROOT)).toEqual([])
  })

  it('refuses a missing, malformed or empty report or expectation instead of passing vacuously', () => {
    for (const [label, document] of [
      ['undefined', undefined],
      ['null', null],
      ['a string', 'text'],
      ['an array', []],
    ] as const) {
      expect(
        auditCoverageThresholds(document, manifest(), WEB_ROOT).length,
        `audited ${label} clean as a coverage report`,
      ).toBeGreaterThan(0)
    }
    for (const [label, coverageGated] of [
      ['undefined', undefined],
      ['an empty array', []],
      ['a bare string', 'src/api/client.ts'],
    ] as const) {
      expect(
        auditCoverageThresholds(uniformReport(covered), manifest({ coverageGated }), WEB_ROOT)
          .length,
        `certified a run against ${label} as the gated set`,
      ).toBeGreaterThan(0)
    }
    expect(
      auditCoverageThresholds(uniformReport(covered), undefined, WEB_ROOT).length,
      'certified a run against no manifest at all',
    ).toBeGreaterThan(0)
  })
})
