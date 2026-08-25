#!/usr/bin/env node
/**
 * Delete the two report files `npm test` gates on, BEFORE vitest runs.
 *
 * Both gates that run after vitest -- `assert-no-skips.mjs` (reads
 * coverage/vitest-results.json) and `assert-coverage-scope.mjs` (reads
 * coverage/coverage-final.json) -- are only as trustworthy as their claim to
 * be reading THIS run's output. `coverage.clean` defaults to true and does
 * wipe the coverage directory, but it is the coverage provider that does the
 * wiping, so it only happens when coverage is enabled at all. Measured on
 * this tree (vitest 3.2.7):
 *
 *   npm test                -> coverage/ wiped, both files rewritten
 *   vitest run (no coverage)-> BOTH files survive untouched from the last run
 *
 * So dropping `--coverage` from the `test` script (or `--coverage.enabled=
 * false`, or a reporter list without `json`) would leave a previous, green
 * report in place for the post-run gates to read and pass. Deleting the files
 * up front turns every one of those into a hard failure: the gates refuse a
 * missing report rather than accepting a stale one.
 *
 * Plain ESM, no dependencies, cross-platform (`rmSync`, not `rm -f`).
 */
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Web-root-relative. Every file here is an INPUT to a post-run gate. */
const STALE_ARTEFACTS = ['coverage/coverage-final.json', 'coverage/vitest-results.json']

function main() {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  for (const artefact of STALE_ARTEFACTS) {
    const target = resolve(webRoot, artefact)
    try {
      rmSync(target, { force: true })
    } catch (error) {
      console.error(`clean-coverage: cannot delete ${target}: ${error.message}`)
      process.exit(1)
    }
    // `force: true` swallows ENOENT but nothing else; confirm the file is
    // really gone rather than trusting the absence of a throw, because a
    // survivor here is exactly the stale report the post-run gates must never
    // be handed.
    if (existsSync(target)) {
      console.error(`clean-coverage: ${target} still exists after deletion; refusing to run`)
      process.exit(1)
    }
  }
  console.log(`clean-coverage: removed ${STALE_ARTEFACTS.length} stale report file(s), if present.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
