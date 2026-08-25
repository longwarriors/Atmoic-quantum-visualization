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
 *                        is the directory the report is read from.
 *   processingConcurrency  min(20, availableParallelism()) -> a fixed marker.
 *                        The KEY is still pinned; only its machine-dependent
 *                        value is not.
 *
 * Anything JSON cannot represent (a function, a symbol, undefined) is written
 * as an explicit marker string rather than dropped, so it fails the gate's
 * deep-equal loudly instead of vanishing from the captured key set.
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
const SCHEMA = 1

/** Machine-dependent by construction; the key is pinned, the value is not. */
const MACHINE_DEPENDENT = '<machine-dependent>'

const toPosix = (path) => String(path).split('\\').join('/')

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
    return Number.isFinite(value) ? value : `<${String(value)}>`
  }
  if (type === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, jsonSafe(value[key])]),
    )
  }
  return `<${type}>`
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
        ? toPosix(relative(root, resolve(root, directory))) || '.'
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
    coverage: normalizeResolvedCoverage(config.coverage, root),
  }

  const target = resolve(webRoot, CAPTURE)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(captured, null, 2)}\n`, 'utf-8')
}
