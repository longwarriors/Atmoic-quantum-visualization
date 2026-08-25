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
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import {
  auditCoverageScope,
  auditCoverageThresholds,
  auditResolvedCoverage,
  jsonDifferences,
  readCoverageScope,
  summarizeFileCoverage,
  toWebRelative,
} from '../scripts/assert-coverage-scope.mjs'
import { normalizeResolvedCoverage } from '../scripts/capture-resolved-coverage.mjs'
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
 * The coverage provider vitest.config.ts declares -- the thing that decides
 * who WRITES coverage/coverage-final.json.
 *
 * Measured, and the reason the capture below exists: with
 * `--coverage.provider=custom --coverage.customProviderModule=./scripts/
 * fake-coverage-provider.mjs` persisted into the `test` script (or set by a
 * plugin `config()` hook), a module in this repo hand-writes a report listing
 * the three gated modules at 100%, and `check.ps1` prints "All checks
 * passed!" at exit 0 with a genuinely uncovered exported function shipping.
 * Every content check downstream then certifies a forgery.
 *
 * This literal is the config-SOURCE half and it is deliberately NOT the fix:
 * a CLI flag and a plugin hook both leave it byte-identical. The fix is
 * scripts/capture-resolved-coverage.mjs writing the config vitest RESOLVED
 * and scripts/assert-coverage-scope.mjs deep-equalling the whole of it
 * against coverage-scope.json's `resolvedCoverage`. This is one more layer,
 * not the wall.
 */
const EXPECTED_COVERAGE_PROVIDER = 'v8'

/**
 * `test.include` -- the specs vitest collects. Pinned here for two reasons:
 * narrowing it hides a whole spec file from the run, and vitest APPENDS it to
 * the resolved `coverage.exclude` (resolveConfig, coverage.DfSpMS-b.js:
 * 3664-3668), so it is part of the resolved coverage config the gate checks
 * and the two must be one value.
 */
const EXPECTED_TEST_INCLUDE = ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}']

/**
 * `globalSetup` -- the module vitest runs once per run, which is what writes
 * coverage/resolved-coverage.json from the RESOLVED config. Deleting it from
 * vitest.config.ts fails twice over: here, and in the gate, which hard-fails
 * on a missing capture (scripts/clean-coverage.mjs deletes the previous one
 * before vitest starts, so "missing" cannot be satisfied by an old file).
 */
const EXPECTED_GLOBAL_SETUP = ['./scripts/capture-resolved-coverage.mjs']

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
 * `export * from` -- can.
 *
 * This regex is the SECOND layer, kept for the plain single-line form it does
 * catch and because it needs nothing but `String.prototype`. It cannot be the
 * only layer: it is applied one line at a time, so both
 *
 *     export
 *     function backdoorInTypes(v: number): number { return v * 2 }
 *
 * and `;export const backdoorInTypes = …` are valid TypeScript that it never
 * sees (measured: both left `npm test` at exit 0 with executable, uncovered
 * code inside a gated root). Every positive control it had was single-line,
 * so the class could not be caught by construction. `valueExportHits` below
 * parses the file instead, and the scan takes the UNION of the two.
 */
const VALUE_EXPORT = /^\s*export\s+(?!type\s|interface\s|declare\s)/

/** `export` on a declaration, as the parser sees it (not as a line looks). */
const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)

/** `declare` makes a declaration ambient, so the compiler emits nothing. */
const hasDeclareModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)

/**
 * Does this top-level statement export something the compiler EMITS?
 *
 * Answered from the syntax tree rather than from the text of a line, because
 * whether `export` starts its line, or is followed by a newline, or sits
 * after a `;`, is exactly the sort of detail a bypass is written out of.
 * Unknown statement kinds carrying an `export` modifier count as value
 * exports: this must fail closed.
 */
function isValueExport(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement)) {
    // `export default …` / `export = …`; both emit.
    return true
  }
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) {
      return false
    }
    const clause = statement.exportClause
    if (clause !== undefined && ts.isNamedExports(clause)) {
      // `export { a, type B }` emits iff some specifier is not type-only.
      return clause.elements.some((element) => !element.isTypeOnly)
    }
    // `export * from …` / `export * as ns from …`.
    return true
  }
  if (!hasExportModifier(statement)) {
    return false
  }
  if (hasDeclareModifier(statement)) {
    return false
  }
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return false
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    return !statement.isTypeOnly
  }
  return true
}

/**
 * Does the compiler EMIT nothing at all for this top-level statement?
 *
 * `src/api/types.ts` is dropped from coverage on the stated grounds that it is
 * type-only, so what it may contain is exactly the forms that leave no runtime
 * behind. Everything else -- an expression, a variable, a function, a class, a
 * live `enum` or `namespace`, a bare side-effect `import` -- is executable code
 * inside a gated root that no threshold holds, whether or not it exports
 * anything. Unknown statement kinds are not erased: this fails closed.
 */
function isErasedDeclaration(statement: ts.Statement): boolean {
  if (hasDeclareModifier(statement)) {
    // `declare global { … }`, `declare module`, `declare const`: ambient.
    return true
  }
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return true
  }
  if (ts.isImportDeclaration(statement)) {
    // An import with a clause is elided when only its types are used; a bare
    // `import './x'` exists for no reason other than to run the other module.
    return statement.importClause !== undefined
  }
  if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
    // Whether THESE emit is `isValueExport`'s question, asked separately by
    // the scan below; answering it here too would report one line twice.
    return true
  }
  return ts.isEmptyStatement(statement)
}

/**
 * Top-level statements a predicate flags, as 1-based line numbers with the
 * text of the line the statement starts on.
 *
 * `createSourceFile` parses without type-checking, which is all this needs
 * and keeps the guard independent of the project's program. Parse errors are
 * reported rather than swallowed: an unparseable module must fail this scan,
 * not sail through it as "nothing found". (`tsc -p tsconfig.test.json
 * --noEmit` runs before vitest in the `test` chain and would already be red;
 * `parseDiagnostics` is belt and braces, and is read defensively because it
 * is not part of the public API.)
 */
function topLevelHits(
  fileName: string,
  source: string,
  flags: (statement: ts.Statement) => boolean,
): Hit[] {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  )
  const lineOf = (position: number): number =>
    ts.getLineAndCharacterOfPosition(parsed, position).line + 1
  const textOf = (line: number): string => source.split('\n')[line - 1]?.trim() ?? ''

  const diagnostics = (parsed as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    const first = diagnostics[0]
    const line = typeof first.start === 'number' ? lineOf(first.start) : 1
    return [
      {
        file: fileName,
        line,
        text: `does not parse (${ts.flattenDiagnosticMessageText(first.messageText, ' ')})`,
      },
    ]
  }

  return parsed.statements.filter(flags).map((statement) => {
    const line = lineOf(statement.getStart(parsed))
    return { file: fileName, line, text: textOf(line) }
  })
}

/**
 * Value exports in a TypeScript source: the forms that let another module
 * reach code parked here by name.
 */
function valueExportHits(fileName: string, source: string): Hit[] {
  return topLevelHits(fileName, source, isValueExport)
}

/**
 * Top-level statements that EMIT but export nothing -- the class
 * `valueExportHits` deliberately does not cover, and which a guard comment in
 * this file used to call harmless on the grounds that code exporting nothing
 * "cannot host code a gated module calls". That is false, and was demonstrated:
 *
 *     // src/api/types.ts
 *     ;(globalThis as Record<string, unknown>).__hsv = (h, s, v) => { … }
 *     // src/scene/color.ts
 *     import '../api/types'
 *
 * moved color.ts's whole implementation, untested branches included, into a
 * module measured by nothing, and left color.ts at 100/100/100/100 with the
 * gate green (measured). A module reached through the global object needs no
 * export at all. So the rule is not "exports nothing" but "emits nothing".
 */
function sideEffectHits(fileName: string, source: string): Hit[] {
  return topLevelHits(
    fileName,
    source,
    (statement) => !isValueExport(statement) && !isErasedDeclaration(statement),
  )
}

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
      | { include?: unknown; exclude?: unknown; thresholds?: unknown; provider?: unknown }
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
    // The measurer itself. One more layer, NOT the wall: see the comment on
    // EXPECTED_COVERAGE_PROVIDER -- a CLI flag and a plugin config() hook
    // both change the provider while leaving this line byte-identical, and
    // what sees those is the resolved-config capture the gate checks.
    expect(
      coverage?.provider,
      'vitestConfig.test.coverage.provider is not v8 -- a custom provider WRITES the coverage ' +
        'report the gate reads, so every check downstream would be certifying a forgery',
    ).toBe(EXPECTED_COVERAGE_PROVIDER)
  })

  it('binds the globalSetup that captures the resolved config, and the spec include it appends', () => {
    // scripts/capture-resolved-coverage.mjs is what writes
    // coverage/resolved-coverage.json, the only artefact that shows the
    // config vitest RESOLVED. Removing it from vitest.config.ts must fail
    // here AND at the gate (which hard-fails on a missing capture, because
    // scripts/clean-coverage.mjs deleted the previous one before vitest
    // started). Two independent failures for one deletion, deliberately: a
    // gate whose evidence can simply stop being produced is not a gate.
    const testConfig = vitestConfig.test as
      | { globalSetup?: unknown; include?: unknown }
      | undefined
    expect(
      Array.isArray(testConfig?.globalSetup),
      'vitestConfig.test.globalSetup is not an array -- nothing captures the coverage config ' +
        'this run resolves, and the gate can then only see the report, not who wrote it',
    ).toBe(true)
    expect(testConfig?.globalSetup).toEqual(EXPECTED_GLOBAL_SETUP)
    // vitest resolves globalSetup paths against the root, so the manifest
    // carries the root-relative spelling of the same list.
    expect(
      COVERAGE_SCOPE.resolvedCoverage.globalSetup,
      'coverage-scope.json: "resolvedCoverage".globalSetup must be vitest.config.ts\'s ' +
        'globalSetup, resolved relative to the project root',
    ).toEqual(EXPECTED_GLOBAL_SETUP.map((file) => file.replace(/^\.\//, '')))
    // test.include is pinned for its own sake (a narrowed pattern hides a
    // whole spec file) and because vitest APPENDS it to the resolved
    // coverage.exclude, which the gate deep-equals.
    expect(testConfig?.include).toEqual(EXPECTED_TEST_INCLUDE)
  })

  it('binds the expected RESOLVED coverage config to the same literals as the source one', () => {
    // coverage-scope.json carries what the run must resolve to. That
    // expectation has to be pinned to the config source, or the pair would be
    // a mirror of itself: an edit to vitest.config.ts plus a matching edit to
    // the manifest would agree with each other and with nothing else.
    const resolved = COVERAGE_SCOPE.resolvedCoverage.coverage
    expect(resolved.provider).toBe(EXPECTED_COVERAGE_PROVIDER)
    expect(resolved.include).toEqual(EXPECTED_COVERAGE_INCLUDE)
    expect(resolved.thresholds).toEqual(EXPECTED_COVERAGE_THRESHOLDS)
    // vitest appends the resolved setupFiles (none here) and test.include to
    // coverage.exclude -- resolveConfig, coverage.DfSpMS-b.js:3664-3668 --
    // so the resolved list is the declared one plus test.include, in order.
    // Spelled out rather than asserted loosely: the head must be exactly the
    // canonical exclude array, and the tail exactly test.include.
    expect(resolved.exclude).toEqual([...EXPECTED_COVERAGE_EXCLUDE, ...EXPECTED_TEST_INCLUDE])
    // And the fields whose value is a policy, not a mirror of the config.
    expect(resolved.enabled, 'a run with coverage disabled instruments nothing').toBe(true)
    expect(resolved.all, 'with all:false an untested module is absent, not 0%').toBe(true)
    expect(
      Object.hasOwn(resolved, 'customProviderModule'),
      'coverage-scope.json must not expect a custom provider module: that module writes the ' +
        'report',
    ).toBe(false)
    expect(
      (resolved.reporter as unknown[]).map((entry) => (Array.isArray(entry) ? entry[0] : entry)),
      'without the json reporter no coverage-final.json is written at all',
    ).toContain('json')
    expect(resolved.reportsDirectory, 'the directory the gate reads the report from').toBe(
      'coverage',
    )
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
    // This used to forbid value exports only, on the stated grounds that a
    // bare top-level side effect "exports nothing and so cannot host code a
    // gated module calls". That premise was false, and a four-line edit
    // falsified it: `;(globalThis as …).__hsv = (h, s, v) => { … }` here plus
    // `import '../api/types'` in src/scene/color.ts moved color.ts's whole
    // implementation, two untested branches included, into this module and
    // left color.ts reporting 100/100/100/100 with the gate green (measured).
    // Nothing has to be exported to be reached through the global object.
    //
    // So the rule this enforces is the one the exclusion actually claims:
    // type-only means the compiler EMITS NOTHING for this file. Declarations
    // only -- imports and exports, interfaces, type aliases, anything
    // `declare`d. If executable code ever belongs here, the file is no longer
    // type-only and belongs in coverage.include instead.
    const gated = new Set<string>(COVERAGE_SCOPE.coverageGated)
    const typeOnly = COVERAGE_SCOPE.pragmaScanned
      .filter((file) => !gated.has(file))
      .map((file) => file.replace(/^src\//, ''))
    expect(typeOnly.length, 'no type-only module to check -- has the manifest changed?').toBe(1)

    // THREE scanners, union of hits. The two parses are the ones that matter
    // -- they see declarations, not lines -- and the line regex is kept
    // because it costs nothing and still fires if the TypeScript API ever
    // moves under this file.
    const sources = typeOnly.map(
      (file) => [file, readFileSync(join(SRC_ROOT, file), 'utf-8')] as const,
    )
    const hits = [
      ...scan(typeOnly, (line) => VALUE_EXPORT.test(line)),
      ...sources.flatMap(([file, source]) => valueExportHits(file, source)),
      ...sources.flatMap(([file, source]) => sideEffectHits(file, source)),
    ]
    expect(
      hits,
      'a module coverage excludes as type-only contains something the compiler emits. Either ' +
        'keep it type-only, or move it into coverage.include and coverage-scope.json:\n' +
        describeHits(hits),
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
    // The same forms as whole modules, for the parse. They are spelled out
    // again rather than reusing the lines above because a parser is fed
    // sources, not lines: `export interface X {` alone is a syntax error, and
    // a control that fails to parse would "pass" for the wrong reason.
    for (const source of [
      'export function backdoor(value: number): number {\n  return value\n}\n',
      'export const backdoor = (value: number): number => value\n',
      'export class Backdoor {}\n',
      'export enum Kind {\n  A,\n}\n',
      'const backdoor = 1\nexport default backdoor\n',
      "export { backdoor } from './client'\n",
      "export * from './client'\n",
      'export let mutable = 1\n',
      'export var legacy = 1\n',
    ]) {
      expect(valueExportHits('control.ts', source).length, source).toBe(1)
    }
    for (const source of [
      "export type BasisKind = 'real' | 'complex'\n",
      'export interface OrbitalParameters {\n  n: number\n}\n',
      'export declare const version: string\n',
      'interface Local {\n  n: number\n}\nexport type { Local }\n',
      '/** Geometry fields shared by the stationary and time-dependent isosurfaces. */\n',
    ]) {
      expect(valueExportHits('control.ts', source), source).toEqual([])
    }
  })

  it('sees a value export the line regex cannot: a newline, or a leading semicolon', () => {
    // Both forms are valid TypeScript, both clear `tsc -p tsconfig.test.json
    // --noEmit` (which runs before vitest), and both put executable,
    // uncovered code inside a gated root. Measured on the line-regex guard:
    // `Tests 204 passed`, both gate lines green, EXIT=0 for each. Every
    // positive control that guard had was single-line, so it could not catch
    // this class by construction -- these two are the class.
    const newlineAfterExport =
      'export type A = string\n' +
      'export\nfunction backdoorInTypes(v: number): number {\n  return v * 2\n}\n'
    const leadingSemicolon =
      'export type A = string\n;export const backdoorInTypes = (v: number): number => v * 2\n'

    for (const [label, source, line] of [
      ['newline after export', newlineAfterExport, 2],
      ['leading semicolon', leadingSemicolon, 2],
    ] as const) {
      // The regex is blind to both; the parse is not. This is the whole
      // reason the scan above takes a union rather than either one alone.
      expect(
        source.split('\n').some((text) => VALUE_EXPORT.test(text)),
        `${label}: the line regex was supposed to be blind to this`,
      ).toBe(false)
      const hits = valueExportHits('types.ts', source)
      expect(hits.map((hit) => hit.line), label).toEqual([line])
    }
  })

  it('reads exports from the tree, so comments, strings and formatting cannot fake one', () => {
    // Negative controls the line regex gets wrong in the other direction, and
    // a parse gets right: prose and string literals that merely contain the
    // word, and type-only re-export forms `isolatedModules` requires.
    for (const [label, source] of [
      ['export mentioned in prose', '// re-export the client here\nexport type A = string\n'],
      ['export inside a string', 'export type A = string\nconst s = "export const x = 1"\n'],
      ['export inside a template', 'export type A = string\nconst s = `\nexport const x = 1\n`\n'],
      ['type-only re-export', "export type { A } from './types'\n"],
      ['per-specifier type-only', "type A = string\nexport { type A }\n"],
      ['ambient declaration', 'export declare const version: string\n'],
      ['unexported value', 'const hidden = 1\nvoid hidden\nexport type A = string\n'],
    ] as const) {
      expect(valueExportHits('types.ts', source), label).toEqual([])
    }
    // ... and forms it must still catch, including ones spread over lines.
    for (const [label, source] of [
      ['mixed named export', "const a = 1\nexport { a, type B }\ntype B = string\n"],
      ['multi-line function', 'export function f(\n  v: number,\n): number {\n  return v\n}\n'],
      ['export namespace', 'export namespace N {\n  export const x = 1\n}\n'],
      ['export default', 'const a = 1\nexport default a\n'],
      ['star re-export', "export * from './client'\n"],
      ['import equals', "import x = require('./x')\nexport = x\n"],
    ] as const) {
      expect(valueExportHits('types.ts', source).length, label).toBeGreaterThan(0)
    }
    // A file that does not parse is a failed scan, not an empty one.
    const broken = valueExportHits('types.ts', 'export const = = 1\n')
    expect(broken.length).toBeGreaterThan(0)
  })

  it('sees code a type-only module emits without exporting it', () => {
    // The composition the value-export scan was written to permit, and which
    // was demonstrated to work: the implementation is parked on `globalThis`
    // by a bare expression statement -- no export modifier anywhere, so
    // `isValueExport` says no by design -- and src/scene/color.ts reaches it
    // with `import '../api/types'`. Everything below emits, and none of it is
    // an export.
    for (const [label, source] of [
      [
        'globalThis assignment (the measured composition)',
        'export type A = string\n' +
          ';(globalThis as Record<string, unknown>).__hsv = (h: number) => h * 2\n',
      ],
      ['bare side-effect import', "export type A = string\nimport './register'\n"],
      ['unexported const', 'export type A = string\nconst hsv = (h: number) => h * 2\n'],
      ['unexported function', 'export type A = string\nfunction hsv(h: number) {\n  return h\n}\n'],
      ['unexported class', 'export type A = string\nclass Hsv {}\n'],
      ['live enum', 'export type A = string\nenum Kind {\n  A,\n}\n'],
      ['live namespace', 'export type A = string\nnamespace N {\n  export const x = 1\n}\n'],
      ['top-level control flow', 'export type A = string\nif (Date.now() > 0) {\n  void 0\n}\n'],
      ['import equals', "export type A = string\nimport x = require('./x')\n"],
    ] as const) {
      expect(sideEffectHits('types.ts', source).map((hit) => hit.line), label).toEqual([2])
    }

    // Negative controls, or the scan could pass by matching nothing rather
    // than because the file is clean. Every form here is genuinely erased --
    // the compiler emits no runtime for any of it.
    for (const [label, source] of [
      ['type alias', "export type BasisKind = 'real' | 'complex'\n"],
      ['interface', 'export interface OrbitalParameters {\n  n: number\n}\n'],
      ['ambient declaration', 'export declare const version: string\n'],
      ['declare global', 'export type A = string\ndeclare global {\n  interface W {\n    x: 1\n  }\n}\n'],
      ['type-only import', "import type { A } from './types'\nexport type B = A\n"],
      ['value import with a clause', "import { A } from './types'\nexport type B = typeof A\n"],
      ['type-only re-export', "export type { A } from './types'\n"],
      ['lone semicolon', 'export type A = string\n;\n'],
      // These DO emit, and are reported by valueExportHits instead. The two
      // scanners partition the statements between them, so the union in the
      // test above never names one line twice.
      ['exported const (the other scan owns it)', 'export const hsv = (h: number) => h\n'],
      ['star re-export (the other scan owns it)', "export * from './client'\n"],
      ['export default (the other scan owns it)', 'export default 1\n'],
    ] as const) {
      expect(sideEffectHits('types.ts', source), label).toEqual([])
    }
    for (const source of [
      'export const hsv = (h: number) => h\n',
      "export * from './client'\n",
      'export default 1\n',
    ]) {
      expect(valueExportHits('types.ts', source).length, source).toBe(1)
    }
    // And an unparseable module is a failed scan here too, not an empty one.
    expect(sideEffectHits('types.ts', 'const = = 1\n').length).toBeGreaterThan(0)
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

describe('resolved config gate (scripts/assert-coverage-scope.mjs)', () => {
  // The third pass, and the one that says the other two are worth anything.
  //
  // Binding the measured file SET says which modules were looked at; binding
  // the THRESHOLDS says what looking at them had to prove; neither says
  // anything about who did the looking. `coverage.provider` lives in the
  // RESOLVED config, where a persisted CLI flag or a plugin config() hook can
  // swap it for `custom` plus a `customProviderModule` that hand-writes
  // coverage-final.json -- measured twice, both green, both with an uncovered
  // exported function shipping in a gated module.
  //
  // scripts/capture-resolved-coverage.mjs writes that resolved config out as
  // vitest's `globalSetup`, and the gate deep-equals the WHOLE of it. Whole,
  // not a chosen list of fields: three reviews in a row each found the next
  // unbound key, so what is pinned here is every key there is.
  //
  // This block exercises the audit on synthetic captures. It deliberately
  // does NOT read the live coverage/resolved-coverage.json: `npm run
  // test:watch` runs vitest without --coverage, and a guard that failed there
  // would be a false red on a legitimate workflow. Checking the live capture
  // is the gate script's job, and the gate script only runs inside `npm test`.

  const expected = COVERAGE_SCOPE.resolvedCoverage
  const webRootPosix = WEB_ROOT.split(sep).join('/').replace(/\/$/, '')

  /** A capture of a run that used exactly the manifest's configuration. */
  const capture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    schema: 2,
    root: webRootPosix,
    isRootProject: true,
    projectName: '',
    globalSetup: structuredClone(expected.globalSetup),
    coverageProviderName: 'v8',
    coverage: structuredClone(expected.coverage),
    ...overrides,
  })

  /** The same, with resolved coverage options changed or (undefined) removed. */
  const withCoverage = (changes: Record<string, unknown>): Record<string, unknown> => {
    const coverage: Record<string, unknown> = structuredClone(expected.coverage)
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) {
        delete coverage[key]
      } else {
        coverage[key] = value
      }
    }
    return capture({ coverage })
  }

  it('accepts a run that resolved exactly the configuration the manifest carries', () => {
    expect(auditResolvedCoverage(capture(), expected, WEB_ROOT)).toEqual([])
  })

  it('rejects the custom-provider swap, in both of its spellings', () => {
    // B1: the two flags persisted into the `test` script. B2: the same two
    // fields set by a Vite plugin config() hook, which touches neither the
    // script nor any array the config-source assertions read.
    const custom = auditResolvedCoverage(
      withCoverage({
        provider: 'custom',
        customProviderModule: '/w/scripts/fake-coverage-provider.mjs',
      }),
      expected,
      WEB_ROOT,
    )
    expect(custom.join('\n')).toContain('coverage.provider is "custom"')
    expect(custom.join('\n')).toContain('customProviderModule')
    // istanbul is a real provider rather than a forgery, but it is not the
    // one this manifest describes and it is not the report shape the
    // threshold pass recomputes.
    expect(
      auditResolvedCoverage(withCoverage({ provider: 'istanbul' }), expected, WEB_ROOT).join('\n'),
    ).toContain('not "v8"')
    // A customProviderModule alongside a v8 provider is refused too: the key
    // existing at all means somebody pointed coverage at a module.
    expect(
      auditResolvedCoverage(
        withCoverage({ customProviderModule: './scripts/fake.mjs' }),
        expected,
        WEB_ROOT,
      ).join('\n'),
    ).toContain('customProviderModule')
  })

  it('rejects coverage that resolved to disabled, or to only the files a test imported', () => {
    expect(
      auditResolvedCoverage(withCoverage({ enabled: false }), expected, WEB_ROOT).join('\n'),
    ).toContain('coverage.enabled is false')
    expect(
      auditResolvedCoverage(withCoverage({ all: false }), expected, WEB_ROOT).join('\n'),
    ).toContain('coverage.all is false')
  })

  it('rejects thresholds the run resolved away, and a scope it resolved smaller', () => {
    // A17 and A21 seen at the config level this time, rather than recomputed
    // from the report: the run itself says it was told to enforce nothing.
    expect(
      auditResolvedCoverage(
        withCoverage({
          thresholds: { perFile: true, statements: 0, branches: 0, functions: 0, lines: 0 },
        }),
        expected,
        WEB_ROOT,
      ).join('\n'),
    ).toContain('coverage.thresholds')
    expect(
      auditResolvedCoverage(withCoverage({ thresholds: undefined }), expected, WEB_ROOT).join('\n'),
    ).toContain('coverage.thresholds')
    expect(
      auditResolvedCoverage(
        withCoverage({
          thresholds: { perFile: false, statements: 90, branches: 85, functions: 90, lines: 90 },
        }),
        expected,
        WEB_ROOT,
      ).join('\n'),
    ).toContain('perFile')
    expect(
      auditResolvedCoverage(
        withCoverage({ include: ['src/scene/color.ts'] }),
        expected,
        WEB_ROOT,
      ).join('\n'),
    ).toContain('coverage.include')
    expect(
      auditResolvedCoverage(
        withCoverage({ exclude: [...expected.coverage.exclude, 'src/api/client.ts'] }),
        expected,
        WEB_ROOT,
      ).join('\n'),
    ).toContain('coverage.exclude')
  })

  it('rejects a reporter list that would leave no report to read', () => {
    expect(
      auditResolvedCoverage(withCoverage({ reporter: [['text', {}]] }), expected, WEB_ROOT).join(
        '\n',
      ),
    ).toContain('"json" reporter')
  })

  it('rejects any resolved option the manifest does not account for, in either direction', () => {
    // THE point of deep-equalling the whole object. Every previous round
    // bound one more named field and the next round found the one after it;
    // an option nobody has vetted -- turned on by a flag, a hook, or a vitest
    // upgrade -- now has to be a reviewed edit to coverage-scope.json rather
    // than a silent change to how the run was measured.
    const extra = auditResolvedCoverage(
      withCoverage({ someNewCoverageOption: true }),
      expected,
      WEB_ROOT,
    )
    expect(extra.join('\n')).toContain('someNewCoverageOption')
    expect(extra.join('\n')).toContain('not expected at all')

    const missing = auditResolvedCoverage(
      withCoverage({ ignoreEmptyLines: undefined }),
      expected,
      WEB_ROOT,
    )
    expect(missing.join('\n')).toContain('ignoreEmptyLines')
    expect(missing.join('\n')).toContain('missing')

    // A value change on an option with no absolute rule of its own is caught
    // by the same deep-equal, which is what makes the whole-object bind more
    // than a restatement of the named checks above.
    expect(
      auditResolvedCoverage(withCoverage({ excludeAfterRemap: true }), expected, WEB_ROOT).join(
        '\n',
      ),
    ).toContain('excludeAfterRemap')
    expect(
      auditResolvedCoverage(
        withCoverage({ reportsDirectory: '../elsewhere' }),
        expected,
        WEB_ROOT,
      ).join('\n'),
    ).toContain('reportsDirectory')
  })

  it('rejects a capture that is not this run, this project, or this schema', () => {
    expect(
      auditResolvedCoverage(capture({ globalSetup: [] }), expected, WEB_ROOT).join('\n'),
    ).toContain('globalSetup')
    expect(
      auditResolvedCoverage(
        capture({ globalSetup: ['scripts/something-else.mjs'] }),
        expected,
        WEB_ROOT,
      ).join('\n'),
    ).toContain('globalSetup')
    expect(
      auditResolvedCoverage(capture({ root: '/elsewhere/web' }), expected, WEB_ROOT).join('\n'),
    ).toContain('different checkout')
    expect(
      auditResolvedCoverage(capture({ isRootProject: false }), expected, WEB_ROOT).join('\n'),
    ).toContain('non-root project')
    expect(
      auditResolvedCoverage(capture({ projectName: 'browser' }), expected, WEB_ROOT).join('\n'),
    ).toContain('projectName')
    expect(auditResolvedCoverage(capture({ schema: 3 }), expected, WEB_ROOT).join('\n')).toContain(
      'schema',
    )
  })

  it('rejects a provider vitest loaded under some other name -- one layer, not the wall', () => {
    // `coverage.provider` above is read out of the resolved options, which
    // vitest sets to `coverageProvider.resolveOptions()` before globalSetup
    // runs: the provider gets to describe itself there. This reads the
    // provider OBJECT instead, and the two come apart for the naive fake --
    // vitest printed `Coverage enabled with fake` directly above three green
    // gate lines (measured).
    for (const [label, name] of [
      ['a fake that did not disguise itself', 'fake'],
      ['istanbul', 'istanbul'],
      ['no provider loaded at all', null],
    ] as const) {
      expect(
        auditResolvedCoverage(capture({ coverageProviderName: name }), expected, WEB_ROOT).join(
          '\n',
        ),
        label,
      ).toContain('coverageProviderName')
    }
    // And the honest limit of it, asserted rather than left to the comment: a
    // fake that declares `name = "v8"` satisfies this check exactly as it
    // satisfies the resolved options, because both are written by the process
    // they describe. Closing that means measuring from outside this run --
    // see the boundary note atop scripts/assert-coverage-scope.mjs.
    expect(auditResolvedCoverage(capture({ coverageProviderName: 'v8' }), expected, WEB_ROOT)).toEqual(
      [],
    )
  })

  it('refuses a missing, malformed or empty capture or expectation instead of passing vacuously', () => {
    // What the gate is handed when the globalSetup was removed, or when the
    // capture was truncated. Each must fail, never audit clean.
    for (const [label, document] of [
      ['undefined', undefined],
      ['null', null],
      ['a string', 'text'],
      ['a number', 42],
      ['an array', []],
      ['an empty object', {}],
    ] as const) {
      expect(
        auditResolvedCoverage(document, expected, WEB_ROOT).length,
        `audited ${label} clean as a resolved-config capture`,
      ).toBeGreaterThan(0)
    }
    for (const [label, expectation] of [
      ['undefined', undefined],
      ['null', null],
      ['an array', []],
      ['an empty object', {}],
      ['a bare string', 'v8'],
    ] as const) {
      expect(
        auditResolvedCoverage(capture(), expectation, WEB_ROOT).length,
        `certified a run against ${label} as the expected resolved config`,
      ).toBeGreaterThan(0)
    }
  })

  it('refuses a manifest whose own expectation would license a forged report', () => {
    // The latch, from the other side. If `resolvedCoverage` could be edited
    // freely, one commit could both swap the provider and bless the swap, so
    // readCoverageScope holds the EXPECTATION to the same invariants the
    // capture is held to -- and throws at import time when it is violated,
    // taking this whole spec file down exactly as a zeroed manifest
    // threshold already does.
    expect(COVERAGE_SCOPE.resolvedCoverage.coverage.provider).toBe(EXPECTED_COVERAGE_PROVIDER)
    expect(readCoverageScope(WEB_ROOT).resolvedCoverage.coverage.enabled).toBe(true)
    expect(() => readCoverageScope(join(WEB_ROOT, 'no-such-directory'))).toThrow(
      /coverage-scope\.json/,
    )
  })

  it('reports every difference between two JSON documents, extra keys included', () => {
    // jsonDifferences is what makes the whole-object bind readable, and a
    // diff that silently ignored a key would turn that bind back into the
    // chosen-fields check this round exists to replace.
    expect(jsonDifferences({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([])
    expect(jsonDifferences({ a: 1 }, { a: 2 }).join('\n')).toContain('a: 1, expected 2')
    expect(jsonDifferences({ a: 1, b: 2 }, { a: 1 }).join('\n')).toContain('not expected at all')
    expect(jsonDifferences({ a: 1 }, { a: 1, b: 2 }).join('\n')).toContain('missing')
    expect(jsonDifferences([1], [1, 2]).join('\n')).toContain('entr(ies), expected 2')
    expect(jsonDifferences({ a: { b: 1 } }, { a: { b: 2 } }).join('\n')).toContain('a.b')
    expect(jsonDifferences({ a: [1] }, { a: 1 }).join('\n')).toContain('a')
    // null is a value, not an absent key.
    expect(jsonDifferences({ a: null }, { a: null })).toEqual([])
    expect(jsonDifferences({ a: null }, {}).join('\n')).toContain('not expected at all')
  })

  it('normalises exactly the two machine-dependent resolved values, and nothing else', () => {
    // reportsDirectory is absolute and processingConcurrency is
    // min(20, availableParallelism()), so pinning either raw value would make
    // the manifest unusable on another machine. Their KEYS stay pinned.
    const normalized = normalizeResolvedCoverage(
      {
        provider: 'v8',
        reportsDirectory: `${webRootPosix}/coverage`,
        processingConcurrency: 12,
        include: ['src/api/**/*.ts'],
        onFinish: () => undefined,
      },
      WEB_ROOT,
    )
    expect(normalized.reportsDirectory).toBe('coverage')
    expect(normalized.processingConcurrency).toEqual({ __captured: 'machine-dependent' })
    expect(normalized.provider).toBe('v8')
    expect(normalized.include).toEqual(['src/api/**/*.ts'])
    // A value JSON cannot carry is written as a marker, not dropped: a key
    // that vanished from the capture would vanish from the deep-equal too.
    expect(normalized.onFinish).toEqual({ __captured: 'function' })
    expect(Object.keys(normalized).sort()).toEqual([
      'include',
      'onFinish',
      'processingConcurrency',
      'provider',
      'reportsDirectory',
    ])
    for (const notAConfig of [undefined, null, 'text', 42, []] as const) {
      expect(() => normalizeResolvedCoverage(notAConfig, WEB_ROOT), String(notAConfig)).toThrow()
    }
  })

  it('captures an absent value as something no real value can be spelled as', () => {
    // The markers used to be strings: `undefined` was written `"<undefined>"`,
    // which a genuine string value `"<undefined>"` normalised to character for
    // character, so the capture could not say which of the two the run had
    // resolved. Not reachable today -- no manifest expectation is ever a
    // marker -- but an encoding that cannot tell "absent" from "a string that
    // looks absent" is not evidence.
    const marked = normalizeResolvedCoverage(
      {
        thresholds: undefined,
        reporter: Symbol('reporter'),
        watermark: Number.NaN,
        ceiling: Number.POSITIVE_INFINITY,
      },
      WEB_ROOT,
    )
    expect(marked.thresholds).toEqual({ __captured: 'undefined' })
    expect(marked.reporter).toEqual({ __captured: 'symbol' })
    expect(marked.watermark).toEqual({ __captured: 'NaN' })
    expect(marked.ceiling).toEqual({ __captured: 'Infinity' })

    // The collision, gone: a string is a string.
    const spelled = normalizeResolvedCoverage({ thresholds: '<undefined>' }, WEB_ROOT)
    expect(spelled.thresholds).toBe('<undefined>')
    expect(jsonDifferences(spelled, marked).length).toBeGreaterThan(0)

    // And a genuine object that carries the marker key is escaped into two
    // keys, so it cannot be read back as the one-key marker it resembles.
    const escaped = normalizeResolvedCoverage({ thresholds: { __captured: 'undefined' } }, WEB_ROOT)
    expect(escaped.thresholds).toEqual({
      __captured: 'literal',
      value: { __captured: 'undefined' },
    })
    expect(jsonDifferences(escaped, marked).length).toBeGreaterThan(0)
  })

  it('reads a reports directory the way the filesystem does, not the way the string looks', () => {
    // `<root>/COVERAGE` and `<root>/coverage` are ONE directory on Windows, so
    // holding the capture to the exact spelling there fails a run that used
    // the pinned directory -- a false RED, not a bypass. On Linux they are two
    // directories and the pin has to keep saying so.
    const cased = normalizeResolvedCoverage(
      { reportsDirectory: `${webRootPosix}/COVERAGE` },
      WEB_ROOT,
    )
    expect(cased.reportsDirectory).toBe(process.platform === 'win32' ? 'coverage' : 'COVERAGE')
    // A directory genuinely somewhere else stays visible either way -- this
    // folds case, it does not fold paths.
    expect(
      normalizeResolvedCoverage({ reportsDirectory: `${webRootPosix}/../elsewhere` }, WEB_ROOT)
        .reportsDirectory,
    ).toBe('../elsewhere')
  })
})
