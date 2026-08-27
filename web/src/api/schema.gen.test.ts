/**
 * `src/api/schema.gen.ts` must be exactly what the committed OpenAPI fixture
 * generates -- checked by running the generator, not by trusting it.
 *
 * The contract chain has three links and this spec closes the last one:
 *
 *   src/quviz/api/  ->  tests/fixtures/openapi.json  ->  src/api/schema.gen.ts
 *                   ^                              ^
 *                   |                              this spec
 *                   tests/test_openapi_contract.py
 *
 * A generated file that nothing regenerates is a hand-written file with a
 * misleading header: someone edits it (or simply forgets to rerun the
 * generator after the fixture moves) and `tsc` goes on certifying the
 * front-end against types no longer derived from the API. Both halves of that
 * failure are silent -- the Python suite drives the live app and passes, the
 * web suite compiles the committed types and passes.
 *
 * So this imports `generateApiTypes` from `../../scripts/generate-api-types.mjs`
 * -- the SAME exported function `npm run codegen` calls, not the
 * `openapi-typescript` CLI. Going through the CLI would prove that some
 * invocation reproduces the file while leaving the one the codegen script
 * actually performs (its banner, its options, its input path) unchecked, which
 * is precisely the part a drift would live in.
 *
 * The generated module is excluded from the coverage thresholds, like
 * `src/api/types.ts`, on the grounds that it is type-only. That claim is not
 * taken on trust either: it is in `coverage-scope.json`'s `pragmaScanned` list,
 * so `src/guards.test.ts` ("keeps the modules coverage excludes as type-only
 * actually type-only") parses it and fails on any top-level statement the
 * compiler would emit -- a value export, a bare side effect, a live `enum`.
 * If openapi-typescript is ever configured to emit runtime code (its `enum`
 * option does), that guard goes red rather than this exclusion quietly
 * becoming a hole.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { generateApiTypes } from '../../scripts/generate-api-types.mjs'

/** The same fixture `npm run codegen` reads, addressed the way qvpc.test.ts addresses its golden. */
const fixtureUrl = new URL('../../../tests/fixtures/openapi.json', import.meta.url)
const generatedUrl = new URL('./schema.gen.ts', import.meta.url)

const committed = readFileSync(fileURLToPath(generatedUrl), 'utf-8')
const fixtureText = readFileSync(fileURLToPath(fixtureUrl), 'utf-8')

/** Write `document` to a throwaway file and hand back its URL, as the generator takes it. */
function schemaFileUrl(document: unknown): URL {
  const directory = mkdtempSync(join(tmpdir(), 'quviz-schema-'))
  const path = join(directory, 'openapi.json')
  writeFileSync(path, JSON.stringify(document, null, 2), 'utf-8')
  return pathToFileURL(path)
}

describe('src/api/schema.gen.ts is generated, not written', () => {
  it('reproduces the committed file byte for byte from the committed fixture', async () => {
    const regenerated = await generateApiTypes(fixtureUrl)
    expect(regenerated).toBe(committed)
  })

  it('carries a banner that says it is generated and how to regenerate it', () => {
    // The file is committed, so the first thing a reader who opens it needs to
    // know is not to edit it. Pinned here rather than eyeballed, because the
    // byte comparison above is satisfied by a banner that says nothing at all.
    expect(committed.startsWith('/**')).toBe(true)
    expect(committed).toContain('npm run codegen')
    expect(committed).toContain('scripts/write_openapi.py')
  })

  it('produces different types from a different schema (negative control)', async () => {
    // Without this the comparison above would pass against a generator that
    // ignored its argument entirely -- one returning a constant, or reading
    // the committed file back. Rename a response schema in a COPY of the
    // fixture and the generated types must change with it.
    const document = JSON.parse(fixtureText) as {
      paths: Record<string, Record<string, { operationId?: string }>>
    }
    const [path] = Object.keys(document.paths)
    const [method] = Object.keys(document.paths[path])
    const operation = document.paths[path][method]
    expect(typeof operation.operationId, `${method} ${path} has no operationId`).toBe('string')
    operation.operationId = `${operation.operationId}_mutated`

    const regenerated = await generateApiTypes(schemaFileUrl(document))
    expect(regenerated).not.toBe(committed)
    expect(regenerated).toContain('_mutated')
    expect(committed).not.toContain('_mutated')
  })

  it('is a pure function of its input: the same schema twice gives the same text', async () => {
    // openapi-typescript keeps module-level caches (`enumCache`), so "runs
    // once correctly" and "is deterministic" are different claims. The byte
    // comparison is only a gate if the second claim holds, otherwise a green
    // run here and a red one in CI differ by call order.
    const document: unknown = JSON.parse(fixtureText)
    const first = await generateApiTypes(schemaFileUrl(document))
    const second = await generateApiTypes(schemaFileUrl(document))
    expect(first).toBe(second)
    expect(first).toBe(committed)
  })
})
