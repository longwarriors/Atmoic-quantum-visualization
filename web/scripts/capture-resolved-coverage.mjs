/**
 * Write the coverage configuration vitest RESOLVED for this run to
 * coverage/resolved-coverage.json, so a gate outside the run can check it.
 *
 * Wired in as `globalSetup` in vitest.config.ts. vitest calls `setup(project)`
 * once per run, after the config is fully resolved and after the coverage
 * provider has cleaned its reports directory (measured on vitest 3.2.7:
 * `Vitest.start()` awaits `coverageProvider.clean()` before `runFiles()`,
 * which is what calls `_initializeGlobalSetup()`), so the file written here
 * survives the run and is not a leftover from the previous one.
 *
 * WHY THIS EXISTS
 *
 * src/guards.test.ts reads vitest.config.ts's config SOURCE; scripts/
 * assert-coverage-scope.mjs reads the REPORT the run wrote. Neither can see
 * the config vitest actually ran under, and three rounds of review found the
 * same hole one key further out each time: the file set was bound and
 * `thresholds` was free; `thresholds` was bound and `provider` was free.
 * With `provider` free, a `--coverage.provider=custom
 * --coverage.customProviderModule=...` flag persisted into the `test` script,
 * or a Vite plugin `config()` hook setting the same two fields, made a
 * hand-written coverage-final.json the thing the gate certified: every guard
 * green, both gate lines printed, and an uncovered exported function shipping
 * in a gated module (measured, twice).
 *
 * `project.config` is the RESOLVED config -- the object vitest hands the pool,
 * with CLI flags, plugin `config()` hooks and env overrides already folded in.
 * Proven, not assumed: `npx vitest run --coverage
 * --coverage.thresholds.lines=0` writes `"lines": 0` into the file below while
 * vitest.config.ts still says 90. (`project.vitest.config` is the same object
 * for the root project, which this file requires it to be.)
 *
 * WHAT IS WRITTEN
 *
 * Every key of the resolved `coverage` object, so there is no next key left
 * over for the next round to find. Two are normalised because their raw values
 * differ between machines and would make the pin unusable:
 *
 *   reportsDirectory     absolute -> posix path relative to the project root
 *                        (`coverage`), which is what the gate cares about: it
 *                        is the directory the report is read from. Case-folded
 *                        on Windows, where `COVERAGE` and `coverage` are one
 *                        directory and comparing them case-sensitively would
 *                        be a false RED on a run that used the pinned one.
 *   processingConcurrency  min(20, availableParallelism()) -> a fixed marker.
 *                        The KEY is still pinned; only its machine-dependent
 *                        value is not.
 *
 * Anything JSON cannot represent (a function, a symbol, undefined) is written
 * as an explicit MARKER rather than dropped, so it fails the gate's deep-equal
 * loudly instead of vanishing from the captured key set. A marker is an object
 * (see MARKER below), never a string, because a string marker cannot be told
 * apart from a genuine string value spelled the same way.
 *
 * WHAT IS NOT WRITTEN, AND WHY IT COULD NOT BE
 *
 * Nothing here is evidence about the process that hosts it. vitest assigns
 * `config.coverage = coverageProvider.resolveOptions()` BEFORE globalSetup
 * runs, so a coverage provider chosen by this repo decides what this module
 * captures. `coverageProviderName` below is one more layer against the naive
 * case, not a wall. The boundary is stated in full at the top of
 * scripts/assert-coverage-scope.mjs.
 *
 * Plain ESM, no dependencies. It writes and it throws; it decides nothing --
 * every expectation lives in coverage-scope.json and is enforced by
 * scripts/assert-coverage-scope.mjs.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Web-root-relative, and in scripts/clean-coverage.mjs's pre-clean list. */
const CAPTURE = 'coverage/resolved-coverage.json'

/** Bumped when the shape below changes; the gate refuses any other value. */
const SCHEMA = 2

/**
 * The key that makes an object in this capture a MARKER for something JSON
 * cannot carry, rather than a captured value.
 *
 * Markers used to be strings (`"<undefined>"`), which a genuine string value
 * spelled `"<undefined>"` normalised to character for character -- so the
 * capture could not say which of the two the run had resolved. Two shapes
 * separate them for good:
 *
 *   marker            exactly one key, `__captured`, naming the kind
 *   escaped literal   two keys, `__captured: "literal"` and `value`, for a
 *                     genuine object that carries `__captured` itself
 *
 * A string is now always a string, and the escape nests, so no config value
 * can be captured as some other config value's capture.
 */
const MARKER = '__captured'

const marker = (kind) => ({ [MARKER]: kind })

/** Machine-dependent by construction; the key is pinned, the value is not. */
const MACHINE_DEPENDENT = marker('machine-dependent')

const toPosix = (path) => String(path).split('\\').join('/')

/**
 * Windows compares paths case-insensitively, so `<root>/COVERAGE` and
 * `<root>/coverage` are ONE directory there and holding the capture to the
 * exact spelling would fail a run that used the pinned directory. On Linux
 * they are two directories and the pin must keep saying so.
 */
const foldCase = (path) => (process.platform === 'win32' ? path.toLowerCase() : path)

/**
 * `value` reduced to something JSON.stringify round-trips without dropping
 * anything. A function, a symbol, an `undefined` or a bigint inside the
 * resolved config would otherwise disappear from the object (or throw), and a
 * silently missing key is exactly what this capture exists to prevent.
 */
function jsonSafe(value) {
  if (value === null) {
    return null
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe)
  }
  const type = typeof value
  if (type === 'string' || type === 'boolean') {
    return value
  }
  if (type === 'number') {
    // NaN and +-Infinity serialise as `null`, which reads as a real value.
    return Number.isFinite(value) ? value : marker(String(value))
  }
  if (type === 'object') {
    const captured = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, jsonSafe(value[key])]),
    )
    // A genuine object carrying the marker key is wrapped rather than written
    // out as-is, so it cannot be read back as the marker it resembles.
    return Object.hasOwn(captured, MARKER) ? { [MARKER]: 'literal', value: captured } : captured
  }
  return marker(type)
}

/**
 * The resolved coverage options, normalised as described in the file comment.
 * Exported for src/guards.test.ts, which exercises it on synthetic configs so
 * the normalisation itself has controls.
 */
export function normalizeResolvedCoverage(coverage, root) {
  if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage)) {
    throw new Error(
      `capture-resolved-coverage: resolved config has no "coverage" object (got ${
        Array.isArray(coverage) ? 'an array' : String(coverage === null ? 'null' : typeof coverage)
      }); refusing to capture a config this gate cannot check`,
    )
  }
  const normalized = jsonSafe(coverage)
  if ('reportsDirectory' in normalized) {
    const directory = coverage.reportsDirectory
    normalized.reportsDirectory =
      typeof directory === 'string'
        ? foldCase(toPosix(relative(root, resolve(root, directory)))) || '.'
        : normalized.reportsDirectory
  }
  if ('processingConcurrency' in normalized) {
    normalized.processingConcurrency = MACHINE_DEPENDENT
  }
  return normalized
}

/**
 * vitest's globalSetup entry point. `project` is the TestProject; its `config`
 * getter is the resolved config (it throws if read before the Vite server is
 * up, which cannot happen here -- globalSetup runs well after that).
 */
export function setup(project) {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const config = project?.config
  if (config === null || typeof config !== 'object') {
    throw new Error(
      'capture-resolved-coverage: globalSetup received no resolved config; the vitest ' +
        'globalSetup contract changed and this capture would be vacuous',
    )
  }
  // The root project is the one whose config carries `coverage`; a non-root
  // project writing this file would pin a config the gate never asked about.
  // src/guards.test.ts separately refuses a `projects` / `workspace` config.
  const isRootProject = typeof project.isRootProject === 'function' ? project.isRootProject() : null
  const root = typeof config.root === 'string' ? config.root : webRoot

  const captured = {
    schema: SCHEMA,
    // Absolute, so the gate can confirm this capture describes ITS project and
    // not some other checkout's run that left a file behind.
    root: toPosix(root),
    isRootProject,
    projectName: typeof project.name === 'string' ? project.name : null,
    // Root-relative, so a globalSetup moved elsewhere is visible.
    globalSetup: (Array.isArray(config.globalSetup) ? config.globalSetup : []).map((file) =>
      posix.normalize(toPosix(relative(root, String(file)))),
    ),
    // ONE MORE LAYER, EXPLICITLY NOT THE WALL. `coverage` above is whatever
    // `initCoverageProvider()` assigned to `config.coverage` -- vitest sets it
    // to `coverageProvider.resolveOptions()` before globalSetup runs, so the
    // provider gets to describe itself there. This is the provider OBJECT
    // vitest loaded, which the naive fake does not bother to disguise (vitest
    // printed `Coverage enabled with fake` directly above three green gate
    // lines, measured). A fake that declares `name = 'v8'` passes this line as
    // easily as it passes the object above, and both are written by the
    // process they describe. `coverageProvider` is marked @internal in
    // vitest 3.2.7, so it is read defensively and captured as null when it is
    // not there -- which is also what coverage being disabled looks like, and
    // that is already a hard problem at the gate.
    coverageProviderName:
      typeof project?.vitest?.coverageProvider?.name === 'string'
        ? project.vitest.coverageProvider.name
        : null,
    coverage: normalizeResolvedCoverage(config.coverage, root),
  }

  const target = resolve(webRoot, CAPTURE)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(captured, null, 2)}\n`, 'utf-8')
}
