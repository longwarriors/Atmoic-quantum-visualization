#!/usr/bin/env node
/**
 * Gate `npm run test:visual` on what Playwright actually ran, not on its exit
 * code.
 *
 * This is the visual counterpart of scripts/assert-no-skips.mjs, and it exists
 * for the same reason: a runner's exit code answers "did anything fail?", not
 * "was anything checked?". Four green-but-empty runs are reachable here:
 *
 *   1. Every test SKIPPED. `playwright test` exits 0 and prints "1 skipped".
 *      A `test.skip()` on a condition that is true in CI (no display, a
 *      missing browser, an env var) reads as success in the job log.
 *   2. NO spec file collected at all -- `testDir` moved, `testIgnore` grew, a
 *      `--grep` that matches nothing, a spec renamed out of the match. Exit 0,
 *      "0 tests", and the screenshot comparison this suite exists for never
 *      happened.
 *   3. The run was `--update-snapshots`. That flag makes every screenshot
 *      assertion pass by WRITING the pixels it was asked to compare against,
 *      so a regression is not detected, it is committed. playwright.config.ts
 *      sets `updateSnapshots: 'none'`, but a CLI flag overrides the config
 *      file, and the resulting report is indistinguishable from a real one
 *      except for the `config.updateSnapshots` field the reporter copies out
 *      of the RESOLVED config. This gate reads that field and refuses anything
 *      but 'none'. It is the anti-tautology latch: without it, the fix for a
 *      red visual suite is one flag away and leaves the suite green forever.
 *   4. A required test or assertion was deleted while the rest of its spec
 *      stayed green. Merely seeing `slice.spec.ts` in the report does not prove
 *      that its half-period or transposition control still ran. The explicit
 *      title manifest below pins every required test, and a TypeScript AST scan
 *      pins the screenshot/WebGL assertions that Playwright's JSON reporter
 *      does not serialize as steps.
 *
 * Usage (wired into `test:visual` in package.json):
 *
 *   playwright test
 *   node scripts/assert-visual-run.mjs [path/to/report.json]
 *
 * The report is written under `test-results/`, which is Playwright's
 * `outputDir` and is wiped at the start of every run, so a stale report from
 * an earlier run is not normally there to be mistaken for this one. That is
 * the same argument scripts/assert-no-skips.mjs makes about coverage/, and it
 * has the same limit: it depends on the runner reaching the point where it
 * cleans. A run that never starts leaves whatever was there, which is why
 * `test:visual` chains with `&&` -- Playwright must exit 0 before this script
 * is asked anything at all.
 *
 * Plain ESM; the source audit uses the same pinned TypeScript parser that the
 * web build already installs. src/visualGate.test.ts imports the audit helpers
 * and exercises them against synthetic reports and in-memory source mutations
 * in the ordinary vitest suite. That split is deliberate: Playwright cannot
 * run on the Windows dev machines (the config throws off Linux by design), so
 * the gate's logic must be verifiable without it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Mirrors `testMatch`'s effect in playwright.config.ts (testDir `e2e`). */
const SPEC_FILE = /\.(test|spec)\.tsx?$/

/**
 * `testDir` from playwright.config.ts, relative to the web root.
 *
 * Named once and used twice -- to find the specs on disk, and to strip the same
 * segment off an expected path when matching it against a report. Those two
 * uses have to agree or the gate compares paths rooted differently, which is
 * exactly the defect this constant was introduced to close.
 */
const TEST_DIR = 'e2e'

const SLICE_SPEC = `${TEST_DIR}/slice.spec.ts`
const WEBGL_SPEC = `${TEST_DIR}/webgl.spec.ts`

const SLICE_TESTS = Object.freeze([
  '2p_z on xz: the nodal line lies across the plane, not down it',
  '2p(+1) on xy: one winding around a masked disc',
  '2s + 2p_z are degenerate: the same picture at t=0 and at t=8.4',
  '1s + 2p_z at t=0: the dipole in its first lobe',
  '1s + 2p_z at t=8.4: half a Bohr period later, the lobe has swung over',
  'the comparison can see a transposed slice: the apparatus is not vacuous',
  'the comparison rejects a two-percent plane-extent error beyond the AA fringe',
])

const WEBGL_TESTS = Object.freeze([
  'renders through a software WebGL2 stack, not whatever GPU is present',
])

/**
 * Every visual test that must appear exactly once in Playwright's JSON report.
 *
 * Explicit rather than derived from the report or source: deleting a test must
 * leave the expectation behind, or the deletion and its audit would disappear
 * together. New tests are allowed, but cannot substitute for one of these.
 */
export const REQUIRED_VISUAL_TESTS = Object.freeze({
  [SLICE_SPEC]: SLICE_TESTS,
  [WEBGL_SPEC]: WEBGL_TESTS,
})

const screenshotKey = (testTitle, negated, snapshot, options) =>
  ['screenshot', testTitle, negated ? 'not' : 'positive', snapshot, options].join('\u0000')

const expectKey = (testTitle, subject, negated, matcher, expected) =>
  ['expect', testTitle, subject, negated ? 'not' : 'positive', matcher, expected].join('\u0000')

/**
 * Assertions that the JSON reporter cannot prove ran.
 *
 * Playwright 1.62 serializes only explicit `test.step()` calls in
 * `results[].steps`; ordinary `expect(...).toHaveScreenshot(...)` calls are not
 * present in a green report. These source requirements close that gap without
 * pretending a test title proves what remains inside its callback.
 */
const REQUIRED_VISUAL_SOURCE_ASSERTIONS = Object.freeze({
  [SLICE_SPEC]: Object.freeze([
    {
      key: screenshotKey(SLICE_TESTS[0], false, '2pz-real-xz.png', 'screenshotOptions'),
      label: 'the 2p_z positive screenshot',
    },
    {
      key: screenshotKey(SLICE_TESTS[1], false, '2p+1-phase-xy.png', 'screenshotOptions'),
      label: 'the 2p(+1) phase positive screenshot',
    },
    {
      key: screenshotKey(
        SLICE_TESTS[2],
        false,
        'degenerate-stationary-xz.png',
        'screenshotOptions',
      ),
      count: 2,
      label: 'both stationary-density positive screenshots',
    },
    {
      key: screenshotKey(SLICE_TESTS[3], false, '1s2pz-t0-xz.png', 'screenshotOptions'),
      label: 'the t=0 positive screenshot',
    },
    {
      key: screenshotKey(SLICE_TESTS[4], false, '1s2pz-t8.4-xz.png', 'screenshotOptions'),
      label: 'the t=8.4 positive screenshot',
    },
    {
      key: screenshotKey(
        SLICE_TESTS[4],
        true,
        '1s2pz-t0-xz.png',
        'halfPeriodRejectionOptions',
      ),
      label: 'the half-period negated screenshot control',
    },
    {
      key: screenshotKey(
        SLICE_TESTS[5],
        true,
        '2pz-real-xz.png',
        'transposeRejectionOptions',
      ),
      label: 'the transposition negated screenshot control',
    },
    {
      key: screenshotKey(
        SLICE_TESTS[6],
        false,
        'degenerate-stationary-xz.png',
        'screenshotOptions',
      ),
      label: 'the geometry-control positive screenshot',
    },
    {
      key: screenshotKey(
        SLICE_TESTS[6],
        true,
        'degenerate-stationary-xz.png',
        'geometryRejectionOptions',
      ),
      label: 'the geometry negated screenshot control',
    },
  ]),
  [WEBGL_SPEC]: Object.freeze([
    {
      key: expectKey(WEBGL_TESTS[0], 'report.supported', false, 'toBe', 'true'),
      label: 'the WebGL2 availability assertion',
    },
    {
      key: expectKey(WEBGL_TESTS[0], 'report.unmasked', false, 'toBe', 'true'),
      label: 'the unmasked-renderer assertion',
    },
    {
      key: expectKey(WEBGL_TESTS[0], 'report.renderer', false, 'toContain', '"SwiftShader"'),
      label: 'the SwiftShader renderer assertion',
    },
  ]),
})

/** The only per-test status Playwright uses for "this test asserted and passed". */
const PASSING_TEST_STATUS = 'expected'
/** The only per-attempt status that means the attempt itself passed. */
const PASSING_RESULT_STATUS = 'passed'
/** The only `updateSnapshots` value under which a screenshot assertion COMPARES. */
const COMPARING_UPDATE_SNAPSHOTS = 'none'

/** Forward slashes everywhere, and no leading `./`. */
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

/**
 * Every e2e spec file on disk, as a sorted list of posix-style paths relative
 * to the WEB ROOT (`e2e/webgl.spec.ts`).
 *
 * That is NOT the spelling Playwright's JSON reporter uses. The reporter writes
 * `spec.file` relative to `testDir`, i.e. `webgl.spec.ts` -- measured on the
 * report from CI run 33098730686, where every `spec.file` is a bare filename
 * and `config.rootDir` is the absolute path of `<web>/e2e`. The two are the
 * same files described from different roots, and `matchesReportedFile` below is
 * what reconciles them. This comment used to claim they were the same spelling,
 * which is why the gate reported both specs "not run" against a run in which
 * all of the then-required tests had passed.
 *
 * Read off disk rather than written out as a literal so that adding a second
 * e2e spec cannot leave this gate quietly checking only the first one. A
 * missing `e2e/` directory throws here rather than yielding an empty list: an
 * empty expectation is exactly the vacuous pass this gate exists to refuse.
 */
export function listVisualSpecFiles(webRoot) {
  const root = toPosix(resolve(webRoot))
  return walk(resolve(webRoot, TEST_DIR))
    .map((file) => posix.relative(root, toPosix(file)))
    .filter((path) => SPEC_FILE.test(path))
    .sort()
}

/**
 * Did this expected spec file run, according to the paths the report carries?
 *
 * An expected path is rooted at the web root and a reported one at `testDir`,
 * so exactly two spellings are accepted: the expected path itself, and the
 * expected path with its leading `testDir` segment removed. Both are compared
 * WHOLE.
 *
 * Deliberately not a basename comparison, which is the obvious shortcut and is
 * wrong: it would let a `webgl.spec.ts` from any other directory satisfy an
 * expectation of `e2e/webgl.spec.ts`, and a gate that accepts the right name
 * from the wrong place is a gate that cannot see `testDir` moving -- failure
 * mode 2 in the header, and one of the four this script exists for. Stripping
 * a known prefix keeps every other segment significant, so a nested spec
 * (`e2e/sub/a.spec.ts` reported as `sub/a.spec.ts`) still matches on its whole
 * relative path.
 */
function matchesReportedFile(expected, reportedFiles) {
  if (reportedFiles.has(expected)) {
    return true
  }
  const prefix = `${TEST_DIR}/`
  return expected.startsWith(prefix) && reportedFiles.has(expected.slice(prefix.length))
}

/** Every spec in the report, flattened out of the nested suite tree. */
function collectSpecs(report) {
  const specs = []
  const queue = Array.isArray(report.suites) ? [...report.suites] : []
  while (queue.length > 0) {
    const suite = queue.shift()
    if (suite === null || typeof suite !== 'object') {
      continue
    }
    if (Array.isArray(suite.specs)) {
      specs.push(...suite.specs.filter((spec) => spec !== null && typeof spec === 'object'))
    }
    if (Array.isArray(suite.suites)) {
      queue.push(...suite.suites)
    }
  }
  return specs
}

/**
 * The manifest is intentionally closed over the files on disk. Discovery and
 * expectation are separate inputs: if a spec is added, removed, duplicated or
 * moved, this comparison fails until the manifest is reviewed explicitly.
 */
export function auditVisualSpecInventory(actualSpecs) {
  const problems = []
  const expected = Object.keys(REQUIRED_VISUAL_TESTS).sort()
  const actualCounts = new Map()

  for (const path of actualSpecs) {
    const normalized = toPosix(path)
    actualCounts.set(normalized, (actualCounts.get(normalized) ?? 0) + 1)
  }

  for (const path of expected) {
    const count = actualCounts.get(path) ?? 0
    if (count !== 1) {
      problems.push(`${path}: found ${count} time(s) on disk (expected exactly once)`)
    }
  }
  for (const [path, count] of actualCounts) {
    if (!Object.hasOwn(REQUIRED_VISUAL_TESTS, path)) {
      problems.push(`${path}: unmanifested visual spec found ${count} time(s) on disk`)
    }
  }

  return problems
}

const compactExpression = (node, sourceFile) => node.getText(sourceFile).replace(/\s+/g, '')

function canonicalArgument(node, sourceFile) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return JSON.stringify(node.text)
  }
  return compactExpression(node, sourceFile)
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function numericLiteralValue(node) {
  const expression = unwrapExpression(node)
  return ts.isNumericLiteral(expression) ? Number(expression.text) : undefined
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function topLevelVariableDeclarations(sourceFile, name) {
  const declarations = []
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        declarations.push(declaration)
      }
    }
  }
  return declarations
}

function exactObjectLiteral(node, expectedProperties) {
  const expression = unwrapExpression(node)
  if (!ts.isObjectLiteralExpression(expression)) {
    return false
  }
  if (expression.properties.length !== Object.keys(expectedProperties).length) {
    return false
  }
  for (const [name, expected] of Object.entries(expectedProperties)) {
    const matches = expression.properties.filter(
      (property) =>
        ts.isPropertyAssignment(property) && propertyNameText(property.name) === name,
    )
    if (matches.length !== 1 || numericLiteralValue(matches[0].initializer) !== expected) {
      return false
    }
  }
  return true
}

function exactNumericCallDeclaration(sourceFile, name, callee, argument) {
  const declarations = topLevelVariableDeclarations(sourceFile, name)
  if (declarations.length !== 1 || declarations[0].initializer === undefined) {
    return false
  }
  const initializer = unwrapExpression(declarations[0].initializer)
  return (
    ts.isCallExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    initializer.expression.text === callee &&
    initializer.arguments.length === 1 &&
    numericLiteralValue(initializer.arguments[0]) === argument
  )
}

function exactNumericDeclaration(sourceFile, name, value) {
  const declarations = topLevelVariableDeclarations(sourceFile, name)
  return (
    declarations.length === 1 &&
    declarations[0].initializer !== undefined &&
    numericLiteralValue(declarations[0].initializer) === value
  )
}

function isThresholdGuard(statement) {
  if (
    !ts.isIfStatement(statement) ||
    statement.elseStatement !== undefined ||
    !ts.isBinaryExpression(unwrapExpression(statement.expression))
  ) {
    return false
  }
  const condition = unwrapExpression(statement.expression)
  const right = unwrapExpression(condition.right)
  return (
    condition.operatorToken.kind === ts.SyntaxKind.LessThanToken &&
    ts.isIdentifier(unwrapExpression(condition.left)) &&
    unwrapExpression(condition.left).text === 'threshold' &&
    ts.isPropertyAccessExpression(right) &&
    ts.isIdentifier(right.expression) &&
    right.expression.text === 'COMPARISON' &&
    right.name.text === 'threshold' &&
    ts.isBlock(statement.thenStatement) &&
    statement.thenStatement.statements.length === 1 &&
    ts.isThrowStatement(statement.thenStatement.statements[0])
  )
}

function isComparisonReturn(statement) {
  if (!ts.isReturnStatement(statement) || statement.expression === undefined) {
    return false
  }
  const expression = unwrapExpression(statement.expression)
  if (!ts.isObjectLiteralExpression(expression) || expression.properties.length !== 2) {
    return false
  }
  const [spread, threshold] = expression.properties
  return (
    ts.isSpreadAssignment(spread) &&
    ts.isIdentifier(spread.expression) &&
    spread.expression.text === 'COMPARISON' &&
    ts.isShorthandPropertyAssignment(threshold) &&
    threshold.name.text === 'threshold'
  )
}

function hasExactRejectionComparison(sourceFile) {
  const functions = sourceFile.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'rejectionComparison',
  )
  if (functions.length !== 1) {
    return false
  }
  const declaration = functions[0]
  return (
    declaration.parameters.length === 1 &&
    ts.isIdentifier(declaration.parameters[0].name) &&
    declaration.parameters[0].name.text === 'threshold' &&
    declaration.body !== undefined &&
    declaration.body.statements.length === 2 &&
    isThresholdGuard(declaration.body.statements[0]) &&
    isComparisonReturn(declaration.body.statements[1])
  )
}

function hasExactOptionsHelper(sourceFile, name, comparison) {
  const declarations = topLevelVariableDeclarations(sourceFile, name)
  if (declarations.length !== 1 || declarations[0].initializer === undefined) {
    return false
  }
  const initializer = unwrapExpression(declarations[0].initializer)
  if (
    !ts.isArrowFunction(initializer) ||
    initializer.parameters.length !== 1 ||
    !ts.isIdentifier(initializer.parameters[0].name) ||
    initializer.parameters[0].name.text !== 'page'
  ) {
    return false
  }
  const body = unwrapExpression(initializer.body)
  if (!ts.isObjectLiteralExpression(body) || body.properties.length !== 2) {
    return false
  }
  const [spread, mask] = body.properties
  return (
    ts.isSpreadAssignment(spread) &&
    ts.isIdentifier(spread.expression) &&
    spread.expression.text === comparison &&
    ts.isPropertyAssignment(mask) &&
    propertyNameText(mask.name) === 'mask' &&
    ts.isCallExpression(mask.initializer) &&
    ts.isIdentifier(mask.initializer.expression) &&
    mask.initializer.expression.text === 'overlays' &&
    mask.initializer.arguments.length === 1 &&
    ts.isIdentifier(mask.initializer.arguments[0]) &&
    mask.initializer.arguments[0].text === 'page'
  )
}

/** Pin the values and construction chain that define visual comparison strength. */
function auditSliceComparisonConfiguration(sourceFile) {
  const problems = []
  const comparison = topLevelVariableDeclarations(sourceFile, 'COMPARISON')
  if (comparison.length !== 1 || comparison[0].initializer === undefined) {
    problems.push('COMPARISON must be declared exactly once as the visual comparison object')
  } else {
    const initializer = unwrapExpression(comparison[0].initializer)
    for (const [property, value] of [
      ['threshold', 0.02],
      ['maxDiffPixelRatio', 0.001],
      ['timeout', 30_000],
    ]) {
      const matches = ts.isObjectLiteralExpression(initializer)
        ? initializer.properties.filter(
            (candidate) =>
              ts.isPropertyAssignment(candidate) && propertyNameText(candidate.name) === property,
          )
        : []
      if (matches.length !== 1 || numericLiteralValue(matches[0].initializer) !== value) {
        problems.push(`COMPARISON.${property} must be the numeric literal ${value}`)
      }
    }
    if (
      !exactObjectLiteral(initializer, {
        threshold: 0.02,
        maxDiffPixelRatio: 0.001,
        timeout: 30_000,
      })
    ) {
      problems.push('COMPARISON must contain exactly threshold, maxDiffPixelRatio and timeout')
    }
  }

  for (const [name, argument] of [
    ['HALF_PERIOD_REJECTION', 0.05],
    ['TRANSPOSE_REJECTION', 0.1],
    ['GEOMETRY_REJECTION', 0.1],
  ]) {
    if (!exactNumericCallDeclaration(sourceFile, name, 'rejectionComparison', argument)) {
      problems.push(`${name} must be rejectionComparison(${argument})`)
    }
  }
  if (!exactNumericDeclaration(sourceFile, 'GEOMETRY_SCALE', 1.02)) {
    problems.push('GEOMETRY_SCALE must be the numeric literal 1.02')
  }
  if (!hasExactRejectionComparison(sourceFile)) {
    problems.push(
      'rejectionComparison must guard threshold < COMPARISON.threshold and return ' +
        '{ ...COMPARISON, threshold }',
    )
  }
  for (const [name, comparisonName] of [
    ['screenshotOptions', 'COMPARISON'],
    ['halfPeriodRejectionOptions', 'HALF_PERIOD_REJECTION'],
    ['transposeRejectionOptions', 'TRANSPOSE_REJECTION'],
    ['geometryRejectionOptions', 'GEOMETRY_REJECTION'],
  ]) {
    if (!hasExactOptionsHelper(sourceFile, name, comparisonName)) {
      problems.push(
        `${name} must return { ...${comparisonName}, mask: overlays(page) } exactly`,
      )
    }
  }
  return problems
}

function unwrapExpect(node) {
  let receiver = node
  let negated = false
  if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'not') {
    negated = true
    receiver = receiver.expression
  }
  if (
    !ts.isCallExpression(receiver) ||
    !ts.isIdentifier(receiver.expression) ||
    receiver.expression.text !== 'expect'
  ) {
    return undefined
  }
  return { call: receiver, negated }
}

function sourceAssertionKey(call, testTitle, sourceFile) {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined
  }
  const matcher = call.expression.name.text
  const expected = unwrapExpect(call.expression.expression)
  if (expected === undefined || expected.call.arguments.length === 0) {
    return undefined
  }

  if (matcher === 'toHaveScreenshot') {
    const snapshot = call.arguments[0]
    const options = call.arguments[1]
    if (
      snapshot !== undefined &&
      (ts.isStringLiteral(snapshot) || ts.isNoSubstitutionTemplateLiteral(snapshot)) &&
      options !== undefined &&
      ts.isCallExpression(options) &&
      ts.isIdentifier(options.expression)
    ) {
      return screenshotKey(
        testTitle,
        expected.negated,
        snapshot.text,
        options.expression.text,
      )
    }
    return undefined
  }

  if (call.arguments[0] === undefined) {
    return undefined
  }
  return expectKey(
    testTitle,
    compactExpression(expected.call.arguments[0], sourceFile),
    expected.negated,
    matcher,
    canonicalArgument(call.arguments[0], sourceFile),
  )
}

/** Statements that make the rest of a required test callback non-linear. */
const NONLINEAR_TOP_LEVEL_STATEMENTS = new Map([
  [ts.SyntaxKind.Block, 'block'],
  [ts.SyntaxKind.BreakStatement, 'break'],
  [ts.SyntaxKind.ContinueStatement, 'continue'],
  [ts.SyntaxKind.DoStatement, 'do'],
  [ts.SyntaxKind.ForInStatement, 'for-in'],
  [ts.SyntaxKind.ForOfStatement, 'for-of'],
  [ts.SyntaxKind.ForStatement, 'for'],
  [ts.SyntaxKind.IfStatement, 'if'],
  [ts.SyntaxKind.LabeledStatement, 'label'],
  [ts.SyntaxKind.ReturnStatement, 'return'],
  [ts.SyntaxKind.SwitchStatement, 'switch'],
  [ts.SyntaxKind.ThrowStatement, 'throw'],
  [ts.SyntaxKind.TryStatement, 'try'],
  [ts.SyntaxKind.WhileStatement, 'while'],
  [ts.SyntaxKind.WithStatement, 'with'],
])

/**
 * Collect only a test callback's direct, awaited assertion statements.
 *
 * Recursively finding a matcher is not evidence that it ran: the same AST can
 * sit below `if (false)`, in an uncalled function, or in an unawaited callback.
 * Requiring the exact top-level `await expect(...).matcher(...)` shape makes
 * all three changes remove the assertion from this inventory. Required test
 * callbacks are also kept linear at that level: a return or control-flow
 * statement before a syntactically direct assertion could otherwise make it
 * unreachable while leaving its shape unchanged.
 */
function collectSourceAssertions(sourceFile, requiredTestTitles) {
  const counts = new Map()
  const nonlinear = []
  const add = (key) => counts.set(key, (counts.get(key) ?? 0) + 1)

  const isTestCall = (node) =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'test'

  const visitTest = (node) => {
    if (isTestCall(node)) {
      const title = node.arguments[0]
      const callback = node.arguments[1]
      if (
        title !== undefined &&
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) &&
        requiredTestTitles.has(title.text) &&
        callback !== undefined &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        ts.isBlock(callback.body)
      ) {
        for (const statement of callback.body.statements) {
          const controlFlow = NONLINEAR_TOP_LEVEL_STATEMENTS.get(statement.kind)
          if (controlFlow !== undefined) {
            nonlinear.push({ title: title.text, statement: controlFlow })
          }
          if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) {
            continue
          }
          const awaited = statement.expression.expression
          if (!ts.isCallExpression(awaited)) {
            continue
          }
          const key = sourceAssertionKey(awaited, title.text, sourceFile)
          if (key !== undefined) {
            add(key)
          }
        }
      }
      return
    }
    ts.forEachChild(node, visitTest)
  }

  ts.forEachChild(sourceFile, visitTest)
  return { counts, nonlinear }
}

/**
 * Audit the assertions Playwright omits from its JSON report. Parsing instead
 * of substring matching keeps comments and coincidental strings from
 * satisfying the gate, and associates each assertion with its exact test.
 */
export function auditVisualSpecSource(specPath, source) {
  const normalized = toPosix(specPath)
  const requirements = REQUIRED_VISUAL_SOURCE_ASSERTIONS[normalized]
  if (requirements === undefined) {
    return [`${normalized}: no required-source-assertion manifest exists`]
  }
  const requiredTitles = REQUIRED_VISUAL_TESTS[normalized]
  if (requiredTitles === undefined) {
    return [`${normalized}: no required-test manifest exists`]
  }

  const sourceFile = ts.createSourceFile(
    normalized,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    return sourceFile.parseDiagnostics.map(
      (diagnostic) =>
        `${normalized}: TypeScript parse error: ${ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          '\n',
        )}`,
    )
  }

  const { counts: actual, nonlinear } = collectSourceAssertions(
    sourceFile,
    new Set(requiredTitles),
  )
  const problems = [
    ...(normalized === SLICE_SPEC
      ? auditSliceComparisonConfiguration(sourceFile).map(
          (problem) => `${normalized}: ${problem}`,
        )
      : []),
    ...nonlinear.map(
      (problem) =>
        `${normalized} > "${problem.title}": top-level ${problem.statement} statement makes ` +
        'required visual assertions conditional or unreachable',
    ),
  ]
  for (const requirement of requirements) {
    const expectedCount = requirement.count ?? 1
    const actualCount = actual.get(requirement.key) ?? 0
    if (actualCount !== expectedCount) {
      problems.push(
        `${normalized}: ${requirement.label} appears ${actualCount} time(s) ` +
          `(expected exactly ${expectedCount})`,
      )
    }
  }
  return problems
}

/** Read and audit every source file named by the closed assertion manifest. */
export function auditVisualSources(webRoot) {
  const problems = []
  for (const specPath of Object.keys(REQUIRED_VISUAL_SOURCE_ASSERTIONS)) {
    const absolute = resolve(webRoot, ...specPath.split('/'))
    try {
      problems.push(...auditVisualSpecSource(specPath, readFileSync(absolute, 'utf-8')))
    } catch (error) {
      problems.push(`${specPath}: could not read source: ${String(error)}`)
    }
  }
  return problems
}

/**
 * Audit one Playwright JSON report document. Returns a list of human-readable
 * problems; an empty list means the run is acceptable.
 */
export function auditVisualRun(report, expectedSpecs) {
  const problems = []

  const updateSnapshots = report.config?.updateSnapshots
  if (updateSnapshots !== COMPARING_UPDATE_SNAPSHOTS) {
    problems.push(
      `config.updateSnapshots = ${JSON.stringify(updateSnapshots)} (expected ` +
        `"${COMPARING_UPDATE_SNAPSHOTS}"): this run WROTE its baselines instead of comparing ` +
        'against them, so every screenshot assertion in it passed by construction',
    )
  }

  const specs = collectSpecs(report)
  const ran = new Set(specs.map((spec) => toPosix(spec.file)))
  for (const requestedSpec of expectedSpecs) {
    const specPath = toPosix(requestedSpec)
    if (!matchesReportedFile(specPath, ran)) {
      problems.push(`${specPath}: not run (absent from the Playwright report)`)
      continue
    }

    const requiredTitles = REQUIRED_VISUAL_TESTS[specPath]
    if (requiredTitles === undefined) {
      problems.push(`${specPath}: no required-test manifest exists`)
      continue
    }
    const fileSpecs = specs.filter((spec) =>
      matchesReportedFile(specPath, new Set([toPosix(spec.file)])),
    )
    for (const title of requiredTitles) {
      const titleSpecs = fileSpecs.filter((spec) => spec.title === title)
      const executions = titleSpecs.reduce(
        (count, spec) => count + (Array.isArray(spec.tests) ? spec.tests.length : 0),
        0,
      )
      if (titleSpecs.length !== 1 || executions !== 1) {
        problems.push(
          `${specPath} > "${title}": required test ran ${executions} time(s) in ` +
            `${titleSpecs.length} report entry/entries (expected exactly once)`,
        )
      }
    }
  }

  let tested = 0
  for (const spec of specs) {
    const where = `${toPosix(spec.file)} > "${spec.title}"`
    if (spec.ok !== true) {
      problems.push(`${where}: did not pass (ok = ${String(spec.ok)})`)
    }
    const tests = Array.isArray(spec.tests) ? spec.tests : []
    if (tests.length === 0) {
      problems.push(`${where}: ran zero tests`)
    }
    for (const test of tests) {
      tested += 1
      if (test.status !== PASSING_TEST_STATUS) {
        problems.push(`${where}: test status is "${test.status}"`)
      }
      const results = Array.isArray(test.results) ? test.results : []
      if (results.length === 0) {
        problems.push(`${where}: produced no result`)
      }
      for (const result of results) {
        if (result.status !== PASSING_RESULT_STATUS) {
          problems.push(`${where}: result status is "${result.status}"`)
        }
      }
    }
  }

  if (tested === 0) {
    problems.push('the report contains zero tests (nothing was compared against a baseline)')
  }

  return problems
}

function main() {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const reportPath = resolve(webRoot, process.argv[2] ?? 'test-results/visual-report.json')
  if (!existsSync(reportPath)) {
    console.error(
      `assert-visual-run: ${reportPath} does not exist; Playwright wrote no JSON report.`,
    )
    process.exit(1)
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
  const discoveredSpecs = listVisualSpecFiles(webRoot)
  const requiredSpecs = Object.keys(REQUIRED_VISUAL_TESTS).sort()
  const problems = [
    ...auditVisualSpecInventory(discoveredSpecs),
    ...auditVisualSources(webRoot),
    ...auditVisualRun(report, requiredSpecs),
  ]
  if (problems.length > 0) {
    console.error(`assert-visual-run: ${problems.length} problem(s) in ${reportPath}:`)
    for (const problem of problems) {
      console.error(`  - ${problem}`)
    }
    process.exit(1)
  }
  const requiredTests = Object.values(REQUIRED_VISUAL_TESTS).reduce(
    (count, titles) => count + titles.length,
    0,
  )
  console.log(
    `assert-visual-run: all ${requiredTests} required tests in ${requiredSpecs.length} ` +
      'e2e spec file(s) passed with their required visual assertions, ' +
      'compared against committed baselines (updateSnapshots = none).',
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
